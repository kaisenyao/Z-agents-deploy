export type AssetClass = 'stock' | 'etf' | 'option' | 'crypto' | 'cash' | 'unknown';

export interface PricingTradeRecord {
  symbol: string;
  assetType: 'Stock' | 'ETF' | 'Crypto' | 'Option';
  side: 'Buy' | 'Sell' | 'Short' | 'Cover';
  quantity: number;
  status?: 'FILLED' | 'REJECTED' | 'PENDING' | 'CANCELLED';
  date: string;
}

export interface PricedPositionInput {
  symbol: string;
  description?: string;
  quantity: number;
  currentPrice: number;
  previousClosePrice?: number;
  todayChangePercent?: number;
  explicitAssetType?: string;
}

export interface PositionDailyMetrics {
  eligibleQuantity: number;
  previousClosePrice: number;
  dailyChangeAmount: number;
  dailyChangePercent: number;
}

const ETF_SYMBOLS = new Set(['SPY', 'QQQ', 'DIA', 'IWM', 'VTI', 'GLD', 'SLV', 'EEM']);
const KNOWN_CRYPTO_SYMBOLS = new Set([
  'BTC', 'ETH', 'DOGE', 'ADA', 'SOL', 'XRP', 'DOT', 'AVAX', 'BNB', 'LINK', 'MATIC',
]);
const ETF_DESCRIPTION_PATTERN = /\bETF\b|Trust|Fund|Index/i;
const CRYPTO_DESCRIPTION_PATTERN = /Bitcoin|Ethereum|Solana|Crypto/i;

export function normalizeAssetSymbol(symbol: string): string {
  return String(symbol || '').trim().toUpperCase().replace(/-USD$/i, '');
}

export function getQuoteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (
    value &&
    typeof value === 'object' &&
    'raw' in value &&
    typeof (value as { raw?: unknown }).raw === 'number' &&
    Number.isFinite((value as { raw: number }).raw)
  ) {
    return (value as { raw: number }).raw;
  }

  return undefined;
}

export function isUsablePrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function classifyAssetClass(
  symbol: string,
  description: string = '',
  explicitAssetType?: string,
): AssetClass {
  const normalizedSymbol = normalizeAssetSymbol(symbol);
  const normalizedExplicitType = String(explicitAssetType || '').trim().toLowerCase();

  if (normalizedExplicitType === 'crypto') return 'crypto';
  if (normalizedExplicitType === 'etf') return 'etf';
  if (normalizedExplicitType === 'stock') return 'stock';
  if (normalizedExplicitType === 'option') return 'option';
  if (normalizedExplicitType === 'cash') return 'cash';

  if (
    KNOWN_CRYPTO_SYMBOLS.has(normalizedSymbol) ||
    CRYPTO_DESCRIPTION_PATTERN.test(description) ||
    normalizedSymbol.endsWith('USD')
  ) {
    return 'crypto';
  }

  if (ETF_SYMBOLS.has(normalizedSymbol) || ETF_DESCRIPTION_PATTERN.test(description)) {
    return 'etf';
  }

  return 'stock';
}

export interface NormalizedAssetQuote {
  symbol: string;
  assetClass: AssetClass;
  currentPrice?: number;
  previousClosePrice?: number;
  dailyChange?: number;
  dailyChangePercent?: number;
  marketState?: string;
  quoteType?: string;
  updatedAt: string;
}

export interface AssetValuationPolicy {
  allowOffSessionMarkUpdate: boolean;
  allowOffSessionPreviousCloseUpdate: boolean;
  allowOffSessionDailyMove: boolean;
}

export interface CanonicalPositionMetrics {
  markPrice: number;
  previousClosePrice: number;
  avgCost: number;
  unrealizedPnL: number;
  unrealizedReturnPct: number;
  dailyPnL: number;
  dailyReturnPct: number;
  rangeReturnPct: number;
}

function derivePreviousCloseFromChange(
  currentPrice?: number,
  dailyChange?: number,
  dailyChangePercent?: number,
): number | undefined {
  if (Number.isFinite(currentPrice) && Number.isFinite(dailyChange)) {
    return Number(currentPrice) - Number(dailyChange);
  }

  if (!Number.isFinite(currentPrice) || !Number.isFinite(dailyChangePercent)) {
    return undefined;
  }

  const ratio = 1 + (Number(dailyChangePercent) / 100);
  if (ratio <= 0) return undefined;

  return Number(currentPrice) / ratio;
}

export function normalizeYahooQuote(rawQuote: any, updatedAt: string): NormalizedAssetQuote | null {
  const symbol = normalizeAssetSymbol(String(rawQuote?.symbol || ''));
  if (!symbol) return null;

  const quoteType = String(rawQuote?.quoteType || '').toUpperCase();
  const quoteAssetClass =
    quoteType === 'CRYPTOCURRENCY' || quoteType === 'CURRENCY'
      ? 'crypto'
      : quoteType === 'ETF'
        ? 'etf'
        : quoteType === 'OPTION'
          ? 'option'
          : quoteType === 'EQUITY'
            ? 'stock'
            : classifyAssetClass(symbol, String(rawQuote?.shortName || rawQuote?.longName || ''));

  const currentPrice = getQuoteNumber(rawQuote?.regularMarketPrice);
  const rawDailyChange = getQuoteNumber(rawQuote?.regularMarketChange);
  const rawDailyChangePercent = getQuoteNumber(rawQuote?.regularMarketChangePercent);
  const previousClosePrice =
    getQuoteNumber(rawQuote?.regularMarketPreviousClose) ??
    getQuoteNumber(rawQuote?.previousClose) ??
    derivePreviousCloseFromChange(currentPrice, rawDailyChange, rawDailyChangePercent);
  const dailyChange =
    Number.isFinite(currentPrice) && Number.isFinite(previousClosePrice)
      ? Number(currentPrice) - Number(previousClosePrice)
      : rawDailyChange;
  const dailyChangePercent =
    Number.isFinite(currentPrice) && Number.isFinite(previousClosePrice) && Number(previousClosePrice) !== 0
      ? (Number(dailyChange) / Number(previousClosePrice)) * 100
      : rawDailyChangePercent;

  return {
    symbol,
    assetClass: quoteAssetClass,
    currentPrice,
    previousClosePrice,
    dailyChange,
    dailyChangePercent,
    marketState: String(rawQuote?.marketState || ''),
    quoteType,
    updatedAt,
  };
}

export function getAssetValuationPolicy(assetClass: AssetClass): AssetValuationPolicy {
  switch (assetClass) {
    case 'stock':
    case 'etf':
      return {
        allowOffSessionMarkUpdate: false,
        allowOffSessionPreviousCloseUpdate: true,
        allowOffSessionDailyMove: false,
      };
    case 'crypto':
      return {
        allowOffSessionMarkUpdate: true,
        allowOffSessionPreviousCloseUpdate: true,
        allowOffSessionDailyMove: true,
      };
    case 'cash':
      return {
        allowOffSessionMarkUpdate: false,
        allowOffSessionPreviousCloseUpdate: false,
        allowOffSessionDailyMove: false,
      };
    case 'option':
    case 'unknown':
    default:
      return {
        allowOffSessionMarkUpdate: false,
        allowOffSessionPreviousCloseUpdate: false,
        allowOffSessionDailyMove: false,
      };
  }
}

export function isRegularEquityMarketState(marketState?: string): boolean {
  return String(marketState || '').trim().toUpperCase() === 'REGULAR';
}

export function resolveSessionAwareMarkPrice(
  assetClass: AssetClass,
  nextMarkPrice: number | undefined,
  previousMarkPrice: number | undefined,
  _marketState?: string,
): number | undefined {
  if (!isUsablePrice(nextMarkPrice)) {
    return previousMarkPrice;
  }

  const policy = getAssetValuationPolicy(assetClass);
  if (policy.allowOffSessionMarkUpdate) {
    return Number(nextMarkPrice);
  }

  if (assetClass === 'stock' || assetClass === 'etf') {
    // Yahoo regularMarketPrice remains the most reliable last trade outside
    // regular hours, so keep dashboard marks aligned with the detail pages.
    return Number(nextMarkPrice);
  }

  return previousMarkPrice;
}

export function resolveSessionAwarePreviousClose(
  assetClass: AssetClass,
  nextPreviousClosePrice: number | undefined,
  previousPreviousClosePrice: number | undefined,
): number | undefined {
  if (!isUsablePrice(nextPreviousClosePrice)) {
    return previousPreviousClosePrice;
  }

  const policy = getAssetValuationPolicy(assetClass);
  return policy.allowOffSessionPreviousCloseUpdate
    ? Number(nextPreviousClosePrice)
    : previousPreviousClosePrice;
}

function derivePositionPreviousClosePrice(position: PricedPositionInput): number {
  if (Number.isFinite(position.previousClosePrice) && Number(position.previousClosePrice) > 0) {
    return Number(position.previousClosePrice);
  }

  const derived = derivePreviousCloseFromChange(
    position.currentPrice,
    undefined,
    position.todayChangePercent,
  );

  if (Number.isFinite(derived) && Number(derived) > 0) {
    return Number(derived);
  }

  return Number(position.currentPrice) || 0;
}

function getMostRecentEquitySessionClose(asOf: Date = new Date()): number {
  const nyDate = new Date(asOf.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const currentDay = nyDate.getDay();
  const close = new Date(nyDate);
  close.setHours(16, 0, 0, 0);

  if (currentDay === 0) {
    close.setDate(close.getDate() - 2);
    return close.getTime();
  }

  if (currentDay === 6) {
    close.setDate(close.getDate() - 1);
    return close.getTime();
  }

  close.setDate(close.getDate() - 1);
  while (close.getDay() === 0 || close.getDay() === 6) {
    close.setDate(close.getDate() - 1);
  }
  close.setHours(16, 0, 0, 0);
  return close.getTime();
}

function isTradeRelevantForPosition(assetClass: AssetClass, trade: PricingTradeRecord, symbol: string): boolean {
  const tradeSymbol = normalizeAssetSymbol(trade.symbol);
  if (tradeSymbol !== normalizeAssetSymbol(symbol)) return false;
  if (trade.status && trade.status !== 'FILLED') return false;

  if (assetClass === 'crypto') return trade.assetType === 'Crypto';
  if (assetClass === 'option') return trade.assetType === 'Option';
  if (assetClass === 'etf') return trade.assetType === 'ETF';
  if (assetClass === 'stock') return trade.assetType === 'Stock' || trade.assetType === 'ETF';

  return false;
}

function getQuantityHeldAtCutoff(
  position: PricedPositionInput,
  assetClass: AssetClass,
  tradeHistory: PricingTradeRecord[] = [],
  cutoffTimestamp: number,
): number {
  const relevantTrades = tradeHistory
    .filter((trade) => isTradeRelevantForPosition(assetClass, trade, position.symbol))
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());

  if (relevantTrades.length === 0) {
    return Math.max(0, Number(position.quantity) || 0);
  }

  let quantity = 0;
  for (const trade of relevantTrades) {
    const timestamp = new Date(trade.date).getTime();
    if (!Number.isFinite(timestamp) || timestamp > cutoffTimestamp) {
      break;
    }

    const tradeQuantity = Number(trade.quantity) || 0;
    if (trade.side === 'Buy') {
      quantity += tradeQuantity;
    } else if (trade.side === 'Sell') {
      quantity = Math.max(0, quantity - tradeQuantity);
    }
  }

  return Math.min(quantity, Math.max(0, Number(position.quantity) || 0));
}

export function calculatePositionDailyMetrics(
  position: PricedPositionInput,
  tradeHistory: PricingTradeRecord[] = [],
  asOf: Date = new Date(),
): PositionDailyMetrics {
  const assetClass = classifyAssetClass(position.symbol, position.description, position.explicitAssetType);
  const currentPrice = Number(position.currentPrice) || 0;
  const previousClosePrice = derivePositionPreviousClosePrice(position);

  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(previousClosePrice) || previousClosePrice <= 0) {
    return {
      eligibleQuantity: 0,
      previousClosePrice: 0,
      dailyChangeAmount: 0,
      dailyChangePercent: 0,
    };
  }

  if (assetClass === 'cash' || assetClass === 'unknown' || assetClass === 'option') {
    return {
      eligibleQuantity: 0,
      previousClosePrice,
      dailyChangeAmount: 0,
      dailyChangePercent: 0,
    };
  }

  const eligibleQuantity = assetClass === 'crypto'
    ? Math.max(0, Number(position.quantity) || 0)
    : getQuantityHeldAtCutoff(position, assetClass, tradeHistory, getMostRecentEquitySessionClose(asOf));

  const dailyChangeAmount = eligibleQuantity > 0
    ? eligibleQuantity * (currentPrice - previousClosePrice)
    : 0;
  const dailyChangePercent = previousClosePrice > 0
    ? ((currentPrice - previousClosePrice) / previousClosePrice) * 100
    : 0;

  return {
    eligibleQuantity,
    previousClosePrice,
    dailyChangeAmount,
    dailyChangePercent,
  };
}

export function calculateCanonicalPositionMetrics({
  quantity,
  markPrice,
  previousClosePrice,
  avgCost,
  eligibleQuantity,
  rangeBaselinePrice,
}: {
  quantity: number;
  markPrice: number;
  previousClosePrice: number;
  avgCost: number;
  eligibleQuantity: number;
  rangeBaselinePrice?: number;
}): CanonicalPositionMetrics {
  const safeQuantity = Math.max(0, Number(quantity) || 0);
  const safeEligibleQuantity = Math.max(0, Number(eligibleQuantity) || 0);
  const safeMarkPrice = Number(markPrice) || 0;
  const safePreviousClosePrice = Number(previousClosePrice) || 0;
  const safeAvgCost = Number(avgCost) || 0;
  const safeRangeBaseline = Number(rangeBaselinePrice);

  const unrealizedPnL = safeQuantity * (safeMarkPrice - safeAvgCost);
  const unrealizedReturnPct = safeAvgCost > 0
    ? ((safeMarkPrice - safeAvgCost) / safeAvgCost) * 100
    : 0;
  const dailyPnL = safeEligibleQuantity * (safeMarkPrice - safePreviousClosePrice);
  const dailyReturnPct = safeEligibleQuantity > 0 && safePreviousClosePrice > 0
    ? ((safeMarkPrice - safePreviousClosePrice) / safePreviousClosePrice) * 100
    : 0;
  const rangeReturnPct = Number.isFinite(safeRangeBaseline) && safeRangeBaseline > 0
    ? ((safeMarkPrice - safeRangeBaseline) / safeRangeBaseline) * 100
    : 0;

  return {
    markPrice: safeMarkPrice,
    previousClosePrice: safePreviousClosePrice,
    avgCost: safeAvgCost,
    unrealizedPnL,
    unrealizedReturnPct,
    dailyPnL,
    dailyReturnPct,
    rangeReturnPct,
  };
}
