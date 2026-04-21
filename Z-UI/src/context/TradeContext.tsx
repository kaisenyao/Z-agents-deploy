import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { STOCK_HOLDINGS, CASH_VALUE, INITIAL_TRADE_HISTORY, SHORTS_HOLDINGS, CRYPTO_HOLDINGS, OPTIONS_HOLDINGS } from '../data/portfolioHoldings';
import { INITIAL_MARGIN_RATE, calculateCoverSettlement } from '../services/tradingEngine';
import { ensureBlankTradingAccountStorage } from '../store/tradingStore';
import { useLatestQuotes } from './MarketQuoteContext';
import { useAccountMetrics } from '../hooks/useAccountMetrics';
import { classifyAssetClass, isUsablePrice, normalizeAssetSymbol } from '../services/assetPricing';

export interface Holding {
  symbol: string;
  description: string;
  quantity: number;
  purchasePrice: number;
  currentPrice: number;
  purchaseDate: string;
  todayChange: number;
  avgCost?: number;
  previousClosePrice?: number;
  assetType?: 'Stock' | 'ETF' | 'Crypto' | 'Option';
}

export interface TradeRecord {
  id: string;
  date: string;
  symbol: string;
  assetType: 'Stock' | 'ETF' | 'Crypto' | 'Option';
  side: 'Buy' | 'Sell' | 'Short' | 'Cover';
  quantity: number;
  price: number;
  total: number;
  status: 'FILLED' | 'REJECTED' | 'PENDING' | 'CANCELLED';
}

export interface PortfolioSnapshot {
  timestamp: number;
  value: number;
  cash?: number;
  stocks?: number;
  options?: number;
  crypto?: number;
}

const PORTFOLIO_SNAPSHOT_INTERVAL_MS = 30 * 1000;
const PORTFOLIO_HISTORY_MAX_POINTS = 5000;

export interface TradeContextType {
  holdings: Holding[];
  shortPositions: Map<string, Holding>;
  cash: number;
  shortProceeds: number;
  marginHeld: number;
  tradeHistory: TradeRecord[];
  portfolioHistory: PortfolioSnapshot[];
  executeTrade: (
    symbol: string,
    quantity: number,
    price: number,
    side: 'Buy' | 'Sell' | 'Short' | 'Cover',
    description: string
  ) => { success: boolean; message: string; orderId?: string };
  updateCurrentPrices: (quotes: Record<string, { price?: number; todayChange?: number; previousClosePrice?: number; assetType?: Holding['assetType'] }>) => void;
  setCashValue: (amount: number) => void;
}

const TradeContext = createContext<TradeContextType | undefined>(undefined);

const ETF_DESCRIPTION_PATTERN = /\bETF\b|Trust|Fund|Index/i;
const CRYPTO_DESCRIPTION_PATTERN = /Bitcoin|Ethereum|Solana|Crypto/i;
const KNOWN_CRYPTO_SYMBOLS = new Set(['BTC', 'ETH', 'DOGE', 'ADA', 'SOL', 'XRP', 'DOT', 'AVAX', 'BNB', 'LINK', 'MATIC']);

function normalizeTradeSymbol(symbol: string): string {
  return normalizeAssetSymbol(symbol);
}

function isSameTradeSymbol(left: string, right: string): boolean {
  return normalizeTradeSymbol(left) === normalizeTradeSymbol(right);
}

function inferAssetType(symbol: string, description: string): TradeRecord['assetType'] {
  const normalizedSymbol = normalizeTradeSymbol(symbol);

  if (
    KNOWN_CRYPTO_SYMBOLS.has(normalizedSymbol) ||
    CRYPTO_HOLDINGS.some((holding) => holding.symbol === symbol) ||
    CRYPTO_DESCRIPTION_PATTERN.test(description)
  ) {
    return 'Crypto';
  }

  if (
    STOCK_HOLDINGS.some(
      (holding) => holding.symbol === symbol && ETF_DESCRIPTION_PATTERN.test(holding.description)
    ) ||
    ETF_DESCRIPTION_PATTERN.test(description)
  ) {
    return 'ETF';
  }

  return 'Stock';
}

const SEEDED_TRADE_IDS = new Set(INITIAL_TRADE_HISTORY.map((trade) => trade.id));

function sanitizeTradeHistory(records: TradeRecord[]): TradeRecord[] {
  return records
    .filter((trade) => !SEEDED_TRADE_IDS.has(trade.id))
    .map((trade) => ({
      ...trade,
      status:
        trade.status === 'FILLED' || trade.status === 'PENDING' || trade.status === 'REJECTED' || trade.status === 'CANCELLED'
          ? trade.status
          : 'FILLED',
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function calculatePortfolioSnapshotValue(
  holdings: Holding[],
  shortPositions: Map<string, Holding>,
  cash: number,
  shortProceeds: number,
  marginHeld: number,
): number {
  const stockValue = holdings.reduce((sum, holding) => sum + (holding.currentPrice * holding.quantity), 0);
  const optionsValue = OPTIONS_HOLDINGS.reduce((sum, option) => sum + (option.mark * option.quantity * 100), 0);
  const cryptoValue = CRYPTO_HOLDINGS.reduce((sum, crypto) => sum + (crypto.currentPrice * crypto.quantity), 0);
  const shortsValue = Array.from(shortPositions.values()).reduce(
    (sum, shortHolding) => sum + (shortHolding.currentPrice * shortHolding.quantity),
    0,
  );
  const shortEquity = shortProceeds + marginHeld - shortsValue;

  return cash + stockValue + optionsValue + cryptoValue + shortEquity;
}

function calculatePortfolioSnapshotComposition(
  holdings: Holding[],
  cash: number,
): Pick<PortfolioSnapshot, 'cash' | 'stocks' | 'options' | 'crypto'> {
  const stocks = holdings.reduce((sum, holding) => {
    const assetClass = classifyAssetClass(holding.symbol, holding.description, holding.assetType);
    if (assetClass === 'crypto') return sum;
    return sum + (holding.currentPrice * holding.quantity);
  }, 0);
  const options = OPTIONS_HOLDINGS.reduce((sum, option) => sum + (option.mark * option.quantity * 100), 0);
  const crypto = holdings.reduce((sum, holding) => {
    const assetClass = classifyAssetClass(holding.symbol, holding.description, holding.assetType);
    if (assetClass !== 'crypto') return sum;
    return sum + (holding.currentPrice * holding.quantity);
  }, 0);

  return {
    cash,
    stocks,
    options,
    crypto,
  };
}

function sanitizePortfolioHistory(points: PortfolioSnapshot[]): PortfolioSnapshot[] {
  const deduped = new Map<number, PortfolioSnapshot>();

  points
    .filter((entry) => Number.isFinite(entry?.timestamp) && Number.isFinite(entry?.value) && Number(entry.value) >= 0)
    .sort((left, right) => left.timestamp - right.timestamp)
    .forEach((entry) => {
      deduped.set(Number(entry.timestamp), {
        timestamp: Number(entry.timestamp),
        value: Number(entry.value),
        cash: Number.isFinite(entry.cash) ? Number(entry.cash) : undefined,
        stocks: Number.isFinite(entry.stocks) ? Number(entry.stocks) : undefined,
        options: Number.isFinite(entry.options) ? Number(entry.options) : undefined,
        crypto: Number.isFinite(entry.crypto) ? Number(entry.crypto) : undefined,
      });
    });

  return Array.from(deduped.values())
    .sort((left, right) => left.timestamp - right.timestamp);
}

function hasValidSnapshotInputs(
  holdings: Holding[],
  shortPositions: Map<string, Holding>,
  cash: number,
  shortProceeds: number,
  marginHeld: number,
): boolean {
  if (![cash, shortProceeds, marginHeld].every((value) => Number.isFinite(value) && value >= 0)) {
    return false;
  }

  const hasPortfolioExposure =
    cash > 0 ||
    shortProceeds > 0 ||
    marginHeld > 0 ||
    holdings.some((holding) => (Number(holding.quantity) || 0) > 0) ||
    Array.from(shortPositions.values()).some((holding) => (Number(holding.quantity) || 0) > 0) ||
    OPTIONS_HOLDINGS.some((holding) => (Number(holding.quantity) || 0) > 0) ||
    CRYPTO_HOLDINGS.some((holding) => (Number(holding.quantity) || 0) > 0);

  if (!hasPortfolioExposure) {
    return false;
  }

  const liveHoldingMarksValid = holdings.every((holding) => {
    const quantity = Number(holding.quantity) || 0;
    return quantity <= 0 || isUsablePrice(Number(holding.currentPrice));
  });
  const shortMarksValid = Array.from(shortPositions.values()).every((holding) => {
    const quantity = Number(holding.quantity) || 0;
    return quantity <= 0 || isUsablePrice(Number(holding.currentPrice));
  });
  const optionMarksValid = OPTIONS_HOLDINGS.every((holding) => {
    const quantity = Number(holding.quantity) || 0;
    return quantity <= 0 || isUsablePrice(Number(holding.mark));
  });
  const cryptoMarksValid = CRYPTO_HOLDINGS.every((holding) => {
    const quantity = Number(holding.quantity) || 0;
    return quantity <= 0 || isUsablePrice(Number(holding.currentPrice));
  });

  return liveHoldingMarksValid && shortMarksValid && optionMarksValid && cryptoMarksValid;
}

export function TradeProvider({ children }: { children: React.ReactNode }) {
  ensureBlankTradingAccountStorage();

  const [holdings, setHoldings] = useState<Holding[]>(() => {
    const saved = localStorage.getItem('holdings');
    const parsed = saved ? JSON.parse(saved) : STOCK_HOLDINGS;
    return parsed.map((holding: Holding) => ({
      ...holding,
      assetType: holding.assetType || (
        classifyAssetClass(holding.symbol, holding.description) === 'crypto'
          ? 'Crypto'
          : classifyAssetClass(holding.symbol, holding.description) === 'etf'
            ? 'ETF'
            : 'Stock'
      ),
    }));
  });

  const [shortPositions, setShortPositions] = useState<Map<string, Holding>>(() => {
    const saved = localStorage.getItem('shortPositions');
    if (saved) {
      return new Map(JSON.parse(saved));
    }
    return new Map();
  });

  const [cash, setCash] = useState<number>(() => {
    const saved = localStorage.getItem('portfolioCash');
    return saved ? parseFloat(saved) : CASH_VALUE;
  });

  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>(() => {
    const saved = localStorage.getItem('tradeHistory');
    if (saved) {
      return sanitizeTradeHistory(JSON.parse(saved));
    }
    return [];
  });
  const [shortProceeds, setShortProceeds] = useState<number>(() => {
    const saved = localStorage.getItem('shortProceeds');
    if (!saved) return 0;
    const parsed = parseFloat(saved);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const [marginHeld, setMarginHeld] = useState<number>(() => {
    const saved = localStorage.getItem('marginHeld');
    if (!saved) return 0;
    const parsed = parseFloat(saved);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const [portfolioHistory, setPortfolioHistory] = useState<PortfolioSnapshot[]>(() => {
    const saved = localStorage.getItem('portfolioHistory');
    if (!saved) return [];

    try {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return [];
      return sanitizePortfolioHistory(parsed
        .filter((entry) => Number.isFinite(entry?.timestamp) && Number.isFinite(entry?.value))
        .map((entry) => ({
          timestamp: Number(entry.timestamp),
          value: Number(entry.value),
          cash: Number.isFinite(entry?.cash) ? Number(entry.cash) : undefined,
          stocks: Number.isFinite(entry?.stocks) ? Number(entry.stocks) : undefined,
          options: Number.isFinite(entry?.options) ? Number(entry.options) : undefined,
          crypto: Number.isFinite(entry?.crypto) ? Number(entry.crypto) : undefined,
        })));
    } catch {
      return [];
    }
  });
  const holdingsRef = useRef(holdings);
  const shortPositionsRef = useRef(shortPositions);
  const cashRef = useRef(cash);
  const shortProceedsRef = useRef(shortProceeds);
  const marginHeldRef = useRef(marginHeld);
  const accountValueRef = useRef(0);

  useEffect(() => {
    holdingsRef.current = holdings;
  }, [holdings]);

  useEffect(() => {
    shortPositionsRef.current = shortPositions;
  }, [shortPositions]);

  useEffect(() => {
    cashRef.current = cash;
  }, [cash]);

  useEffect(() => {
    shortProceedsRef.current = shortProceeds;
  }, [shortProceeds]);

  useEffect(() => {
    marginHeldRef.current = marginHeld;
  }, [marginHeld]);

  // Persist holdings to localStorage
  useEffect(() => {
    localStorage.setItem('holdings', JSON.stringify(holdings));
  }, [holdings]);

  // Persist short positions to localStorage
  useEffect(() => {
    localStorage.setItem('shortPositions', JSON.stringify(Array.from(shortPositions.entries())));
  }, [shortPositions]);

  // Persist cash to localStorage
  useEffect(() => {
    localStorage.setItem('portfolioCash', cash.toString());
  }, [cash]);

  // Persist trade history to localStorage
  useEffect(() => {
    localStorage.setItem('tradeHistory', JSON.stringify(tradeHistory));
  }, [tradeHistory]);

  useEffect(() => {
    localStorage.setItem('shortProceeds', shortProceeds.toString());
  }, [shortProceeds]);

  useEffect(() => {
    localStorage.setItem('marginHeld', marginHeld.toString());
  }, [marginHeld]);

  useEffect(() => {
    localStorage.setItem('portfolioHistory', JSON.stringify(portfolioHistory));
  }, [portfolioHistory]);

  const recordSnapshot = useCallback((value: number, force: boolean = false) => {
    if (!Number.isFinite(value)) return;
    if (!hasValidSnapshotInputs(
      holdingsRef.current,
      shortPositionsRef.current,
      cashRef.current,
      shortProceedsRef.current,
      marginHeldRef.current,
    )) {
      return;
    }

    setPortfolioHistory((current) => {
      const now = Date.now();
      const sanitizedCurrent = sanitizePortfolioHistory(current);
      const lastEntry = sanitizedCurrent[sanitizedCurrent.length - 1];
      const composition = calculatePortfolioSnapshotComposition(
        holdingsRef.current,
        cashRef.current,
      );

      if (
        lastEntry &&
        lastEntry.value === value &&
        lastEntry.cash === composition.cash &&
        lastEntry.stocks === composition.stocks &&
        lastEntry.options === composition.options &&
        lastEntry.crypto === composition.crypto &&
        now - lastEntry.timestamp < PORTFOLIO_SNAPSHOT_INTERVAL_MS
      ) {
        return sanitizedCurrent;
      }

      if (!force && lastEntry && now - lastEntry.timestamp < PORTFOLIO_SNAPSHOT_INTERVAL_MS) {
        const next = [...sanitizedCurrent];
        next[next.length - 1] = {
          timestamp: now,
          value,
          ...composition,
        };
        return next;
      }

      const next = [
        ...sanitizedCurrent,
        {
          timestamp: now,
          value,
          ...composition,
        },
      ];

      return next.length > PORTFOLIO_HISTORY_MAX_POINTS
        ? next.slice(next.length - PORTFOLIO_HISTORY_MAX_POINTS)
        : next;
    });
  }, []);

  const executeTrade = useCallback((
    symbol: string,
    quantity: number,
    price: number,
    side: 'Buy' | 'Sell' | 'Short' | 'Cover',
    description: string
  ) => {
    try {
      const total = quantity * price;
      const tradeId = `${symbol}-${Date.now()}`;
      const now = new Date().toISOString();
      const assetType = inferAssetType(symbol, description);
      const currentHoldings = holdingsRef.current;
      const currentShortPositions = shortPositionsRef.current;
      const currentCash = cashRef.current;
      const currentShortProceeds = shortProceedsRef.current;
      const currentMarginHeld = marginHeldRef.current;
      let nextHoldingsSnapshot = currentHoldings;
      let nextShortPositionsSnapshot = currentShortPositions;
      let nextCashSnapshot = currentCash;
      let nextShortProceedsSnapshot = currentShortProceeds;
      let nextMarginHeldSnapshot = currentMarginHeld;
      const holdingMatch = currentHoldings.find((h) => isSameTradeSymbol(h.symbol, symbol));
      const shortPositionEntry = Array.from(currentShortPositions.entries()).find(([shortSymbol, shortHolding]) => (
        isSameTradeSymbol(shortSymbol, symbol) || isSameTradeSymbol(shortHolding.symbol, symbol)
      ));
      const shortPositionKey = shortPositionEntry?.[0];
      const shortPosition = shortPositionEntry?.[1];

      const recordTrade = (
        status: TradeRecord['status'],
        overrides?: Partial<TradeRecord>
      ) => {
        const tradeRecord: TradeRecord = {
          id: overrides?.id || tradeId,
          date: overrides?.date || now,
          symbol: overrides?.symbol || symbol,
          assetType: overrides?.assetType || assetType,
          side: overrides?.side || side,
          quantity: overrides?.quantity ?? quantity,
          price: overrides?.price ?? price,
          total: overrides?.total ?? total,
          status,
        };

        setTradeHistory((prev) => [tradeRecord, ...prev]);
      };

      // Validate inputs
      if (quantity <= 0) {
        recordTrade('REJECTED');
        return { success: false, message: 'Quantity must be greater than 0' };
      }

      if (price <= 0) {
        recordTrade('REJECTED');
        return { success: false, message: 'Price must be greater than 0' };
      }

      if (side === 'Buy') {
        if (currentCash < total) {
          recordTrade('REJECTED');
          return {
            success: false,
            message: `Insufficient cash. Need $${total.toFixed(2)}, have $${currentCash.toFixed(2)}`,
          };
        }
      }

      if (side === 'Cover') {
        const availableFunds = currentShortProceeds + currentCash;
        if (availableFunds < total) {
          recordTrade('REJECTED');
          return {
            success: false,
            message: `Insufficient funds to cover. Need $${total.toFixed(2)}, have $${availableFunds.toFixed(2)}`,
          };
        }
      }

      if (side === 'Sell') {
        if (!holdingMatch || holdingMatch.quantity < quantity) {
          recordTrade('REJECTED');
          return {
            success: false,
            message: `Insufficient shares. Need ${quantity}, have ${holdingMatch?.quantity || 0}`,
          };
        }
      }

      if (side === 'Short') {
        if (holdingMatch && holdingMatch.quantity > 0) {
          recordTrade('REJECTED');
          return {
            success: false,
            message: `Cannot short ${symbol} while long shares are held.`,
          };
        }

        const requiredInitialMargin = total * INITIAL_MARGIN_RATE;
        if (currentCash < requiredInitialMargin) {
          recordTrade('REJECTED');
          return {
            success: false,
            message: `Insufficient buying power for margin. Need $${requiredInitialMargin.toFixed(2)}, have $${currentCash.toFixed(2)}`,
          };
        }
      }

      if (side === 'Cover') {
        if (!shortPosition || shortPosition.quantity < quantity) {
          recordTrade('REJECTED');
          return {
            success: false,
            message: `Insufficient short position. Need ${quantity}, have ${shortPosition?.quantity || 0}`,
          };
        }
      }

      // Execute trade logic
      if (side === 'Buy') {
        const nextHoldings = holdingMatch
          ? currentHoldings.map((holding) => {
              if (!isSameTradeSymbol(holding.symbol, symbol)) return holding;
              const totalShares = holding.quantity + quantity;
              const weightedCost =
                (holding.avgCost || holding.purchasePrice) * holding.quantity +
                price * quantity;
              const avgCost = weightedCost / totalShares;
              return {
                ...holding,
                quantity: totalShares,
                avgCost,
                purchasePrice: avgCost,
                assetType: holding.assetType || assetType,
              };
            })
          : [
              ...currentHoldings,
              {
                symbol,
                description,
                quantity,
                purchasePrice: price,
                currentPrice: price,
                purchaseDate: now,
                todayChange: 0,
                avgCost: price,
                previousClosePrice: price,
                assetType,
              },
            ];

        holdingsRef.current = nextHoldings;
        setHoldings(nextHoldings);
        cashRef.current = currentCash - total;
        setCash(cashRef.current);
        nextHoldingsSnapshot = nextHoldings;
        nextCashSnapshot = cashRef.current;
      } else if (side === 'Sell') {
        const remainingQty = (holdingMatch?.quantity || 0) - quantity;
        const nextHoldings = remainingQty <= 0
          ? currentHoldings.filter((holding) => !isSameTradeSymbol(holding.symbol, symbol))
          : currentHoldings.map((holding) => (
              isSameTradeSymbol(holding.symbol, symbol)
                ? { ...holding, quantity: remainingQty }
                : holding
            ));

        holdingsRef.current = nextHoldings;
        setHoldings(nextHoldings);
        cashRef.current = currentCash + total;
        setCash(cashRef.current);
        nextHoldingsSnapshot = nextHoldings;
        nextCashSnapshot = cashRef.current;
      } else if (side === 'Short') {
        const requiredInitialMargin = total * INITIAL_MARGIN_RATE;
        cashRef.current = currentCash - requiredInitialMargin;
        shortProceedsRef.current = currentShortProceeds + total;
        marginHeldRef.current = currentMarginHeld + requiredInitialMargin;
        setCash(cashRef.current);
        setShortProceeds(shortProceedsRef.current);
        setMarginHeld(marginHeldRef.current);

        const nextShortPositions = new Map(currentShortPositions);
        if (shortPosition && shortPositionKey) {
          const totalShares = shortPosition.quantity + quantity;
          const weightedAvgPrice =
            ((shortPosition.avgCost || shortPosition.purchasePrice) * shortPosition.quantity + price * quantity) /
            totalShares;
          nextShortPositions.set(shortPositionKey, {
            ...shortPosition,
            quantity: totalShares,
            avgCost: weightedAvgPrice,
            purchasePrice: weightedAvgPrice,
            assetType: shortPosition.assetType || assetType,
          });
        } else {
          nextShortPositions.set(symbol, {
            symbol,
            description,
            quantity,
            purchasePrice: price,
            currentPrice: price,
            purchaseDate: now,
            todayChange: 0,
            avgCost: price,
            previousClosePrice: price,
            assetType,
          });
        }

        shortPositionsRef.current = nextShortPositions;
        setShortPositions(nextShortPositions);
        nextCashSnapshot = cashRef.current;
        nextShortProceedsSnapshot = shortProceedsRef.current;
        nextMarginHeldSnapshot = marginHeldRef.current;
        nextShortPositionsSnapshot = nextShortPositions;
      } else if (side === 'Cover') {
        const remainingQty = (shortPosition?.quantity || 0) - quantity;
        const entryPrice = Number(shortPosition?.avgCost || shortPosition?.purchasePrice || 0);
        const settlement = calculateCoverSettlement(
          total,
          quantity,
          entryPrice,
          currentShortProceeds,
          currentMarginHeld,
          INITIAL_MARGIN_RATE
        );
        shortProceedsRef.current = Math.max(0, currentShortProceeds + settlement.shortProceedsDelta);
        marginHeldRef.current = Math.max(0, currentMarginHeld + settlement.marginHeldDelta);
        cashRef.current = currentCash + settlement.buyingPowerDelta;
        setShortProceeds(shortProceedsRef.current);
        setMarginHeld(marginHeldRef.current);
        setCash(cashRef.current);

        const nextShortPositions = new Map(currentShortPositions);
        if (shortPositionKey) {
          if (remainingQty <= 0) {
            nextShortPositions.delete(shortPositionKey);
          } else if (shortPosition) {
            nextShortPositions.set(shortPositionKey, {
              ...shortPosition,
              quantity: remainingQty,
            });
          }
        }

        shortPositionsRef.current = nextShortPositions;
        setShortPositions(nextShortPositions);
        nextCashSnapshot = cashRef.current;
        nextShortProceedsSnapshot = shortProceedsRef.current;
        nextMarginHeldSnapshot = marginHeldRef.current;
        nextShortPositionsSnapshot = nextShortPositions;
      }

      // Add to trade history
      const newTrade: TradeRecord = {
        id: tradeId,
        date: now,
        symbol,
        assetType,
        side,
        quantity,
        price,
        total,
        status: 'FILLED',
      };

      setTradeHistory((prev) => [newTrade, ...prev]);
      accountValueRef.current = calculatePortfolioSnapshotValue(
        nextHoldingsSnapshot,
        nextShortPositionsSnapshot,
        nextCashSnapshot,
        nextShortProceedsSnapshot,
        nextMarginHeldSnapshot,
      );
      recordSnapshot(accountValueRef.current, true);

      return {
        success: true,
        message: `${side} order executed: ${quantity} shares of ${symbol} at $${price.toFixed(2)}`,
        orderId: tradeId,
      };
    } catch (error) {
      const fallbackTotal = quantity * price;
      setTradeHistory((prev) => [
        {
          id: `${symbol}-${Date.now()}`,
          date: new Date().toISOString(),
          symbol,
          assetType: inferAssetType(symbol, description),
          side,
          quantity,
          price,
          total: Number.isFinite(fallbackTotal) ? fallbackTotal : 0,
          status: 'REJECTED',
        },
        ...prev,
      ]);
      return { success: false, message: `Error executing trade: ${error}` };
    }
  }, [recordSnapshot]);

  const updateCurrentPrices = useCallback((quotes: Record<string, { price?: number; todayChange?: number; previousClosePrice?: number; assetType?: Holding['assetType'] }>) => {
    let holdingsChanged = false;
    const nextHoldings = holdingsRef.current.map((holding) => {
      const quote = quotes[normalizeTradeSymbol(holding.symbol)];
      const nextPrice = isUsablePrice(quote?.price) ? Number(quote?.price) : holding.currentPrice;
      const nextTodayChange = Number.isFinite(quote?.todayChange) ? Number(quote?.todayChange) : holding.todayChange;
      const nextPreviousClosePrice = isUsablePrice(quote?.previousClosePrice) ? Number(quote?.previousClosePrice) : holding.previousClosePrice;
      const nextAssetType = quote?.assetType || holding.assetType;

      if (
        nextPrice !== holding.currentPrice ||
        nextTodayChange !== holding.todayChange ||
        nextPreviousClosePrice !== holding.previousClosePrice ||
        nextAssetType !== holding.assetType
      ) {
        holdingsChanged = true;
        return {
          ...holding,
          purchasePrice: holding.purchasePrice,
          currentPrice: nextPrice,
          todayChange: nextTodayChange,
          avgCost: holding.avgCost,
          previousClosePrice: nextPreviousClosePrice,
          assetType: nextAssetType,
        };
      }

      return holding;
    });

    if (holdingsChanged) {
      holdingsRef.current = nextHoldings;
      setHoldings(nextHoldings);
    }

    let shortPositionsChanged = false;
    const nextShortPositions = new Map(shortPositionsRef.current);
    shortPositionsRef.current.forEach((shortHolding, shortSymbol) => {
      const quote = quotes[normalizeTradeSymbol(shortSymbol)];
      if (!isUsablePrice(quote?.price) || Number(quote?.price) === shortHolding.currentPrice) {
        return;
      }

      shortPositionsChanged = true;
      nextShortPositions.set(shortSymbol, {
        ...shortHolding,
        purchasePrice: shortHolding.purchasePrice,
        currentPrice: Number(quote?.price),
        avgCost: shortHolding.avgCost,
        previousClosePrice: isUsablePrice(quote?.previousClosePrice) ? Number(quote?.previousClosePrice) : shortHolding.previousClosePrice,
        assetType: quote?.assetType || shortHolding.assetType,
      });
    });

    if (shortPositionsChanged) {
      shortPositionsRef.current = nextShortPositions;
      setShortPositions(nextShortPositions);
    }
  }, []);

  const trackedSymbols = useMemo(
    () =>
      Array.from(
        new Set([
          ...holdings.map((holding) => normalizeTradeSymbol(holding.symbol)),
          ...Array.from(shortPositions.keys()).map((symbol) => normalizeTradeSymbol(symbol)),
        ].filter(Boolean)),
      ),
    [holdings, shortPositions],
  );
  const latestTrackedQuotes = useLatestQuotes(trackedSymbols);

  useEffect(() => {
    const nextQuotes = Object.entries(latestTrackedQuotes).reduce<Record<string, { price?: number; todayChange?: number; previousClosePrice?: number; assetType?: Holding['assetType'] }>>((acc, [symbol, quote]) => {
      acc[symbol] = {
        price: quote.price,
        todayChange: quote.dailyChangePercent,
        previousClosePrice: quote.previousClosePrice,
        assetType:
          quote.assetClass === 'crypto'
            ? 'Crypto'
            : quote.assetClass === 'etf'
              ? 'ETF'
              : quote.assetClass === 'option'
                ? 'Option'
                : 'Stock',
      };
      return acc;
    }, {});

    if (Object.keys(nextQuotes).length === 0) return;
    updateCurrentPrices(nextQuotes);
  }, [latestTrackedQuotes, updateCurrentPrices]);

  const shortsHoldings = useMemo(
    () =>
      Array.from(shortPositions.values()).map((shortHolding) => ({
        symbol: shortHolding.symbol,
        description: shortHolding.description,
        quantity: shortHolding.quantity,
        currentPrice: shortHolding.currentPrice,
        avgShortPrice: shortHolding.avgCost || shortHolding.purchasePrice || 0,
        purchaseDate: shortHolding.purchaseDate,
      })),
    [shortPositions],
  );
  const stockEtfHoldings = useMemo(
    () => holdings.filter((holding) => classifyAssetClass(holding.symbol, holding.description, holding.assetType) !== 'crypto'),
    [holdings],
  );
  const tradedCryptoHoldings = useMemo(
    () =>
      holdings
        .filter((holding) => classifyAssetClass(holding.symbol, holding.description, holding.assetType) === 'crypto')
        .map((holding) => ({
          symbol: normalizeTradeSymbol(holding.symbol),
          description: holding.description,
          quantity: holding.quantity,
          currentPrice: holding.currentPrice,
          purchasePrice: holding.avgCost || holding.purchasePrice,
          todayChange: holding.todayChange,
          purchaseDate: holding.purchaseDate,
          previousClosePrice: holding.previousClosePrice,
          assetType: 'Crypto' as const,
        })),
    [holdings],
  );
  const accountMetrics = useAccountMetrics(
    stockEtfHoldings,
    OPTIONS_HOLDINGS,
    [...CRYPTO_HOLDINGS, ...tradedCryptoHoldings],
    shortsHoldings,
    cash,
    shortProceeds,
    marginHeld,
    tradeHistory,
  );

  useEffect(() => {
    accountValueRef.current = accountMetrics.totalPortfolioValue;
    recordSnapshot(accountMetrics.totalPortfolioValue);
  }, [accountMetrics.totalPortfolioValue, recordSnapshot]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      recordSnapshot(accountValueRef.current);
    }, PORTFOLIO_SNAPSHOT_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [recordSnapshot]);

  const setCashValue = useCallback((amount: number) => {
    cashRef.current = amount;
    setCash(amount);
  }, []);

  const value: TradeContextType = useMemo(() => ({
    holdings,
    shortPositions,
    cash,
    shortProceeds,
    marginHeld,
    tradeHistory,
    portfolioHistory,
    executeTrade,
    updateCurrentPrices,
    setCashValue,
  }), [holdings, shortPositions, cash, shortProceeds, marginHeld, tradeHistory, portfolioHistory, executeTrade, updateCurrentPrices, setCashValue]);

  return <TradeContext.Provider value={value}>{children}</TradeContext.Provider>;
}

export function useTradeContext() {
  const context = useContext(TradeContext);
  if (!context) {
    throw new Error('useTradeContext must be used within TradeProvider');
  }
  return context;
}
