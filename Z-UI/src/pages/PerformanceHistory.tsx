import { ArrowLeft, Download } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/ui/button';
import { useTradeContext } from '../context/TradeContext';

type HistoryFilterValue = 'all' | 'last-6-months' | `month:${string}` | `year:${string}`;
type SortOrder = 'desc' | 'asc';

interface DailyHistoryRow {
  dateKey: string;
  timestamp: number;
  portfolioEquity: number;
  dailyChange: number | null;
  dailyChangePct: number | null;
  cash: number | null;
  stocks: number | null;
  options: number | null;
  crypto: number | null;
}

function formatDateLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
}

function formatMonthOption(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

function formatCurrency(value: number | null): string {
  if (!Number.isFinite(value)) return '—';
  return `$${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPercent(value: number | null): string {
  if (!Number.isFinite(value)) return '—';
  return `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`;
}

function getRowAccentClass(value: number | null): string {
  if (!Number.isFinite(value) || value === 0) return 'text-slate-300';
  return Number(value) > 0 ? 'text-emerald-400' : 'text-red-400';
}

function toDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toMonthKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function PerformanceHistory() {
  const { portfolioHistory } = useTradeContext();
  const [selectedFilter, setSelectedFilter] = useState<HistoryFilterValue>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const dailySnapshots = useMemo(() => {
    const latestPerDay = new Map<string, typeof portfolioHistory[number]>();

    portfolioHistory.forEach((entry) => {
      latestPerDay.set(toDateKey(entry.timestamp), entry);
    });

    return Array.from(latestPerDay.entries())
      .map(([dateKey, entry]) => ({
        dateKey,
        timestamp: entry.timestamp,
        value: entry.value,
        cash: Number.isFinite(entry.cash) ? Number(entry.cash) : null,
        stocks: Number.isFinite(entry.stocks) ? Number(entry.stocks) : null,
        options: Number.isFinite(entry.options) ? Number(entry.options) : null,
        crypto: Number.isFinite(entry.crypto) ? Number(entry.crypto) : null,
      }))
      .sort((left, right) => left.timestamp - right.timestamp);
  }, [portfolioHistory]);

  const monthOptions = useMemo(
    () => Array.from(new Map(
      dailySnapshots.map((row) => [toMonthKey(row.timestamp), formatMonthOption(row.timestamp)]),
    ).entries()).reverse(),
    [dailySnapshots],
  );

  const yearOptions = useMemo(
    () => Array.from(new Set(dailySnapshots.map((row) => String(new Date(row.timestamp).getFullYear())))).sort((a, b) => Number(b) - Number(a)),
    [dailySnapshots],
  );

  const filteredRows = useMemo<DailyHistoryRow[]>(() => {
    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const visibleSnapshots = dailySnapshots.filter((row) => {
      if (selectedFilter === 'all') return true;
      if (selectedFilter === 'last-6-months') {
        return row.timestamp >= sixMonthsAgo.getTime();
      }
      if (selectedFilter.startsWith('month:')) {
        return toMonthKey(row.timestamp) === selectedFilter.slice('month:'.length);
      }
      if (selectedFilter.startsWith('year:')) {
        return String(new Date(row.timestamp).getFullYear()) === selectedFilter.slice('year:'.length);
      }
      return true;
    });

    return visibleSnapshots.map((row, index) => {
      const previousRow = visibleSnapshots[index - 1];
      const dailyChange = previousRow ? row.value - previousRow.value : null;
      const dailyChangePct = previousRow && previousRow.value > 0
        ? (dailyChange as number / previousRow.value) * 100
        : null;

      return {
        dateKey: row.dateKey,
        timestamp: row.timestamp,
        portfolioEquity: row.value,
        dailyChange,
        dailyChangePct,
        cash: row.cash,
        stocks: row.stocks,
        options: row.options,
        crypto: row.crypto,
      };
    });
  }, [dailySnapshots, selectedFilter]);

  const sortedRows = useMemo(
    () => [...filteredRows].sort((a, b) => (
      sortOrder === 'desc'
        ? b.timestamp - a.timestamp
        : a.timestamp - b.timestamp
    )),
    [filteredRows, sortOrder],
  );

  const handleDownloadCSV = () => {
    const headers = ['Date', 'Portfolio Equity', 'Daily Change', 'Daily Change %', 'Cash', 'Stocks', 'Options', 'Crypto'];
    const csvRows = filteredRows.map((row) => [
      formatDateLabel(row.timestamp),
      row.portfolioEquity.toFixed(2),
      row.dailyChange === null ? '—' : row.dailyChange.toFixed(2),
      row.dailyChangePct === null ? '—' : row.dailyChangePct.toFixed(2),
      row.cash === null ? '—' : row.cash.toFixed(2),
      row.stocks === null ? '—' : row.stocks.toFixed(2),
      row.options === null ? '—' : row.options.toFixed(2),
      row.crypto === null ? '—' : row.crypto.toFixed(2),
    ]);

    const csvContent = [
      headers.join(','),
      ...csvRows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `portfolio_equity_history_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-2 text-slate-400 hover:text-slate-100 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm">Back to Portfolio</span>
      </Link>

      <div>
        <h1 className="text-slate-100 mb-2">Portfolio Equity History</h1>
        <p className="text-slate-400">Daily snapshots of portfolio equity and asset composition.</p>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="history-range" className="block text-slate-400 text-xs mb-2">
                Period
              </label>
              <select
                id="history-range"
                value={selectedFilter}
                onChange={(event) => setSelectedFilter(event.target.value as HistoryFilterValue)}
                className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-slate-500"
              >
                <optgroup label="Month">
                  {monthOptions.map(([value, label]) => (
                    <option key={`month-${value}`} value={`month:${value}`}>
                      {label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Quick Range">
                  <option value="last-6-months">Last 6 Months</option>
                  <option value="all">All Time</option>
                </optgroup>
                <optgroup label="Year">
                  {yearOptions.map((year) => (
                    <option key={`year-${year}`} value={`year:${year}`}>
                      {year}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div>
              <label htmlFor="history-sort" className="block text-slate-400 text-xs mb-2">
                Sort
              </label>
              <select
                id="history-sort"
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value as SortOrder)}
                className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-slate-500"
              >
                <option value="desc">Newest → Oldest</option>
                <option value="asc">Oldest → Newest</option>
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left text-slate-400 text-xs font-normal pb-3 pr-4">Date</th>
                <th className="text-right text-slate-400 text-xs font-normal pb-3 pr-4">Portfolio Equity</th>
                <th className="text-right text-slate-400 text-xs font-normal pb-3 pr-4">Daily Change</th>
                <th className="text-right text-slate-400 text-xs font-normal pb-3 pr-4">Daily Change %</th>
                <th className="text-right text-slate-400 text-xs font-normal pb-3 pr-4">Cash</th>
                <th className="text-right text-slate-400 text-xs font-normal pb-3 pr-4">Stocks</th>
                <th className="text-right text-slate-400 text-xs font-normal pb-3 pr-4">Options</th>
                <th className="text-right text-slate-400 text-xs font-normal pb-3 pr-4">Crypto</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.length > 0 ? (
                sortedRows.map((row) => (
                  <tr key={row.dateKey} className="border-b border-slate-800/50">
                    <td className="py-3 pr-4">
                      <span className="text-slate-300 text-sm">{formatDateLabel(row.timestamp)}</span>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span className="text-slate-100 text-sm font-semibold">{formatCurrency(row.portfolioEquity)}</span>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span className={`text-sm ${getRowAccentClass(row.dailyChange)}`}>{formatCurrency(row.dailyChange)}</span>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span className={`text-sm ${getRowAccentClass(row.dailyChangePct)}`}>{formatPercent(row.dailyChangePct)}</span>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span className="text-slate-300 text-sm">{formatCurrency(row.cash)}</span>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span className="text-slate-300 text-sm">{formatCurrency(row.stocks)}</span>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span className="text-slate-300 text-sm">{formatCurrency(row.options)}</span>
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <span className="text-slate-300 text-sm">{formatCurrency(row.crypto)}</span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-sm text-slate-500">
                    No performance history is available for this account yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end mt-6 pt-6 border-t border-slate-800">
          <Button
            onClick={handleDownloadCSV}
            disabled={sortedRows.length === 0}
            className="px-3 py-1.5 rounded bg-slate-900/70 border border-slate-600 text-sm text-slate-200 hover:bg-slate-800/80 disabled:opacity-40 whitespace-nowrap"
          >
            <Download className="w-4 h-4 mr-1.5" />
            Download
          </Button>
        </div>
      </div>
    </div>
  );
}
