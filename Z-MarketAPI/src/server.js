const http = require('node:http');
const { Pool } = require('pg');
const YahooFinance = require('yahoo-finance2').default;

const PORT = Number(process.env.PORT || 8787);
const DEFAULT_CACHE_TTL_MS = Number(process.env.MARKET_CACHE_TTL_MS || 30_000);
const QUOTE_TTL_MS = Number(process.env.MARKET_QUOTE_TTL_MS || 15_000);
const CHART_TTL_MS = Number(process.env.MARKET_CHART_TTL_MS || 60_000);
const METADATA_TTL_MS = Number(process.env.MARKET_METADATA_TTL_MS || 1_800_000);
const SCREENER_TTL_MS = Number(process.env.MARKET_SCREENER_TTL_MS || 300_000);
const SCREENER_STALE_MS = Number(process.env.MARKET_SCREENER_STALE_MS || 1_800_000);
const SCREENER_REFRESH_INTERVAL_MS = Number(process.env.MARKET_SCREENER_REFRESH_INTERVAL_MS || SCREENER_STALE_MS);
const OPTIONS_TTL_MS = Number(process.env.MARKET_OPTIONS_TTL_MS || 60_000);
const YAHOO_TIMEOUT_MS = Number(process.env.YAHOO_TIMEOUT_MS || 15_000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const DATABASE_URL = process.env.SUPABASE_DB_URL;
if (!DATABASE_URL) {
  throw new Error('SUPABASE_DB_URL is required and DATABASE_URL is ignored');
}
const YAHOO_FINANCE_BASE_URL = 'https://query1.finance.yahoo.com';
const DATABASE_HOST = DATABASE_URL ? new URL(DATABASE_URL).hostname : '';

const cache = new Map();
const screenerRefreshInFlight = new Map();
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const dbPool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    })
  : null;

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

const SCREENER_DATASETS = [
  ['stocks', 'most_actives'],
  ['stocks', 'day_gainers'],
  ['etfs', 'most_actives'],
  ['etfs', 'day_gainers'],
  ['crypto', 'most_actives'],
  ['crypto', 'day_gainers'],
  ['options', 'most_actives'],
  ['options', 'day_gainers'],
];

const OPTIONS_UNDERLYING_LIMIT = 8;
const OPTIONS_ROW_LIMIT = 100;
const SCREENER_BATCH_SIZE = 100;

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

function nullableNumber(value) {
  const numeric = getNumericValue(value);
  return Number.isFinite(numeric) && numeric !== 0 ? numeric : null;
}

function nullableBoolean(value) {
  return typeof value === 'boolean' ? value : null;
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

function isValidOptionsUnderlying(symbol) {
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol);
}

function formatOptionContractName(underlyingSymbol, expirationDate, strike, optionType) {
  const expiration = new Date(expirationDate);
  const expirationLabel = Number.isFinite(expiration.getTime())
    ? expiration.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : expirationDate;
  const strikeLabel = typeof strike === 'number' && Number.isFinite(strike) ? strike.toFixed(2).replace(/\.00$/, '') : '?';
  return `${underlyingSymbol} ${expirationLabel} ${strikeLabel} ${optionType}`;
}

function toIsoDateString(value, fallback) {
  const normalized = normalizeExpirationDate(value);
  return normalized ? new Date(`${normalized}T00:00:00.000Z`).toISOString() : fallback;
}

function mapOptionContractToScreenerRow(contract, underlyingSymbol, fallbackExpirationDate, optionType) {
  const symbol = String(contract?.contractSymbol || contract?.symbol || '').trim().toUpperCase();
  if (!symbol) return null;

  const strike = getNumericValue(contract?.strike);
  const expirationDate = toIsoDateString(contract?.expiration ?? contract?.expirationDate, fallbackExpirationDate);
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

function toScreenerEnvelope(row) {
  if (!row) return null;
  return {
    category: row.category,
    tab: row.tab,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
    items: Array.isArray(row.items) ? row.items : [],
  };
}

async function readScreenerCache(category, tab) {
  if (!dbPool) return null;
  let result;
  try {
    result = await dbPool.query(
      'select category, tab, updated_at, items from market_screener_cache where category = $1 and tab = $2',
      [category, tab],
    );
  } catch (error) {
    throw new Error(`Database screener cache read failed host=${DATABASE_HOST || 'unset'} category=${category} tab=${tab}: ${error?.message || 'Unknown database error'}`);
  }
  return toScreenerEnvelope(result.rows[0]);
}

async function writeScreenerCache(envelope, status = 'ok', lastError = null) {
  if (!dbPool) return;
  try {
    await dbPool.query(
      `insert into market_screener_cache
        (category, tab, updated_at, items, provider, source_key, refresh_status, last_error, refreshed_at)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, now())
       on conflict (category, tab) do update set
        updated_at = excluded.updated_at,
        items = excluded.items,
        provider = excluded.provider,
        source_key = excluded.source_key,
        refresh_status = excluded.refresh_status,
        last_error = excluded.last_error,
        refreshed_at = now()`,
      [
        envelope.category,
        envelope.tab,
        envelope.updatedAt,
        JSON.stringify(Array.isArray(envelope.items) ? envelope.items : []),
        'yahoo',
        envelope.category === 'options' ? 'derived-options-screener' : SCREENER_IDS[envelope.category]?.[envelope.tab] || null,
        status,
        lastError,
      ],
    );
  } catch (error) {
    throw new Error(`Database screener cache write failed host=${DATABASE_HOST || 'unset'} category=${envelope.category} tab=${envelope.tab}: ${error?.message || 'Unknown database error'}`);
  }
}

function isScreenerStale(envelope) {
  if (!envelope?.updatedAt) return true;
  const updatedAtMs = new Date(envelope.updatedAt).getTime();
  return !Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > SCREENER_STALE_MS;
}

async function fetchJson(targetUrl) {
  const parsedUrl = new URL(targetUrl);
  if (parsedUrl.hostname === 'base') {
    throw new Error(`Invalid provider URL hostname "base": ${targetUrl}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), YAHOO_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json,text/plain,*/*',
          'User-Agent': 'Mozilla/5.0 z-market-api/0.1',
        },
      });
    } catch (error) {
      console.error(`[Provider fetch] request failed url=${targetUrl} error=${error?.name || 'Error'}: ${error?.message || 'Unknown error'}`);
      throw error;
    }

    const responseText = await response.text();
    if (!response.ok) {
      const snippet = responseText.slice(0, 500);
      console.error(`[Provider fetch] non-OK url=${targetUrl} status=${response.status} ${response.statusText} body=${snippet}`);
      throw new Error(`Yahoo request failed (${response.status} ${response.statusText}) for ${targetUrl}: ${snippet}`);
    }

    try {
      return JSON.parse(responseText);
    } catch (error) {
      const snippet = responseText.slice(0, 500);
      console.error(`[Provider fetch] invalid JSON url=${targetUrl} error=${error?.name || 'Error'}: ${error?.message || 'Unknown error'} body=${snippet}`);
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }
}

function yahooUrl(pathname, params) {
  const url = new URL(pathname, YAHOO_FINANCE_BASE_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
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
        const data = await fetchJson(yahooUrl('/v7/finance/quote', { symbols: chunk.join(',') }));
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

function normalizeExpirationDate(value) {
  if (value === null || value === undefined || value === '') return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const timestamp = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    const date = new Date(timestamp);
    return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  }

  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function expirationDateToUnix(date) {
  const normalized = normalizeExpirationDate(date);
  if (!normalized) return null;
  return Math.floor(new Date(`${normalized}T00:00:00.000Z`).getTime() / 1000);
}

function normalizeDateTime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(timestamp);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : value;
}

function nextFridayDates(count = 8) {
  const dates = [];
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  const daysUntilFriday = (5 - cursor.getUTCDay() + 7) % 7 || 7;
  cursor.setUTCDate(cursor.getUTCDate() + daysUntilFriday);

  while (dates.length < count) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  return dates;
}

function buildOptionContractSymbol(symbol, expiration, type, strike) {
  const yymmdd = expiration.replace(/-/g, '').slice(2);
  const typeCode = type === 'put' ? 'P' : 'C';
  const strikeCode = String(Math.round(strike * 1000)).padStart(8, '0');
  return `${symbol}${yymmdd}${typeCode}${strikeCode}`;
}

function buildSyntheticOptionRows(symbol, expiration, underlyingPrice, type) {
  if (!Number.isFinite(underlyingPrice) || underlyingPrice <= 0) return [];

  const rawStep = underlyingPrice < 50 ? 2.5 : underlyingPrice < 200 ? 5 : 10;
  const centerStrike = Math.round(underlyingPrice / rawStep) * rawStep;
  const strikes = Array.from({ length: 11 }, (_, index) => Number((centerStrike + (index - 5) * rawStep).toFixed(2)))
    .filter((strike) => strike > 0);

  return strikes.map((strike) => {
    const intrinsic = type === 'call'
      ? Math.max(underlyingPrice - strike, 0)
      : Math.max(strike - underlyingPrice, 0);

    return {
      contractSymbol: buildOptionContractSymbol(symbol, expiration, type, strike),
      strike,
      lastPrice: Number((intrinsic || Math.max(underlyingPrice * 0.015, rawStep * 0.1)).toFixed(2)),
      bid: null,
      ask: null,
      change: null,
      percentChange: null,
      volume: null,
      openInterest: null,
      impliedVolatility: null,
      inTheMoney: type === 'call' ? strike < underlyingPrice : strike > underlyingPrice,
      expiration,
      currency: 'USD',
    };
  });
}

async function buildSyntheticOptionsChain(symbol, requestedDate) {
  const cleanedSymbol = normalizeSymbol(symbol);
  const expirations = nextFridayDates();
  const selectedExpiration = normalizeExpirationDate(requestedDate) || expirations[0] || null;
  const quote = await fetchYahooChartQuote(cleanedSymbol);
  const underlyingPrice = nullableNumber(quote?.regularMarketPrice);

  return {
    symbol: cleanedSymbol,
    underlyingSymbol: cleanedSymbol,
    underlyingPrice,
    expirations,
    expirationDates: expirations,
    selectedExpiration,
    quote: quote || {},
    calls: selectedExpiration && underlyingPrice
      ? buildSyntheticOptionRows(cleanedSymbol, selectedExpiration, underlyingPrice, 'call')
      : [],
    puts: selectedExpiration && underlyingPrice
      ? buildSyntheticOptionRows(cleanedSymbol, selectedExpiration, underlyingPrice, 'put')
      : [],
    diagnostics: {
      fallback: true,
      reason: 'Yahoo options chain unavailable; generated display-only derived chain from underlying price.',
    },
  };
}

async function fetchYahooChart(symbol, request) {
  const cleanedSymbol = normalizeSymbol(symbol);
  if (!cleanedSymbol) return null;

  const cacheKey = `chart:${JSON.stringify({ symbol: cleanedSymbol, ...request })}`;
  return getOrFetch(cacheKey, CHART_TTL_MS, async () => {
    const encodedSymbol = encodeURIComponent(cleanedSymbol);
    const params = {
      interval: request.interval || '1d',
      includePrePost: 'false',
      events: 'div,splits',
    };

    if (Number.isFinite(request.period1) && Number.isFinite(request.period2)) {
      params.period1 = String(Math.floor(request.period1));
      params.period2 = String(Math.floor(request.period2));
    } else if (request.startDate && request.endDate) {
      const start = toUnixSeconds(request.startDate);
      const end = toUnixSeconds(request.endDate, { endOfDay: true });
      if (start === null || end === null || end <= start) return null;
      params.period1 = String(start);
      params.period2 = String(end);
    } else {
      params.range = request.range || '1mo';
    }

    const data = await fetchJson(yahooUrl(`/v8/finance/chart/${encodedSymbol}`, params));
    return data?.chart?.result?.[0] || null;
  });
}

async function fetchYahooSearch(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) return [];

  const cacheKey = `search:${trimmed.toLowerCase()}`;
  return getOrFetch(cacheKey, QUOTE_TTL_MS, async () => {
    const data = await fetchJson(yahooUrl('/v1/finance/search', {
      q: trimmed,
      quotesCount: '10',
      newsCount: '0',
    }));
    return Array.isArray(data?.quotes) ? data.quotes.filter((quote) => quote?.symbol) : [];
  });
}

async function fetchYahooScreenerQuotes(screenerId) {
  const allQuotes = [];
  let start = 0;
  let total = Infinity;

  while (start < total) {
    const data = await fetchJson(yahooUrl('/v1/finance/screener/predefined/saved', {
      formatted: 'false',
      scrIds: screenerId,
      count: String(SCREENER_BATCH_SIZE),
      start: String(start),
    }));
    const result = data?.finance?.result?.[0] || {};
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

  const deduped = new Map();
  allQuotes.forEach((quote) => {
    const symbol = normalizeSymbol(quote?.symbol);
    if (symbol && !deduped.has(symbol)) deduped.set(symbol, quote);
  });
  return [...deduped.values()];
}

function normalizeOptionContract(contract, fallbackExpiration, currency) {
  const expiration = normalizeExpirationDate(
    contract?.expiration ??
    contract?.expirationDate ??
    fallbackExpiration,
  );

  return {
    contractSymbol: String(contract?.contractSymbol || contract?.symbol || '').trim().toUpperCase(),
    lastTradeDate: normalizeDateTime(contract?.lastTradeDate),
    strike: nullableNumber(contract?.strike),
    lastPrice: nullableNumber(contract?.lastPrice ?? contract?.regularMarketPrice),
    bid: contract?.bid === null || contract?.bid === undefined ? null : nullableNumber(contract.bid),
    ask: contract?.ask === null || contract?.ask === undefined ? null : nullableNumber(contract.ask),
    change: contract?.change === null || contract?.change === undefined
      ? null
      : getNumericValue(contract.change),
    percentChange: contract?.percentChange === null || contract?.percentChange === undefined
      ? null
      : getNumericValue(contract.percentChange),
    volume: contract?.volume === null || contract?.volume === undefined
      ? null
      : nullableNumber(contract.volume),
    openInterest: contract?.openInterest === null || contract?.openInterest === undefined
      ? null
      : nullableNumber(contract.openInterest),
    impliedVolatility: contract?.impliedVolatility === null || contract?.impliedVolatility === undefined
      ? null
      : getNumericValue(contract.impliedVolatility),
    inTheMoney: nullableBoolean(contract?.inTheMoney),
    expiration,
    currency: contract?.currency || currency || null,
  };
}

function normalizeYahooFinanceOptionsChain(data, cleanedSymbol, requestedExpiration) {
  const expirations = Array.isArray(data?.expirationDates)
    ? data.expirationDates.map((expiration) => normalizeExpirationDate(expiration)).filter(Boolean)
    : [];
  const optionSet = Array.isArray(data?.options) ? data.options[0] : null;
  const selectedExpiration = requestedExpiration || expirations[0] || null;
  const quote = data?.quote || {};
  const currency = quote.currency || data?.underlyingCurrency || null;

  return {
    symbol: cleanedSymbol,
    underlyingSymbol: data?.underlyingSymbol || cleanedSymbol,
    underlyingPrice: nullableNumber(
      quote.regularMarketPrice ??
      quote.postMarketPrice ??
      quote.preMarketPrice,
    ),
    expirations,
    expirationDates: expirations,
    selectedExpiration,
    quote,
    calls: Array.isArray(optionSet?.calls)
      ? optionSet.calls.map((contract) => normalizeOptionContract(contract, selectedExpiration, currency))
      : [],
    puts: Array.isArray(optionSet?.puts)
      ? optionSet.puts.map((contract) => normalizeOptionContract(contract, selectedExpiration, currency))
      : [],
    diagnostics: {
      provider: 'yahoo-finance2',
      fallback: false,
    },
  };
}

async function fetchOptionsChain(symbol, requestedDate) {
  const cleanedSymbol = normalizeSymbol(symbol);
  if (!cleanedSymbol) {
    const error = new Error('Missing required query parameter: symbol');
    error.statusCode = 400;
    throw error;
  }

  const requestedExpiration = normalizeExpirationDate(requestedDate);
  const cacheKey = `options:${cleanedSymbol}:${requestedExpiration || 'nearest'}`;

  return getOrFetch(cacheKey, OPTIONS_TTL_MS, async () => {
    try {
      const queryOptions = requestedExpiration ? { date: new Date(`${requestedExpiration}T00:00:00.000Z`) } : undefined;
      const data = await yahooFinance.options(cleanedSymbol, queryOptions);
      return normalizeYahooFinanceOptionsChain(data, cleanedSymbol, requestedExpiration);
    } catch (error) {
      console.warn(`[Options provider] yahoo-finance2 failed for ${cleanedSymbol}: ${error?.message || 'Unknown error'}`);
      console.warn(`[Options provider] using synthetic fallback for ${cleanedSymbol}`);
      return buildSyntheticOptionsChain(cleanedSymbol, requestedExpiration);
    }
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
      const data = await fetchJson(yahooUrl(`/v10/finance/quoteSummary/${encodeURIComponent(cleanedSymbol)}`, { modules }));
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

async function fetchProviderScreener(category, tab) {
  if (category === 'options') {
    const stockScreener = await fetchProviderScreener('stocks', tab);
    const underlyings = stockScreener.items
      .map((item) => ({
        ticker: normalizeSymbol(item?.ticker),
        name: String(item?.name || item?.ticker || 'Unknown'),
      }))
      .filter((item) => item.ticker && isValidOptionsUnderlying(item.ticker))
      .slice(0, OPTIONS_UNDERLYING_LIMIT);

    const chains = await Promise.allSettled(underlyings.map(async (underlying) => ({
      underlying,
      chain: await fetchOptionsChain(underlying.ticker),
    })));

    const rows = chains.flatMap((result) => {
      if (result.status !== 'fulfilled') return [];
      const { underlying, chain } = result.value;
      const expirationDate = Array.isArray(chain?.expirations) && chain.expirations.length > 0
        ? new Date(`${chain.expirations[0]}T00:00:00.000Z`).toISOString()
        : new Date().toISOString();
      const calls = Array.isArray(chain?.calls) ? chain.calls : [];
      const puts = Array.isArray(chain?.puts) ? chain.puts : [];

      return [
        ...calls.map((contract) => mapOptionContractToScreenerRow(contract, underlying.ticker, expirationDate, 'Call')),
        ...puts.map((contract) => mapOptionContractToScreenerRow(contract, underlying.ticker, expirationDate, 'Put')),
      ].filter(Boolean);
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

    return {
      category,
      tab,
      updatedAt: new Date().toISOString(),
      items: sorted.slice(0, OPTIONS_ROW_LIMIT),
    };
  }

  const screenerId = SCREENER_IDS[category]?.[tab];
  if (!screenerId) {
    const error = new Error('Invalid category');
    error.statusCode = 400;
    throw error;
  }

  const quotes = await fetchYahooScreenerQuotes(screenerId);

  return {
    category,
    tab,
    updatedAt: new Date().toISOString(),
    items: quotes.map((quote) => mapYahooQuoteToScreenerRow(quote, category)),
  };
}

async function refreshScreenerCache(category, tab) {
  const cacheKey = `${category}:${tab}`;
  const existing = screenerRefreshInFlight.get(cacheKey);
  if (existing) return existing;

  const request = (async () => {
    try {
      const refreshed = await fetchProviderScreener(category, tab);
      if (!Array.isArray(refreshed.items) || refreshed.items.length === 0) {
        throw new Error(`Provider returned empty screener for ${category}/${tab}`);
      }

      await writeScreenerCache(refreshed);
      setCache(`screener:${category}:${tab}`, refreshed, SCREENER_TTL_MS);
      return refreshed;
    } catch (error) {
      if (dbPool) {
        await dbPool.query(
          `update market_screener_cache
           set refresh_status = $3, last_error = $4
           where category = $1 and tab = $2`,
          [category, tab, 'error', error?.message || 'Unknown refresh error'],
        ).catch(() => {});
      }
      throw error;
    } finally {
      screenerRefreshInFlight.delete(cacheKey);
    }
  })();

  screenerRefreshInFlight.set(cacheKey, request);
  return request;
}

function refreshScreenerCacheInBackground(category, tab) {
  refreshScreenerCache(category, tab).catch((error) => {
    console.error(`[Screener cache] refresh failed for ${category}/${tab}:`, error?.message || error);
  });
}

async function fetchScreener(category, tab) {
  const validTabs = new Set(['most_actives', 'day_gainers']);
  const validCategories = new Set(['stocks', 'etfs', 'crypto', 'options']);
  const normalizedCategory = String(category || '').trim().toLowerCase();
  const normalizedTab = String(tab || '').trim().toLowerCase();

  if (!validTabs.has(normalizedTab)) {
    const error = new Error('Invalid tab');
    error.statusCode = 400;
    throw error;
  }

  if (!validCategories.has(normalizedCategory)) {
    const error = new Error('Invalid category');
    error.statusCode = 400;
    throw error;
  }

  const cacheKey = `screener:${normalizedCategory}:${normalizedTab}`;
  const cachedMemory = getCache(cacheKey);
  if (cachedMemory !== null) return cachedMemory;

  const cachedDb = await readScreenerCache(normalizedCategory, normalizedTab);
  if (cachedDb) {
    const isEmptyOptionsCache =
      normalizedCategory === 'options' &&
      (!Array.isArray(cachedDb.items) || cachedDb.items.length === 0);

    if (!isEmptyOptionsCache) {
      setCache(cacheKey, cachedDb, SCREENER_TTL_MS);
      if (isScreenerStale(cachedDb)) {
        refreshScreenerCacheInBackground(normalizedCategory, normalizedTab);
      }
      return cachedDb;
    }
  }

  try {
    const refreshed = await refreshScreenerCache(normalizedCategory, normalizedTab);
    return refreshed;
  } catch (error) {
    console.error(`[Screener cache] initial refresh failed for ${normalizedCategory}/${normalizedTab}:`, error?.message || error);
    return {
      category: normalizedCategory,
      tab: normalizedTab,
      updatedAt: new Date().toISOString(),
      items: [],
    };
  }
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

    if (url.pathname === '/market/options') {
      const symbol = normalizeSymbol(url.searchParams.get('symbol'));
      const date = String(url.searchParams.get('date') || '').trim();
      if (!symbol) {
        sendJson(res, 400, { error: 'Missing required query parameter: symbol' });
        return;
      }
      sendJson(res, 200, await fetchOptionsChain(symbol, date));
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

function refreshAllScreenersInBackground() {
  if (!dbPool) return;
  SCREENER_DATASETS.forEach(([category, tab]) => {
    refreshScreenerCacheInBackground(category, tab);
  });
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`z-market-api listening on 0.0.0.0:${PORT}`);
  if (dbPool) {
    console.log('z-market-api screener cache persistence enabled');
    refreshAllScreenersInBackground();
    setInterval(refreshAllScreenersInBackground, SCREENER_REFRESH_INTERVAL_MS);
  } else {
    console.warn('z-market-api screener cache persistence disabled: DATABASE_URL or SUPABASE_DB_URL is not set');
  }
});
