import { ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useState, useEffect, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useLatestQuotes, useMarketQuoteContext } from '../context/MarketQuoteContext';
import { fetchStockData, fetchStockDataByWindow, fetchYahooQuotePageMetrics, fetchYahooQuotes } from '../lib/api';
import { getDirectAssetDetailPath, getResearchAssetDetailPath, normalizeRouteTicker, toYahooDetailTicker, type DetailRouteKind } from '../services/assetRouting';
import { formatEasternTimeLabel, getAssetMarketStatus } from '../services/marketHours';

interface StockData {
  ticker: string;
  name: string;
  exchange?: string;
  price: number;
  change: number;
  changePercent: number;
  volume?: string;
  marketCap?: string;
  dayHigh?: number;
  dayLow?: number;
  week52High?: number;
  week52Low?: number;
  peRatio?: string;
}

interface ChartPoint {
  date: string;
  price: number;
  fullDate?: string;
}

interface InitialAssetState {
  ticker: string;
  name?: string;
  price?: number;
  change?: number;
  changePercent?: number;
  volume?: string;
  marketCap?: string;
}

interface DetailNavigationState {
  initialAsset?: InitialAssetState;
  source?: 'investment-report';
  selectedReportId?: string;
}

function formatVolume(volume: number | null | undefined): string {
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume <= 0) {
    return '-';
  }
  if (volume >= 1_000_000_000_000) return `${(volume / 1_000_000_000_000).toFixed(2)}T`;
  if (volume >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(2)}B`;
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(2)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(2)}K`;
  return Math.round(volume).toString();
}

function formatCompactNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value) || value <= 0) return '-';
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function getChartExtremes(chartData: any): { high?: number; low?: number } {
  const quote = chartData?.indicators?.quote?.[0];
  if (!quote) return {};

  const highs = Array.isArray(quote.high) ? quote.high.filter((value: any) => value !== null && Number.isFinite(value)) : [];
  const lows = Array.isArray(quote.low) ? quote.low.filter((value: any) => value !== null && Number.isFinite(value)) : [];
  const closes = Array.isArray(quote.close) ? quote.close.filter((value: any) => value !== null && Number.isFinite(value)) : [];

  const highSource = highs.length > 0 ? highs : closes;
  const lowSource = lows.length > 0 ? lows : closes;

  return {
    high: highSource.length > 0 ? Math.max(...highSource) : undefined,
    low: lowSource.length > 0 ? Math.min(...lowSource) : undefined,
  };
}

function getLatestVolumeFromChart(chartData: any): number | undefined {
  const quote = chartData?.indicators?.quote?.[0];
  if (!quote || !Array.isArray(quote.volume)) return undefined;

  const volumes = quote.volume.filter((value: any) => value !== null && Number.isFinite(value));
  if (volumes.length === 0) return undefined;

  return volumes[volumes.length - 1];
}

function getQuoteNumber(value: any): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value?.raw === 'number' && Number.isFinite(value.raw)) {
    return value.raw;
  }

  return undefined;
}

function formatMoney(value: number | undefined | null, fractionDigits: number = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatDetailMetricMoney(value: number | undefined | null, fractionDigits: number = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `$${formatMoney(value, fractionDigits)}`;
}

function formatXAxisTimestamp(timestamp: number, timeRange: string): string {
  const date = new Date(timestamp * 1000);
  if (timeRange === '1D') {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (timeRange === 'ALL') {
    return date.toLocaleDateString('en-US', { year: 'numeric' });
  }
  if (timeRange === 'YTD' || timeRange === '1Y') {
    return date.toLocaleDateString('en-US', { month: 'short' });
  }
  return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
}

function formatTooltipTimestamp(timestamp: number, timeRange: string): string {
  const date = new Date(timestamp * 1000);
  if (timeRange === '1D') {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getChartMinTickGap(timeRange: string): number {
  if (timeRange === '1D') return 28;
  if (timeRange === '1W') return 36;
  if (timeRange === '1M' || timeRange === '3M') return 40;
  if (timeRange === 'YTD' || timeRange === '1Y') return 48;
  return 52;
}

interface StockDetailProps {
  routeKind?: DetailRouteKind;
  enableCompatibilityRedirect?: boolean;
}

export function StockDetail({
  routeKind = 'stock',
  enableCompatibilityRedirect = true,
}: StockDetailProps = {}) {
  const { ticker } = useParams<{ ticker: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { publishQuotes } = useMarketQuoteContext();
  const normalizedTicker = normalizeRouteTicker(ticker);
  const [timeRange, setTimeRange] = useState('1D');
  const [stockData, setStockData] = useState<StockData | null>(null);
  const [chartData, setChartData] = useState<ChartPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [marketClock, setMarketClock] = useState(() => new Date());
  const latestQuotes = useLatestQuotes(normalizedTicker ? [normalizedTicker] : []);
  const navigationState = location.state && typeof location.state === 'object'
    ? (location.state as DetailNavigationState)
    : undefined;
  const initialAsset = navigationState?.initialAsset;

  useEffect(() => {
    if (!enableCompatibilityRedirect || !normalizedTicker) return;

    const isResearchRoute = location.pathname.startsWith('/research/');
    const expectedPath = isResearchRoute
      ? getResearchAssetDetailPath(normalizedTicker, routeKind)
      : getDirectAssetDetailPath(normalizedTicker, routeKind);
    const compatibilityPath = isResearchRoute
      ? getResearchAssetDetailPath(normalizedTicker)
      : getDirectAssetDetailPath(normalizedTicker);
    const currentPath = location.pathname;

    if (routeKind === 'stock' && compatibilityPath !== expectedPath) {
      navigate(compatibilityPath, { replace: true, state: location.state });
      return;
    }

    if (routeKind === 'crypto' && compatibilityPath !== expectedPath) {
      navigate(compatibilityPath, { replace: true, state: location.state });
      return;
    }

    if (currentPath !== expectedPath) {
      navigate(expectedPath, { replace: true, state: location.state });
    }
  }, [enableCompatibilityRedirect, location.pathname, location.state, navigate, normalizedTicker, routeKind]);

  const handleBack = () => {
    if (navigationState?.source === 'investment-report' && navigationState.selectedReportId) {
      navigate('/research/report', {
        state: {
          selectedReportId: navigationState.selectedReportId,
          openMode: 'detail',
        },
      });
      return;
    }

    navigate(-1);
  };

  const timeRanges = ['1D', '1W', '1M', '3M', 'YTD', '1Y', 'ALL'];
  const changeLabel = 'Today';
  const marketStatus = useMemo(
    () => getAssetMarketStatus(routeKind === 'crypto' ? 'crypto' : 'stock', marketClock),
    [marketClock, routeKind],
  );
  const marketTimeLabel = useMemo(() => formatEasternTimeLabel(marketClock), [marketClock]);
  const marketIndicatorColor = marketStatus.tone === 'open' ? '#10b981' : '#f43f5e';
  const displayedStockData = useMemo(() => {
    const hasMatchingInitialAsset = Boolean(
      normalizedTicker &&
      initialAsset?.ticker &&
      normalizeRouteTicker(initialAsset.ticker) === normalizedTicker,
    );
    const baseStockData = stockData || (
      hasMatchingInitialAsset
        ? {
            ticker: normalizedTicker as string,
            name: initialAsset?.name || normalizedTicker || '',
            exchange: 'Market',
            price: Number.isFinite(initialAsset?.price) ? Number(initialAsset?.price) : 0,
            change: Number.isFinite(initialAsset?.change) ? Number(initialAsset?.change) : 0,
            changePercent: Number.isFinite(initialAsset?.changePercent) ? Number(initialAsset?.changePercent) : 0,
            volume: initialAsset?.volume,
            marketCap: initialAsset?.marketCap || '-',
            dayHigh: undefined,
            dayLow: undefined,
            week52High: undefined,
            week52Low: undefined,
            peRatio: '-',
          }
        : null
    );
    if (!baseStockData) return null;

    // Once the detail loader has resolved stockData, keep that snapshot authoritative.
    // A stale MarketQuoteContext entry can otherwise overwrite the fresh loader result
    // on first navigation from Overview.
    if (stockData) {
      return baseStockData;
    }

    const latestQuote = normalizedTicker ? latestQuotes[normalizedTicker] : undefined;
    if (!latestQuote) return baseStockData;

    return {
      ...baseStockData,
      price: Number.isFinite(latestQuote.price) ? Number(latestQuote.price) : baseStockData.price,
      change: Number.isFinite(latestQuote.change) ? Number(latestQuote.change) : baseStockData.change,
      changePercent: Number.isFinite(latestQuote.changePercent) ? Number(latestQuote.changePercent) : baseStockData.changePercent,
      dayHigh: Number.isFinite(latestQuote.dayHigh) ? Number(latestQuote.dayHigh) : baseStockData.dayHigh,
      dayLow: Number.isFinite(latestQuote.dayLow) ? Number(latestQuote.dayLow) : baseStockData.dayLow,
      volume: Number.isFinite(latestQuote.volume) ? formatVolume(Number(latestQuote.volume)) : baseStockData.volume,
    };
  }, [initialAsset, latestQuotes, stockData, ticker]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setMarketClock(new Date());
    }, 30000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadStockData = async () => {
      setIsLoading(true);
      if (!normalizedTicker) return;

      try {
        const upperTicker = normalizedTicker;
        const yahooTicker = toYahooDetailTicker(normalizedTicker);
        const isRollingCryptoDayChart = routeKind === 'crypto' && timeRange === '1D';
        
        // Map time range to API params
        let rangeParam = '1mo';
        let intervalParam = '1d';
        
        switch (timeRange) {
          case '1D': rangeParam = '1d'; intervalParam = '5m'; break;
          case '1W': rangeParam = '5d'; intervalParam = '15m'; break;
          case '1M': rangeParam = '1mo'; intervalParam = '1d'; break;
          case '3M': rangeParam = '3mo'; intervalParam = '1d'; break;
          case 'YTD': rangeParam = 'ytd'; intervalParam = '1d'; break;
          case '1Y': rangeParam = '1y'; intervalParam = '1d'; break;
          case 'ALL': rangeParam = 'max'; intervalParam = '1mo'; break;
          default: rangeParam = '1mo'; intervalParam = '1d'; break;
        }

        const rollingWindowEnd = Math.floor(Date.now() / 1000);
        const rollingWindowStart = rollingWindowEnd - (24 * 60 * 60);

        // Fetch the selected chart plus dedicated live summary ranges for accurate stats
        const [data, daySummaryData, yearSummaryData, volumeSummaryData, quotes, pageMetrics] = await Promise.all([
          isRollingCryptoDayChart
            ? fetchStockDataByWindow(yahooTicker, rollingWindowStart, rollingWindowEnd, intervalParam)
            : fetchStockData(yahooTicker, rangeParam, intervalParam),
          fetchStockData(yahooTicker, '1d', '5m'),
          fetchStockData(yahooTicker, '1y', '1d'),
          fetchStockData(yahooTicker, '5d', '1d'),
          fetchYahooQuotes([yahooTicker]),
          fetchYahooQuotePageMetrics(yahooTicker),
        ]);
        
        const quote = quotes && quotes.length > 0 ? quotes[0] : null;
        const daySummary = getChartExtremes(daySummaryData);
        const yearSummary = getChartExtremes(yearSummaryData);
        
        if (data && data.indicators.quote[0].close) {
          const closes = data.indicators.quote[0].close.filter((c: any) => c !== null);
          const opens = data.indicators.quote[0].open.filter((o: any) => o !== null);
          const volumes = (data.indicators.quote[0].volume || []).filter((v: any) => v !== null);
          const summaryCloses = (volumeSummaryData?.indicators?.quote?.[0]?.close || []).filter((c: any) => c !== null);
          const summaryOpens = (volumeSummaryData?.indicators?.quote?.[0]?.open || []).filter((o: any) => o !== null);
          
          if (closes.length > 0) {
            // Keep detail-page daily change in sync with screener/trending cards:
            // current close minus previous daily close from a 5d/1d series.
            const summaryCurrent = summaryCloses.length > 0 ? summaryCloses[summaryCloses.length - 1] : undefined;
            const summaryPrev = summaryCloses.length > 1
              ? summaryCloses[summaryCloses.length - 2]
              : (summaryOpens[0] ?? summaryCurrent);
            const fallbackCurrent = closes[closes.length - 1];
            const fallbackPrev = closes[closes.length - 2] || opens[0] || fallbackCurrent;
            const fallbackPrice = summaryCurrent ?? fallbackCurrent;
            const fallbackPrevClose = summaryPrev ?? fallbackPrev;
            const quotePrice = getQuoteNumber(quote?.regularMarketPrice);
            const quoteChange = getQuoteNumber(quote?.regularMarketChange);
            const quoteChangePercent = getQuoteNumber(quote?.regularMarketChangePercent);
            const current = quotePrice ?? fallbackPrice;
            const change = quoteChange ?? (fallbackPrice - fallbackPrevClose);
            const changePercent = quoteChangePercent ?? (fallbackPrevClose !== 0 ? (change / fallbackPrevClose) * 100 : 0);
            const pe = getQuoteNumber(quote?.trailingPE);
            const liveVolume = getQuoteNumber(quote?.regularMarketVolume);
            const summaryVolume = getLatestVolumeFromChart(volumeSummaryData);
            const liveMarketCap = getQuoteNumber(quote?.marketCap);
            const resolvedMarketCap = liveMarketCap !== undefined
              ? formatCompactNumber(liveMarketCap)
              : (pageMetrics?.marketCap || '-');
            const liveDayHigh = getQuoteNumber(quote?.regularMarketDayHigh);
            const liveDayLow = getQuoteNumber(quote?.regularMarketDayLow);
            const live52WeekHigh = getQuoteNumber(quote?.fiftyTwoWeekHigh);
            const live52WeekLow = getQuoteNumber(quote?.fiftyTwoWeekLow);

            const resolvedDayHigh = liveDayHigh ?? daySummary.high;
            const resolvedDayLow = liveDayLow ?? daySummary.low;
            const resolvedVolume = summaryVolume ?? liveVolume ?? volumes[volumes.length - 1];

            publishQuotes({
              [upperTicker]: {
                price: current,
                change,
                changePercent,
                dayHigh: resolvedDayHigh,
                dayLow: resolvedDayLow,
                volume: resolvedVolume,
              },
            });
            
            if (!active) return;

            setStockData({
              ticker: upperTicker,
              name: quote?.shortName || quote?.longName || upperTicker,
              exchange: quote?.fullExchangeName || 'Market',
              price: current,
              change: change,
              changePercent: changePercent,
              // Match screener cards by prioritizing 5D daily live volume.
              volume: formatVolume(summaryVolume ?? liveVolume ?? volumes[volumes.length - 1]),
              marketCap: resolvedMarketCap,
              dayHigh: resolvedDayHigh,
              dayLow: resolvedDayLow,
              week52High: live52WeekHigh ?? yearSummary.high,
              week52Low: live52WeekLow ?? yearSummary.low,
              peRatio: pe ? pe.toFixed(2) : '-',
            });

            const timestamps = Array.isArray(data.timestamp) ? data.timestamp : [];
            const rawCloses = Array.isArray(data.indicators?.quote?.[0]?.close)
              ? data.indicators.quote[0].close
              : [];
            const formatted = timestamps
              .map((ts, index) => {
                const price = rawCloses[index];
                if (price === null || price === undefined || !Number.isFinite(price)) return null;
                return {
                  date: formatXAxisTimestamp(ts, timeRange),
                  fullDate: formatTooltipTimestamp(ts, timeRange),
                  price,
                };
              })
              .filter((point): point is ChartPoint => point !== null);
            setChartData(formatted);
          }
        } else {
          if (!active) return;
          setStockData(null);
          setChartData([]);
        }
      } catch (e) {
        console.error('Error loading stock detail data:', e);
        if (!active) return;
        setStockData(null);
        setChartData([]);
      }

      if (active) {
        setIsLoading(false);
      }
    };

    loadStockData();

    return () => {
      active = false;
    };
  }, [normalizedTicker, publishQuotes, routeKind, timeRange]);

  useEffect(() => {
    if (!normalizedTicker) return;

    let active = true;

    const upperTicker = normalizedTicker;
    const yahooTicker = toYahooDetailTicker(normalizedTicker);

    const refreshQuote = async () => {
      try {
        const [quotes, pageMetrics] = await Promise.all([
          fetchYahooQuotes([yahooTicker]),
          fetchYahooQuotePageMetrics(yahooTicker),
        ]);
        if (!active || !quotes.length) return;

        const quote = quotes[0];
        const quotePrice = getQuoteNumber(quote?.regularMarketPrice);
        const quoteChange = getQuoteNumber(quote?.regularMarketChange);
        const quoteChangePercent = getQuoteNumber(quote?.regularMarketChangePercent);
        const marketCap = getQuoteNumber(quote?.marketCap);
        const dayHigh = getQuoteNumber(quote?.regularMarketDayHigh);
        const dayLow = getQuoteNumber(quote?.regularMarketDayLow);
        const week52High = getQuoteNumber(quote?.fiftyTwoWeekHigh);
        const week52Low = getQuoteNumber(quote?.fiftyTwoWeekLow);
        const trailingPE = getQuoteNumber(quote?.trailingPE);
        const regularMarketVolume = getQuoteNumber(quote?.regularMarketVolume);

        if (
          quotePrice === undefined &&
          quoteChange === undefined &&
          quoteChangePercent === undefined &&
          marketCap === undefined &&
          dayHigh === undefined &&
          dayLow === undefined &&
          week52High === undefined &&
          week52Low === undefined &&
          trailingPE === undefined &&
          regularMarketVolume === undefined
        ) {
          return;
        }

        let nextDisplayedQuote:
          | {
              price: number;
              change: number;
              changePercent: number;
              dayHigh?: number;
              dayLow?: number;
              volume?: number;
            }
          | null = null;
        setStockData((current) => {
          if (!current) return current;

          const next = {
            ...current,
            name: quote?.shortName || quote?.longName || current.name,
            exchange: quote?.fullExchangeName || current.exchange,
            price: quotePrice ?? current.price,
            change: quoteChange ?? current.change,
            changePercent: quoteChangePercent ?? current.changePercent,
            marketCap: marketCap !== undefined
              ? formatCompactNumber(marketCap)
              : (pageMetrics?.marketCap || current.marketCap),
            dayHigh: dayHigh ?? current.dayHigh,
            dayLow: dayLow ?? current.dayLow,
            week52High: week52High ?? current.week52High,
            week52Low: week52Low ?? current.week52Low,
            peRatio: trailingPE
              ? trailingPE.toFixed(2)
              : current.peRatio,
            volume: regularMarketVolume !== undefined
              ? formatVolume(regularMarketVolume)
              : current.volume,
          };

          nextDisplayedQuote = {
            price: next.price,
            change: next.change,
            changePercent: next.changePercent,
            dayHigh: next.dayHigh,
            dayLow: next.dayLow,
            volume: regularMarketVolume,
          };

          return next;
        });

        if (nextDisplayedQuote) {
          publishQuotes({
            [upperTicker]: nextDisplayedQuote,
          });
        }
      } catch (error) {
        console.error('Error refreshing stock detail quote:', error);
      }
    };

    refreshQuote();
    const intervalId = setInterval(refreshQuote, 30000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [normalizedTicker, publishQuotes]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (!displayedStockData) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-slate-400">Stock data not found</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <button
        onClick={handleBack}
        className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-100 transition-colors text-sm font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      {/* Top Section: Stock Info + Chart */}
      <div className="grid grid-cols-5 gap-6">
        {/* LEFT: Stock Info Panel (40%) */}
        <div className="col-span-2 bg-slate-900/50 border border-slate-800 rounded-xl p-5">
          {/* Header */}
          <div className="mb-4">
            <h2 className="text-slate-100 text-xl font-semibold mb-1">
              {displayedStockData.name}
            </h2>
            <div className="text-slate-400 text-sm">
              {displayedStockData.ticker} · {displayedStockData.exchange || 'US Market'}
            </div>
          </div>

          {/* Current Price - Very Prominent */}
          <div className="mb-6 pb-6 border-b border-slate-800">
            <div className="text-slate-100 text-4xl font-bold mb-2">
              ${formatMoney(displayedStockData.price)}
            </div>
            <div
              className={`flex items-center gap-2 text-lg ${displayedStockData.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {displayedStockData.changePercent >= 0 ? (
                <TrendingUp className="w-5 h-5" />
              ) : (
                <TrendingDown className="w-5 h-5" />
              )}
              <span>
                {displayedStockData.changePercent >= 0 ? '+' : ''}${formatMoney(Math.abs(displayedStockData.change))} ({displayedStockData.changePercent >= 0 ? '+' : ''}{displayedStockData.changePercent.toFixed(2)}%)
              </span>
            </div>
            <div className="text-slate-500 text-xs mt-2">
              {changeLabel}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-slate-500 text-xs mb-1">
                  Day High
                </div>
                <div className="text-slate-300 text-sm">
                  {formatDetailMetricMoney(displayedStockData.dayHigh)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-1">
                  Day Low
                </div>
                <div className="text-slate-300 text-sm">
                  {formatDetailMetricMoney(displayedStockData.dayLow)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-slate-500 text-xs mb-1">
                  52W High
                </div>
                <div className="text-slate-300 text-sm">
                  {formatDetailMetricMoney(displayedStockData.week52High)}
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-1">
                  52W Low
                </div>
                <div className="text-slate-300 text-sm">
                  {formatDetailMetricMoney(displayedStockData.week52Low)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-slate-500 text-xs mb-1">
                  Volume
                </div>
                <div className="text-slate-300 text-sm">
                  {displayedStockData.volume || '-'}
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-1">
                  Market Cap
                </div>
                <div className="text-slate-300 text-sm">
                  {displayedStockData.marketCap || '-'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Chart Panel (60%) */}
        <div className="col-span-3 bg-slate-900/50 border border-slate-800 rounded-xl p-5 flex flex-col min-h-0">
          {/* Chart Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-slate-100 text-lg">
              Price Chart
            </h3>

            {/* Time Range Selector */}
            <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
              {timeRanges.map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                    timeRange === range
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>

          {/* Chart Area */}
          <div
            className="flex-1 rounded-lg p-4 flex flex-col min-h-0"
            style={{ backgroundColor: '#0B1220' }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ backgroundColor: marketIndicatorColor }}
                ></div>
                <span className="text-slate-400 text-xs">
                  {marketStatus.label}
                </span>
              </div>
              <div className="text-slate-500 text-xs">
                {routeKind === 'crypto' ? 'Live 24/7' : `As of ${marketTimeLabel}`}
              </div>
            </div>
            <div
              key={`research-chart-${ticker}-${timeRange}`}
              className="relative flex-1 min-h-[280px] chart-reveal"
            >
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{
                      top: 10,
                      right: 10,
                      left: 0,
                      bottom: 0,
                    }}
                  >
                    <defs>
                      <linearGradient
                        id="priceGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#10b981"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="#10b981"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="0"
                      stroke="#1e293b"
                      opacity={0.3}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      stroke="#475569"
                      tick={{
                        fill: '#64748b',
                        fontSize: 10,
                      }}
                      axisLine={{ stroke: '#1e293b' }}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={getChartMinTickGap(timeRange)}
                    />
                    <YAxis
                      stroke="#475569"
                      tick={{
                        fill: '#64748b',
                        fontSize: 10,
                      }}
                      axisLine={{ stroke: '#1e293b' }}
                      tickLine={false}
                      domain={[
                        'dataMin - 2',
                        'dataMax + 2',
                      ]}
                      tickFormatter={(value) =>
                        `$${formatMoney(value, 0)}`
                      }
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                      }}
                      labelStyle={{ color: '#e2e8f0' }}
                      labelFormatter={(label: string, payload: any[]) => payload?.[0]?.payload?.fullDate || label}
                      formatter={(value: any) => `$${formatMoney(Number(value), 2)}`}
                    />
                    <Area
                      type="linear"
                      dataKey="price"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      fill="url(#priceGradient)"
                      isAnimationActive={false}
                      dot={false}
                      activeDot={{
                        r: 5,
                        fill: '#10b981',
                        stroke: '#064e3b',
                        strokeWidth: 2,
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400">
                  No data available
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
