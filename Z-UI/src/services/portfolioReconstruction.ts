import type { TradeRecord } from '../context/TradeContext';
import type { CashActivityRecord } from '../store/tradingStore';
import { fetchHistoricalPrices, type HistoricalPricePoint } from './historicalPriceService';
import { INITIAL_MARGIN_RATE, calculateCoverSettlement } from './tradingEngine';

export interface ReconstructPortfolioHistoryInput {
  trades: TradeRecord[];
  cashActivities: CashActivityRecord[];
  symbols: string[];
  range: string;
}

export interface ReconstructedPortfolioPoint {
  timestamp: number;
  value: number;
}

interface PositionState {
  quantity: number;
  avgCost: number;
}

interface ShortState {
  quantity: number;
  avgCost: number;
}

function normalizeSymbol(symbol: string): string {
  return String(symbol || '').trim().toUpperCase().replace(/-USD$/i, '');
}

function getPriceAtOrBefore(prices: HistoricalPricePoint[], timestamp: number): number | undefined {
  let lastPrice: number | undefined;
  for (const point of prices) {
    if (point.timestamp > timestamp) break;
    lastPrice = point.price;
  }
  return lastPrice;
}

function isTrackableAsset(trade: TradeRecord): boolean {
  return trade.assetType === 'Stock' || trade.assetType === 'ETF' || trade.assetType === 'Crypto';
}

function toDayEndTimestamp(timestamp: number): number {
  const day = new Date(timestamp);
  day.setHours(23, 59, 59, 999);
  return day.getTime();
}

function getRangeStart(range: string, latestEventTimestamp: number): number {
  const now = new Date();

  if (range === 'ytd') {
    return new Date(now.getFullYear(), 0, 1).getTime();
  }

  const start = new Date(now);
  if (range === '5d') {
    start.setDate(start.getDate() - 7);
  } else if (range === '1mo') {
    start.setMonth(start.getMonth() - 1);
  } else if (range === '3mo') {
    start.setMonth(start.getMonth() - 3);
  } else if (range === '6mo') {
    start.setMonth(start.getMonth() - 6);
  } else if (range === '1y') {
    start.setFullYear(start.getFullYear() - 1);
  } else if (range === '10y') {
    if (Number.isFinite(latestEventTimestamp) && latestEventTimestamp > 0) {
      return new Date(latestEventTimestamp).getTime();
    }
    start.setFullYear(start.getFullYear() - 10);
  }

  // If the portfolio didn't exist yet at the computed range start, clamp the
  // timeline start to the first portfolio event. This avoids long stretches of
  // zero values that make the chart look broken.
  if (Number.isFinite(latestEventTimestamp) && latestEventTimestamp > 0) {
    return Math.max(start.getTime(), new Date(latestEventTimestamp).getTime());
  }

  return start.getTime();
}

function buildDailyTimeline(startTimestamp: number, endTimestamp: number): number[] {
  if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp) || startTimestamp > endTimestamp) {
    return [];
  }

  const cursor = new Date(startTimestamp);
  cursor.setHours(0, 0, 0, 0);
  const timeline: number[] = [];

  while (cursor.getTime() <= endTimestamp) {
    const dayEnd = toDayEndTimestamp(cursor.getTime());
    timeline.push(Math.min(dayEnd, endTimestamp));
    cursor.setDate(cursor.getDate() + 1);
  }

  return timeline;
}

export async function reconstructPortfolioHistory({
  trades,
  cashActivities,
  symbols,
  range,
}: ReconstructPortfolioHistoryInput): Promise<ReconstructedPortfolioPoint[]> {
  const normalizedSymbols = Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));
  const completedCashActivities = [...cashActivities]
    .filter((record) => record.status === 'completed')
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const sortedTrades = [...trades]
    .filter((trade) => trade.status === 'FILLED' && isTrackableAsset(trade))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (!normalizedSymbols.length && !sortedTrades.length && !completedCashActivities.length) {
    return [];
  }

  const priceEntries = await Promise.all(
    normalizedSymbols.map(async (symbol) => [symbol, await fetchHistoricalPrices(symbol, range)] as const),
  );
  const priceMap = new Map<string, HistoricalPricePoint[]>(priceEntries);
  // First event (trade or cash activity). This is used to prevent generating
  // chart points long before the account had any activity.
  const firstEventTimestamp = Math.min(
    ...[
      ...sortedTrades.map((trade) => new Date(trade.date).getTime()),
      ...completedCashActivities.map((record) => new Date(record.timestamp).getTime()),
    ].filter((timestamp) => Number.isFinite(timestamp)),
  );

  const timeline = buildDailyTimeline(getRangeStart(range, firstEventTimestamp), Date.now());

  if (!timeline.length) return [];

  let cashActivityIndex = 0;
  let tradeIndex = 0;
  let cash = 0;
  let shortProceeds = 0;
  let marginHeld = 0;
  const positions = new Map<string, PositionState>();
  const shortPositions = new Map<string, ShortState>();
  const history: ReconstructedPortfolioPoint[] = [];

  for (const timestamp of timeline) {
    while (
      cashActivityIndex < completedCashActivities.length &&
      new Date(completedCashActivities[cashActivityIndex].timestamp).getTime() <= timestamp
    ) {
      const activity = completedCashActivities[cashActivityIndex];
      if (activity.type === 'deposit') {
        cash += activity.amount;
      } else if (activity.type === 'withdraw' || activity.type === 'transfer') {
        cash -= activity.amount;
      }
      cashActivityIndex += 1;
    }

    while (tradeIndex < sortedTrades.length && new Date(sortedTrades[tradeIndex].date).getTime() <= timestamp) {
      const trade = sortedTrades[tradeIndex];
      const symbol = normalizeSymbol(trade.symbol);
      const quantity = Number(trade.quantity) || 0;
      const price = Number(trade.price) || 0;
      const total = Number(trade.total) || quantity * price;

      if (trade.side === 'Buy') {
        cash -= total;
        const current = positions.get(symbol);
        if (current) {
          const totalShares = current.quantity + quantity;
          const nextAvgCost = totalShares > 0
            ? ((current.avgCost * current.quantity) + total) / totalShares
            : current.avgCost;
          positions.set(symbol, { quantity: totalShares, avgCost: nextAvgCost });
        } else {
          positions.set(symbol, { quantity, avgCost: price });
        }
      } else if (trade.side === 'Sell') {
        cash += total;
        const current = positions.get(symbol);
        if (current) {
          const remaining = current.quantity - quantity;
          if (remaining > 0) {
            positions.set(symbol, { ...current, quantity: remaining });
          } else {
            positions.delete(symbol);
          }
        }
      } else if (trade.side === 'Short') {
        const requiredInitialMargin = total * INITIAL_MARGIN_RATE;
        cash -= requiredInitialMargin;
        shortProceeds += total;
        marginHeld += requiredInitialMargin;

        const current = shortPositions.get(symbol);
        if (current) {
          const totalShares = current.quantity + quantity;
          const nextAvgCost = totalShares > 0
            ? ((current.avgCost * current.quantity) + total) / totalShares
            : current.avgCost;
          shortPositions.set(symbol, { quantity: totalShares, avgCost: nextAvgCost });
        } else {
          shortPositions.set(symbol, { quantity, avgCost: price });
        }
      } else if (trade.side === 'Cover') {
        const current = shortPositions.get(symbol);
        if (current) {
          const settlement = calculateCoverSettlement(
            total,
            quantity,
            current.avgCost,
            shortProceeds,
            marginHeld,
            INITIAL_MARGIN_RATE,
          );
          shortProceeds = Math.max(0, shortProceeds + settlement.shortProceedsDelta);
          marginHeld = Math.max(0, marginHeld + settlement.marginHeldDelta);
          cash += settlement.buyingPowerDelta;

          const remaining = current.quantity - quantity;
          if (remaining > 0) {
            shortPositions.set(symbol, { ...current, quantity: remaining });
          } else {
            shortPositions.delete(symbol);
          }
        }
      }

      tradeIndex += 1;
    }

    let longValue = 0;
    positions.forEach((position, symbol) => {
      const price = getPriceAtOrBefore(priceMap.get(symbol) || [], timestamp);
      if (price !== undefined) {
        longValue += position.quantity * price;
      }
    });

    let shortNotional = 0;
    shortPositions.forEach((position, symbol) => {
      const price = getPriceAtOrBefore(priceMap.get(symbol) || [], timestamp);
      if (price !== undefined) {
        shortNotional += position.quantity * price;
      }
    });

    history.push({
      timestamp,
      value: cash + longValue + shortProceeds + marginHeld - shortNotional,
    });
  }

  return history;
}
