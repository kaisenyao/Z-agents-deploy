import type { OrderRecord, TradingTradeRecord, TradingAccountSnapshot } from '../services/tradingEngine';

const ORDERS_KEY_V1 = 'clearpath_trading_orders_v1';
const TRADES_KEY_V1 = 'clearpath_trading_trades_v1';
const ACCOUNT_KEY_V1 = 'clearpath_trading_account_v1';
const CASH_ACTIVITY_KEY_V1 = 'cashActivityHistory';
const LEGACY_ACCOUNT_KEYS = [
  'holdings',
  'shortPositions',
  'portfolioCash',
  'tradeHistory',
  'shortProceeds',
  'marginHeld',
] as const;
const BLANK_ACCOUNT_MIGRATION_KEY = 'clearpath_trading_blank_account_v1';

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export interface CashActivityRecord {
  id: string;
  timestamp: string;
  type: 'deposit' | 'withdraw' | 'transfer';
  amount: number;
  status: 'completed' | 'pending' | 'failed';
  resultingCash: number;
  note?: string;
}

export function clearTradingAccountStorage(): void {
  if (!canUseStorage()) return;

  [
    ORDERS_KEY_V1,
    TRADES_KEY_V1,
    ACCOUNT_KEY_V1,
    CASH_ACTIVITY_KEY_V1,
    ...LEGACY_ACCOUNT_KEYS,
  ].forEach((key) => localStorage.removeItem(key));
}

export function ensureBlankTradingAccountStorage(): void {
  if (!canUseStorage()) return;
  if (localStorage.getItem(BLANK_ACCOUNT_MIGRATION_KEY) === '1') return;

  clearTradingAccountStorage();
  localStorage.setItem(BLANK_ACCOUNT_MIGRATION_KEY, '1');
}

export function loadTradingOrders(): OrderRecord[] {
  if (!canUseStorage()) return [];
  const parsed = safeParse<OrderRecord[]>(localStorage.getItem(ORDERS_KEY_V1), []);
  return Array.isArray(parsed) ? parsed : [];
}

export function getOrders(): OrderRecord[] {
  return loadTradingOrders();
}

export function saveTradingOrders(orders: OrderRecord[]): void {
  if (!canUseStorage()) return;
  localStorage.setItem(ORDERS_KEY_V1, JSON.stringify(orders));
}

export function upsertTradingOrder(order: OrderRecord): OrderRecord[] {
  const existing = loadTradingOrders();
  const index = existing.findIndex((item) => item.id === order.id);
  const next = [...existing];
  if (index >= 0) {
    next[index] = order;
  } else {
    next.unshift(order);
  }
  saveTradingOrders(next);
  return next;
}

export function cancelTradingOrder(orderId: string): OrderRecord[] {
  return cancelOrder(orderId);
}

function cancelOrderInCollection(orders: OrderRecord[], orderId: string): OrderRecord[] {
  const cancelledAt = new Date().toISOString();
  return orders.map((order) => (
    order.id === orderId && order.status === 'PENDING'
      ? {
          ...order,
          status: 'CANCELLED',
          notes: order.notes
            ? `${order.notes} | Cancelled by user at ${cancelledAt}.`
            : `Cancelled by user at ${cancelledAt}.`,
        }
      : order
  ));
}

export function cancelOrder(orderId: string): OrderRecord[] {
  const existing = loadTradingOrders();
  const next = cancelOrderInCollection(existing, orderId);
  saveTradingOrders(next);
  return next;
}

export function loadTradingTrades(): TradingTradeRecord[] {
  if (!canUseStorage()) return [];
  const parsed = safeParse<TradingTradeRecord[]>(localStorage.getItem(TRADES_KEY_V1), []);
  return Array.isArray(parsed) ? parsed : [];
}

export function getTradesByOrderId(orderId: string): TradingTradeRecord[] {
  return loadTradingTrades().filter((trade) => trade.orderId === orderId);
}

export function saveTradingTrades(trades: TradingTradeRecord[]): void {
  if (!canUseStorage()) return;
  localStorage.setItem(TRADES_KEY_V1, JSON.stringify(trades));
}

export function appendTradingTrade(trade: TradingTradeRecord): TradingTradeRecord[] {
  const existing = loadTradingTrades();
  const next = [trade, ...existing];
  saveTradingTrades(next);
  return next;
}

export function loadTradingAccountSnapshot(): TradingAccountSnapshot | null {
  if (!canUseStorage()) return null;
  const parsed = safeParse<TradingAccountSnapshot | null>(localStorage.getItem(ACCOUNT_KEY_V1), null);
  if (!parsed || typeof parsed !== 'object') return null;
  const holdings = Array.isArray(parsed.holdings) ? parsed.holdings : [];
  const positions = Array.isArray(parsed.positions)
    ? parsed.positions
    : holdings.map((holding) => ({
        symbol: holding.symbol,
        longQty: Number(holding.quantity) || 0,
        longAvgCost: Number(holding.avgCost) || 0,
        shortQty: 0,
        shortAvgPrice: 0,
      }));

  return {
    ...parsed,
    holdings,
    positions,
    shortProceeds: Number.isFinite(parsed.shortProceeds) ? parsed.shortProceeds : 0,
    marginHeld: Number.isFinite(parsed.marginHeld) ? parsed.marginHeld : 0,
    marginCall: Boolean(parsed.marginCall),
  };
}

export function saveTradingAccountSnapshot(snapshot: TradingAccountSnapshot): void {
  if (!canUseStorage()) return;
  localStorage.setItem(ACCOUNT_KEY_V1, JSON.stringify(snapshot));
}

export function loadCashActivityHistory(): CashActivityRecord[] {
  if (!canUseStorage()) return [];
  const parsed = safeParse<CashActivityRecord[]>(localStorage.getItem(CASH_ACTIVITY_KEY_V1), []);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((record) => (
      record &&
      typeof record === 'object' &&
      typeof record.id === 'string' &&
      typeof record.timestamp === 'string' &&
      (record.type === 'deposit' || record.type === 'withdraw' || record.type === 'transfer') &&
      (record.status === 'completed' || record.status === 'pending' || record.status === 'failed') &&
      Number.isFinite(record.amount) &&
      Number.isFinite(record.resultingCash)
    ))
    .map((record) => ({
      id: record.id,
      timestamp: record.timestamp,
      type: record.type,
      status: record.status,
      amount: Number(record.amount),
      resultingCash: Number(record.resultingCash),
      note: typeof record.note === 'string' ? record.note : undefined,
    }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

export function saveCashActivityHistory(records: CashActivityRecord[]): void {
  if (!canUseStorage()) return;
  localStorage.setItem(CASH_ACTIVITY_KEY_V1, JSON.stringify(records));
}

export function appendCashActivityRecord(record: CashActivityRecord): CashActivityRecord[] {
  const current = loadCashActivityHistory();
  const next = [record, ...current];
  saveCashActivityHistory(next);
  return next;
}
