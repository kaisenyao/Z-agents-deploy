const http = require('node:http');

const PORT = Number(process.env.PORT || 8787);
const DEFAULT_CACHE_TTL_MS = Number(process.env.MARKET_CACHE_TTL_MS || 30_000);
const QUOTE_TTL_MS = Number(process.env.MARKET_QUOTE_TTL_MS || 15_000);
const CHART_TTL_MS = Number(process.env.MARKET_CHART_TTL_MS || 60_000);
const METADATA_TTL_MS = Number(process.env.MARKET_METADATA_TTL_MS || 1_800_000);
const SCREENER_TTL_MS = Number(process.env.MARKET_SCREENER_TTL_MS || 300_000);
const YAHOO_TIMEOUT_MS = Number(process.env.YAHOO_TIMEOUT_MS || 15_000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const cache = new Map();

const SCREENER_IDS = {
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

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.end(JSON.stringify(payload));
}

function sendOptions(res) {
  res.statusCode = 204;
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.end();
}

function getNumericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && typeof value.raw === 'number' && Number.isFinite(value.raw)) {
    return value.raw;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatCompactNumber(value) {
  const numeric = getNumericValue(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(numeric);
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function normalizeSearchSymbol(symbol, category) {
  const upper = normalizeSymbol(symbol);
  return category === 'crypto' ? upper.replace(/-USD$/i, '') : upper;
}

function isYahooResultForCategory(item, category) {
  const quoteType = String(item?.quoteType || '').toUpperCase();
  const symbol = String(item?.symbol || '').toUpperCase();

  if (category === 'stocks') return quoteType === 'EQUITY';
  if (category === 'etfs') return quoteType === 'ETF';
  if (category === 'options') return quoteType === 'EQUITY' || quoteType === 'ETF';
  return quoteType === 'CRYPTOCURRENCY' || quoteType === 'CURRENCY' || symbol.endsWith('-USD');
}

function mapYahooSearchResult(item, category) {
  const symbol = normalizeSearchSymbol(item?.symbol, category);
  if (!symbol) return null;
  return {
    symbol,
    name: String(item?.shortname || item?.longname || item?.symbol || 'Unknown'),
    exchange: String(item?.exchDisp || item?.exchange || '').trim() || undefined,
    quoteType: String(item?.quoteType || '').toUpperCase() || undefined,
  };
}

function mapYahooQuoteToScreenerRow(quote, category) {
  const price = getNumericValue(quote?.regularMarketPrice);
  const change = getNumericValue(quote?.regularMarketChange);
  const changePercent = getNumericValue(quote?.regularMarketChangePercent);
  const peRatio = getNumericValue(quote?.trailingPE);

  return {
    ticker: normalizeSearchSymbol(quote?.symbol, category),
    name: String(quote?.shortName || quote?.longName || quote?.displayName || quote?.symbol || 'Unknown'),
    price,
    change,
    changePercent,
    volume: formatCompactNumber(quote?.regularMarketVolume) || '-',
    marketCap: formatCompactNumber(quote?.marketCap) || '-',
    peRatio: peRatio > 0 ? peRatio.toFixed(2) : '-',
    sparklineData: [],
  };
}

function getCache(key) {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.value;
}

function setCache(key, value, ttlMs = DEFAULT_CACHE_TTL_MS) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
  return value;
}

async function getOrFetch(key, ttlMs, fetcher) {
  const cached = getCache(key);
  if (cached !== null) return cached;
  const value = await fetcher();
  return setCache(key, value, ttlMs);
}

async function fetchJson(targetUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), YAHOO_TIMEOUT_MS);
  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0 z-market-api/0.1',
      },
    });
    if (!response.ok) {
      throw new Error(`Yahoo request failed (${response.status} ${response.statusText})`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchYahooQuotes(symbols) {
  const cleanedSymbols = Array.from(new Set(symbols.map(normalizeSymbol).filter(Boolean)));
  if (!cleanedSymbols.length) return [];

  const cacheKey = `quotes:${cleanedSymbols.slice().sort().join(',')}`;
  return getOrFetch(cacheKey, QUOTE_TTL_MS, async () => {
    const chunks = [];
    for (let index = 0; index < cleanedSymbols.length; index += 40) {
      chunks.push(cleanedSymbols.slice(index, index + 40));
    }

    const results = [];
    for (const chunk of chunks) {
      try {
        const params = new URLSearchParams({ symbols: chunk.join(',') });
        const data = await fetchJson(`https://query1.finance.yahoo.com/v7/finance/quote?${params.toString()}`);
        const quotes = Array.isArray(data?.quoteResponse?.result) ? data.quoteResponse.result : [];
        results.push(...quotes);
      } catch {
        const fallbackQuotes = await Promise.all(chunk.map((symbol) => fetchYahooChartQuote(symbol)));
        results.push(...fallbackQuotes.filter(Boolean));
      }
    }
    return results;
  });
}

async function fetchYahooChartQuote(symbol) {
  const cleanedSymbol = normalizeSymbol(symbol);
  if (!cleanedSymbol) return null;

  try {
    const chart = await fetchYahooChart(cleanedSymbol, { range: '5d', interval: '1d' });
    const meta = chart?.meta || {};
    const quote = chart?.indicators?.quote?.[0] || {};
    const closes = Array.isArray(quote.close) ? quote.close.filter((value) => Number.isFinite(value)) : [];
    const previousClose =
      (closes.length > 1 ? Number(closes[closes.length - 2]) : 0) ||
      getNumericValue(meta.previousClose) ||
      getNumericValue(meta.chartPreviousClose);
    const regularMarketPrice =
      getNumericValue(meta.regularMarketPrice) ||
      (closes.length > 0 ? Number(closes[closes.length - 1]) : 0);
    const regularMarketChange = regularMarketPrice && previousClose
      ? regularMarketPrice - previousClose
      : 0;
    const regularMarketChangePercent = previousClose
      ? (regularMarketChange / previousClose) * 100
      : 0;

    return {
      symbol: cleanedSymbol,
      shortName: cleanedSymbol,
      longName: cleanedSymbol,
      quoteType: String(meta.instrumentType || '').toUpperCase() || undefined,
      marketState: meta.marketState,
      regularMarketPrice,
      regularMarketPreviousClose: previousClose || undefined,
      regularMarketChange,
      regularMarketChangePercent,
      regularMarketDayHigh: getNumericValue(meta.regularMarketDayHigh) || undefined,
      regularMarketDayLow: getNumericValue(meta.regularMarketDayLow) || undefined,
      regularMarketVolume: getNumericValue(meta.regularMarketVolume) || undefined,
      exchange: meta.exchangeName,
      exchDisp: meta.exchangeName,
      currency: meta.currency,
    };
  } catch {
    return null;
  }
}

function toUnixSeconds(date, { endOfDay = false } = {}) {
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.getTime())) return null;
  parsed.setUTCHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return Math.floor(parsed.getTime() / 1000);
}

async function fetchYahooChart(symbol, request) {
  const cleanedSymbol = normalizeSymbol(symbol);
  if (!cleanedSymbol) return null;

  const cacheKey = `chart:${JSON.stringify({ symbol: cleanedSymbol, ...request })}`;
  return getOrFetch(cacheKey, CHART_TTL_MS, async () => {
    const encodedSymbol = encodeURIComponent(cleanedSymbol);
    const params = new URLSearchParams({
      interval: request.interval || '1d',
      includePrePost: 'false',
      events: 'div,splits',
    });

    if (Number.isFinite(request.period1) && Number.isFinite(request.period2)) {
      params.set('period1', String(Math.floor(request.period1)));
      params.set('period2', String(Math.floor(request.period2)));
    } else if (request.startDate && request.endDate) {
      const start = toUnixSeconds(request.startDate);
      const end = toUnixSeconds(request.endDate, { endOfDay: true });
      if (start === null || end === null || end <= start) return null;
      params.set('period1', String(start));
      params.set('period2', String(end));
    } else {
      params.set('range', request.range || '1mo');
    }

    const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?${params.toString()}`);
    return data?.chart?.result?.[0] || null;
  });
}

async function fetchYahooSearch(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return [];

  const cacheKey = `search:${trimmed.toLowerCase()}`;
  return getOrFetch(cacheKey, QUOTE_TTL_MS, async () => {
    const params = new URLSearchParams({
      q: trimmed,
      quotesCount: '10',
      newsCount: '0',
    });
    const data = await fetchJson(`https://query1.finance.yahoo.com/v1/finance/search?${params.toString()}`);
    return Array.isArray(data?.quotes) ? data.quotes.filter((quote) => quote?.symbol) : [];
  });
}

async function searchMarket(query, category) {
  const yahooResults = await fetchYahooSearch(query);
  const mappedYahoo = yahooResults
    .filter((item) => isYahooResultForCategory(item, category))
    .map((item) => mapYahooSearchResult(item, category))
    .filter(Boolean);

  if (mappedYahoo.length > 0) {
    const deduped = new Map();
    mappedYahoo.forEach((item) => {
      if (!deduped.has(item.symbol)) deduped.set(item.symbol, item);
    });
    return [...deduped.values()].slice(0, 8);
  }

  const upperQuery = normalizeSymbol(query);
  const quoteCandidates = category === 'crypto'
    ? [upperQuery, upperQuery.endsWith('-USD') ? upperQuery : `${upperQuery}-USD`]
    : [upperQuery];
  const directQuotes = await fetchYahooQuotes(quoteCandidates);
  return directQuotes
    .filter((item) => isYahooResultForCategory(item, category))
    .map((item) => mapYahooSearchResult(item, category))
    .filter(Boolean)
    .slice(0, 8);
}

async function fetchYahooQuoteSummary(symbol) {
  const cleanedSymbol = normalizeSymbol(symbol);
  if (!cleanedSymbol) return null;

  const cacheKey = `summary:${cleanedSymbol}`;
  return getOrFetch(cacheKey, METADATA_TTL_MS, async () => {
    try {
      const modules = 'price,summaryDetail,defaultKeyStatistics';
      const data = await fetchJson(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(cleanedSymbol)}?modules=${modules}`);
      return data?.quoteSummary?.result?.[0] || null;
    } catch {
      return null;
    }
  });
}

async function fetchMetadata(symbol) {
  const cleanedSymbol = normalizeSymbol(symbol);
  if (!cleanedSymbol) return null;

  const cacheKey = `metadata:${cleanedSymbol}`;
  return getOrFetch(cacheKey, METADATA_TTL_MS, async () => {
    const [quotes, summary, screenerFallback] = await Promise.all([
      fetchYahooQuotes([cleanedSymbol]).catch(() => []),
      fetchYahooQuoteSummary(cleanedSymbol),
      findScreenerFallback(cleanedSymbol),
    ]);
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
    const fallbackMarketCap = screenerFallback?.marketCap && screenerFallback.marketCap !== '-'
      ? screenerFallback.marketCap
      : undefined;
    const fallbackTrailingPE = screenerFallback?.peRatio && screenerFallback.peRatio !== '-'
      ? screenerFallback.peRatio
      : undefined;

    return {
      symbol: cleanedSymbol,
      shortName: quote?.shortName || summary?.price?.shortName || screenerFallback?.name || cleanedSymbol,
      longName: quote?.longName || summary?.price?.longName || screenerFallback?.name,
      marketCap: marketCap > 0 ? marketCap : undefined,
      trailingPE: trailingPE > 0 ? trailingPE : undefined,
      epsTrailingTwelveMonths: epsTrailingTwelveMonths > 0 ? epsTrailingTwelveMonths : undefined,
      summary,
      pageMetrics: {
        marketCap: formatCompactNumber(marketCap) || fallbackMarketCap,
        trailingPE: trailingPE > 0 ? trailingPE.toFixed(2) : fallbackTrailingPE,
      },
      diagnostics: {
        quoteOk: Boolean(quote),
        summaryOk: Boolean(summary),
        screenerFallbackOk: Boolean(screenerFallback),
      },
    };
  });
}

async function findScreenerFallback(symbol) {
  const cleanedSymbol = normalizeSymbol(symbol);
  const categories = ['stocks', 'etfs', 'crypto'];
  const tabs = ['most_actives', 'day_gainers'];

  for (const category of categories) {
    for (const tab of tabs) {
      try {
        const payload = await fetchScreener(category, tab);
        const match = payload.items.find((item) => normalizeSymbol(item.ticker) === normalizeSearchSymbol(cleanedSymbol, category));
        if (match) return match;
      } catch {
        // Keep metadata best-effort.
      }
    }
  }

  return null;
}

async function fetchScreener(category, tab) {
  const validTabs = new Set(['most_actives', 'day_gainers']);
  const normalizedCategory = String(category || '').trim().toLowerCase();
  const normalizedTab = String(tab || '').trim().toLowerCase();

  if (!validTabs.has(normalizedTab)) {
    const error = new Error('Invalid tab');
    error.statusCode = 400;
    throw error;
  }

  if (normalizedCategory === 'options') {
    return {
      category: 'options',
      tab: normalizedTab,
      updatedAt: new Date().toISOString(),
      items: [],
    };
  }

  const screenerId = SCREENER_IDS[normalizedCategory]?.[normalizedTab];
  if (!screenerId) {
    const error = new Error('Invalid category');
    error.statusCode = 400;
    throw error;
  }

  const cacheKey = `screener:${normalizedCategory}:${normalizedTab}`;
  return getOrFetch(cacheKey, SCREENER_TTL_MS, async () => {
    const params = new URLSearchParams({
      formatted: 'false',
      scrIds: screenerId,
      count: '100',
      start: '0',
    });
    const data = await fetchJson(`https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?${params.toString()}`);
    const quotes = Array.isArray(data?.finance?.result?.[0]?.quotes) ? data.finance.result[0].quotes : [];
    const deduped = new Map();
    quotes.forEach((quote) => {
      const symbol = normalizeSymbol(quote?.symbol);
      if (symbol && !deduped.has(symbol)) deduped.set(symbol, quote);
    });

    return {
      category: normalizedCategory,
      tab: normalizedTab,
      updatedAt: new Date().toISOString(),
      items: [...deduped.values()].map((quote) => mapYahooQuoteToScreenerRow(quote, normalizedCategory)),
    };
  });
}

async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    sendOptions(res);
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (url.pathname === '/ok' || url.pathname === '/health') {
    sendJson(res, 200, { ok: true, service: 'z-market-api' });
    return;
  }

  try {
    if (url.pathname === '/market/quote') {
      const symbols = String(url.searchParams.get('symbols') || '')
        .split(',')
        .map(normalizeSymbol)
        .filter(Boolean);
      if (!symbols.length) {
        sendJson(res, 400, { error: 'Missing required query parameter: symbols' });
        return;
      }
      const items = await fetchYahooQuotes(symbols);
      sendJson(res, 200, { items });
      return;
    }

    if (url.pathname === '/market/chart') {
      const symbol = normalizeSymbol(url.searchParams.get('symbol'));
      if (!symbol) {
        sendJson(res, 400, { error: 'Missing required query parameter: symbol' });
        return;
      }

      const rawPeriod1 = String(url.searchParams.get('period1') || '').trim();
      const rawPeriod2 = String(url.searchParams.get('period2') || '').trim();
      const period1 = rawPeriod1 ? Number(rawPeriod1) : Number.NaN;
      const period2 = rawPeriod2 ? Number(rawPeriod2) : Number.NaN;
      const chart = await fetchYahooChart(symbol, {
        range: String(url.searchParams.get('range') || '1mo').trim(),
        interval: String(url.searchParams.get('interval') || '1d').trim(),
        startDate: String(url.searchParams.get('startDate') || '').trim(),
        endDate: String(url.searchParams.get('endDate') || '').trim(),
        period1: Number.isFinite(period1) ? period1 : undefined,
        period2: Number.isFinite(period2) ? period2 : undefined,
      });
      sendJson(res, 200, { chart });
      return;
    }

    if (url.pathname === '/market/search') {
      const query = String(url.searchParams.get('query') || '').trim();
      const category = String(url.searchParams.get('category') || '').trim().toLowerCase();
      if (!query) {
        sendJson(res, 400, { error: 'Missing required query parameter: query' });
        return;
      }

      if (!category) {
        sendJson(res, 200, { items: await fetchYahooSearch(query) });
        return;
      }

      if (!['stocks', 'etfs', 'crypto', 'options'].includes(category)) {
        sendJson(res, 400, { error: 'Invalid category' });
        return;
      }

      sendJson(res, 200, { items: await searchMarket(query, category) });
      return;
    }

    if (url.pathname === '/market/metadata') {
      const symbol = normalizeSymbol(url.searchParams.get('symbol'));
      if (!symbol) {
        sendJson(res, 400, { error: 'Missing required query parameter: symbol' });
        return;
      }
      sendJson(res, 200, await fetchMetadata(symbol));
      return;
    }

    if (url.pathname === '/market/screener') {
      const category = String(url.searchParams.get('category') || '').trim().toLowerCase();
      const tab = String(url.searchParams.get('tab') || '').trim().toLowerCase();
      sendJson(res, 200, await fetchScreener(category, tab));
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    const status = Number(error?.statusCode) || 500;
    sendJson(res, status, {
      error: error?.message || 'Internal server error',
    });
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    sendJson(res, 500, {
      error: error?.message || 'Internal server error',
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`z-market-api listening on 0.0.0.0:${PORT}`);
});
