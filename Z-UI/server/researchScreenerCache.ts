import { promises as fs } from 'fs';
import path from 'path';
import { MarketDataGateway } from './marketDataGateway';

export type ResearchScreenerCategory = 'stocks' | 'etfs' | 'crypto' | 'options';
export type ResearchScreenerTab = 'most_actives' | 'day_gainers';

export interface ResearchAssetRow {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: string;
  marketCap: string;
  peRatio: string;
  sparklineData: number[];
}

export interface ResearchOptionRow {
  symbol: string;
  name: string;
  underlyingSymbol: string;
  strike: number | null;
  expirationDate: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
}

interface CacheEnvelope<T> {
  category: ResearchScreenerCategory;
  tab: ResearchScreenerTab;
  updatedAt: string;
  items: T[];
}

const CACHE_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const CACHE_BATCH_SIZE = 100;
const CACHE_DIR = path.resolve(__dirname, '../.cache/research-screeners');
const OPTIONS_UNDERLYING_LIMIT = 8;
const OPTIONS_ROW_LIMIT = 100;

const SCREENER_IDS: Record<Exclude<ResearchScreenerCategory, 'options'>, Record<ResearchScreenerTab, string>> = {
  stocks: {
    most_actives: 'most_actives',
    day_gainers: 'day_gainers',
  },
  etfs: {
    most_actives: 'most_actives_etfs',
    day_gainers: 'day_gainers_etfs',
  },
  crypto: {
    most_actives: 'most_actives_cryptocurrencies',
    day_gainers: 'day_gainers_cryptocurrencies',
  },
};

function formatCompactNumber(value: unknown): string {
  const numeric = getNumericValue(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '-';
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(numeric);
}

function getNumericValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'raw' in value && typeof (value as { raw?: unknown }).raw === 'number') {
    const raw = (value as { raw: number }).raw;
    return Number.isFinite(raw) ? raw : 0;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeTicker(symbol: string, category: ResearchScreenerCategory): string {
  const upper = String(symbol || '').trim().toUpperCase();
  if (category === 'crypto') {
    return upper.replace(/-USD$/i, '');
  }
  return upper;
}

function isValidOptionsUnderlying(symbol: string): boolean {
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol);
}

function toIsoDateString(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value < 1_000_000_000_000 ? value * 1000 : value;
    const parsed = new Date(timestamp);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return fallback;
}

function formatOptionContractName(underlyingSymbol: string, expirationDate: string, strike: number | null, optionType: 'Call' | 'Put'): string {
  const expiration = new Date(expirationDate);
  const expirationLabel = Number.isFinite(expiration.getTime())
    ? expiration.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : expirationDate;
  const strikeLabel = typeof strike === 'number' && Number.isFinite(strike) ? strike.toFixed(2).replace(/\.00$/, '') : '?';
  return `${underlyingSymbol} ${expirationLabel} ${strikeLabel} ${optionType}`;
}

function toCacheFilePath(category: ResearchScreenerCategory, tab: ResearchScreenerTab): string {
  return path.join(CACHE_DIR, `${category}-${tab}.json`);
}

async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

async function fetchYahooScreenerResult(scrId: string, count: number, start: number): Promise<any | null> {
  const params = new URLSearchParams({
    formatted: 'false',
    scrIds: scrId,
    count: String(count),
    start: String(start),
  });
  const response = await fetch(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Yahoo screener request failed (${response.status} ${response.statusText})`);
  }
  const data = await response.json();
  return data?.finance?.result?.[0] || null;
}

async function fetchYahooScreenerQuotes(scrId: string): Promise<any[]> {
  const allQuotes: any[] = [];
  let start = 0;
  let total = Infinity;

  while (start < total) {
    const result = await fetchYahooScreenerResult(scrId, CACHE_BATCH_SIZE, start);
    const quotes = Array.isArray(result?.quotes) ? result.quotes : [];
    const responseTotal = Number(result?.total);
    const responseCount = Number(result?.count);

    allQuotes.push(...quotes);

    if (!Number.isFinite(responseTotal) || responseTotal <= 0 || quotes.length === 0) {
      break;
    }

    total = responseTotal;
    start += Number.isFinite(responseCount) && responseCount > 0 ? responseCount : quotes.length;
  }

  const deduped = new Map<string, any>();
  for (const quote of allQuotes) {
    const symbol = String(quote?.symbol || '').toUpperCase();
    if (!symbol || deduped.has(symbol)) continue;
    deduped.set(symbol, quote);
  }
  return [...deduped.values()];
}

function mapYahooQuoteToAssetRow(quote: any, category: Exclude<ResearchScreenerCategory, 'options'>): ResearchAssetRow {
  const price = getNumericValue(quote?.regularMarketPrice);
  const change = getNumericValue(quote?.regularMarketChange);
  const changePercent = getNumericValue(quote?.regularMarketChangePercent);
  const peRatio = getNumericValue(quote?.trailingPE);

  return {
    ticker: normalizeTicker(String(quote?.symbol || ''), category),
    name: String(quote?.shortName || quote?.longName || quote?.displayName || quote?.symbol || 'Unknown'),
    price,
    change,
    changePercent,
    volume: formatCompactNumber(quote?.regularMarketVolume),
    marketCap: formatCompactNumber(quote?.marketCap),
    peRatio: peRatio > 0 ? peRatio.toFixed(2) : '-',
    sparklineData: [],
  };
}

function buildEmptyOptionsFallback(tab: ResearchScreenerTab): CacheEnvelope<ResearchOptionRow> {
  return {
    category: 'options',
    tab,
    updatedAt: new Date().toISOString(),
    items: [],
  };
}

export class ResearchScreenerCache {
  private readonly marketDataGateway = new MarketDataGateway();
  private readonly memoryCache = new Map<string, CacheEnvelope<any>>();
  private startupPromise: Promise<void> | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (!this.startupPromise) {
      this.startupPromise = this.initialize();
    }
    return this.startupPromise;
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async get(category: ResearchScreenerCategory, tab: ResearchScreenerTab): Promise<CacheEnvelope<any[]>> {
    await this.start();
    const cacheKey = this.toKey(category, tab);
    const cached = this.memoryCache.get(cacheKey);
    if (cached) {
      return {
        category,
        tab,
        updatedAt: cached.updatedAt,
        items: Array.isArray(cached.items) ? cached.items : [],
      };
    }

    return category === 'options'
      ? buildEmptyOptionsFallback(tab)
      : { category, tab, updatedAt: new Date().toISOString(), items: [] };
  }

  private async initialize(): Promise<void> {
    await ensureCacheDir();
    await Promise.all(this.buildDatasetPairs().map(({ category, tab }) => this.loadOrPopulate(category, tab)));
    this.refreshTimer = setInterval(() => {
      void this.refreshAll();
    }, CACHE_REFRESH_INTERVAL_MS);
  }

  private buildDatasetPairs(): Array<{ category: ResearchScreenerCategory; tab: ResearchScreenerTab }> {
    return (['stocks', 'etfs', 'crypto', 'options'] as const).flatMap((category) =>
      (['most_actives', 'day_gainers'] as const).map((tab) => ({ category, tab })),
    );
  }

  private toKey(category: ResearchScreenerCategory, tab: ResearchScreenerTab): string {
    return `${category}:${tab}`;
  }

  private async loadOrPopulate(category: ResearchScreenerCategory, tab: ResearchScreenerTab): Promise<void> {
    const filePath = toCacheFilePath(category, tab);

    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as CacheEnvelope<any[]>;
      if (Array.isArray(parsed?.items)) {
        const shouldRefreshEmptyOptions = category === 'options' && parsed.items.length === 0;
        this.memoryCache.set(this.toKey(category, tab), {
          category,
          tab,
          updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
          items: parsed.items,
        });
        if (!shouldRefreshEmptyOptions) {
          return;
        }
      }
    } catch {
      // Fall through to initial population.
    }

    const initial = await this.refreshDataset(category, tab);
    if (initial) {
      this.memoryCache.set(this.toKey(category, tab), initial);
      await this.writeCacheFile(category, tab, initial);
      return;
    }

    const fallback = category === 'options'
      ? buildEmptyOptionsFallback(tab)
      : { category, tab, updatedAt: new Date().toISOString(), items: [] };
    this.memoryCache.set(this.toKey(category, tab), fallback);
    await this.writeCacheFile(category, tab, fallback);
  }

  private async refreshAll(): Promise<void> {
    const datasets = this.buildDatasetPairs();
    await Promise.all(datasets.map(async ({ category, tab }) => {
      const refreshed = await this.refreshDataset(category, tab);
      if (!refreshed) return;
      this.memoryCache.set(this.toKey(category, tab), refreshed);
      await this.writeCacheFile(category, tab, refreshed);
    }));
  }

  private async refreshDataset(
    category: ResearchScreenerCategory,
    tab: ResearchScreenerTab,
  ): Promise<CacheEnvelope<any[]> | null> {
    if (category === 'options') {
      try {
        const items = await this.fetchOptionScreenerRows(tab);
        return {
          category,
          tab,
          updatedAt: new Date().toISOString(),
          items,
        };
      } catch (error) {
        console.error(`[Research screener cache] options refresh failed for ${tab}:`, error);
        return null;
      }
    }

    try {
      const scrId = SCREENER_IDS[category][tab];
      const quotes = await fetchYahooScreenerQuotes(scrId);
      return {
        category,
        tab,
        updatedAt: new Date().toISOString(),
        items: quotes.map((quote) => mapYahooQuoteToAssetRow(quote, category)),
      };
    } catch (error) {
      console.error(`[Research screener cache] refresh failed for ${category}/${tab}:`, error);
      return null;
    }
  }

  private async writeCacheFile(category: ResearchScreenerCategory, tab: ResearchScreenerTab, value: CacheEnvelope<any[]>): Promise<void> {
    const filePath = toCacheFilePath(category, tab);
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
  }

  private async fetchOptionScreenerRows(tab: ResearchScreenerTab): Promise<ResearchOptionRow[]> {
    const stockScreenerId = SCREENER_IDS.stocks[tab];
    const underlyingQuotes = await fetchYahooScreenerQuotes(stockScreenerId);
    const underlyings = underlyingQuotes
      .map((quote) => ({
        ticker: String(quote?.symbol || '').trim().toUpperCase(),
        name: String(quote?.shortName || quote?.longName || quote?.displayName || quote?.symbol || 'Unknown'),
      }))
      .filter((item) => item.ticker && isValidOptionsUnderlying(item.ticker))
      .slice(0, OPTIONS_UNDERLYING_LIMIT);

    const chains = await Promise.allSettled(underlyings.map(async (underlying) => {
      const metadataChain = await this.marketDataGateway.getOptions(underlying.ticker);
      const firstExpiration = Array.isArray(metadataChain?.expirationDates) && metadataChain.expirationDates.length > 0
        ? String(metadataChain.expirationDates[0])
        : '';
      const explicitChain = firstExpiration
        ? await this.marketDataGateway.getOptions(underlying.ticker, firstExpiration)
        : null;

      return {
        underlying,
        chain: explicitChain || metadataChain,
      };
    }));

    const rows = chains.flatMap((result) => {
      if (result.status !== 'fulfilled') {
        return [];
      }

      const { underlying, chain } = result.value;
      const expirationDate = Array.isArray(chain?.expirationDates) && chain.expirationDates.length > 0
        ? String(chain.expirationDates[0])
        : new Date().toISOString();
      const contracts = [
        ...(Array.isArray(chain?.calls) ? chain.calls : []),
        ...(Array.isArray(chain?.puts) ? chain.puts : []),
      ];

      return contracts
        .map((contract: any) => this.mapOptionContractToRow(contract, underlying.ticker, expirationDate))
        .filter((row): row is ResearchOptionRow => row !== null);
    });

    const sorted = [...rows].sort((left, right) => {
      if (tab === 'most_actives') {
        const volumeDiff = (right.volume || 0) - (left.volume || 0);
        if (volumeDiff !== 0) return volumeDiff;
        return (right.openInterest || 0) - (left.openInterest || 0);
      }

      const gainDiff = (right.changePercent || -Infinity) - (left.changePercent || -Infinity);
      if (gainDiff !== 0) return gainDiff;
      return (right.volume || 0) - (left.volume || 0);
    });

    return sorted.slice(0, OPTIONS_ROW_LIMIT);
  }

  private mapOptionContractToRow(contract: any, underlyingSymbol: string, fallbackExpirationDate: string): ResearchOptionRow | null {
    const symbol = String(contract?.contractSymbol || contract?.symbol || '').trim().toUpperCase();
    if (!symbol) return null;

    const strike = getNumericValue(contract?.strike);
    const expirationDate = toIsoDateString(contract?.expiration ?? contract?.expirationDate, fallbackExpirationDate);
    const optionType: 'Call' | 'Put' = /P\d{8}$/.test(symbol) ? 'Put' : 'Call';
    const price = getNumericValue(contract?.lastPrice ?? contract?.regularMarketPrice);
    const change = getNumericValue(contract?.change ?? contract?.regularMarketChange);
    const changePercent = getNumericValue(contract?.percentChange ?? contract?.regularMarketChangePercent);
    const rawBid = contract?.bid;
    const rawAsk = contract?.ask;
    const bid = rawBid === null || rawBid === undefined || rawBid === '' ? null : getNumericValue(rawBid);
    const ask = rawAsk === null || rawAsk === undefined || rawAsk === '' ? null : getNumericValue(rawAsk);
    const volume = getNumericValue(contract?.volume);
    const openInterest = getNumericValue(contract?.openInterest);

    return {
      symbol,
      name: formatOptionContractName(underlyingSymbol, expirationDate, strike > 0 ? strike : null, optionType),
      underlyingSymbol,
      strike: strike > 0 ? strike : null,
      expirationDate,
      price: price > 0 ? price : null,
      change: Number.isFinite(change) ? change : null,
      changePercent: Number.isFinite(changePercent) ? changePercent : null,
      bid: bid !== null && Number.isFinite(bid) ? bid : null,
      ask: ask !== null && Number.isFinite(ask) ? ask : null,
      volume: volume > 0 ? volume : null,
      openInterest: openInterest > 0 ? openInterest : null,
    };
  }
}
