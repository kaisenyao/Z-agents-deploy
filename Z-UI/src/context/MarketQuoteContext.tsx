import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { fetchYahooQuotes } from '../lib/api';
import {
  classifyAssetClass,
  getQuoteNumber,
  normalizeAssetSymbol,
  normalizeYahooQuote,
  resolveSessionAwareMarkPrice,
  resolveSessionAwarePreviousClose,
  type AssetClass,
} from '../services/assetPricing';

export interface LatestQuote {
  assetClass?: AssetClass;
  price?: number;
  previousClosePrice?: number;
  dailyChange?: number;
  dailyChangePercent?: number;
  change?: number;
  changePercent?: number;
  dayHigh?: number;
  dayLow?: number;
  volume?: number;
  marketState?: string;
  updatedAt: string;
}

interface MarketQuoteContextType {
  latestQuotes: Record<string, LatestQuote>;
  registerSymbols: (registrationId: string, symbols: string[]) => void;
  publishQuotes: (quotes: Record<string, Omit<LatestQuote, 'updatedAt'> & { updatedAt?: string }>) => void;
  forceRefresh: () => void;
}

const MarketQuoteContext = createContext<MarketQuoteContextType | undefined>(undefined);

function normalizeQuoteSymbol(symbol: string): string {
  return normalizeAssetSymbol(symbol);
}

function toYahooQuoteSymbol(symbol: string): string {
  const normalized = normalizeQuoteSymbol(symbol);
  if (!normalized) return normalized;
  if (classifyAssetClass(normalized) === 'crypto') {
    return `${normalized}-USD`;
  }
  return normalized;
}

export function MarketQuoteProvider({ children }: { children: React.ReactNode }) {
  const [latestQuotes, setLatestQuotes] = useState<Record<string, LatestQuote>>({});
  const registrationsRef = useRef(new Map<string, string[]>());
  const [symbolsVersion, setSymbolsVersion] = useState(0);

  const registerSymbols = useCallback((registrationId: string, symbols: string[]) => {
    const normalized = Array.from(
      new Set(symbols.map((symbol) => normalizeQuoteSymbol(symbol)).filter(Boolean)),
    );
    const current = registrationsRef.current.get(registrationId) || [];
    const currentKey = current.join(',');
    const nextKey = normalized.join(',');
    if (currentKey === nextKey) return;

    if (normalized.length === 0) {
      registrationsRef.current.delete(registrationId);
    } else {
      registrationsRef.current.set(registrationId, normalized);
    }
    setSymbolsVersion((value) => value + 1);
  }, []);

  const publishQuotes = useCallback((quotes: Record<string, Omit<LatestQuote, 'updatedAt'> & { updatedAt?: string }>) => {
    const entries = Object.entries(quotes);
    if (entries.length === 0) return;

    setLatestQuotes((current) => {
      let changed = false;
      const next = { ...current };

      entries.forEach(([symbol, quote]) => {
        const normalizedSymbol = normalizeQuoteSymbol(symbol);
        if (!normalizedSymbol) return;
        const previous = current[normalizedSymbol];
        const assetClass = quote.assetClass || previous?.assetClass || classifyAssetClass(normalizedSymbol);
        const safePrice = resolveSessionAwareMarkPrice(
          assetClass,
          quote.price,
          previous?.price,
          quote.marketState,
        );
        const safePreviousClosePrice = resolveSessionAwarePreviousClose(
          assetClass,
          quote.previousClosePrice,
          previous?.previousClosePrice,
        );
        const safeDailyChange =
          Number.isFinite(safePrice) &&
          Number.isFinite(safePreviousClosePrice)
            ? Number(safePrice) - Number(safePreviousClosePrice)
            : quote.dailyChange;
        const safeDailyChangePercent =
          Number.isFinite(safePrice) &&
          Number.isFinite(safePreviousClosePrice) &&
          Number(safePreviousClosePrice) !== 0
            ? (Number(safeDailyChange) / Number(safePreviousClosePrice)) * 100
            : quote.dailyChangePercent;

        const nextQuote: LatestQuote = {
          assetClass,
          price: safePrice,
          previousClosePrice: safePreviousClosePrice,
          dailyChange: safeDailyChange,
          dailyChangePercent: safeDailyChangePercent,
          change: quote.change ?? safeDailyChange,
          changePercent: quote.changePercent ?? safeDailyChangePercent,
          dayHigh: quote.dayHigh,
          dayLow: quote.dayLow,
          volume: quote.volume,
          marketState: quote.marketState,
          updatedAt: quote.updatedAt || new Date().toISOString(),
        };

        if (
          previous?.price !== nextQuote.price ||
          previous?.previousClosePrice !== nextQuote.previousClosePrice ||
          previous?.dailyChange !== nextQuote.dailyChange ||
          previous?.dailyChangePercent !== nextQuote.dailyChangePercent ||
          previous?.change !== nextQuote.change ||
          previous?.changePercent !== nextQuote.changePercent ||
          previous?.dayHigh !== nextQuote.dayHigh ||
          previous?.dayLow !== nextQuote.dayLow ||
          previous?.volume !== nextQuote.volume ||
          previous?.assetClass !== nextQuote.assetClass ||
          previous?.marketState !== nextQuote.marketState ||
          previous?.updatedAt !== nextQuote.updatedAt
        ) {
          next[normalizedSymbol] = nextQuote;
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, []);

  const trackedSymbols = useMemo(
    () => Array.from(new Set(Array.from(registrationsRef.current.values()).flat())),
    [symbolsVersion],
  );
  const trackedSymbolsKey = trackedSymbols.join(',');
  const trackedSymbolsRef = useRef(trackedSymbols);
  const refreshQuotesFnRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    trackedSymbolsRef.current = trackedSymbols;
  }, [trackedSymbols]);

  const forceRefresh = useCallback(() => {
    refreshQuotesFnRef.current?.();
  }, []);

  useEffect(() => {
    if (!trackedSymbolsKey) return;

    let cancelled = false;

    const refreshQuotes = async () => {
      const activeSymbols = trackedSymbolsRef.current;
      if (!activeSymbols.length) return;

      const yahooSymbols = activeSymbols.map((symbol) => toYahooQuoteSymbol(symbol));
      const quotes = await fetchYahooQuotes(yahooSymbols);
      if (cancelled || !quotes.length) return;

      const updatedAt = new Date().toISOString();
      setLatestQuotes((current) => {
        const next = { ...current };
        quotes.forEach((quote) => {
          const normalizedQuote = normalizeYahooQuote(quote, updatedAt);
          if (!normalizedQuote) return;

          const previousQuote = current[normalizedQuote.symbol];
          const safePrice = resolveSessionAwareMarkPrice(
            normalizedQuote.assetClass,
            normalizedQuote.currentPrice,
            previousQuote?.price,
            normalizedQuote.marketState,
          );
          const safePreviousClosePrice = resolveSessionAwarePreviousClose(
            normalizedQuote.assetClass,
            normalizedQuote.previousClosePrice,
            previousQuote?.previousClosePrice,
          );
          const safeDailyChange =
            Number.isFinite(safePrice) &&
            Number.isFinite(safePreviousClosePrice)
              ? Number(safePrice) - Number(safePreviousClosePrice)
              : previousQuote?.dailyChange;
          const safeDailyChangePercent =
            Number.isFinite(safePrice) &&
            Number.isFinite(safePreviousClosePrice) &&
            Number(safePreviousClosePrice) !== 0
              ? (Number(safeDailyChange) / Number(safePreviousClosePrice)) * 100
              : previousQuote?.dailyChangePercent;

          next[normalizedQuote.symbol] = {
            assetClass: normalizedQuote.assetClass,
            price: safePrice,
            previousClosePrice: safePreviousClosePrice,
            dailyChange: safeDailyChange,
            dailyChangePercent: safeDailyChangePercent,
            change: safeDailyChange,
            changePercent: safeDailyChangePercent,
            dayHigh: getQuoteNumber(quote?.regularMarketDayHigh),
            dayLow: getQuoteNumber(quote?.regularMarketDayLow),
            volume: getQuoteNumber(quote?.regularMarketVolume),
            marketState: normalizedQuote.marketState,
            updatedAt,
          };
        });
        return next;
      });
    };

    refreshQuotesFnRef.current = refreshQuotes;

    void refreshQuotes();
    const intervalId = window.setInterval(refreshQuotes, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshQuotes();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      refreshQuotesFnRef.current = null;
    };
  }, [trackedSymbolsKey]);

  const value = useMemo(
    () => ({
      latestQuotes,
      registerSymbols,
      publishQuotes,
      forceRefresh,
    }),
    [latestQuotes, publishQuotes, registerSymbols, forceRefresh],
  );

  return <MarketQuoteContext.Provider value={value}>{children}</MarketQuoteContext.Provider>;
}

export function useMarketQuoteContext() {
  const context = useContext(MarketQuoteContext);
  if (!context) {
    throw new Error('useMarketQuoteContext must be used within MarketQuoteProvider');
  }
  return context;
}

let registrationCounter = 0;

export function useLatestQuotes(symbols: string[]) {
  const { latestQuotes, registerSymbols } = useMarketQuoteContext();
  const registrationIdRef = useRef<string>('');
  if (!registrationIdRef.current) {
    registrationIdRef.current = `quote-sub-${registrationCounter += 1}`;
  }

  const normalizedSymbols = useMemo(
    () => Array.from(new Set(symbols.map((symbol) => normalizeQuoteSymbol(symbol)).filter(Boolean))),
    [symbols],
  );
  const normalizedKey = normalizedSymbols.join(',');

  useEffect(() => {
    registerSymbols(registrationIdRef.current, normalizedSymbols);
    return () => {
      registerSymbols(registrationIdRef.current, []);
    };
  }, [normalizedKey, normalizedSymbols, registerSymbols]);

  return useMemo(
    () =>
      normalizedSymbols.reduce<Record<string, LatestQuote>>((acc, symbol) => {
        const quote = latestQuotes[symbol];
        if (quote) {
          acc[symbol] = quote;
        }
        return acc;
      }, {}),
    [latestQuotes, normalizedSymbols],
  );
}
