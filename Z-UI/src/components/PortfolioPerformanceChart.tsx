import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Eye, EyeOff } from 'lucide-react';
import {
  formatPortfolioChartTick,
  formatPortfolioTooltipTimestamp,
  type PortfolioChartPoint,
  type PortfolioPerformanceRange,
} from '../services/portfolioPerformance';
import { isUsablePrice } from '../services/assetPricing';

interface PortfolioPerformanceChartProps {
  data: PortfolioChartPoint[];
  timeRange: PortfolioPerformanceRange;
  showBenchmark: boolean;
  benchmarkAvailable: boolean;
  onShowBenchmarkChange?: (show: boolean) => void;
  isLoading?: boolean;
}

function formatCurrencyValue(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 1000 ? 0 : 2,
  }).format(value);
}

function formatCurrencyAxisTick(value: number): string {
  if (!Number.isFinite(value)) return '$0';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

export function PortfolioPerformanceChart({
  data,
  timeRange,
  showBenchmark,
  benchmarkAvailable,
  onShowBenchmarkChange,
  isLoading = false,
}: PortfolioPerformanceChartProps) {
  const yAxisDomain = useMemo(() => {
    if (data.length === 0) {
      return [0, 100] as const;
    }

    const values = data.flatMap((point) => (
      showBenchmark && benchmarkAvailable && isUsablePrice(point.benchmark)
        ? [point.portfolio, Number(point.benchmark)]
        : [point.portfolio]
    ));
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = maxValue - minValue;
    const padding = range > 0 ? range * 0.08 : Math.max(maxValue * 0.04, 100);

    return [
      Math.max(0, Math.floor(minValue - padding)),
      Math.ceil(maxValue + padding),
    ] as const;
  }, [benchmarkAvailable, data, showBenchmark]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) {
      return null;
    }

    const point = payload[0]?.payload as PortfolioChartPoint | undefined;
    if (!point) return null;

    const benchmarkPayload = payload.find((entry: any) => entry.dataKey === 'benchmark');

    return (
      <div className="bg-slate-950 border border-slate-700 rounded-lg p-3 shadow-lg">
        <p className="text-slate-300 text-sm font-medium mb-2">
          {formatPortfolioTooltipTimestamp(point.timestamp, timeRange)}
        </p>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500"></div>
            <span className="text-slate-400 text-xs">Portfolio Equity:</span>
            <span className="text-blue-400 text-xs font-semibold">
              {formatCurrencyValue(Number(point.portfolio))}
            </span>
          </div>
          {showBenchmark && benchmarkAvailable && isUsablePrice(benchmarkPayload?.value) && (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-slate-400"></div>
              <span className="text-slate-400 text-xs">S&P 500:</span>
              <span className="text-slate-300 text-xs font-semibold">
                {formatCurrencyValue(Number(benchmarkPayload.value))}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const hasLimitedHistory = data.length > 0 && data.length <= 2;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0 bg-gradient-to-b from-slate-800/30 to-slate-900/20 border border-slate-700/50 rounded-lg p-4 relative">
        {isLoading && (
          <div className="absolute inset-0 bg-slate-900/40 flex items-center justify-center rounded-lg z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-slate-700 border-t-emerald-500 rounded-full animate-spin"></div>
              <span className="text-slate-400 text-xs">Loading chart...</span>
            </div>
          </div>
        )}
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            No Portfolio Equity data available yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 15, left: 0, bottom: 30 }}>
              <CartesianGrid
                strokeDasharray="0"
                stroke="#475569"
                opacity={0.25}
                vertical={false}
                horizontalPoints={undefined}
              />
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={['dataMin', 'dataMax']}
                stroke="#64748b"
                tick={{ fill: '#64748b', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) => formatPortfolioChartTick(Number(value), timeRange)}
                minTickGap={24}
              />
              <YAxis
                stroke="#64748b"
                tick={{ fill: '#64748b', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) => formatCurrencyAxisTick(Number(value))}
                width={72}
                domain={yAxisDomain}
                type="number"
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="linear"
                dataKey="portfolio"
                name="Portfolio Equity"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#3b82f6' }}
                isAnimationActive
                animationBegin={0}
                animationDuration={450}
                animationEasing="ease-in-out"
              />
              {showBenchmark && benchmarkAvailable && (
                <Line
                  type="linear"
                  dataKey="benchmark"
                  name="S&P 500"
                  stroke="#94a3b8"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  activeDot={{ r: 3, fill: '#94a3b8' }}
                  connectNulls={false}
                  isAnimationActive
                  animationBegin={0}
                  animationDuration={450}
                  animationEasing="ease-in-out"
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
        {hasLimitedHistory && !isLoading && (
          <div className="pointer-events-none absolute bottom-3 left-4 text-xs text-slate-500">
            Showing the history currently available for this account.
          </div>
        )}
      </div>

      <div className="flex items-center gap-6 mt-3 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 bg-blue-500 rounded-full"></div>
          <span className="text-slate-300">Portfolio Equity</span>
        </div>

        {benchmarkAvailable && (
          <button
            onClick={() => onShowBenchmarkChange?.(!showBenchmark)}
            className="flex items-center gap-2 cursor-pointer transition-all hover:opacity-80 active:scale-95"
            title={showBenchmark ? 'Hide S&P 500 benchmark' : 'Show S&P 500 benchmark'}
          >
            {showBenchmark ? (
              <Eye className="w-4 h-4 text-slate-400" />
            ) : (
              <EyeOff className="w-4 h-4 text-slate-500" />
            )}
            <span className={`text-sm font-medium transition-colors ${showBenchmark ? 'text-slate-300' : 'text-slate-500'}`}>
              S&P 500
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
