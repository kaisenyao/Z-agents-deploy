import { classifyAssetClass, normalizeAssetSymbol } from './assetPricing';

export type DetailRouteKind = 'stock' | 'crypto';
export type DetailRouteContext = 'research' | 'direct';

export function normalizeRouteTicker(ticker: string | undefined | null): string {
  return normalizeAssetSymbol(String(ticker || ''));
}

export function isCryptoRouteTicker(ticker: string | undefined | null): boolean {
  const normalized = normalizeRouteTicker(ticker);
  if (!normalized) return false;
  return classifyAssetClass(normalized) === 'crypto';
}

export function toYahooDetailTicker(ticker: string | undefined | null): string {
  const normalized = normalizeRouteTicker(ticker);
  if (!normalized) return normalized;
  return isCryptoRouteTicker(normalized) ? `${normalized}-USD` : normalized;
}

export function getAssetDetailRouteKind(
  ticker: string | undefined | null,
  preferredKind?: DetailRouteKind | null,
): DetailRouteKind {
  if (preferredKind === 'crypto') return 'crypto';
  if (preferredKind === 'stock') return 'stock';
  return isCryptoRouteTicker(ticker) ? 'crypto' : 'stock';
}

export function getAssetDetailPath(
  ticker: string | undefined | null,
  options?: {
    context?: DetailRouteContext;
    preferredKind?: DetailRouteKind | null;
  },
): string {
  const normalized = normalizeRouteTicker(ticker);
  const context = options?.context || 'research';
  const routeKind = getAssetDetailRouteKind(normalized, options?.preferredKind);

  if (routeKind === 'crypto') {
    return context === 'direct'
      ? `/crypto/${encodeURIComponent(normalized)}`
      : `/research/crypto/${encodeURIComponent(normalized)}`;
  }

  return context === 'direct'
    ? `/stock/${encodeURIComponent(normalized)}`
    : `/research/stock/${encodeURIComponent(normalized)}`;
}

export function getResearchAssetDetailPath(
  ticker: string | undefined | null,
  preferredKind?: DetailRouteKind | null,
): string {
  return getAssetDetailPath(ticker, {
    context: 'research',
    preferredKind,
  });
}

export function getDirectAssetDetailPath(
  ticker: string | undefined | null,
  preferredKind?: DetailRouteKind | null,
): string {
  return getAssetDetailPath(ticker, {
    context: 'direct',
    preferredKind,
  });
}
