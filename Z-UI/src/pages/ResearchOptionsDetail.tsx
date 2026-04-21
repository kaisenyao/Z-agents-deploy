import { ArrowLeft, Loader2, Plus, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '../components/ui/button';
import { useLatestQuotes } from '../context/MarketQuoteContext';
import { fetchLiveOptionsChain, fetchStockData, fetchYahooQuotes } from '../lib/api';
import { formatEasternTimeLabel, getUSOptionsMarketStatus } from '../services/marketHours';

const PORTFOLIO_DRAFT_ITEMS_KEY = 'research_portfolio_items';
const MAX_PORTFOLIO_ITEMS = 15;

interface InitialAssetState {
  ticker: string;
  name?: string;
  price?: number;
  change?: number;
  changePercent?: number;
  volume?: string;
}

interface DetailNavigationState {
  initialAsset?: InitialAssetState;
  source?: 'investment-report';
  selectedReportId?: string;
}

interface DetailStockData {
  symbol: string;
  company: string;
  exchange: string;
  price: number;
  change: number;
  changePercent: number;
  volume: string;
  dayHigh?: number;
  dayLow?: number;
  week52High?: number;
  week52Low?: number;
}

interface ChartPoint {
  time: string;
  fullTime: string;
  price: number;
}

interface PortfolioItem {
  ticker: string;
  name: string;
  amount: number;
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

function formatMoney(value: number | undefined | null, fractionDigits: number = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function parseOptionDate(value: string | number | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const timestamp = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatOptionLastTradeDate(value: string | number | Date | null | undefined): string {
  const date = parseOptionDate(value);
  if (!date) return 'N/A';

  return date.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  });
}

function formatOptionExpirationLabel(value: string | number | Date): string {
  const date = parseOptionDate(value);
  if (!date) return 'Invalid date';

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatPercentChange(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function getQuoteNumber(value: any): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.raw === 'number' && Number.isFinite(value.raw)) return value.raw;
  return undefined;
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

export function ResearchOptionsDetail() {
  const { ticker } = useParams<{ ticker: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [chartTimeRange, setChartTimeRange] = useState('1D');
  const [isLoadingStock, setIsLoadingStock] = useState(true);
  const [liveStockData, setLiveStockData] = useState<DetailStockData | null>(null);
  const [liveChartData, setLiveChartData] = useState<ChartPoint[]>([]);
  const [marketClock, setMarketClock] = useState(() => new Date());
  const [selectedExpiration, setSelectedExpiration] = useState('');
  const [availableExpirationDates, setAvailableExpirationDates] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedView, setSelectedView] = useState('Near the Money');
  const [optionType, setOptionType] = useState<'calls' | 'puts'>('calls');
  const [optionsChainData, setOptionsChainData] = useState<{ calls: any[]; puts: any[] }>({ calls: [], puts: [] });
  const navigationState = location.state && typeof location.state === 'object'
    ? (location.state as DetailNavigationState)
    : undefined;
  const initialAsset = navigationState?.initialAsset;

  const normalizedTicker = ticker?.toUpperCase() || '';
  const latestSelectedQuotes = useLatestQuotes(normalizedTicker ? [normalizedTicker] : []);
  const latestSelectedQuote = normalizedTicker ? latestSelectedQuotes[normalizedTicker] : undefined;
  const changeLabel = 'Today';
  const marketStatus = useMemo(() => getUSOptionsMarketStatus(marketClock), [marketClock]);
  const marketTimeLabel = useMemo(() => formatEasternTimeLabel(marketClock), [marketClock]);
  const marketIndicatorColor = marketStatus.tone === 'open' ? '#10b981' : '#f43f5e';

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

    localStorage.setItem('research_category', 'options');
    navigate('/research/overview');
  };

  const addContractToPortfolio = (ticker: string, name: string) => {
    if (typeof window === 'undefined') return;

    const saved = localStorage.getItem(PORTFOLIO_DRAFT_ITEMS_KEY);
    let portfolioItems: PortfolioItem[] = [];

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        portfolioItems = Array.isArray(parsed) ? parsed : [];
      } catch {
        portfolioItems = [];
      }
    }

    if (portfolioItems.some((item) => item.ticker === ticker) || portfolioItems.length >= MAX_PORTFOLIO_ITEMS) {
      return false;
    }

    localStorage.setItem(
      PORTFOLIO_DRAFT_ITEMS_KEY,
      JSON.stringify([...portfolioItems, { ticker, name, amount: 0 }])
    );
    return true;
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-800/95 border border-slate-700 rounded-lg p-2.5 shadow-xl">
          <p className="text-slate-400 text-xs mb-1">
            {payload[0].payload.fullTime || payload[0].payload.time}
          </p>
          <p className="text-emerald-400 text-sm font-semibold">
            ${formatMoney(Number(payload[0].value), 2)}
          </p>
        </div>
      );
    }

    return null;
  };

  const currentDisplayedStockData = useMemo(() => {
    const baseStockData = liveStockData || (
      normalizedTicker && initialAsset?.ticker?.toUpperCase() === normalizedTicker
        ? {
            symbol: normalizedTicker,
            company: initialAsset?.name || normalizedTicker,
            exchange: 'US Market',
            price: Number.isFinite(initialAsset?.price) ? Number(initialAsset?.price) : 0,
            change: Number.isFinite(initialAsset?.change) ? Number(initialAsset?.change) : 0,
            changePercent: Number.isFinite(initialAsset?.changePercent) ? Number(initialAsset?.changePercent) : 0,
            volume: initialAsset?.volume || '-',
          }
        : null
    );

    if (!baseStockData) return null;
    if (!latestSelectedQuote) return baseStockData;

    return {
      ...baseStockData,
      price: Number.isFinite(Number(latestSelectedQuote?.price)) ? Number(latestSelectedQuote?.price) : baseStockData.price,
      change: Number.isFinite(Number(latestSelectedQuote?.change)) ? Number(latestSelectedQuote?.change) : baseStockData.change,
      changePercent: Number.isFinite(Number(latestSelectedQuote?.changePercent)) ? Number(latestSelectedQuote?.changePercent) : baseStockData.changePercent,
      dayHigh: Number.isFinite(Number(latestSelectedQuote?.dayHigh)) ? Number(latestSelectedQuote?.dayHigh) : baseStockData.dayHigh,
      dayLow: Number.isFinite(Number(latestSelectedQuote?.dayLow)) ? Number(latestSelectedQuote?.dayLow) : baseStockData.dayLow,
      volume: Number.isFinite(Number(latestSelectedQuote?.volume)) ? formatVolume(Number(latestSelectedQuote?.volume)) : baseStockData.volume,
    };
  }, [initialAsset, latestSelectedQuote, liveStockData, normalizedTicker]);

  const isDetailLoading = Boolean(normalizedTicker) && (!currentDisplayedStockData || isLoadingStock);
  const isPositive = currentDisplayedStockData ? currentDisplayedStockData.change >= 0 : false;

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setMarketClock(new Date());
    }, 30000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    const loadData = async () => {
      if (!normalizedTicker) return;

      setIsLoadingStock(true);

      try {
        let rangeParam = '1mo';
        let intervalParam = '1d';

        switch (chartTimeRange) {
          case '1D': rangeParam = '1d'; intervalParam = '5m'; break;
          case '1W': rangeParam = '5d'; intervalParam = '15m'; break;
          case '1M': rangeParam = '1mo'; intervalParam = '1d'; break;
          case '3M': rangeParam = '3mo'; intervalParam = '1d'; break;
          case 'YTD': rangeParam = 'ytd'; intervalParam = '1d'; break;
          case '1Y': rangeParam = '1y'; intervalParam = '1d'; break;
          case 'ALL': rangeParam = 'max'; intervalParam = '1mo'; break;
          default: break;
        }

        const [data, daySummaryData, yearSummaryData, volumeSummaryData, quotes] = await Promise.all([
          fetchStockData(normalizedTicker, rangeParam, intervalParam),
          fetchStockData(normalizedTicker, '1d', '5m'),
          fetchStockData(normalizedTicker, '1y', '1d'),
          fetchStockData(normalizedTicker, '5d', '1d'),
          fetchYahooQuotes([normalizedTicker]),
        ]);

        if (!isActive) return;

        const quote = quotes && quotes.length > 0 ? quotes[0] : null;
        const daySummary = getChartExtremes(daySummaryData);
        const yearSummary = getChartExtremes(yearSummaryData);
        const summaryVolume = getLatestVolumeFromChart(volumeSummaryData);

        if (data && data.timestamp && data.indicators?.quote?.[0]?.close) {
          const quoteData = data.indicators.quote[0];
          const rawCloses = quoteData.close || [];
          const timestamps = data.timestamp || [];
          const highs = (quoteData.high || []).filter((value: any) => value !== null && Number.isFinite(value));
          const lows = (quoteData.low || []).filter((value: any) => value !== null && Number.isFinite(value));
          const closes = rawCloses.filter((value: any) => value !== null && Number.isFinite(value));
          const opens = (quoteData.open || []).filter((value: any) => value !== null && Number.isFinite(value));
          const volumes = (quoteData.volume || []).filter((value: any) => value !== null && Number.isFinite(value));
          const summaryCloses = (volumeSummaryData?.indicators?.quote?.[0]?.close || []).filter((value: any) => value !== null && Number.isFinite(value));
          const summaryOpens = (volumeSummaryData?.indicators?.quote?.[0]?.open || []).filter((value: any) => value !== null && Number.isFinite(value));

          if (closes.length > 0) {
            const summaryCurrent = summaryCloses.length > 0 ? summaryCloses[summaryCloses.length - 1] : undefined;
            const summaryPrev = summaryCloses.length > 1 ? summaryCloses[summaryCloses.length - 2] : (summaryOpens[0] ?? summaryCurrent);
            const fallbackCurrent = closes[closes.length - 1] || 0;
            const fallbackPrev = closes[closes.length - 2] || opens[0] || fallbackCurrent;
            const currentPrice = summaryCurrent ?? fallbackCurrent;
            const previousPrice = summaryPrev ?? fallbackPrev;
            const quotePrice = getQuoteNumber(quote?.regularMarketPrice);
            const quoteChange = getQuoteNumber(quote?.regularMarketChange);
            const quoteChangePercent = getQuoteNumber(quote?.regularMarketChangePercent);
            const effectivePrice = quotePrice ?? currentPrice;
            const effectiveChange = quoteChange ?? (currentPrice - previousPrice);
            const effectiveChangePercent = quoteChangePercent ?? (previousPrice !== 0 ? (effectiveChange / previousPrice) * 100 : 0);
            const dayHigh = getQuoteNumber(quote?.regularMarketDayHigh);
            const dayLow = getQuoteNumber(quote?.regularMarketDayLow);
            const week52High = getQuoteNumber(quote?.fiftyTwoWeekHigh);
            const week52Low = getQuoteNumber(quote?.fiftyTwoWeekLow);
            const liveVolume = getQuoteNumber(quote?.regularMarketVolume);

            const formatted = timestamps
              .map((ts: number, index: number) => {
                const price = rawCloses[index];
                if (price === null || price === undefined || !Number.isFinite(price)) return null;
                return {
                  time: formatXAxisTimestamp(ts, chartTimeRange),
                  fullTime: formatTooltipTimestamp(ts, chartTimeRange),
                  price,
                };
              })
              .filter((point): point is ChartPoint => point !== null);

            setLiveChartData(formatted);
            setLiveStockData({
              symbol: normalizedTicker,
              company: quote?.shortName || quote?.longName || normalizedTicker,
              exchange: quote?.fullExchangeName || 'US Market',
              price: effectivePrice,
              change: effectiveChange,
              changePercent: effectiveChangePercent,
              volume: formatVolume(summaryVolume ?? liveVolume ?? volumes[volumes.length - 1]),
              dayHigh: dayHigh ?? daySummary.high ?? (highs.length > 0 ? Math.max(...highs) : undefined),
              dayLow: dayLow ?? daySummary.low ?? (lows.length > 0 ? Math.min(...lows) : undefined),
              week52High: week52High ?? yearSummary.high ?? (highs.length > 0 ? Math.max(...highs) : undefined),
              week52Low: week52Low ?? yearSummary.low ?? (lows.length > 0 ? Math.min(...lows) : undefined),
            });
          } else {
            setLiveChartData([]);
            setLiveStockData(null);
          }
        } else {
          setLiveChartData([]);
          setLiveStockData(null);
        }
      } catch (error) {
        if (!isActive) return;
        console.error('Error loading research options detail:', error);
        setLiveStockData(null);
        setLiveChartData([]);
      } finally {
        if (isActive) {
          setIsLoadingStock(false);
        }
      }
    };

    loadData();
    return () => {
      isActive = false;
    };
  }, [chartTimeRange, normalizedTicker]);

  useEffect(() => {
    let mounted = true;

    const fetchOptionsChain = async () => {
      if (!normalizedTicker) {
        if (mounted) {
          setAvailableExpirationDates([]);
          setOptionsChainData({ calls: [], puts: [] });
          setSelectedExpiration('');
        }
        return;
      }

      try {
        const metadata = await fetchLiveOptionsChain(normalizedTicker);
        const expirationDates: string[] = metadata?.expirationDates || [];
        if (!expirationDates.length) {
          throw new Error('No expiration dates returned from live options endpoint');
        }

        const fetchedExpirationDates = expirationDates.map((isoDate) => {
          const date = new Date(isoDate);
          return {
            value: date.toISOString().split('T')[0],
            label: formatOptionExpirationLabel(isoDate),
          };
        });

        if (mounted) {
          setAvailableExpirationDates(fetchedExpirationDates);
        }

        const selectedDateData = fetchedExpirationDates.find((date) => date.value === selectedExpiration) || fetchedExpirationDates[0];

        if (mounted && selectedDateData.value !== selectedExpiration) {
          setSelectedExpiration(selectedDateData.value);
        }

        const liveChain = await fetchLiveOptionsChain(normalizedTicker, selectedDateData.value);
        if (!liveChain) {
          throw new Error('No options data returned for selected expiration');
        }

        if (mounted) {
          setOptionsChainData({ calls: liveChain.calls || [], puts: liveChain.puts || [] });
        }
      } catch (error) {
        console.error('Failed to fetch options chain:', error);
        if (mounted) {
          setAvailableExpirationDates([]);
          setOptionsChainData({ calls: [], puts: [] });
          setSelectedExpiration('');
        }
      }
    };

    fetchOptionsChain();
    return () => {
      mounted = false;
    };
  }, [normalizedTicker, selectedExpiration]);

  const renderAssetDetailSkeleton = () => (
    <div className="grid grid-cols-5 gap-6">
      <div className="col-span-2 bg-slate-900/50 border border-slate-800 rounded-xl p-5 animate-pulse">
        <div className="mb-4">
          <div className="text-slate-100 text-xl font-semibold mb-1">
            {normalizedTicker || 'Loading'}
          </div>
          <div className="h-4 w-28 bg-slate-800 rounded" />
        </div>
        <div className="mb-6 pb-6 border-b border-slate-800">
          <div className="h-12 w-36 bg-slate-800 rounded mb-3" />
          <div className="h-6 w-32 bg-slate-800 rounded mb-2" />
          <div className="h-4 w-12 bg-slate-800 rounded" />
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="h-12 bg-slate-800 rounded" />
            <div className="h-12 bg-slate-800 rounded" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-12 bg-slate-800 rounded" />
            <div className="h-12 bg-slate-800 rounded" />
          </div>
          <div className="h-12 bg-slate-800 rounded" />
        </div>
      </div>

      <div className="col-span-3 bg-slate-900/50 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="h-7 w-28 bg-slate-800 rounded" />
          <div className="h-8 w-56 bg-slate-800 rounded-lg" />
        </div>
        <div className="rounded-lg p-4 min-h-[360px] bg-slate-950/60 border border-slate-900">
          <div className="flex items-center justify-between mb-3">
            <div className="h-4 w-24 bg-slate-800 rounded" />
            <div className="h-4 w-28 bg-slate-800 rounded" />
          </div>
          <div className="h-[300px] bg-slate-900/70 rounded" />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <button
        onClick={handleBack}
        className="flex items-center gap-2 text-slate-400 hover:text-slate-100 transition-colors text-sm font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      {isDetailLoading || !currentDisplayedStockData ? renderAssetDetailSkeleton() : (
        <div className="grid grid-cols-5 gap-6">
          <div className="col-span-2 bg-slate-900/50 border border-slate-800 rounded-xl p-5">
            <div className="mb-4">
              <h2 className="text-slate-100 text-xl font-semibold mb-1">
                {currentDisplayedStockData.company}
              </h2>
              <div className="text-slate-400 text-sm">
                {currentDisplayedStockData.symbol} · {currentDisplayedStockData.exchange}
              </div>
            </div>

            <div className="mb-6 pb-6 border-b border-slate-800">
              <div className="text-slate-100 text-4xl font-bold mb-2 flex items-center gap-3">
                ${formatMoney(currentDisplayedStockData.price)}
                {isLoadingStock && <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />}
              </div>
              <div className={`flex items-center gap-2 text-lg ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {isPositive ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                <span>
                  {isPositive ? '+' : ''}${formatMoney(Math.abs(currentDisplayedStockData.change))} ({isPositive ? '+' : ''}
                  {currentDisplayedStockData.changePercent.toFixed(2)}%)
                </span>
              </div>
              <div className="text-slate-500 text-xs mt-2">{changeLabel}</div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-slate-500 text-xs mb-1">Day High</div>
                  <div className="text-slate-300 text-sm">${formatMoney(currentDisplayedStockData.dayHigh)}</div>
                </div>
                <div>
                  <div className="text-slate-500 text-xs mb-1">Day Low</div>
                  <div className="text-slate-300 text-sm">${formatMoney(currentDisplayedStockData.dayLow)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-slate-500 text-xs mb-1">52W High</div>
                  <div className="text-slate-300 text-sm">${formatMoney(currentDisplayedStockData.week52High)}</div>
                </div>
                <div>
                  <div className="text-slate-500 text-xs mb-1">52W Low</div>
                  <div className="text-slate-300 text-sm">${formatMoney(currentDisplayedStockData.week52Low)}</div>
                </div>
              </div>
              <div>
                <div className="text-slate-500 text-xs mb-1">Volume</div>
                <div className="text-slate-300 text-sm">{currentDisplayedStockData.volume}</div>
              </div>
            </div>
          </div>

          <div className="col-span-3 bg-slate-900/50 border border-slate-800 rounded-xl p-5 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-slate-100 text-lg">Price Chart</h3>

              <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
                {['1D', '1W', '1M', '3M', 'YTD', '1Y', 'ALL'].map((range) => (
                  <button
                    key={range}
                    onClick={() => setChartTimeRange(range)}
                    className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                      chartTimeRange === range ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 rounded-lg p-4 flex flex-col min-h-0" style={{ backgroundColor: '#0B1220' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full animate-pulse"
                    style={{ backgroundColor: marketIndicatorColor }}
                  />
                  <span className="text-slate-400 text-xs">{marketStatus.label}</span>
                </div>
                <div className="text-slate-500 text-xs">As of {marketTimeLabel}</div>
              </div>
              <div key={`research-options-chart-${normalizedTicker}-${chartTimeRange}`} className="relative flex-1 min-h-[280px] chart-reveal">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={liveChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="researchOptionsPriceGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="0" stroke="#1e293b" opacity={0.3} vertical={false} />
                    <XAxis
                      dataKey="time"
                      stroke="#475569"
                      tick={{ fill: '#64748b', fontSize: 10 }}
                      axisLine={{ stroke: '#1e293b' }}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={getChartMinTickGap(chartTimeRange)}
                    />
                    <YAxis
                      stroke="#475569"
                      tick={{ fill: '#64748b', fontSize: 10 }}
                      axisLine={{ stroke: '#1e293b' }}
                      tickLine={false}
                      domain={['dataMin - 2', 'dataMax + 2']}
                      tickFormatter={(value) => `$${formatMoney(Number(value), 0)}`}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="linear"
                      dataKey="price"
                      stroke="#10b981"
                      strokeWidth={2.5}
                      fill="url(#researchOptionsPriceGradient)"
                      isAnimationActive={false}
                      dot={false}
                      activeDot={{ r: 5, fill: '#10b981', stroke: '#064e3b', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {isDetailLoading || !currentDisplayedStockData ? (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 animate-pulse">
          <div className="h-6 w-40 bg-slate-800 rounded mb-4" />
          <div className="h-10 w-full bg-slate-800 rounded mb-4" />
          <div className="h-64 w-full bg-slate-900/70 rounded" />
        </div>
      ) : (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-slate-100 text-lg font-semibold">{optionType === 'calls' ? 'Calls' : 'Puts'}</h2>
                <p className="text-slate-400 text-sm">By Expiration Date</p>
              </div>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-slate-400 text-sm">Expiration:</label>
                <select
                  value={selectedExpiration}
                  onChange={(e) => setSelectedExpiration(e.target.value)}
                  className="bg-slate-800/50 border border-slate-700 text-slate-100 px-3 py-2 rounded text-sm hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  {availableExpirationDates.map((date) => (
                    <option key={date.value} value={date.value}>
                      {date.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <select
                  value={selectedView}
                  onChange={(e) => setSelectedView(e.target.value)}
                  className="bg-slate-800/50 border border-slate-700 text-slate-100 px-3 py-2 rounded text-sm hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  <option>Near the Money</option>
                  <option>All Strikes</option>
                  <option>In the Money</option>
                  <option>Out of the Money</option>
                </select>
              </div>

              <div className="ml-auto flex gap-2">
                <Button
                  onClick={() => setOptionType('calls')}
                  className={`text-sm px-3 py-1.5 rounded ${
                    optionType === 'calls'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800/50 border border-slate-700 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Calls
                </Button>
                <Button
                  onClick={() => setOptionType('puts')}
                  className={`text-sm px-3 py-1.5 rounded ${
                    optionType === 'puts'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800/50 border border-slate-700 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Puts
                </Button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full">
              <thead className="bg-slate-900/50 sticky top-0">
	                <tr className="border-b border-slate-800">
	                  <th className="text-left text-slate-400 text-xs font-medium py-3 px-4">Contract Name</th>
	                  <th className="text-left text-slate-400 text-xs font-medium py-3 px-4">Last Trade Date (EST)</th>
                  <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Strike</th>
                  <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Last Price</th>
                  <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Bid</th>
                  <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Ask</th>
                  <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Change</th>
                  <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">% Change</th>
	                  <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Volume</th>
	                  <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Open Interest</th>
	                  <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Implied Volatility</th>
	                  <th className="text-right text-slate-400 text-xs font-medium py-3 px-4 w-12"></th>
	                </tr>
	              </thead>
	              <tbody>
                {(() => {
                  const dataToShow = optionType === 'calls' ? optionsChainData.calls : optionsChainData.puts;

                  if (!dataToShow || dataToShow.length === 0) {
	                    return (
	                      <tr>
	                        <td colSpan={12} className="py-8 px-4 text-center text-slate-400">
	                          No {optionType} data available
	                        </td>
	                      </tr>
                    );
                  }

                  return dataToShow.map((contract: any) => {
                    const lastTradeDate = formatOptionLastTradeDate(contract.lastTradeDate);

                    return (
                      <tr key={contract.contractSymbol} className="border-b border-slate-800/50 hover:bg-slate-800/50 transition-colors">
                        <td className="py-3 px-4">
                          <div className="text-slate-100 text-sm font-medium">{contract.contractSymbol}</div>
                        </td>
                        <td className="py-3 px-4 text-left text-slate-300 text-sm">{lastTradeDate}</td>
                        <td className="py-3 px-4 text-right text-slate-300 text-sm font-semibold">${formatMoney(contract.strike)}</td>
                        <td className="py-3 px-4 text-right text-slate-300 text-sm">${formatMoney(contract.lastPrice)}</td>
                        <td className="py-3 px-4 text-right text-slate-300 text-sm">${formatMoney(contract.bid)}</td>
                        <td className="py-3 px-4 text-right text-slate-300 text-sm">${formatMoney(contract.ask)}</td>
                        <td className="py-3 px-4 text-right text-sm">
                          <span className={contract.change >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {contract.change >= 0 ? '+' : ''}{formatMoney(contract.change)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right text-sm">
                          <span className={contract.percentChange >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {formatPercentChange(contract.percentChange)}
                          </span>
                        </td>
	                        <td className="py-3 px-4 text-right text-slate-300 text-sm">{contract.volume || 0}</td>
	                        <td className="py-3 px-4 text-right text-slate-300 text-sm">{contract.openInterest || 0}</td>
	                        <td className="py-3 px-4 text-right text-slate-300 text-sm">{((contract.impliedVolatility || 0) * 100).toFixed(2)}%</td>
	                        <td className="py-3 px-4 text-right">
	                          <Button
	                            size="sm"
	                            onClick={() => {
	                              const added = addContractToPortfolio(contract.contractSymbol, contract.contractSymbol);
	                              if (!added) return;
	                              localStorage.setItem('research_category', 'options');
	                              navigate('/research/overview');
	                            }}
	                            className="h-7 w-7 p-0 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed"
	                            disabled={typeof window !== 'undefined' && (() => {
	                              const saved = localStorage.getItem(PORTFOLIO_DRAFT_ITEMS_KEY);
	                              if (!saved) return false;
	                              try {
	                                const parsed = JSON.parse(saved);
	                                if (!Array.isArray(parsed)) return false;
	                                return parsed.some((item: PortfolioItem) => item.ticker === contract.contractSymbol) || parsed.length >= MAX_PORTFOLIO_ITEMS;
	                              } catch {
	                                return false;
	                              }
	                            })()}
	                          >
	                            <Plus className="w-3 h-3" />
	                          </Button>
	                        </td>
	                      </tr>
	                    );
	                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
