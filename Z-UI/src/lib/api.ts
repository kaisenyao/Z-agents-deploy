import { appApi } from './apiBase';
import { MARKET_API_ENABLED } from './marketApiAvailability';

export interface YahooFinanceQuote {
  symbol: string;
  regularMarketPrice: number;
  regularMarketChangePercent: number;
  [key: string]: any;
}

export interface YahooFinanceChart {
  timestamp: number[];
  indicators: {
    quote: [
      {
        close: number[];
        high: number[];
        low: number[];
        open: number[];
        volume: number[];
      }
    ];
  };
}

const metadataResponseCache = new Map<string, { expiresAt: number; value: any | null }>();
const metadataInFlightRequests = new Map<string, Promise<any | null>>();
const METADATA_CLIENT_TTL_MS = 30 * 1000;

export async function fetchStockData(
  ticker: string,
  range: string = "1mo",
  interval: string = "1d"
): Promise<YahooFinanceChart | null> {
  if (!MARKET_API_ENABLED) return null;

  try {
    const params = new URLSearchParams({
      symbol: ticker.trim().toUpperCase(),
      range,
      interval,
    });
    const response = await fetch(appApi(`/market/chart?${params.toString()}`));
    
    if (!response.ok) {
      throw new Error(`Failed to fetch stock data: ${response.statusText}`);
    }
    
    const data = await response.json();
    return (data?.chart || null) as YahooFinanceChart | null;
  } catch (error) {
    console.error("Error fetching stock data:", error);
    return null;
  }
}

export async function fetchStockDataByWindow(
  ticker: string,
  period1: number,
  period2: number,
  interval: string = "1d"
): Promise<YahooFinanceChart | null> {
  if (!MARKET_API_ENABLED) return null;

  try {
    const params = new URLSearchParams({
      symbol: ticker.trim().toUpperCase(),
      interval,
      period1: String(Math.floor(period1)),
      period2: String(Math.floor(period2)),
    });
    const response = await fetch(appApi(`/market/chart?${params.toString()}`));

    if (!response.ok) {
      throw new Error(`Failed to fetch stock data: ${response.statusText}`);
    }

    const data = await response.json();
    return (data?.chart || null) as YahooFinanceChart | null;
  } catch (error) {
    console.error("Error fetching stock data by window:", error);
    return null;
  }
}

/**
 * Helper function to format the Yahoo Finance chart data into Recharts compatible format
 */
export function formatChartDataForRecharts(chartData: YahooFinanceChart | null) {
  if (!chartData || !chartData.timestamp || !chartData.indicators.quote[0].close) {
    return [];
  }

  const timestamps = chartData.timestamp;
  const closes = chartData.indicators.quote[0].close;

  return timestamps.map((ts, i) => ({
    date: new Date(ts * 1000).toLocaleDateString(),
    price: closes[i],
  })).filter(point => point.price !== null && point.price !== undefined);
}

export async function fetchYahooQuotes(symbols: string[]): Promise<any[]> {
  if (!symbols.length) return [];
  if (!MARKET_API_ENABLED) return [];

  try {
    const cleanedSymbols = symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
    const params = new URLSearchParams({
      symbols: cleanedSymbols.join(','),
    });
    const response = await fetch(appApi(`/market/quote?${params.toString()}`));

    if (!response.ok) {
      throw new Error(`Failed to fetch quote data: ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch (error) {
    console.error('Error fetching Yahoo quote data:', error);
    return [];
  }
}

export async function fetchLiveOptionsChain(symbol: string, date?: string): Promise<any | null> {
  const cleanedSymbol = symbol.trim().toUpperCase();
  if (!cleanedSymbol) return null;
  if (!MARKET_API_ENABLED) return null;

  try {
    const params = new URLSearchParams({ symbol: cleanedSymbol });
    if (date) {
      params.set('date', date);
    }

    const response = await fetch(appApi(`/market/options?${params.toString()}`));
    if (!response.ok) {
      throw new Error(`Failed to fetch live options chain: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching live options chain:', error);
    return null;
  }
}

export async function fetchLiveQuoteMetadata(symbol: string): Promise<any | null> {
  const cleanedSymbol = symbol.trim().toUpperCase();
  if (!cleanedSymbol) return null;

  const payload = await fetchMarketMetadata(cleanedSymbol);
  return payload
    ? {
        symbol: payload.symbol,
        shortName: payload.shortName,
        longName: payload.longName,
        marketCap: payload.marketCap,
        trailingPE: payload.trailingPE,
        epsTrailingTwelveMonths: payload.epsTrailingTwelveMonths,
      }
    : null;
}

export async function fetchYahooQuoteSummary(symbol: string): Promise<any | null> {
  const cleanedSymbol = symbol.trim().toUpperCase();
  if (!cleanedSymbol) return null;

  const payload = await fetchMarketMetadata(cleanedSymbol);
  return payload?.summary || null;
}

async function fetchMarketMetadata(symbol: string): Promise<any | null> {
  const cleanedSymbol = symbol.trim().toUpperCase();
  if (!cleanedSymbol) return null;
  if (!MARKET_API_ENABLED) return null;

  const cached = metadataResponseCache.get(cleanedSymbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const inFlight = metadataInFlightRequests.get(cleanedSymbol);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    try {
      const params = new URLSearchParams({ symbol: cleanedSymbol });
      const response = await fetch(appApi(`/market/metadata?${params.toString()}`));

      if (!response.ok) {
        throw new Error(`Failed to fetch market metadata: ${response.statusText}`);
      }

      const data = await response.json();
      metadataResponseCache.set(cleanedSymbol, {
        value: data || null,
        expiresAt: Date.now() + METADATA_CLIENT_TTL_MS,
      });
      return data || null;
    } catch (error) {
      console.error('Error fetching market metadata:', error);
      return null;
    } finally {
      metadataInFlightRequests.delete(cleanedSymbol);
    }
  })();

  metadataInFlightRequests.set(cleanedSymbol, request);
  return request;
}

export async function fetchYahooQuotePageMetrics(symbol: string): Promise<{ marketCap?: string; trailingPE?: string } | null> {
  const cleanedSymbol = symbol.trim().toUpperCase();
  if (!cleanedSymbol) return null;

  const payload = await fetchMarketMetadata(cleanedSymbol);
  return payload?.pageMetrics || null;
}

export async function searchYahooSymbols(query: string): Promise<any[]> {
  if (!query.trim()) return [];
  if (!MARKET_API_ENABLED) return [];

  try {
    const params = new URLSearchParams({ query });
    const response = await fetch(appApi(`/market/search?${params.toString()}`));

    if (!response.ok) {
      throw new Error(`Failed to search symbols: ${response.statusText}`);
    }

    const data = await response.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch (error) {
    console.error('Error searching Yahoo symbols:', error);
    return [];
  }
}
