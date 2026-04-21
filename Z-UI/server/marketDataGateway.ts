import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const QUOTE_TTL_MS = 15 * 1000;
const CHART_TTL_MS = 60 * 1000;
const METADATA_TTL_MS = 30 * 60 * 1000;
const OPTIONS_TTL_MS = 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

function formatCompactNumber(value: unknown): string | undefined {
  const numeric = getNumericValue(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
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

async function fetchJson(targetUrl: string): Promise<any> {
  const response = await fetch(targetUrl);
  if (!response.ok) {
    throw new Error(`Yahoo request failed (${response.status} ${response.statusText})`);
  }
  return response.json();
}

async function fetchYahooQuoteBatch(symbols: string[]): Promise<any[]> {
  if (!symbols.length) return [];

  const params = new URLSearchParams({
    symbols: symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean).join(','),
  });
  const data = await fetchJson(`https://query1.finance.yahoo.com/v7/finance/quote?${params.toString()}`);
  return Array.isArray(data?.quoteResponse?.result) ? data.quoteResponse.result : [];
}

async function fetchYahooQuoteFallback(symbol: string): Promise<any | null> {
  try {
    return await yahooFinance.quote(symbol.trim().toUpperCase());
  } catch {
    return null;
  }
}

async function fetchYahooChart(symbol: string, range: string, interval: string): Promise<any | null> {
  const encodedSymbol = encodeURIComponent(symbol.trim().toUpperCase());
  const params = new URLSearchParams({ range, interval });
  params.set('includePrePost', 'false');
  params.set('events', 'div,splits');
  const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?${params.toString()}`);
  return data?.chart?.result?.[0] || null;
}

function toUnixSeconds(date: string, { endOfDay = false }: { endOfDay?: boolean } = {}): number | null {
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }

  if (endOfDay) {
    parsed.setUTCHours(23, 59, 59, 999);
  } else {
    parsed.setUTCHours(0, 0, 0, 0);
  }

  return Math.floor(parsed.getTime() / 1000);
}

async function fetchYahooChartByDateWindow(symbol: string, startDate: string, endDate: string, interval: string): Promise<any | null> {
  const encodedSymbol = encodeURIComponent(symbol.trim().toUpperCase());
  const start = toUnixSeconds(startDate);
  const end = toUnixSeconds(endDate, { endOfDay: true });

  if (start === null || end === null) {
    return null;
  }

  const params = new URLSearchParams({
    period1: String(start),
    period2: String(end),
    interval,
    includePrePost: 'false',
    events: 'div,splits',
  });
  const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?${params.toString()}`);
  return data?.chart?.result?.[0] || null;
}

async function fetchYahooChartByUnixWindow(symbol: string, period1: number, period2: number, interval: string): Promise<any | null> {
  if (!Number.isFinite(period1) || !Number.isFinite(period2) || period2 <= period1) {
    return null;
  }

  const encodedSymbol = encodeURIComponent(symbol.trim().toUpperCase());
  const params = new URLSearchParams({
    period1: String(Math.floor(period1)),
    period2: String(Math.floor(period2)),
    interval,
    includePrePost: 'false',
    events: 'div,splits',
  });
  const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?${params.toString()}`);
  return data?.chart?.result?.[0] || null;
}

async function fetchYahooQuoteSummary(symbol: string): Promise<any | null> {
  try {
    return await yahooFinance.quoteSummary(symbol.trim().toUpperCase(), {
      modules: ['price', 'summaryDetail', 'defaultKeyStatistics'],
    });
  } catch {
    return null;
  }
}

async function fetchYahooSearchRaw(query: string): Promise<any[]> {
  const params = new URLSearchParams({
    q: query,
    quotesCount: '10',
    newsCount: '0',
  });
  const data = await fetchJson(`https://query1.finance.yahoo.com/v1/finance/search?${params.toString()}`);
  return Array.isArray(data?.quotes) ? data.quotes.filter((quote: any) => quote?.symbol) : [];
}

async function getOrFetch<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  try {
    const value = await fetcher();
    cache.set(key, {
      value,
      expiresAt: now + ttlMs,
    });
    return value;
  } catch (error) {
    if (cached) {
      return cached.value;
    }
    throw error;
  }
}

export class MarketDataGateway {
  private readonly quoteCache = new Map<string, CacheEntry<any[]>>();
  private readonly quoteSymbolCache = new Map<string, CacheEntry<any>>();
  private readonly chartCache = new Map<string, CacheEntry<any | null>>();
  private readonly metadataCache = new Map<string, CacheEntry<any | null>>();
  private readonly optionsCache = new Map<string, CacheEntry<any | null>>();
  private readonly rawSearchCache = new Map<string, CacheEntry<any[]>>();
  private readonly quoteInFlight = new Map<string, Promise<any[]>>();
  private readonly metadataInFlight = new Map<string, Promise<any | null>>();

  async getQuotes(symbols: string[]): Promise<any[]> {
    const cleanedSymbols = Array.from(new Set(
      symbols
        .map((symbol) => String(symbol || '').trim().toUpperCase())
        .filter((symbol) => symbol && symbol !== 'NULL' && symbol !== 'UNDEFINED'),
    ));
    if (!cleanedSymbols.length) return [];

    const cacheKey = cleanedSymbols.slice().sort().join(',');
    const now = Date.now();
    const cachedBatch = this.quoteCache.get(cacheKey);
    if (cachedBatch && cachedBatch.expiresAt > now) {
      return cachedBatch.value;
    }

    const inFlight = this.quoteInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const request = (async () => {
      const chunkSize = 40;
      const freshResults = new Map<string, any>();
      const staleResults = new Map<string, any>();
      const missingSymbols: string[] = [];

      cleanedSymbols.forEach((symbol) => {
        const cachedSymbol = this.quoteSymbolCache.get(symbol);
        if (cachedSymbol?.value) {
          staleResults.set(symbol, cachedSymbol.value);
          if (cachedSymbol.expiresAt > now) {
            freshResults.set(symbol, cachedSymbol.value);
            return;
          }
        }
        missingSymbols.push(symbol);
      });

      for (let index = 0; index < missingSymbols.length; index += chunkSize) {
        const chunk = missingSymbols.slice(index, index + chunkSize);
        try {
          const quotes = await fetchYahooQuoteBatch(chunk);
          const seenInChunk = new Set<string>();

          quotes.forEach((quote) => {
            const symbol = String(quote?.symbol || '').trim().toUpperCase();
            if (!symbol) return;
            seenInChunk.add(symbol);
            freshResults.set(symbol, quote);
            staleResults.set(symbol, quote);
            this.quoteSymbolCache.set(symbol, {
              value: quote,
              expiresAt: Date.now() + QUOTE_TTL_MS,
            });
          });

          chunk.forEach((symbol) => {
            if (seenInChunk.has(symbol)) return;
            const stale = this.quoteSymbolCache.get(symbol);
            if (stale?.value) {
              staleResults.set(symbol, stale.value);
            }
          });

          const unresolvedSymbols = chunk.filter((symbol) => !seenInChunk.has(symbol));
          if (unresolvedSymbols.length > 0) {
            const fallbackQuotes = await Promise.all(
              unresolvedSymbols.map(async (symbol) => ({
                symbol,
                quote: await fetchYahooQuoteFallback(symbol),
              })),
            );

            fallbackQuotes.forEach(({ symbol, quote }) => {
              if (!quote) return;
              freshResults.set(symbol, quote);
              staleResults.set(symbol, quote);
              this.quoteSymbolCache.set(symbol, {
                value: quote,
                expiresAt: Date.now() + QUOTE_TTL_MS,
              });
            });
          }
        } catch {
          const fallbackQuotes = await Promise.all(
            chunk.map(async (symbol) => ({
              symbol,
              quote: await fetchYahooQuoteFallback(symbol),
            })),
          );

          fallbackQuotes.forEach(({ symbol, quote }) => {
            if (quote) {
              freshResults.set(symbol, quote);
              staleResults.set(symbol, quote);
              this.quoteSymbolCache.set(symbol, {
                value: quote,
                expiresAt: Date.now() + QUOTE_TTL_MS,
              });
              return;
            }

            const stale = this.quoteSymbolCache.get(symbol);
            if (stale?.value) {
              staleResults.set(symbol, stale.value);
            }
          });
        }
      }

      const combined = cleanedSymbols
        .map((symbol) => freshResults.get(symbol) || staleResults.get(symbol))
        .filter((quote): quote is any => Boolean(quote));

      this.quoteCache.set(cacheKey, {
        value: combined,
        expiresAt: Date.now() + QUOTE_TTL_MS,
      });

      if (combined.length > 0) {
        return combined;
      }

      return cachedBatch?.value || [];
    })().finally(() => {
      this.quoteInFlight.delete(cacheKey);
    });

    this.quoteInFlight.set(cacheKey, request);
    return request;
  }

  async getChart(
    symbol: string,
    request: { range?: string; interval: string; startDate?: string; endDate?: string; period1?: number; period2?: number },
  ): Promise<any | null> {
    const cleanedSymbol = symbol.trim().toUpperCase();
    if (!cleanedSymbol) return null;

    const cacheKey = JSON.stringify({
      symbol: cleanedSymbol,
      range: request.range || null,
      interval: request.interval,
      startDate: request.startDate || null,
      endDate: request.endDate || null,
      period1: request.period1 ?? null,
      period2: request.period2 ?? null,
    });
    return getOrFetch(this.chartCache, cacheKey, CHART_TTL_MS, () => {
      if (Number.isFinite(request.period1) && Number.isFinite(request.period2)) {
        return fetchYahooChartByUnixWindow(cleanedSymbol, Number(request.period1), Number(request.period2), request.interval);
      }

      if (request.startDate && request.endDate) {
        return fetchYahooChartByDateWindow(cleanedSymbol, request.startDate, request.endDate, request.interval);
      }

      return fetchYahooChart(cleanedSymbol, request.range || '1mo', request.interval);
    });
  }

  async getMetadata(symbol: string): Promise<any | null> {
    const cleanedSymbol = symbol.trim().toUpperCase();
    if (!cleanedSymbol) return null;

    const cached = this.metadataCache.get(cleanedSymbol);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const existingRequest = this.metadataInFlight.get(cleanedSymbol);
    if (existingRequest) {
      return existingRequest;
    }

    const request = (async () => {
      try {
        const [quotesResult, summaryResult] = await Promise.allSettled([
          this.getQuotes([cleanedSymbol]),
          fetchYahooQuoteSummary(cleanedSymbol),
        ]);

        const quotes = quotesResult.status === 'fulfilled' ? quotesResult.value : [];
        const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : null;
        const quote = Array.isArray(quotes) ? quotes[0] : null;
        const marketCap = getNumericValue(
          quote?.marketCap ??
          summary?.price?.marketCap ??
          summary?.summaryDetail?.marketCap,
        );
        const trailingPE = getNumericValue(
          quote?.trailingPE ??
          summary?.defaultKeyStatistics?.trailingPE ??
          summary?.summaryDetail?.trailingPE,
        );
        const epsTrailingTwelveMonths = getNumericValue(quote?.epsTrailingTwelveMonths);

        const payload = {
          symbol: cleanedSymbol,
          shortName: quote?.shortName || summary?.price?.shortName || cleanedSymbol,
          longName: quote?.longName || summary?.price?.longName,
          marketCap: marketCap > 0 ? marketCap : undefined,
          trailingPE: trailingPE > 0 ? trailingPE : undefined,
          epsTrailingTwelveMonths: epsTrailingTwelveMonths > 0 ? epsTrailingTwelveMonths : undefined,
          summary,
          pageMetrics: {
            marketCap: formatCompactNumber(marketCap),
            trailingPE: trailingPE > 0 ? trailingPE.toFixed(2) : undefined,
          },
          diagnostics: {
            quoteOk: quotesResult.status === 'fulfilled',
            summaryOk: summaryResult.status === 'fulfilled',
          },
        };

        this.metadataCache.set(cleanedSymbol, {
          value: payload,
          expiresAt: Date.now() + METADATA_TTL_MS,
        });

        if (!payload.shortName && !payload.longName && !payload.marketCap && !payload.trailingPE && !payload.summary) {
          return {
            symbol: cleanedSymbol,
            shortName: cleanedSymbol,
            pageMetrics: {},
            diagnostics: payload.diagnostics,
          };
        }

        return payload;
      } catch {
        if (cached) {
          return cached.value;
        }
        return {
          symbol: cleanedSymbol,
          shortName: cleanedSymbol,
          pageMetrics: {},
          diagnostics: {
            quoteOk: false,
            summaryOk: false,
          },
        };
      } finally {
        this.metadataInFlight.delete(cleanedSymbol);
      }
    })();

    this.metadataInFlight.set(cleanedSymbol, request);
    return request;
  }

  async getOptions(symbol: string, date?: string): Promise<any | null> {
    const cleanedSymbol = symbol.trim().toUpperCase();
    if (!cleanedSymbol) return null;

    const cacheKey = `${cleanedSymbol}:${date || 'default'}`;
    return getOrFetch(this.optionsCache, cacheKey, OPTIONS_TTL_MS, async () => {
      const queryOptions = date ? { date: new Date(date) } : undefined;
      const data = await yahooFinance.options(cleanedSymbol, queryOptions);
      const optionSet = data.options?.[0];

      return {
        underlyingSymbol: data.underlyingSymbol,
        expirationDates: (data.expirationDates || []).map((expirationDate: Date) => expirationDate.toISOString()),
        quote: data.quote,
        calls: optionSet?.calls || [],
        puts: optionSet?.puts || [],
      };
    });
  }

  async searchRaw(query: string): Promise<any[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const cacheKey = trimmed.toLowerCase();
    return getOrFetch(this.rawSearchCache, cacheKey, QUOTE_TTL_MS, () => fetchYahooSearchRaw(trimmed));
  }
}
