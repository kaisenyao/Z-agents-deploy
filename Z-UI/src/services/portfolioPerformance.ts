import { isUsablePrice } from './assetPricing';
import type { HistoricalPricePoint } from './historicalPriceService';

export type PortfolioPerformanceRange = '1D' | '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL';

export interface PortfolioValuePoint {
  timestamp: number;
  value: number;
}

export interface PortfolioChartPoint {
  timestamp: number;
  portfolio: number;
  benchmark?: number;
}

function getPriceAtOrBefore(points: HistoricalPricePoint[], timestamp: number): number | undefined {
  let last: number | undefined;
  for (const point of points) {
    if (point.timestamp > timestamp) break;
    last = point.price;
  }
  return last;
}

function getPriceAtOrAfter(points: HistoricalPricePoint[], timestamp: number): number | undefined {
  for (const point of points) {
    if (point.timestamp >= timestamp) {
      return point.price;
    }
  }
  return undefined;
}

export function getRangeStartTimestamp(range: PortfolioPerformanceRange, now: number = Date.now()): number {
  const date = new Date(now);

  switch (range) {
    case '1D': {
      const next = new Date(date);
      next.setDate(next.getDate() - 1);
      return next.getTime();
    }
    case '1W': {
      const next = new Date(date);
      next.setDate(next.getDate() - 7);
      return next.getTime();
    }
    case '1M': {
      const next = new Date(date);
      next.setMonth(next.getMonth() - 1);
      return next.getTime();
    }
    case '3M': {
      const next = new Date(date);
      next.setMonth(next.getMonth() - 3);
      return next.getTime();
    }
    case '6M': {
      const next = new Date(date);
      next.setMonth(next.getMonth() - 6);
      return next.getTime();
    }
    case 'YTD':
      return new Date(date.getFullYear(), 0, 1).getTime();
    case '1Y': {
      const next = new Date(date);
      next.setFullYear(next.getFullYear() - 1);
      return next.getTime();
    }
    case 'ALL':
      return 0;
  }
}

export function getSnapshotBucketSize(range: PortfolioPerformanceRange): number {
  switch (range) {
    case '1D':
      return 5 * 60 * 1000;
    case '1W':
      return 30 * 60 * 1000;
    case '1M':
      return 2 * 60 * 60 * 1000;
    case '3M':
      return 6 * 60 * 60 * 1000;
    case '6M':
      return 12 * 60 * 60 * 1000;
    case 'YTD':
    case '1Y':
      return 24 * 60 * 60 * 1000;
    case 'ALL':
      return 7 * 24 * 60 * 60 * 1000;
  }
}

export function sanitizePortfolioHistory(points: Array<{ timestamp: number; value: number }>): PortfolioValuePoint[] {
  const deduped = new Map<number, number>();

  points
    .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value) && point.value >= 0)
    .sort((left, right) => left.timestamp - right.timestamp)
    .forEach((point) => {
      deduped.set(Number(point.timestamp), Number(point.value));
    });

  return Array.from(deduped.entries())
    .map(([timestamp, value]) => ({ timestamp, value }))
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function filterValueSeriesByRange(points: PortfolioValuePoint[], rangeStart: number): PortfolioValuePoint[] {
  return points.filter((point) => point.timestamp >= rangeStart);
}

export function resamplePortfolioSnapshots(points: PortfolioValuePoint[], bucketMs: number): PortfolioValuePoint[] {
  if (points.length <= 1 || bucketMs <= 0) return points;

  const buckets = new Map<number, { values: number[]; latestTimestamp: number }>();

  points.forEach((point) => {
    const bucketKey = Math.floor(point.timestamp / bucketMs) * bucketMs;
    const bucket = buckets.get(bucketKey) || { values: [], latestTimestamp: point.timestamp };
    bucket.values.push(point.value);
    bucket.latestTimestamp = Math.max(bucket.latestTimestamp, point.timestamp);
    buckets.set(bucketKey, bucket);
  });

  return Array.from(buckets.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, bucket]) => {
      const values = [...bucket.values].sort((left, right) => left - right);
      const midpoint = Math.floor(values.length / 2);
      const median = values.length % 2 === 0
        ? (values[midpoint - 1] + values[midpoint]) / 2
        : values[midpoint];

      return {
        timestamp: bucket.latestTimestamp,
        value: median,
      };
    });
}

export function getStartOfToday(timestamp: number = Date.now()): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function mergeValueSeries(seriesList: PortfolioValuePoint[][]): PortfolioValuePoint[] {
  return sanitizePortfolioHistory(seriesList.flat());
}

export function appendCurrentValuePoint(
  points: PortfolioValuePoint[],
  currentValue: number,
  now: number = Date.now(),
): PortfolioValuePoint[] {
  if (!Number.isFinite(currentValue) || currentValue < 0) return points;

  const next = [...points];
  const last = next[next.length - 1];

  if (!last) {
    return [{ timestamp: now, value: currentValue }];
  }

  if (now - last.timestamp < 60 * 1000) {
    next[next.length - 1] = { timestamp: now, value: currentValue };
    return next;
  }

  if (last.value === currentValue) {
    return next;
  }

  next.push({ timestamp: now, value: currentValue });
  return next;
}

export function sortBenchmarkPrices(points: HistoricalPricePoint[]): HistoricalPricePoint[] {
  return points
    .filter((point) => Number.isFinite(point.timestamp) && isUsablePrice(point.price))
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function buildChartSeriesWithBenchmark(
  portfolioSeries: PortfolioValuePoint[],
  benchmarkPrices: HistoricalPricePoint[],
): {
  points: PortfolioChartPoint[];
  benchmarkAvailable: boolean;
} {
  if (portfolioSeries.length === 0) {
    return { points: [], benchmarkAvailable: false };
  }

  const sortedBenchmarkPrices = sortBenchmarkPrices(benchmarkPrices);
  if (sortedBenchmarkPrices.length === 0) {
    return {
      points: portfolioSeries.map((point) => ({
        timestamp: point.timestamp,
        portfolio: point.value,
      })),
      benchmarkAvailable: false,
    };
  }
  const anchorPoint = portfolioSeries.find((point) => isUsablePrice(point.value)) ?? portfolioSeries[0];
  const startPortfolioValue = anchorPoint.value;
  const startBenchmarkPrice =
    getPriceAtOrBefore(sortedBenchmarkPrices, anchorPoint.timestamp) ??
    getPriceAtOrAfter(sortedBenchmarkPrices, anchorPoint.timestamp) ??
    sortedBenchmarkPrices[0]?.price;

  if (!isUsablePrice(startPortfolioValue) || !isUsablePrice(startBenchmarkPrice)) {
    return {
      points: portfolioSeries.map((point) => ({
        timestamp: point.timestamp,
        portfolio: point.value,
      })),
      benchmarkAvailable: false,
    };
  }

  const points = portfolioSeries.map((point) => {
    const benchmarkPrice =
      getPriceAtOrBefore(sortedBenchmarkPrices, point.timestamp) ??
      getPriceAtOrAfter(sortedBenchmarkPrices, point.timestamp) ??
      sortedBenchmarkPrices[0]?.price;
    const benchmark = isUsablePrice(benchmarkPrice)
      ? startPortfolioValue * (benchmarkPrice / startBenchmarkPrice)
      : undefined;

    return {
      timestamp: point.timestamp,
      portfolio: point.value,
      benchmark,
    };
  });

  return {
    points,
    benchmarkAvailable: true,
  };
}

export function formatPortfolioChartTick(timestamp: number, range: PortfolioPerformanceRange): string {
  const date = new Date(timestamp);

  switch (range) {
    case '1D':
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    case '1W':
    case '1M':
    case '3M':
    case '6M':
      return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
    case 'YTD':
    case '1Y':
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case 'ALL':
      return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
}

export function formatPortfolioTooltipTimestamp(timestamp: number, range: PortfolioPerformanceRange): string {
  const date = new Date(timestamp);

  if (range === '1D') {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
