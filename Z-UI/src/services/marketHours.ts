export type TradeAssetType = 'stock' | 'etf' | 'option' | 'crypto' | 'cash' | 'unknown';
export type MarketStatusTone = 'open' | 'extended' | 'closed' | 'neutral';
export type TradeTabKey = 'stocks' | 'options' | 'crypto' | 'orders';

export interface MarketStatusResult {
  assetType: TradeAssetType;
  state: string;
  label: string;
  detail: string;
  isTradable: boolean;
  tone: MarketStatusTone;
}

const EASTERN_TIME_ZONE = 'America/New_York';
const EQUITY_REGULAR_START_MINUTES = (9 * 60) + 30;
const EQUITY_REGULAR_END_MINUTES = 16 * 60;

function getEasternDateParts(date: Date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);
  const weekday = parts.find((part) => part.type === 'weekday')?.value || 'Sun';

  return {
    weekday,
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
    hour: getPart('hour'),
    minute: getPart('minute'),
    second: getPart('second'),
  };
}

function getMinutesSinceMidnight(parts: ReturnType<typeof getEasternDateParts>): number {
  return (parts.hour * 60) + parts.minute;
}

function isEasternWeekday(parts: ReturnType<typeof getEasternDateParts>): boolean {
  return parts.weekday !== 'Sat' && parts.weekday !== 'Sun';
}

export function getNowInEasternTime(date: Date = new Date()) {
  return getEasternDateParts(date);
}

export function formatEasternTimeLabel(date: Date = new Date()): string {
  const now = getEasternDateParts(date);
  const hour = now.hour % 12 === 0 ? 12 : now.hour % 12;
  const suffix = now.hour >= 12 ? 'PM' : 'AM';
  const minutes = String(now.minute).padStart(2, '0');
  return `${hour}:${minutes} ${suffix} ET`;
}

function buildUSEquityMarketStatus(
  assetType: Extract<TradeAssetType, 'stock' | 'etf' | 'option'>,
  date: Date = new Date(),
): MarketStatusResult {
  const parts = getEasternDateParts(date);
  const minutes = getMinutesSinceMidnight(parts);
  const isOpen = isEasternWeekday(parts) && minutes >= EQUITY_REGULAR_START_MINUTES && minutes < EQUITY_REGULAR_END_MINUTES;

  return {
    assetType,
    state: isOpen ? 'open' : 'closed',
    label: isOpen ? 'Market Open' : 'Market Closed',
    detail: isOpen ? 'Regular session 9:30 AM - 4:00 PM ET' : 'Outside regular trading hours',
    isTradable: isOpen,
    tone: isOpen ? 'open' : 'closed',
  };
}

export function getUSEquityMarketStatus(date: Date = new Date()): MarketStatusResult {
  return buildUSEquityMarketStatus('stock', date);
}

export function getUSOptionsMarketStatus(date: Date = new Date()): MarketStatusResult {
  return buildUSEquityMarketStatus('option', date);
}

export function getCryptoMarketStatus(): MarketStatusResult {
  return {
    assetType: 'crypto',
    state: 'open',
    label: 'Market Open',
    detail: '24/7 market',
    isTradable: true,
    tone: 'open',
  };
}

export function isAssetTradable(assetType: TradeAssetType, date: Date = new Date()): boolean {
  if (assetType === 'crypto') {
    return true;
  }

  if (assetType === 'option') {
    return buildUSEquityMarketStatus('option', date).isTradable;
  }

  if (assetType === 'stock' || assetType === 'etf') {
    return buildUSEquityMarketStatus(assetType, date).isTradable;
  }

  return false;
}

export function getAssetMarketStatus(assetType: TradeAssetType, date: Date = new Date()): MarketStatusResult {
  if (assetType === 'crypto') return getCryptoMarketStatus();
  if (assetType === 'option') return getUSOptionsMarketStatus(date);
  if (assetType === 'stock' || assetType === 'etf') return buildUSEquityMarketStatus(assetType, date);

  return {
    assetType,
    state: 'neutral',
    label: 'Market status unavailable',
    detail: 'Select a tradable asset',
    isTradable: false,
    tone: 'neutral',
  };
}

export function getTradeTabMarketStatus({
  activeTab,
  selectedAssetType,
  date = new Date(),
}: {
  activeTab: TradeTabKey;
  selectedAssetType?: TradeAssetType | null;
  date?: Date;
}): MarketStatusResult {
  if (activeTab === 'orders') {
    return {
      assetType: 'unknown',
      state: 'neutral',
      label: 'Order History',
      detail: 'No live trading status on this tab',
      isTradable: false,
      tone: 'neutral',
    };
  }

  if (activeTab === 'options') {
    return buildUSEquityMarketStatus('option', date);
  }

  if (activeTab === 'crypto') {
    return getAssetMarketStatus('crypto', date);
  }

  return buildUSEquityMarketStatus(selectedAssetType === 'etf' ? 'etf' : 'stock', date);
}
