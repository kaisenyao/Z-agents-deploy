import { appApi } from './apiBase';

export type ResearchScreenerCategory = 'stocks' | 'etfs' | 'crypto' | 'options';
export type ResearchScreenerTab = 'most_actives' | 'day_gainers';

export interface CachedResearchScreenerResponse<T> {
  category: ResearchScreenerCategory;
  tab: ResearchScreenerTab;
  updatedAt: string;
  items: T[];
}

export async function fetchCachedResearchScreener<T>(
  category: ResearchScreenerCategory,
  tab: ResearchScreenerTab,
): Promise<CachedResearchScreenerResponse<T>> {
  const params = new URLSearchParams({
    category,
    tab,
  });

  const response = await fetch(appApi(`/research/screener?${params.toString()}`));
  if (!response.ok) {
    throw new Error(`Failed to fetch research screener cache: ${response.statusText}`);
  }

  return response.json();
}
