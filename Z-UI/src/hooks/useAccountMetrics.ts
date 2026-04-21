import { useEffect, useMemo, useState } from 'react';
import {
  calculateCanonicalPositionMetrics,
  calculatePositionDailyMetrics,
  classifyAssetClass,
  normalizeAssetSymbol,
  type PricingTradeRecord,
} from '../services/assetPricing';
import { loadCashActivityHistory } from '../store/tradingStore';

export interface StockHolding {
  symbol: string;
  description: string;
  currentPrice: number;
  todayChange: number;
  purchasePrice: number;
  avgCost?: number;
  quantity: number;
  purchaseDate?: string;
  previousClosePrice?: number;
  assetType?: 'Stock' | 'ETF' | 'Crypto' | 'Option';
}

export interface OptionHolding {
  contract: string;
  quantity: number;
  avgCost: number;
  mark: number;
  purchaseDate: string;
}

export interface CryptoHolding {
  symbol: string;
  description: string;
  quantity: number;
  currentPrice: number;
  purchasePrice: number;
  avgCost?: number;
  todayChange: number;
  purchaseDate: string;
  previousClosePrice?: number;
  assetType?: 'Crypto';
}

export interface ShortHolding {
  symbol: string;
  description: string;
  quantity: number;
  currentPrice: number;
  avgShortPrice: number;
  purchaseDate: string;
}

export interface HoldingDailyMetric {
  symbol: string;
  assetClass: 'stock' | 'etf' | 'crypto' | 'option' | 'cash' | 'unknown';
  markPrice: number;
  avgCost: number;
  eligibleQuantity: number;
  previousClosePrice: number;
  unrealizedPnL: number;
  unrealizedReturnPct: number;
  dailyChangeAmount: number;
  dailyChangePercent: number;
  rangeReturnPct: number;
}

export interface AccountMetrics {
  totalPortfolioValue: number;
  totalHoldingsValue: number;
  cashValue: number;
  buyingPower: number;
  usStocksValue: number;
  etfsValue: number;
  totalOptionsValue: number;
  totalCryptoValue: number;
  totalShortsValue: number;
  totalTodayChange: number;
  totalTodayChangePercent: number;
  holdingDailyMetrics: Record<string, HoldingDailyMetric>;
}

const START_OF_DAY_SNAPSHOT_KEY = 'portfolioStartOfDaySnapshot';

interface StartOfDaySnapshot {
  date: string;
  value: number;
  externalCashFlowBaseline: number;
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function getLocalDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function loadStartOfDaySnapshot(): StartOfDaySnapshot | null {
  if (!canUseStorage()) return null;

  try {
    const raw = localStorage.getItem(START_OF_DAY_SNAPSHOT_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StartOfDaySnapshot>;
    if (
      typeof parsed?.date !== 'string' ||
      !Number.isFinite(parsed?.value) ||
      !Number.isFinite(parsed?.externalCashFlowBaseline)
    ) {
      return null;
    }

    return {
      date: parsed.date,
      value: Number(parsed.value),
      externalCashFlowBaseline: Number(parsed.externalCashFlowBaseline),
    };
  } catch {
    return null;
  }
}

function saveStartOfDaySnapshot(snapshot: StartOfDaySnapshot): void {
  if (!canUseStorage()) return;
  localStorage.setItem(START_OF_DAY_SNAPSHOT_KEY, JSON.stringify(snapshot));
}

function getNetExternalCashFlowToday(date: Date = new Date()): number {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  return loadCashActivityHistory().reduce((sum, activity) => {
    if (activity.status !== 'completed') return sum;
    if (activity.type !== 'deposit' && activity.type !== 'withdraw') return sum;

    const timestamp = new Date(activity.timestamp).getTime();
    if (!Number.isFinite(timestamp) || timestamp < startOfDay.getTime() || timestamp >= endOfDay.getTime()) {
      return sum;
    }

    return sum + (activity.type === 'deposit' ? activity.amount : -activity.amount);
  }, 0);
}

export function useAccountMetrics(
  stockHoldings: StockHolding[],
  optionsHoldings: OptionHolding[] = [],
  cryptoHoldings: CryptoHolding[] = [],
  shortsHoldings: ShortHolding[] = [],
  cashValue: number = 0,
  shortProceedsValue: number = 0,
  marginHeldValue: number = 0,
  tradeHistory: PricingTradeRecord[] = [],
): AccountMetrics {
  const currentDateKey = getLocalDateKey();
  const netExternalCashFlowToday = getNetExternalCashFlowToday();
  const [startOfDaySnapshot, setStartOfDaySnapshot] = useState<StartOfDaySnapshot | null>(() => loadStartOfDaySnapshot());

  const metrics = useMemo(() => {
    const holdingDailyMetrics: Record<string, HoldingDailyMetric> = {};

    const etfsValue = stockHoldings
      .filter((holding) => classifyAssetClass(holding.symbol, holding.description, holding.assetType) === 'etf')
      .reduce((sum, holding) => sum + holding.currentPrice * holding.quantity, 0);

    const usStocksValue = stockHoldings
      .filter((holding) => classifyAssetClass(holding.symbol, holding.description, holding.assetType) === 'stock')
      .reduce((sum, holding) => sum + holding.currentPrice * holding.quantity, 0);

    const totalOptionsValue = optionsHoldings.reduce(
      (sum, holding) => sum + holding.mark * holding.quantity * 100,
      0,
    );

    const totalCryptoValue = cryptoHoldings.reduce(
      (sum, holding) => sum + holding.currentPrice * holding.quantity,
      0,
    );

    const totalShortsValue = shortsHoldings.reduce(
      (sum, holding) => sum + holding.currentPrice * holding.quantity,
      0,
    );
    const shortEquityValue = shortProceedsValue + marginHeldValue - totalShortsValue;

    const stockTodayChange = stockHoldings.reduce((sum, holding) => {
      const metrics = calculatePositionDailyMetrics(
        {
          symbol: holding.symbol,
          description: holding.description,
          quantity: holding.quantity,
          currentPrice: holding.currentPrice,
          previousClosePrice: holding.previousClosePrice,
          todayChangePercent: holding.todayChange,
          explicitAssetType: holding.assetType,
        },
        tradeHistory,
      );
      const normalizedSymbol = normalizeAssetSymbol(holding.symbol);

      holdingDailyMetrics[normalizedSymbol] = {
        symbol: normalizedSymbol,
        assetClass: classifyAssetClass(holding.symbol, holding.description, holding.assetType),
        ...calculateCanonicalPositionMetrics({
          quantity: holding.quantity,
          markPrice: holding.currentPrice,
          previousClosePrice: metrics.previousClosePrice,
          avgCost: holding.avgCost || holding.purchasePrice,
          eligibleQuantity: metrics.eligibleQuantity,
          rangeBaselinePrice: holding.avgCost || holding.purchasePrice,
        }),
        eligibleQuantity: metrics.eligibleQuantity,
        dailyChangeAmount: metrics.dailyChangeAmount,
        dailyChangePercent: metrics.dailyChangePercent,
      };

      return sum + metrics.dailyChangeAmount;
    }, 0);

    const cryptoTodayChange = cryptoHoldings.reduce((sum, holding) => {
      const metrics = calculatePositionDailyMetrics(
        {
          symbol: holding.symbol,
          description: holding.description,
          quantity: holding.quantity,
          currentPrice: holding.currentPrice,
          previousClosePrice: holding.previousClosePrice,
          todayChangePercent: holding.todayChange,
          explicitAssetType: holding.assetType || 'Crypto',
        },
        tradeHistory,
      );
      const normalizedSymbol = normalizeAssetSymbol(holding.symbol);

      holdingDailyMetrics[normalizedSymbol] = {
        symbol: normalizedSymbol,
        assetClass: 'crypto',
        ...calculateCanonicalPositionMetrics({
          quantity: holding.quantity,
          markPrice: holding.currentPrice,
          previousClosePrice: metrics.previousClosePrice,
          avgCost: holding.avgCost || holding.purchasePrice,
          eligibleQuantity: metrics.eligibleQuantity,
          rangeBaselinePrice: holding.avgCost || holding.purchasePrice,
        }),
        eligibleQuantity: metrics.eligibleQuantity,
        dailyChangeAmount: metrics.dailyChangeAmount,
        dailyChangePercent: metrics.dailyChangePercent,
      };

      return sum + metrics.dailyChangeAmount;
    }, 0);

    const totalHoldingsValue =
      usStocksValue + etfsValue + totalOptionsValue + totalCryptoValue + shortEquityValue;
    const totalPortfolioValue = totalHoldingsValue + cashValue;

    return {
      totalPortfolioValue,
      totalHoldingsValue,
      cashValue,
      buyingPower: cashValue,
      usStocksValue,
      etfsValue,
      totalOptionsValue,
      totalCryptoValue,
      totalShortsValue,
      totalTodayChange: stockTodayChange + cryptoTodayChange,
      totalTodayChangePercent: 0,
      holdingDailyMetrics,
    };
  }, [
    stockHoldings,
    optionsHoldings,
    cryptoHoldings,
    shortsHoldings,
    cashValue,
    shortProceedsValue,
    marginHeldValue,
    tradeHistory,
  ]);

  useEffect(() => {
    if (!Number.isFinite(metrics.totalPortfolioValue) || metrics.totalPortfolioValue < 0) {
      return;
    }

    if (startOfDaySnapshot?.date === currentDateKey) {
      return;
    }

    const nextSnapshot: StartOfDaySnapshot = {
      date: currentDateKey,
      value: metrics.totalPortfolioValue,
      externalCashFlowBaseline: netExternalCashFlowToday,
    };

    saveStartOfDaySnapshot(nextSnapshot);
    setStartOfDaySnapshot(nextSnapshot);
  }, [
    currentDateKey,
    metrics.totalPortfolioValue,
    netExternalCashFlowToday,
    startOfDaySnapshot,
  ]);

  const effectiveStartOfDayValue = startOfDaySnapshot?.date === currentDateKey
    ? startOfDaySnapshot.value
    : metrics.totalPortfolioValue;
  const effectiveExternalCashFlowToday = startOfDaySnapshot?.date === currentDateKey
    ? netExternalCashFlowToday - startOfDaySnapshot.externalCashFlowBaseline
    : 0;
  const totalTodayChange = metrics.totalPortfolioValue - effectiveStartOfDayValue - effectiveExternalCashFlowToday;
  const totalTodayChangePercent = effectiveStartOfDayValue > 0
    ? (totalTodayChange / effectiveStartOfDayValue) * 100
    : 0;

  return {
    ...metrics,
    totalTodayChange,
    totalTodayChangePercent,
  };
}
