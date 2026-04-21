import { ChevronDown, Clock, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { InteractiveAssetAllocation } from '../components/InteractiveAssetAllocation';
import { PortfolioPerformanceChart } from '../components/PortfolioPerformanceChart';
import { useLatestQuotes, useMarketQuoteContext } from '../context/MarketQuoteContext';
import { useTradeContext } from '../context/TradeContext';
import { CRYPTO_HOLDINGS, OPTIONS_HOLDINGS } from '../data/portfolioHoldings';
import { useAccountMetrics } from '../hooks/useAccountMetrics';
import { fetchStockData } from '../lib/api';
import { reconstructPortfolioHistory } from '../services/portfolioReconstruction';
import {
  appendCurrentValuePoint,
  buildChartSeriesWithBenchmark,
  filterValueSeriesByRange,
  getRangeStartTimestamp,
  getSnapshotBucketSize,
  getStartOfToday,
  mergeValueSeries,
  resamplePortfolioSnapshots,
  sanitizePortfolioHistory,
  type PortfolioChartPoint,
} from '../services/portfolioPerformance';
import { isUsablePrice, normalizeAssetSymbol } from '../services/assetPricing';
import { getDirectAssetDetailPath } from '../services/assetRouting';
import { loadCashActivityHistory } from '../store/tradingStore';
type DashboardRange = '1D' | '1W' | '1M' | '3M' | '6M' | 'YTD' | '1Y' | 'ALL';

interface TopGainerEntry {
  id: string;
  symbol: string;
  displayName: string;
  assetType: 'Stock' | 'ETF' | 'Crypto' | 'Option';
  performance: number;
  routeSymbol: string;
}

const DASHBOARD_TIME_RANGES: DashboardRange[] = ['1D', '1W', '1M', '3M', '6M', 'YTD', '1Y', 'ALL'];
const TOP_GAINERS_RANGES: DashboardRange[] = ['1D', '1W', '3M', '1Y', 'ALL'];
const ETF_SYMBOLS = new Set(['SPY', 'QQQ', 'DIA', 'IWM', 'VTI']);
const KNOWN_CRYPTO_SYMBOLS = new Set(['BTC', 'ETH', 'DOGE', 'ADA', 'SOL', 'XRP', 'DOT', 'AVAX', 'BNB', 'LINK', 'MATIC']);

function normalizeHoldingSymbol(symbol: string): string {
  return normalizeAssetSymbol(symbol);
}

function getRangeConfig(range: DashboardRange) {
  switch (range) {
    case '1D':
      return { range: '1d', interval: '5m' };
    case '1W':
      return { range: '5d', interval: '15m' };
    case '1M':
      return { range: '1mo', interval: '1d' };
    case '3M':
      return { range: '3mo', interval: '1d' };
    case '6M':
      return { range: '6mo', interval: '1d' };
    case 'YTD':
      return { range: 'ytd', interval: '1d' };
    case '1Y':
      return { range: '1y', interval: '1d' };
    case 'ALL':
      return { range: '10y', interval: '1mo' };
  }
}

function getRangeStartDate(range: DashboardRange): Date {
  const now = new Date();

  switch (range) {
    case '1D': {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return d;
    }
    case '1W': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d;
    }
    case '1M': {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      return d;
    }
    case '3M': {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 3);
      return d;
    }
    case '6M': {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 6);
      return d;
    }
    case 'YTD':
      return new Date(now.getFullYear(), 0, 1);
    case '1Y': {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 1);
      return d;
    }
    case 'ALL':
      return new Date(0);
  }
}

function getFirstAndLastClose(chartData: any): { first: number; last: number } | null {
  const closes = chartData?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) return null;

  const validCloses = closes.filter((price: number | null | undefined) => typeof price === 'number' && Number.isFinite(price));
  if (validCloses.length < 2) return null;

  return {
    first: validCloses[0],
    last: validCloses[validCloses.length - 1],
  };
}

function getOptionUnderlying(contract: string): string {
  return String(contract || '').trim().split(' ')[0]?.toUpperCase() || '';
}

function getHoldingAssetType(symbol: string, description: string): 'Stock' | 'ETF' | 'Crypto' {
  if (KNOWN_CRYPTO_SYMBOLS.has(normalizeHoldingSymbol(symbol))) {
    return 'Crypto';
  }

  if (ETF_SYMBOLS.has(symbol.toUpperCase()) || /\bETF\b|Trust|Fund|Index/i.test(description)) {
    return 'ETF';
  }

  return 'Stock';
}

function getDashboardDetailPath(symbol: string, assetType: 'Stock' | 'ETF' | 'Crypto' | 'Option'): string {
  return getDirectAssetDetailPath(symbol, assetType === 'Crypto' ? 'crypto' : 'stock');
}

function percentageOfTotal(value: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return parseFloat(((value / total) * 100).toFixed(2));
}

function formatTodaysChangePercent(value: number): string {
  if (!Number.isFinite(value)) return '0.00%';

  const precision = Math.abs(value) < 0.01 ? 4 : 2;
  const rounded = Number(value.toFixed(precision));
  if (Object.is(rounded, -0) || rounded === 0) {
    return `0.${'0'.repeat(precision)}%`;
  }

  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(precision)}%`;
}

function getTotalExternalCashFlowSinceInception(): number {
  return loadCashActivityHistory().reduce((sum, activity) => {
    if (activity.status !== 'completed') return sum;
    if (activity.type === 'deposit') return sum + activity.amount;
    if (activity.type === 'withdraw') return sum - activity.amount;
    return sum;
  }, 0);
}

function chartToPricePoints(chart: any): Array<{ timestamp: number; price: number }> {
  const timestamps = Array.isArray(chart?.timestamp) ? chart.timestamp : [];
  const closes = Array.isArray(chart?.indicators?.quote?.[0]?.close) ? chart.indicators.quote[0].close : [];

  return timestamps
    .map((ts: number, idx: number) => ({ timestamp: Number(ts) * 1000, price: Number(closes[idx]) }))
    .filter((point: { timestamp: number; price: number }) => Number.isFinite(point.timestamp) && isUsablePrice(point.price))
    .sort((left, right) => left.timestamp - right.timestamp);
}

export function Dashboard() {
  const navigate = useNavigate();
  const topGainersDropdownRef = useRef<HTMLDivElement | null>(null);
  const { forceRefresh } = useMarketQuoteContext();
  const { holdings, shortPositions, cash, shortProceeds, marginHeld, portfolioHistory, tradeHistory } = useTradeContext();

  // Refresh prices immediately on page entry
  useEffect(() => {
    forceRefresh();
  }, [forceRefresh]);
  const [selectedTimeRange, setSelectedTimeRange] = useState<DashboardRange>('1D');
  const [selectedHoldingsTab, setSelectedHoldingsTab] = useState('stocks');
  const [hoveredAsset, setHoveredAsset] = useState<string | null>(null);
  const [showBenchmark, setShowBenchmark] = useState(false);
  const [topGainersRange, setTopGainersRange] = useState<DashboardRange>('1D');
  const [topGainers, setTopGainers] = useState<TopGainerEntry[]>([]);
  const [isTopGainersLoading, setIsTopGainersLoading] = useState(false);
  const [isTopGainersMenuOpen, setIsTopGainersMenuOpen] = useState(false);
  const trackedQuoteSymbols = useMemo(
    () => Array.from(new Set([
      ...holdings.map((holding) => holding.symbol),
      ...Array.from(shortPositions.keys()),
    ])),
    [holdings, shortPositions],
  );
  const latestQuotes = useLatestQuotes(trackedQuoteSymbols);
  const benchmarkQuotes = useLatestQuotes(['SPY']);
  const latestSpyPrice = isUsablePrice(benchmarkQuotes.SPY?.price) ? Number(benchmarkQuotes.SPY?.price) : undefined;

  const timeRanges = DASHBOARD_TIME_RANGES;
  const effectiveHoldings = useMemo(
    () => holdings.map((holding) => {
      const latestQuote = latestQuotes[String(holding.symbol || '').toUpperCase().replace(/-USD$/i, '')];
      if (!latestQuote) return holding;

      return {
        ...holding,
        currentPrice: isUsablePrice(latestQuote.price) ? Number(latestQuote.price) : holding.currentPrice,
        todayChange: Number.isFinite(latestQuote.dailyChangePercent) ? Number(latestQuote.dailyChangePercent) : holding.todayChange,
        previousClosePrice: isUsablePrice(latestQuote.previousClosePrice) ? Number(latestQuote.previousClosePrice) : holding.previousClosePrice,
      };
    }),
    [holdings, latestQuotes],
  );
  const shortsHoldings = useMemo(
    () =>
      Array.from(shortPositions.values()).map((shortHolding) => ({
        symbol: shortHolding.symbol,
        description: shortHolding.description,
        quantity: shortHolding.quantity,
        currentPrice: isUsablePrice(latestQuotes[String(shortHolding.symbol || '').toUpperCase().replace(/-USD$/i, '')]?.price)
          ? Number(latestQuotes[String(shortHolding.symbol || '').toUpperCase().replace(/-USD$/i, '')]?.price)
          : shortHolding.currentPrice,
        avgShortPrice: shortHolding.avgCost || shortHolding.purchasePrice || 0,
        purchaseDate: shortHolding.purchaseDate,
      })),
    [latestQuotes, shortPositions],
  );

  const sanitizedPortfolioHistory = useMemo(
    () => sanitizePortfolioHistory(portfolioHistory),
    [portfolioHistory],
  );
  const [performanceChartData, setPerformanceChartData] = useState<PortfolioChartPoint[]>([]);
  const [benchmarkAvailable, setBenchmarkAvailable] = useState(false);
  const [isChartLoading, setIsChartLoading] = useState(false);
  const hasChartPerformanceData = performanceChartData.length > 1;

  // Sample options data
  const optionsHoldings = OPTIONS_HOLDINGS;

  // Seeded (static) crypto data
  const cryptoHoldings = CRYPTO_HOLDINGS;

  // Split effectiveHoldings: crypto holdings (BTC, ETH, etc.) vs stocks/ETFs
  const stockEtfHoldings = useMemo(
    () => effectiveHoldings.filter((h) => !KNOWN_CRYPTO_SYMBOLS.has(normalizeHoldingSymbol(h.symbol))),
    [effectiveHoldings],
  );
  const tradedCryptoHoldings = useMemo(
    () => effectiveHoldings.filter((h) => KNOWN_CRYPTO_SYMBOLS.has(normalizeHoldingSymbol(h.symbol))),
    [effectiveHoldings],
  );

  // All crypto holdings: seeded + user-traded
  const allCryptoHoldings = useMemo(
    () => [
      ...cryptoHoldings,
      ...tradedCryptoHoldings.map((h) => ({
        symbol: normalizeHoldingSymbol(h.symbol),
        description: h.description,
        quantity: h.quantity,
        currentPrice: h.currentPrice,
        purchasePrice: h.avgCost ?? h.purchasePrice,
        todayChange: h.todayChange,
        purchaseDate: h.purchaseDate,
        previousClosePrice: h.previousClosePrice,
        assetType: 'Crypto' as const,
      })),
    ],
    [cryptoHoldings, tradedCryptoHoldings],
  );

  const calculateTotalValue = (price: number, qty: number) => price * qty;

  // Use the account metrics hook for consistent calculations.
  // Pass only non-crypto holdings as stockHoldings so that crypto value is
  // counted under totalCryptoValue (not usStocksValue) for correct asset allocation.
  const accountMetrics = useAccountMetrics(stockEtfHoldings, optionsHoldings, allCryptoHoldings, shortsHoldings, cash, shortProceeds, marginHeld, tradeHistory);
  const { totalPortfolioValue, usStocksValue, etfsValue, totalOptionsValue, totalCryptoValue, totalHoldingsValue, totalTodayChange, totalTodayChangePercent, holdingDailyMetrics } = accountMetrics;
  const showPerformanceEmptyState = totalPortfolioValue === 0 && totalHoldingsValue === 0 && tradeHistory.length === 0;
  const topMoversLabel = 'Top Movers';
  const impliedStartOfDayValue = totalPortfolioValue - totalTodayChange;
  const displayedTodayChangePercent = impliedStartOfDayValue > 0
    ? (totalTodayChange / impliedStartOfDayValue) * 100
    : totalTodayChangePercent;
  const totalExternalCashFlowSinceInception = getTotalExternalCashFlowSinceInception();
  const totalReturn = totalExternalCashFlowSinceInception > 0
    ? totalPortfolioValue - totalExternalCashFlowSinceInception
    : 0;
  const totalReturnPercent = totalExternalCashFlowSinceInception > 0
    ? (totalReturn / totalExternalCashFlowSinceInception) * 100
    : 0;

  useEffect(() => {
    let active = true;

    const buildPerformanceSeries = async () => {
      setIsChartLoading(true);
      try {
        const now = Date.now();
        const rangeStart = getRangeStartTimestamp(selectedTimeRange, now);
        const todayStart = getStartOfToday(now);
        const snapshotBucketMs = getSnapshotBucketSize(selectedTimeRange);
        const rangeMap: Record<Exclude<DashboardRange, '1D'>, string> = {
          '1W': '5d',
          '1M': '1mo',
          '3M': '3mo',
          '6M': '6mo',
          'YTD': 'ytd',
          '1Y': '1y',
          'ALL': '10y',
        };
        const benchmarkRangeConfig = getRangeConfig(selectedTimeRange);
        const benchmarkChart = await fetchStockData('SPY', benchmarkRangeConfig.range, benchmarkRangeConfig.interval);
        const benchmarkPrices = chartToPricePoints(benchmarkChart);
        if (isUsablePrice(latestSpyPrice) && (benchmarkPrices.length === 0 || now > benchmarkPrices[benchmarkPrices.length - 1].timestamp)) {
          benchmarkPrices.push({ timestamp: now, price: latestSpyPrice });
        }

        const rawRangeHistory = filterValueSeriesByRange(sanitizedPortfolioHistory, rangeStart);
        const sampledRawRangeHistory = resamplePortfolioSnapshots(
          rawRangeHistory.length > 0 ? rawRangeHistory : sanitizedPortfolioHistory,
          snapshotBucketMs,
        );
        const intradaySnapshotTail = resamplePortfolioSnapshots(
          filterValueSeriesByRange(sanitizedPortfolioHistory, Math.max(rangeStart, todayStart)),
          getSnapshotBucketSize('1D'),
        );
        const cashActivities = loadCashActivityHistory();
        let portfolioSeries = selectedTimeRange === '1D'
          ? sampledRawRangeHistory
          : [];

        if (selectedTimeRange !== '1D' && (tradeHistory.length > 0 || cashActivities.length > 0)) {
          const chartSymbols = Array.from(
            new Set(
              tradeHistory
                .filter((trade) => trade.assetType === 'Stock' || trade.assetType === 'ETF' || trade.assetType === 'Crypto')
                .map((trade) => trade.symbol),
            ),
          );

          const reconstructed = await reconstructPortfolioHistory({
            trades: tradeHistory,
            cashActivities,
            symbols: chartSymbols,
            range: rangeMap[selectedTimeRange],
          });

          if (!active) return;

          const reconstructedSeries = sanitizePortfolioHistory(reconstructed).filter((point) => point.timestamp >= rangeStart);
          const historicalBeforeToday = reconstructedSeries.filter((point) => point.timestamp < todayStart);

          // Prefer actual snapshots for the full range at the range's bucket granularity.
          // This avoids a cliff at the day boundary caused by stitching EOD reconstruction
          // points (one per day at 23:59:59) to intraday snapshot data from today.
          const rangeSnapshots = resamplePortfolioSnapshots(rawRangeHistory, snapshotBucketMs);
          // Reconstruction produces one EOD point per calendar day. If we have fewer
          // snapshot buckets than reconstruction days, snapshots alone are too sparse to
          // form a readable curve (near-flat line with a single jump). In that case use
          // the reconstruction as the daily backbone and layer snapshot points on top.
          const snapshotsAreDense = rangeSnapshots.length >= Math.max(1, reconstructedSeries.length);

          if (snapshotsAreDense) {
            // Dense snapshot coverage: snapshots tell the full story.
            // Use reconstruction only for the period before the first real snapshot.
            const firstSnapshotTs = rangeSnapshots[0].timestamp;
            const preSnapshotReconstruction = reconstructedSeries.filter((point) => point.timestamp < firstSnapshotTs);
            portfolioSeries = mergeValueSeries([preSnapshotReconstruction, rangeSnapshots]);
          } else if (rangeSnapshots.length > 0) {
            // Sparse snapshots: use reconstruction as the daily backbone for the
            // pre-snapshot period only, then raw snapshots for the rest.
            // Limiting reconstruction to before the first snapshot prevents V-shape
            // dips caused by EOD reconstruction points (where historical prices may
            // be unavailable) overlapping with same-day snapshot values.
            const firstRawSnapshotTs = rawRangeHistory[0]?.timestamp ?? Infinity;
            const preSnapshotReconstruction = reconstructedSeries.filter((point) => point.timestamp < firstRawSnapshotTs);
            portfolioSeries = mergeValueSeries([preSnapshotReconstruction, rawRangeHistory]);
          } else {
            // No snapshots in this range window — fall back to EOD reconstruction + today.
            portfolioSeries = mergeValueSeries([historicalBeforeToday, intradaySnapshotTail]);
          }
        }

        if (portfolioSeries.length === 0) {
          portfolioSeries = sampledRawRangeHistory;
        }

        portfolioSeries = appendCurrentValuePoint(portfolioSeries, totalPortfolioValue, now);

        const { points, benchmarkAvailable: nextBenchmarkAvailable } = buildChartSeriesWithBenchmark(
          portfolioSeries,
          benchmarkPrices,
        );

        if (!active) return;

        setPerformanceChartData(points);
        setBenchmarkAvailable(nextBenchmarkAvailable);
        if (!nextBenchmarkAvailable) {
          setShowBenchmark(false);
        }
      } catch (error) {
        console.error('Error building portfolio equity curve:', error);
        if (active) {
          setPerformanceChartData([]);
          setBenchmarkAvailable(false);
          setShowBenchmark(false);
        }
      } finally {
        if (active) {
          setIsChartLoading(false);
        }
      }
    };

    void buildPerformanceSeries();

    return () => {
      active = false;
    };
	  }, [latestSpyPrice, sanitizedPortfolioHistory, selectedTimeRange, totalPortfolioValue, tradeHistory]);

  // Asset allocation data
  const assetAllocationData = [
    { id: 'usStocks', name: 'Stocks', percentage: percentageOfTotal(usStocksValue, totalPortfolioValue), value: usStocksValue, color: '#3b82f6' },
    { id: 'etfs', name: 'ETFs', percentage: percentageOfTotal(etfsValue, totalPortfolioValue), value: etfsValue, color: '#10b981' },
    { id: 'options', name: 'Options', percentage: percentageOfTotal(totalOptionsValue, totalPortfolioValue), value: totalOptionsValue, color: '#f59e0b' },
    { id: 'crypto', name: 'Crypto', percentage: percentageOfTotal(totalCryptoValue, totalPortfolioValue), value: totalCryptoValue, color: '#a78bfa' },
    { id: 'cash', name: 'Cash', percentage: percentageOfTotal(cash, totalPortfolioValue), value: cash, color: '#64748b' },
  ];

  useEffect(() => {
    let mounted = true;

    const fetchTopGainers = async () => {
      setIsTopGainersLoading(true);

      const rangeConfig = getRangeConfig(topGainersRange);
      const intervalStart = getRangeStartDate(topGainersRange);

      try {
        // Only stocks/ETFs go through the standard stock data path
        const stockAndEtfPromises = stockEtfHoldings.map(async (holding) => {
          const assetType = getHoldingAssetType(holding.symbol, holding.description);
          const chart = await fetchStockData(holding.symbol, rangeConfig.range, rangeConfig.interval);
          const closeData = getFirstAndLastClose(chart);
          const purchaseDate = holding.purchaseDate ? new Date(holding.purchaseDate) : null;
          const baselineFromPurchase = purchaseDate && purchaseDate > intervalStart ? holding.purchasePrice : null;
          const baselinePrice = baselineFromPurchase ?? closeData?.first ?? null;
          const dailyMetrics = holdingDailyMetrics[normalizeHoldingSymbol(holding.symbol)];
          const performance = topGainersRange === '1D'
            ? dailyMetrics?.dailyChangePercent ?? 0
            : baselinePrice && baselinePrice > 0
              ? ((holding.currentPrice - baselinePrice) / baselinePrice) * 100
              : 0;

          return {
            id: `holding-${holding.symbol}`,
            symbol: holding.symbol,
            displayName: holding.symbol,
            assetType,
            performance,
            routeSymbol: holding.symbol,
          } satisfies TopGainerEntry;
        });

        // Seeded crypto + user-traded crypto both go through the -USD path
        const cryptoPromises = [
          ...cryptoHoldings.map(async (holding) => {
            const chart = await fetchStockData(`${holding.symbol}-USD`, rangeConfig.range, rangeConfig.interval);
            const closeData = getFirstAndLastClose(chart);
            const purchaseDate = new Date(holding.purchaseDate);
            const baselineFromPurchase = purchaseDate > intervalStart ? holding.purchasePrice : null;
            const baselinePrice = baselineFromPurchase ?? closeData?.first ?? null;
            const dailyMetrics = holdingDailyMetrics[normalizeHoldingSymbol(holding.symbol)];
            const performance = topGainersRange === '1D'
              ? dailyMetrics?.dailyChangePercent ?? 0
              : baselinePrice && baselinePrice > 0
                ? ((holding.currentPrice - baselinePrice) / baselinePrice) * 100
                : 0;

            return {
              id: `crypto-${holding.symbol}`,
              symbol: holding.symbol,
              displayName: holding.symbol,
              assetType: 'Crypto',
              performance,
              routeSymbol: holding.symbol,
            } satisfies TopGainerEntry;
          }),
          ...tradedCryptoHoldings.map(async (holding) => {
            const normalizedSymbol = normalizeHoldingSymbol(holding.symbol);
            const chart = await fetchStockData(`${normalizedSymbol}-USD`, rangeConfig.range, rangeConfig.interval);
            const closeData = getFirstAndLastClose(chart);
            const purchaseDate = holding.purchaseDate ? new Date(holding.purchaseDate) : null;
            const baselineFromPurchase = purchaseDate && purchaseDate > intervalStart ? (holding.avgCost ?? holding.purchasePrice) : null;
            const baselinePrice = baselineFromPurchase ?? closeData?.first ?? null;
            const dailyMetrics = holdingDailyMetrics[normalizeHoldingSymbol(normalizedSymbol)];
            const performance = topGainersRange === '1D'
              ? dailyMetrics?.dailyChangePercent ?? 0
              : baselinePrice && baselinePrice > 0
                ? ((holding.currentPrice - baselinePrice) / baselinePrice) * 100
                : 0;

            return {
              id: `traded-crypto-${normalizedSymbol}`,
              symbol: normalizedSymbol,
              displayName: normalizedSymbol,
              assetType: 'Crypto',
              performance,
              routeSymbol: normalizedSymbol,
            } satisfies TopGainerEntry;
          }),
        ];

        const optionEntries = optionsHoldings.map((holding) => {
          const baselinePrice = holding.avgCost;
          const performance = topGainersRange === '1D'
            ? 0
            : baselinePrice > 0
              ? ((holding.mark - baselinePrice) / baselinePrice) * 100
              : 0;
          const underlying = getOptionUnderlying(holding.contract);

          return {
            id: `option-${holding.contract}`,
            symbol: underlying || holding.contract,
            displayName: holding.contract,
            assetType: 'Option',
            performance,
            routeSymbol: underlying || holding.contract,
          } satisfies TopGainerEntry;
        });

        const resolved = await Promise.all([...stockAndEtfPromises, ...cryptoPromises]);
        const ranked = [...resolved, ...optionEntries]
          .filter((entry) => Number.isFinite(entry.performance))
          .sort((a, b) => b.performance - a.performance)
          .slice(0, 6);

        if (mounted) {
          setTopGainers(ranked);
        }
      } catch (error) {
        console.error('Failed to fetch top gainers:', error);
        if (mounted) {
          setTopGainers([]);
        }
      } finally {
        if (mounted) {
          setIsTopGainersLoading(false);
        }
      }
    };

    fetchTopGainers();
    return () => {
      mounted = false;
    };
  }, [topGainersRange, stockEtfHoldings, cryptoHoldings, tradedCryptoHoldings, optionsHoldings, holdingDailyMetrics]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!topGainersDropdownRef.current?.contains(event.target as Node)) {
        setIsTopGainersMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-100 mb-2">Portfolio</h1>
        <p className="text-slate-400">Account Dashboard</p>
      </div>

      {/* Main Layout: Two Columns */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-4 space-y-6">
          {/* Account Overview Card */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 relative">
            <h2 className="text-slate-100 mb-3 text-base">Account Overview</h2>
            
            <div className="space-y-4">
              <div>
                <div className="text-slate-400 text-sm mb-1">Account Value</div>
                <div className="text-slate-100 text-2xl font-semibold">
                  ${totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>

              <div className="flex items-center justify-between py-3 border-t border-slate-800">
                <span className="text-slate-400 text-sm">Today's Change</span>
                <div className="text-right">
                  <div className={`text-sm ${totalTodayChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {totalTodayChange >= 0 ? '+' : ''}${totalTodayChange.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className={`text-xs ${totalTodayChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    ({formatTodaysChangePercent(displayedTodayChangePercent)})
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between py-3 border-t border-slate-800">
                <span className="text-slate-400 text-sm">Total Return</span>
                <div className="text-right">
                  <div className={`text-sm ${totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {totalReturn >= 0 ? '+' : ''}${totalReturn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className={`text-xs ${totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    ({formatTodaysChangePercent(totalReturnPercent)})
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between py-3 border-t border-slate-800">
                <span className="text-slate-400 text-sm">Cash</span>
                <span className="text-slate-300 text-sm">
                  ${cash.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              <div className="flex items-center justify-between py-3 border-t border-slate-800">
                <span className="text-slate-400 text-sm">Holdings Value</span>
                <span className="text-slate-300 text-sm">
                  ${totalHoldingsValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>

          {/* Asset Allocation and Top Movers - Side by Side */}
          <div className="grid gap-4" style={{ gridTemplateColumns: '1.1fr 1fr' }}>
            {/* Asset Allocation Panel */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col h-full">
              <h2 className="text-slate-100 mb-3 text-sm">Asset Allocation</h2>
              
              <div className="flex-1">
                <InteractiveAssetAllocation data={assetAllocationData} totalValue={totalPortfolioValue} />
              </div>
            </div>

            {/* Top Movers Panel */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col h-full">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-slate-100 text-sm flex items-center gap-2">
                    {topMoversLabel}
                    {isTopGainersLoading && <Loader2 className="w-3.5 h-3.5 text-emerald-500 animate-spin" />}
                  </h2>
                </div>
                <div className="relative" ref={topGainersDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsTopGainersMenuOpen((open) => !open)}
                    className="flex h-7 min-w-[76px] items-center justify-between rounded-lg border border-slate-700 bg-slate-900 pl-3 pr-2 text-xs font-semibold text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800"
                  >
                    <span>{topGainersRange}</span>
                    <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform ${isTopGainersMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isTopGainersMenuOpen && (
                    <div className="absolute right-0 top-full z-[100] mt-1.5 w-[104px] overflow-hidden rounded-lg border border-slate-700 bg-slate-950 p-1.5 shadow-lg">
                      {TOP_GAINERS_RANGES.map((range) => (
                        <button
                          key={range}
                          type="button"
                          onClick={() => {
                            setTopGainersRange(range);
                            setIsTopGainersMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                            topGainersRange === range
                              ? 'bg-slate-800 text-slate-100'
                              : 'text-slate-200 hover:bg-slate-900 hover:text-slate-100'
                          }`}
                        >
                          <span>{range}</span>
                          {topGainersRange === range && <span className="h-2 w-2 rounded-full bg-slate-300" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              
              <div className="space-y-0">
                {topGainers.map((entry) => (
                  <div key={entry.id} className="border-b border-slate-800/50 last:border-b-0">
                    <button
                      onClick={() => navigate(getDashboardDetailPath(entry.routeSymbol, entry.assetType))}
                      className="w-full flex items-center justify-between px-0 py-2.5 hover:bg-slate-800/30 transition-colors cursor-pointer text-left"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-slate-100 text-sm font-semibold truncate">{entry.displayName}</div>
                        <div className="text-slate-500 text-xs mt-0.5">{entry.assetType}</div>
                      </div>
                      <div className={`ml-2 whitespace-nowrap text-sm font-medium ${entry.performance >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {entry.performance >= 0 ? '+' : ''}{entry.performance.toFixed(2)}%
                      </div>
                    </button>
                  </div>
                ))}
                {!isTopGainersLoading && topGainers.length === 0 && (
                  <div className="py-6 text-sm text-slate-500">No holdings available for ranking.</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN - Performance Panel */}
        <div className="lg:col-span-8">
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 h-full flex flex-col gap-6">
            {/* Header with Time Range Controls */}
            <div className="flex items-center justify-between">
              <h2 className="text-slate-100 text-lg font-semibold">Portfolio Equity</h2>
              
              {/* Time Range Selector */}
              <div className="flex gap-1 bg-slate-900/50 rounded-lg p-1 border border-slate-800">
                {timeRanges.map((range) => (
                  <button
                    key={range}
                    onClick={() => setSelectedTimeRange(range)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                      selectedTimeRange === range
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50'
                    }`}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>

            {/* Performance Chart */}
            {showPerformanceEmptyState ? (
              <div className="flex min-h-[320px] flex-1 items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-950/30 px-6 text-center">
                <div className="max-w-md">
                  <div className="text-lg font-semibold text-slate-100">No portfolio activity yet</div>
                  <div className="mt-2 text-sm text-slate-400">
                    Deposit funds or place your first trade to start tracking performance.
                  </div>
                </div>
              </div>
            ) : (
              <PortfolioPerformanceChart
                data={performanceChartData}
                timeRange={selectedTimeRange}
                showBenchmark={showBenchmark}
                benchmarkAvailable={benchmarkAvailable}
                onShowBenchmarkChange={setShowBenchmark}
                isLoading={isChartLoading}
              />
            )}

            {/* Controls */}
            <div className="flex items-center justify-end pt-3 mt-3 border-t border-slate-800">
              <Link to="/dashboard/performance-history">
                <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm transition-all" style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: 'rgba(255, 255, 255, 0.85)'
                }} onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(80, 200, 120, 0.12)';
                  e.currentTarget.style.borderColor = 'rgba(80, 200, 120, 0.35)';
                  e.currentTarget.style.color = '#FFFFFF';
                  e.currentTarget.style.boxShadow = '0 0 0 2px rgba(80, 200, 120, 0.15)';
                }} onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.85)';
                  e.currentTarget.style.boxShadow = 'none';
                }}>
                  <Clock className="w-4 h-4" style={{ opacity: 0.6 }} />
                  View History
                </button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section: Holdings */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-slate-100">Holdings</h2>
        </div>

        {/* Holdings Tabs */}
        <div className="flex gap-1 mb-6 border-b border-slate-800">
          <button
            onClick={() => setSelectedHoldingsTab('stocks')}
            className={`px-4 py-2 text-sm transition-colors border-b-2 ${
              selectedHoldingsTab === 'stocks'
                ? 'border-emerald-500 text-slate-100'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            Stocks & ETFs
          </button>
          <button
            onClick={() => setSelectedHoldingsTab('options')}
            className={`px-4 py-2 text-sm transition-colors border-b-2 ${
              selectedHoldingsTab === 'options'
                ? 'border-emerald-500 text-slate-100'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            Options
          </button>
          <button
            onClick={() => setSelectedHoldingsTab('crypto')}
            className={`px-4 py-2 text-sm transition-colors border-b-2 ${
              selectedHoldingsTab === 'crypto'
                ? 'border-emerald-500 text-slate-100'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            Crypto
          </button>
          <button
            onClick={() => setSelectedHoldingsTab('shorts')}
            className={`px-4 py-2 text-sm transition-colors border-b-2 ${
              selectedHoldingsTab === 'shorts'
                ? 'border-emerald-500 text-slate-100'
                : 'border-transparent text-slate-400 hover:text-slate-100'
            }`}
          >
            Shorts
          </button>
        </div>

        {/* Holdings Table - Stocks & ETFs */}
        {selectedHoldingsTab === 'stocks' && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800/20 border-b border-slate-800">
                  <th className="text-left text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4 pl-2 sticky top-0 bg-slate-900/50">Symbol</th>
                  <th className="text-left text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Description</th>
                  <th className="text-left text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Opened</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Avg Cost</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Current Price</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Qty</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Market Value</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">P/L</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Today</th>
                </tr>
              </thead>
              <tbody>
                {stockEtfHoldings.map((holding, index) => {
                  const holdingMetrics = holdingDailyMetrics[normalizeHoldingSymbol(holding.symbol)];
                  const totalValue = calculateTotalValue(holding.currentPrice, holding.quantity);
                  const gainLoss = holdingMetrics?.unrealizedPnL ?? 0;
                  const gainLossPercent = holdingMetrics?.unrealizedReturnPct ?? 0;
                  const holdingTodayPercent = holdingMetrics?.dailyChangePercent ?? 0;
                  const isPositive = gainLoss >= 0;
                  const openedDateStr = holding.purchaseDate
                    ? new Date(holding.purchaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                    : '-';
                  const openedTimeStr = holding.purchaseDate
                    ? new Date(holding.purchaseDate).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                    : '';

                  return (
                    <tr 
                      key={index} 
                      onClick={() => navigate(getDashboardDetailPath(holding.symbol, getHoldingAssetType(holding.symbol, holding.description)))}
                      className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors cursor-pointer"
                    >
                      <td className="py-3 pr-4 pl-2">
                        <span className="text-slate-100 text-sm font-semibold">{holding.symbol}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-slate-400 text-xs">{holding.description}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <div>
                          <div className="text-slate-300 text-xs">{openedDateStr}</div>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-400 text-sm">${(holdingMetrics?.avgCost ?? holding.avgCost ?? holding.purchasePrice).toFixed(2)}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-300 text-sm">${holding.currentPrice.toFixed(2)}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-300 text-sm">{holding.quantity}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-100 text-sm font-medium">${totalValue.toFixed(2)}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <div className={isPositive ? 'text-emerald-400' : 'text-red-400'}>
                          <div className="text-sm font-medium">{isPositive ? '+' : ''}${Math.abs(gainLoss).toFixed(2)}</div>
                          <div className="text-xs opacity-75">({isPositive ? '+' : ''}{gainLossPercent.toFixed(2)}%)</div>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className={`text-sm font-medium ${holdingTodayPercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {holdingTodayPercent >= 0 ? '+' : ''}{holdingTodayPercent.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Holdings Table - Options */}
        {selectedHoldingsTab === 'options' && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800/20 border-b border-slate-800">
                  <th className="text-left text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4 pl-2 sticky top-0 bg-slate-900/50">Contract</th>
                  <th className="text-left text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Underlying</th>
                  <th className="text-left text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Opened</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Avg Cost</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Mark</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Contracts</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Market Value</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">P/L</th>
                </tr>
              </thead>
              <tbody>
                {optionsHoldings.map((option, index) => {
                  const totalCost = option.avgCost * option.quantity * 100;
                  const currentValue = option.mark * option.quantity * 100;
                  const pl = currentValue - totalCost;
                  const plPercent = totalCost ? (pl / totalCost) * 100 : 0;
                  const isPositive = pl >= 0;
                  const openedDateStr = option.purchaseDate
                    ? new Date(option.purchaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                    : '-';
                  const underlying = option.contract.split(' ')[0] || '';

                  return (
                    <tr 
                      key={index} 
                      onClick={() => navigate(getDashboardDetailPath(underlying, 'Option'))}
                      className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors cursor-pointer"
                    >
                      <td className="py-3 pr-4 pl-2">
                        <span className="text-slate-100 text-sm font-semibold">{option.contract}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-slate-400 text-xs">{underlying}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <div>
                          <div className="text-slate-300 text-xs">{openedDateStr}</div>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-400 text-sm">${option.avgCost.toFixed(2)}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-300 text-sm">${option.mark.toFixed(2)}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-300 text-sm">{option.quantity}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-100 text-sm font-medium">${currentValue.toFixed(2)}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <div className={isPositive ? 'text-emerald-400' : 'text-red-400'}>
                          <div className="text-sm font-medium">{isPositive ? '+' : ''}${Math.abs(pl).toFixed(2)}</div>
                          <div className="text-xs opacity-75">({isPositive ? '+' : ''}{plPercent.toFixed(2)}%)</div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Holdings Table - Crypto */}
        {selectedHoldingsTab === 'crypto' && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800/20 border-b border-slate-800">
                  <th className="text-left text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4 pl-2 sticky top-0 bg-slate-900/50">Asset</th>
                  <th className="text-left text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Description</th>
                  <th className="text-left text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Opened</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Avg Cost</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Mark</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Units</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Market Value</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">P/L</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">24h</th>
                </tr>
              </thead>
              <tbody>
                {allCryptoHoldings.map((crypto, index) => {
                  const totalValue = crypto.currentPrice * crypto.quantity;
                  const cryptoMetrics = holdingDailyMetrics[normalizeHoldingSymbol(crypto.symbol)];
                  const pl = cryptoMetrics?.unrealizedPnL ?? 0;
                  const plPercent = cryptoMetrics?.unrealizedReturnPct ?? 0;
                  const isPositive = pl >= 0;
                  const change24hPercent = cryptoMetrics?.dailyChangePercent ?? crypto.todayChange ?? 0;
                  const is24hPositive = change24hPercent >= 0;
                  const openedDateStr = crypto.purchaseDate
                    ? new Date(crypto.purchaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                    : '-';

                  return (
                    <tr 
                      key={index} 
                      onClick={() => navigate(getDashboardDetailPath(crypto.symbol, 'Crypto'))}
                      className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors cursor-pointer"
                    >
                      <td className="py-3 pr-4 pl-2">
                        <span className="text-slate-100 text-sm font-semibold">{crypto.symbol}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-slate-400 text-xs">{crypto.description}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <div>
                          <div className="text-slate-300 text-xs">{openedDateStr}</div>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-400 text-sm">${(cryptoMetrics?.avgCost ?? crypto.purchasePrice).toFixed(2)}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-300 text-sm">${crypto.currentPrice.toFixed(2)}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-300 text-sm">{crypto.quantity}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-100 text-sm font-medium">${totalValue.toFixed(2)}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <div className={isPositive ? 'text-emerald-400' : 'text-red-400'}>
                          <div className="text-sm font-medium">{isPositive ? '+' : ''}${Math.abs(pl).toFixed(2)}</div>
                          <div className="text-xs opacity-75">({isPositive ? '+' : ''}{plPercent.toFixed(2)}%)</div>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className={`text-sm font-medium ${is24hPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                          {is24hPositive ? '+' : ''}{change24hPercent.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Holdings Table - Shorts */}
        {selectedHoldingsTab === 'shorts' && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800/20 border-b border-slate-800">
                  <th className="text-left text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4 pl-2 sticky top-0 bg-slate-900/50">Symbol</th>
                  <th className="text-left text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Description</th>
                  <th className="text-left text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Opened</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Short Price</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Current Price</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Shares</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">Market Value</th>
                  <th className="text-right text-slate-400 text-xs font-semibold uppercase pb-3 pt-3 pr-4">P/L</th>
                </tr>
              </thead>
              <tbody>
                {shortsHoldings.map((short, index) => {
                  const totalValue = short.currentPrice * short.quantity;
                  const pl = (short.avgShortPrice - short.currentPrice) * short.quantity;
                  const plPercent = short.avgShortPrice ? ((short.avgShortPrice - short.currentPrice) / short.avgShortPrice) * 100 : 0;
                  const isPositive = pl >= 0;
                  const openedDateStr = short.purchaseDate
                    ? new Date(short.purchaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                    : '-';

                  return (
                    <tr 
                      key={index} 
                      onClick={() => navigate(getDashboardDetailPath(short.symbol, 'Stock'))}
                      className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors cursor-pointer"
                    >
                      <td className="py-3 pr-4 pl-2">
                        <span className="text-slate-100 text-sm font-semibold">{short.symbol}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-slate-400 text-xs">{short.description}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <div>
                          <div className="text-slate-300 text-xs">{openedDateStr}</div>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-400 text-sm">${short.avgShortPrice.toFixed(2)}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-300 text-sm">${short.currentPrice.toFixed(2)}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-300 text-sm">{short.quantity}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-100 text-sm font-medium">${totalValue.toFixed(2)}</span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <div className={isPositive ? 'text-emerald-400' : 'text-red-400'}>
                          <div className="text-sm font-medium">{isPositive ? '+' : ''}${Math.abs(pl).toFixed(2)}</div>
                          <div className="text-xs opacity-75">({isPositive ? '+' : ''}{plPercent.toFixed(2)}%)</div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Order History Button */}
        <div className="flex justify-end mt-6 pt-6 border-t border-slate-800">
          <Link to="/trade?tab=orders">
            <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm transition-all" style={{
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: 'rgba(255, 255, 255, 0.85)'
            }} onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(80, 200, 120, 0.12)';
              e.currentTarget.style.borderColor = 'rgba(80, 200, 120, 0.35)';
              e.currentTarget.style.color = '#FFFFFF';
              e.currentTarget.style.boxShadow = '0 0 0 2px rgba(80, 200, 120, 0.15)';
            }} onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.85)';
              e.currentTarget.style.boxShadow = 'none';
            }}>
              <Clock className="w-4 h-4" style={{ opacity: 0.6 }} />
              Order History
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
