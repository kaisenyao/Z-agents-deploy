import { StockDetail } from './StockDetail';

export function CryptoDetail() {
  return <StockDetail routeKind="crypto" enableCompatibilityRedirect={true} />;
}
