export type MarketSearchCategory = 'stocks' | 'etfs' | 'crypto' | 'options';

export interface MarketSearchResult {
  symbol: string;
  name: string;
  exchange?: string;
  quoteType?: string;
}

function normalizeSearchSymbol(symbol: string, category: MarketSearchCategory): string {
  const upper = String(symbol || '').trim().toUpperCase();
  if (category === 'crypto') {
    return upper.replace(/-USD$/i, '');
  }
  return upper;
}

function isYahooResultForCategory(item: any, category: MarketSearchCategory): boolean {
  const quoteType = String(item?.quoteType || '').toUpperCase();
  const symbol = String(item?.symbol || '').toUpperCase();

  if (category === 'stocks') return quoteType === 'EQUITY';
  if (category === 'etfs') return quoteType === 'ETF';
  if (category === 'options') return quoteType === 'EQUITY' || quoteType === 'ETF';
  return quoteType === 'CRYPTOCURRENCY' || quoteType === 'CURRENCY' || symbol.endsWith('-USD');
}

function mapYahooSearchResult(item: any, category: MarketSearchCategory): MarketSearchResult | null {
  const symbol = normalizeSearchSymbol(String(item?.symbol || ''), category);
  if (!symbol) return null;

  return {
    symbol,
    name: String(item?.shortname || item?.longname || item?.symbol || 'Unknown'),
    exchange: String(item?.exchDisp || item?.exchange || '').trim() || undefined,
    quoteType: String(item?.quoteType || '').toUpperCase() || undefined,
  };
}

async function fetchYahooSearch(query: string): Promise<any[]> {
  const targetUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
  const response = await fetch(targetUrl);
  if (!response.ok) {
    throw new Error(`Yahoo search request failed (${response.status} ${response.statusText})`);
  }
  const data = await response.json();
  return Array.isArray(data?.quotes) ? data.quotes : [];
}

async function fetchYahooQuotes(symbols: string[]): Promise<any[]> {
  if (!symbols.length) return [];
  const targetUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols.map((symbol) => symbol.trim().toUpperCase()).join(',')}`;
  const response = await fetch(targetUrl);
  if (!response.ok) {
    throw new Error(`Yahoo quote request failed (${response.status} ${response.statusText})`);
  }
  const data = await response.json();
  return Array.isArray(data?.quoteResponse?.result) ? data.quoteResponse.result : [];
}

export async function searchYahooMarket(query: string, category: MarketSearchCategory): Promise<MarketSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const yahooResults = await fetchYahooSearch(trimmed);
  const mappedYahoo = yahooResults
    .filter((item: any) => isYahooResultForCategory(item, category))
    .map((item: any) => mapYahooSearchResult(item, category))
    .filter((item): item is MarketSearchResult => item !== null);

  if (mappedYahoo.length > 0) {
    const deduped = new Map<string, MarketSearchResult>();
    mappedYahoo.forEach((item) => {
      if (!deduped.has(item.symbol)) {
        deduped.set(item.symbol, item);
      }
    });
    return [...deduped.values()].slice(0, 8);
  }

  const upperQuery = trimmed.toUpperCase();
  const quoteCandidates = category === 'crypto'
    ? [upperQuery, upperQuery.endsWith('-USD') ? upperQuery : `${upperQuery}-USD`]
    : [upperQuery];
  const directQuotes = await fetchYahooQuotes(quoteCandidates);
  const mappedDirect = directQuotes
    .filter((item: any) => isYahooResultForCategory(item, category))
    .map((item: any) => mapYahooSearchResult(item, category))
    .filter((item): item is MarketSearchResult => item !== null);

  const deduped = new Map<string, MarketSearchResult>();
  mappedDirect.forEach((item) => {
    if (!deduped.has(item.symbol)) {
      deduped.set(item.symbol, item);
    }
  });

  return [...deduped.values()].slice(0, 8);
}
