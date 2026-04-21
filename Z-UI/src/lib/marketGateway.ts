import { appApi } from './apiBase';
import { MARKET_API_ENABLED } from './marketApiAvailability';

export type MarketScreenerCategory = 'stocks' | 'etfs' | 'crypto' | 'options';
export type MarketScreenerTab = 'most_actives' | 'day_gainers';

export interface MarketScreenerResponse<T> {
  category: MarketScreenerCategory;
  tab: MarketScreenerTab;
  updatedAt: string;
  items: T[];
}

export interface MarketSearchResult {
  symbol: string;
  name: string;
  exchange?: string;
  quoteType?: string;
}

export async function fetchMarketScreener<T>(
  category: MarketScreenerCategory,
  tab: MarketScreenerTab,
): Promise<MarketScreenerResponse<T>> {
  if (!MARKET_API_ENABLED) {
    return {
      category,
      tab,
      updatedAt: new Date().toISOString(),
      items: [],
    };
  }

  const params = new URLSearchParams({ category, tab });
  const response = await fetch(appApi(`/market/screener?${params.toString()}`));
  if (!response.ok) {
    throw new Error(`Failed to fetch market screener: ${response.statusText}`);
  }
  return response.json();
}

export async function searchMarketSymbols(
  query: string,
  category: MarketScreenerCategory,
): Promise<MarketSearchResult[]> {
  if (!MARKET_API_ENABLED) return [];

  const params = new URLSearchParams({ query, category });
  const response = await fetch(appApi(`/market/search?${params.toString()}`));
  if (!response.ok) {
    throw new Error(`Failed to search market symbols: ${response.statusText}`);
  }
  const data = await response.json();
  return Array.isArray(data?.items) ? data.items : [];
}
