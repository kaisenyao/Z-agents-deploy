import { StockHolding, OptionHolding, CryptoHolding, ShortHolding } from '../hooks/useAccountMetrics';

export interface SeedTradeHistoryItem {
  id: string;
  date: string;
  symbol: string;
  assetType: 'Stock' | 'ETF' | 'Crypto' | 'Option';
  side: 'Buy' | 'Sell' | 'Short' | 'Cover';
  quantity: number;
  price: number;
  total: number;
}

export const STOCK_HOLDINGS: StockHolding[] = [];
export const OPTIONS_HOLDINGS: OptionHolding[] = [];
export const CRYPTO_HOLDINGS: CryptoHolding[] = [];
export const SHORTS_HOLDINGS: ShortHolding[] = [];
export const CASH_VALUE = 0;
export const INITIAL_TRADE_HISTORY: SeedTradeHistoryItem[] = [];
