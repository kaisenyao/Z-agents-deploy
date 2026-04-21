import { appApi } from '../lib/apiBase';

export interface HistoricalPricePoint {
  timestamp: number;
  price: number;
}

export interface FetchHistoricalPricesOptions {
  range?: string;
  startDate?: string;
  endDate?: string;
  interval?: '1d' | '1wk' | '1mo';
  useAdjustedClose?: boolean;
}

const historicalPriceCache = new Map<string, HistoricalPricePoint[]>();
const KNOWN_CRYPTO_SYMBOLS = new Set(['BTC', 'ETH', 'DOGE', 'ADA', 'SOL', 'XRP', 'DOT', 'AVAX', 'BNB', 'LINK', 'MATIC']);

function toYahooHistoricalSymbol(symbol: string): string {
  const normalized = String(symbol || '').trim().toUpperCase().replace(/-USD$/i, '');
  if (KNOWN_CRYPTO_SYMBOLS.has(normalized)) {
    return `${normalized}-USD`;
  }
  return normalized;
}

function buildCacheKey(symbol: string, request: FetchHistoricalPricesOptions): string {
  return JSON.stringify({
    symbol,
    range: request.range || null,
    startDate: request.startDate || null,
    endDate: request.endDate || null,
    interval: request.interval || '1d',
    useAdjustedClose: request.useAdjustedClose !== false,
  });
}

export async function fetchHistoricalPrices(symbol: string, range: string): Promise<HistoricalPricePoint[]>;
export async function fetchHistoricalPrices(symbol: string, options: FetchHistoricalPricesOptions): Promise<HistoricalPricePoint[]>;
export async function fetchHistoricalPrices(
  symbol: string,
  input: string | FetchHistoricalPricesOptions,
): Promise<HistoricalPricePoint[]> {
  const yahooSymbol = toYahooHistoricalSymbol(symbol);
  const request: FetchHistoricalPricesOptions = typeof input === 'string'
    ? { range: input, interval: '1d', useAdjustedClose: false }
    : {
        interval: '1d',
        useAdjustedClose: false,
        ...input,
      };
  const cacheKey = buildCacheKey(yahooSymbol, request);
  const cached = historicalPriceCache.get(cacheKey);
  if (cached) return cached;

  try {
    const params = new URLSearchParams({
      symbol: yahooSymbol,
      interval: request.interval || '1d',
    });
    if (request.startDate) {
      params.set('startDate', request.startDate);
    }
    if (request.endDate) {
      params.set('endDate', request.endDate);
    }
    if (request.range) {
      params.set('range', request.range);
    }

    const response = await fetch(appApi(`/market/chart?${params.toString()}`));
    if (!response.ok) {
      throw new Error(`Failed to fetch historical prices: ${response.statusText}`);
    }

    const data = await response.json();
    const result = data?.chart;
    const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
    const closes = Array.isArray(result?.indicators?.quote?.[0]?.close) ? result.indicators.quote[0].close : [];
    const adjustedCloses = Array.isArray(result?.indicators?.adjclose?.[0]?.adjclose)
      ? result.indicators.adjclose[0].adjclose
      : [];
    const selectedPrices = request.useAdjustedClose !== false && adjustedCloses.length === timestamps.length
      ? adjustedCloses
      : closes;
    const points = timestamps
      .map((timestamp: number, index: number) => ({
        timestamp: Number(timestamp) * 1000,
        price: Number(selectedPrices[index]),
      }))
      .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.price) && point.price > 0)
      .sort((left, right) => left.timestamp - right.timestamp);

    historicalPriceCache.set(cacheKey, points);
    return points;
  } catch (error) {
    console.error('Error fetching historical prices:', error);
    return [];
  }
}
