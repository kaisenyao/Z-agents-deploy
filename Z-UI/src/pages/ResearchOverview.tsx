import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { ChevronsLeft, ChevronsRight, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { useNavigate } from 'react-router';
import { fetchLiveQuoteMetadata, fetchStockData, fetchYahooQuotePageMetrics, fetchYahooQuoteSummary, fetchYahooQuotes } from '../lib/api';
import { fetchMarketScreener, searchMarketSymbols } from '../lib/marketGateway';
import { useLatestQuotes } from '../context/MarketQuoteContext';
import { getResearchAssetDetailPath } from '../services/assetRouting';

type AssetCategory = 'stocks' | 'etfs' | 'options' | 'crypto';
type Rating = 'Buy' | 'Neutral' | 'Sell';
type StockScreenerTab = 'most_actives' | 'day_gainers' | 'user_selected';
type ScreenerCategory = AssetCategory;

interface Asset {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: string;
  marketCap: string;
  peRatio: string;
  sparklineData: number[];
}

interface OptionScreenerRow {
  symbol: string;
  name: string;
  underlyingSymbol: string;
  strike: number | null;
  expirationDate: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
}

const STOCK_SCREENER_TABS: { key: StockScreenerTab; label: string }[] = [
  { key: 'most_actives', label: 'Most Active' },
  { key: 'day_gainers', label: 'Top Gainers' },
  { key: 'user_selected', label: 'User Selected' },
];

const PORTFOLIO_DRAFT_ITEMS_KEY = 'research_portfolio_items';
const PORTFOLIO_DRAFT_NAME_KEY = 'research_portfolio_name';
const PORTFOLIO_DRAFT_BUDGET_KEY = 'research_portfolio_budget';
const STOCK_SCREENER_USER_SELECTED_KEY = 'stock_screener_user_selected';
const OPTIONS_SCREENER_USER_SELECTED_KEY = 'options_screener_user_selected';
const ETF_SCREENER_USER_SELECTED_KEY = 'etf_screener_user_selected';
const CRYPTO_SCREENER_USER_SELECTED_KEY = 'crypto_screener_user_selected';

interface PortfolioItem {
  ticker: string;
  name: string;
  amount: number; // Dollar amount
}

interface StockSearchResult {
  symbol: string;
  name: string;
  exchange?: string;
  quoteType?: string;
}

const SCREENER_COLUMN_WIDTHS = {
  actions: '1%',
  symbol: '8%',
  name: '28%',
  price: '10%',
  change: '10%',
  changePercent: '10%',
  volume: '10%',
  marketCap: '10%',
  peRatio: '12%',
  add: '1%',
} as const;

const OPTIONS_SCREENER_COLUMN_WIDTHS = {
  actions: '1%',
  symbol: '12%',
  name: '21%',
  underlyingSymbol: '9%',
  strike: '8%',
  expirationDate: '10%',
  price: '7%',
  change: '7%',
  changePercent: '7%',
  bid: '6%',
  ask: '6%',
  volume: '8%',
  openInterest: '8%',
  add: '1%',
} as const;

const SCREENER_ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;

interface TablePaginationProps {
  currentPage: number;
  endRow: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  rowsPerPage: number;
  startRow: number;
  totalPages: number;
  totalRows: number;
}

function TablePagination({
  currentPage,
  endRow,
  onPageChange,
  onRowsPerPageChange,
  rowsPerPage,
  startRow,
  totalPages,
  totalRows,
}: TablePaginationProps) {
  const isFirstPage = currentPage <= 1;
  const isLastPage = currentPage >= totalPages;
  const rangeLabel = totalRows === 0 ? '0 of 0' : `${startRow}-${endRow} of ${totalRows}`;

  return (
    <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-slate-800 text-sm text-slate-400">
      <label className="flex items-center gap-2">
        <span>Rows per page:</span>
        <select
          value={rowsPerPage}
          onChange={(e) => onRowsPerPageChange(Number(e.target.value))}
          className="bg-slate-800/50 border border-slate-700 rounded px-2 py-1 text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
        >
          {SCREENER_ROWS_PER_PAGE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <span className="min-w-[84px] text-right">{rangeLabel}</span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(1)}
          disabled={isFirstPage}
          className="h-8 w-8 p-0 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronsLeft className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={isFirstPage}
          className="h-8 px-2 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Prev
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={isLastPage}
          className="h-8 px-2 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Next
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onPageChange(totalPages)}
          disabled={isLastPage}
          className="h-8 w-8 p-0 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronsRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function getSavedUserSelectedSymbols(category: AssetCategory): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  if (category === 'stocks') {
    const saved = localStorage.getItem(STOCK_SCREENER_USER_SELECTED_KEY);
    return saved ? JSON.parse(saved) : [];
  }

  if (category === 'options') {
    const saved = localStorage.getItem(OPTIONS_SCREENER_USER_SELECTED_KEY);
    return saved ? JSON.parse(saved) : [];
  }

  if (category === 'etfs') {
    const saved = localStorage.getItem(ETF_SCREENER_USER_SELECTED_KEY);
    return saved ? JSON.parse(saved) : [];
  }

  if (category === 'crypto') {
    const saved = localStorage.getItem(CRYPTO_SCREENER_USER_SELECTED_KEY);
    return saved ? JSON.parse(saved) : [];
  }

  return [];
}

function createPlaceholderAsset(symbol: string): Asset {
  return {
    ticker: symbol,
    name: symbol,
    price: 0,
    change: 0,
    changePercent: 0,
    volume: '-',
    marketCap: '-',
    peRatio: '-',
    sparklineData: [],
  };
}

export function ResearchOverview() {
  const navigate = useNavigate();
  const [category, setCategory] = useState<AssetCategory>(() => {
    const saved = localStorage.getItem('research_category');
    return (saved as AssetCategory) || 'stocks';
  });
  const [sortBy, setSortBy] = useState<'marketCap' | 'volume' | 'change'>('marketCap');
  const [stockScreenerTab, setStockScreenerTab] = useState<StockScreenerTab>('most_actives');
  const [stockScreenerData, setStockScreenerData] = useState<Asset[]>([]);
  const [optionsScreenerData, setOptionsScreenerData] = useState<OptionScreenerRow[]>([]);
  const [userSelectedCardData, setUserSelectedCardData] = useState<Asset[]>(() =>
    getSavedUserSelectedSymbols(category).map((symbol) => createPlaceholderAsset(symbol))
  );
  const [stockSearchQuery, setStockSearchQuery] = useState('');
  const [isAddingStock, setIsAddingStock] = useState(false);
  const [stockSearchResults, setStockSearchResults] = useState<StockSearchResult[]>([]);
  const [isSearchingStocks, setIsSearchingStocks] = useState(false);
  const [screenerCurrentPage, setScreenerCurrentPage] = useState(1);
  const [screenerRowsPerPage, setScreenerRowsPerPage] = useState<number>(25);
  const [draggedUserSymbol, setDraggedUserSymbol] = useState<string | null>(null);
  const [dragOverUserSymbol, setDragOverUserSymbol] = useState<string | null>(null);
  const [userSelectedStocks, setUserSelectedStocks] = useState<string[]>(() => {
    const saved = localStorage.getItem(STOCK_SCREENER_USER_SELECTED_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [userSelectedOptions, setUserSelectedOptions] = useState<string[]>(() => {
    const saved = localStorage.getItem(OPTIONS_SCREENER_USER_SELECTED_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [userSelectedEtfs, setUserSelectedEtfs] = useState<string[]>(() => {
    const saved = localStorage.getItem(ETF_SCREENER_USER_SELECTED_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [userSelectedCrypto, setUserSelectedCrypto] = useState<string[]>(() => {
    const saved = localStorage.getItem(CRYPTO_SCREENER_USER_SELECTED_KEY);
    return saved ? JSON.parse(saved) : [];
  });
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>(() => {
    const saved = localStorage.getItem(PORTFOLIO_DRAFT_ITEMS_KEY);
    if (!saved) return [];

    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [portfolioName, setPortfolioName] = useState(() => {
    return localStorage.getItem(PORTFOLIO_DRAFT_NAME_KEY) || 'Untitled Portfolio';
  });
  const [isEditingName, setIsEditingName] = useState(false);
  const [portfolioBudget, setPortfolioBudget] = useState(() => {
    const saved = localStorage.getItem(PORTFOLIO_DRAFT_BUDGET_KEY);
    if (!saved) return 10000;
    const parsed = Number(saved);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10000;
  }); // Required, not optional
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const optionsScreenerCacheRef = useRef<Partial<Record<Exclude<StockScreenerTab, 'user_selected'>, OptionScreenerRow[]>>>({});
  const optionsScreenerRequestRef = useRef<Partial<Record<Exclude<StockScreenerTab, 'user_selected'>, Promise<OptionScreenerRow[]>>>>({});

  // Persist category selection
  useEffect(() => {
    localStorage.setItem('research_category', category);
  }, [category]);

  // Live state for market data
  const [isLoadingLivePrices, setIsLoadingLivePrices] = useState(false);
  const [stocksData, setStocksData] = useState<Asset[]>([]);
  const [etfsData, setEtfsData] = useState<Asset[]>([]);
  const [cryptoData, setCryptoData] = useState<Asset[]>([]);
  const [topCardLiveQuotes, setTopCardLiveQuotes] = useState<Record<string, {
    price?: number;
    change?: number;
    changePercent?: number;
    volume?: number;
  }>>({});
  const [topCardSparklineData, setTopCardSparklineData] = useState<Record<string, number[]>>({});

  useEffect(() => {
    localStorage.setItem(STOCK_SCREENER_USER_SELECTED_KEY, JSON.stringify(userSelectedStocks));
  }, [userSelectedStocks]);

  useEffect(() => {
    localStorage.setItem(OPTIONS_SCREENER_USER_SELECTED_KEY, JSON.stringify(userSelectedOptions));
  }, [userSelectedOptions]);

  useEffect(() => {
    localStorage.setItem(ETF_SCREENER_USER_SELECTED_KEY, JSON.stringify(userSelectedEtfs));
  }, [userSelectedEtfs]);

  useEffect(() => {
    localStorage.setItem(CRYPTO_SCREENER_USER_SELECTED_KEY, JSON.stringify(userSelectedCrypto));
  }, [userSelectedCrypto]);

  useEffect(() => {
    localStorage.setItem(PORTFOLIO_DRAFT_ITEMS_KEY, JSON.stringify(portfolioItems));
    localStorage.setItem(PORTFOLIO_DRAFT_NAME_KEY, portfolioName);
    localStorage.setItem(PORTFOLIO_DRAFT_BUDGET_KEY, String(portfolioBudget));
  }, [portfolioItems, portfolioName, portfolioBudget]);

  useEffect(() => {
    setTopCardSparklineData({});
  }, [category]);

  useEffect(() => {
    setTopCardLiveQuotes({});
  }, [category]);

  const getNumericValue = (value: any): number => {
    if (typeof value === 'number') return value;
    if (value && typeof value === 'object' && typeof value.raw === 'number') return value.raw;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/,/g, ''));
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  };

  const getOptionalNumericValue = (value: any): number | null => {
    if (value === undefined || value === null || value === '') return null;
    const numericValue = getNumericValue(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  };

  const formatCompactNumber = (value?: any) => {
    const numericValue = getNumericValue(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return '-';
    if (value === undefined || value === null || Number.isNaN(value)) return '-';
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(numericValue);
  };

  const formatQuoteVolume = (value?: number) => {
    if (!Number.isFinite(value) || Number(value) <= 0) return '-';
    return formatCompactNumber(Number(value));
  };

  const formatOptionDate = (value?: string | number | null) => {
    if (!value) return '-';

    const date = typeof value === 'number'
      ? new Date(value < 1_000_000_000_000 ? value * 1000 : value)
      : new Date(value);

    if (Number.isNaN(date.getTime())) return '-';

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };

  const formatOptionMoney = (value: number | null | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    return `$${value.toFixed(2)}`;
  };

  const formatOptionChange = (value: number | null | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
  };

  const formatOptionPercent = (value: number | null | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  };

  const formatOptionCount = (value: number | null | undefined) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
    return new Intl.NumberFormat('en-US').format(value);
  };

  const getRatingFromChange = (changePercent: number): Rating => {
    if (changePercent >= 1) return 'Buy';
    if (changePercent <= -1) return 'Sell';
    return 'Neutral';
  };

  const getScreenerCategory = (cat: ScreenerCategory): Exclude<ScreenerCategory, 'options'> => {
    return cat === 'options' ? 'stocks' : cat;
  };

  const isScreenerCategory = (cat: AssetCategory): cat is ScreenerCategory => {
    return cat === 'stocks' || cat === 'etfs' || cat === 'options' || cat === 'crypto';
  };

  const normalizeSearchSymbol = (symbol: string, targetCategory: ScreenerCategory): string => {
    const resolvedCategory = getScreenerCategory(targetCategory);
    const upper = symbol.trim().toUpperCase();
    return resolvedCategory === 'crypto' ? upper.replace(/-USD$/i, '') : upper;
  };

  const getTopCardSparklineLookupSymbol = (symbol: string, targetCategory: ScreenerCategory): string => {
    const resolvedCategory = getScreenerCategory(targetCategory);
    const normalized = normalizeSearchSymbol(symbol, targetCategory);
    return resolvedCategory === 'crypto' ? `${normalized}-USD` : normalized;
  };

  const isYahooResultForCategory = (item: any, targetCategory: ScreenerCategory): boolean => {
    const resolvedCategory = getScreenerCategory(targetCategory);
    const quoteType = String(item?.quoteType || '').toUpperCase();
    const symbol = String(item?.symbol || '').toUpperCase();

    if (resolvedCategory === 'stocks') return quoteType === 'EQUITY';
    if (resolvedCategory === 'etfs') return quoteType === 'ETF';
    return quoteType === 'CRYPTOCURRENCY' || quoteType === 'CURRENCY' || symbol.endsWith('-USD');
  };

  const isQuoteForCategory = (quote: any, targetCategory: ScreenerCategory): boolean => {
    const resolvedCategory = getScreenerCategory(targetCategory);
    const quoteType = String(quote?.quoteType || '').toUpperCase();
    const symbol = String(quote?.symbol || '').toUpperCase();

    if (resolvedCategory === 'stocks') return quoteType === 'EQUITY';
    if (resolvedCategory === 'etfs') return quoteType === 'ETF';
    return quoteType === 'CRYPTOCURRENCY' || quoteType === 'CURRENCY' || symbol.endsWith('-USD');
  };

  const getResearchDetailPathForCategory = (ticker: string, targetCategory: AssetCategory): string => {
    if (targetCategory === 'options') {
      return `/research/options/${encodeURIComponent(ticker)}`;
    }

    return getResearchAssetDetailPath(ticker, targetCategory === 'crypto' ? 'crypto' : 'stock');
  };

  const getUserSelectedSymbols = (cat: ScreenerCategory): string[] => {
    if (cat === 'options') return userSelectedOptions;

    switch (getScreenerCategory(cat)) {
      case 'stocks': return userSelectedStocks;
      case 'etfs': return userSelectedEtfs;
      case 'crypto': return userSelectedCrypto;
      default: return [];
    }
  };

  const getCategoryBaseData = (cat: ScreenerCategory): Asset[] => {
    switch (getScreenerCategory(cat)) {
      case 'stocks': return stocksData;
      case 'etfs': return etfsData;
      case 'crypto': return cryptoData;
      default: return stocksData;
    }
  };

  const toFallbackAsset = (symbol: string, sourceData: Asset[]): Asset => {
    const local = sourceData.find((item) => item.ticker.toUpperCase() === symbol.toUpperCase());
    if (local) return local;

    return {
      ticker: symbol,
      name: symbol,
      price: 0,
      change: 0,
      changePercent: 0,
      volume: '-',
      marketCap: '-',
      peRatio: '--',
      sparklineData: [],
    };
  };

  const getPredefinedScreenerId = (
    targetCategory: ScreenerCategory,
    tab: Exclude<StockScreenerTab, 'user_selected'>
  ): string => {
    if (targetCategory === 'options') {
      return tab === 'most_actives' ? 'most_actives_options' : 'day_gainers_options';
    }

    const resolvedCategory = getScreenerCategory(targetCategory);
    if (resolvedCategory === 'stocks') return tab;
    if (resolvedCategory === 'etfs') return tab === 'most_actives' ? 'most_actives_etfs' : 'day_gainers_etfs';
    return tab === 'most_actives' ? 'most_actives_cryptocurrencies' : 'day_gainers_cryptocurrencies';
  };

  const getCachedOptionRows = (tab: Exclude<StockScreenerTab, 'user_selected'>): OptionScreenerRow[] => {
    return optionsScreenerCacheRef.current[tab] || [];
  };

  const setCachedOptionRows = (
    tab: Exclude<StockScreenerTab, 'user_selected'>,
    rows: OptionScreenerRow[]
  ) => {
    optionsScreenerCacheRef.current[tab] = rows;
  };

  const mergeOptionRowsBySymbol = (...rowSets: OptionScreenerRow[][]): OptionScreenerRow[] => {
    const dedupedRows = new Map<string, OptionScreenerRow>();

    rowSets.flat().forEach((row) => {
      if (!row.symbol || dedupedRows.has(row.symbol)) return;
      dedupedRows.set(row.symbol, row);
    });

    return [...dedupedRows.values()];
  };

  const filterOptionRowsByUnderlying = (rows: OptionScreenerRow[], selectedSymbols: Set<string>): OptionScreenerRow[] => {
    return rows.filter((row) => row.symbol && selectedSymbols.has(row.underlyingSymbol));
  };

  const areOptionRowsEqual = (left: OptionScreenerRow[], right: OptionScreenerRow[]): boolean => {
    if (left.length !== right.length) return false;

    return left.every((row, index) => {
      const other = right[index];
      return !!other &&
        row.symbol === other.symbol &&
        row.name === other.name &&
        row.underlyingSymbol === other.underlyingSymbol &&
        row.strike === other.strike &&
        row.expirationDate === other.expirationDate &&
        row.price === other.price &&
        row.change === other.change &&
        row.changePercent === other.changePercent &&
        row.bid === other.bid &&
        row.ask === other.ask &&
        row.volume === other.volume &&
        row.openInterest === other.openInterest;
    });
  };

  const loadOptionScreenerRows = (tab: Exclude<StockScreenerTab, 'user_selected'>): Promise<OptionScreenerRow[]> => {
    const cachedRows = getCachedOptionRows(tab);
    if (cachedRows.length > 0) {
      return Promise.resolve(cachedRows);
    }

    const inFlightRequest = optionsScreenerRequestRef.current[tab];
    if (inFlightRequest) {
      return inFlightRequest;
    }

    const request = fetchMarketScreener<OptionScreenerRow>('options', tab)
      .then((response) => {
        const normalizedRows = Array.isArray(response?.items) ? response.items : [];
        setCachedOptionRows(tab, normalizedRows);
        return normalizedRows;
      })
      .finally(() => {
        delete optionsScreenerRequestRef.current[tab];
      });

    optionsScreenerRequestRef.current[tab] = request;
    return request;
  };

  const mapYahooQuoteToAsset = (quote: any, targetCategory: ScreenerCategory, sourceData?: Asset[]): Asset => {
    const resolvedCategory = getScreenerCategory(targetCategory);
    const price = getNumericValue(quote.regularMarketPrice);
    const change = getNumericValue(quote.regularMarketChange);
    const changePercent = getNumericValue(quote.regularMarketChangePercent);
    const peRatio = getNumericValue(quote.trailingPE);
    const rawSymbol = String(quote.symbol || 'N/A').toUpperCase();
    const normalizedSymbol = resolvedCategory === 'crypto' ? rawSymbol.replace(/-USD$/i, '') : rawSymbol;
    const local = sourceData?.find((item) => item.ticker.toUpperCase() === normalizedSymbol);
    return {
      ticker: normalizedSymbol,
      name: quote.shortName || quote.longName || quote.displayName || quote.symbol || 'Unknown',
      price,
      change,
      changePercent,
      volume: local?.volume || formatCompactNumber(quote.regularMarketVolume),
      marketCap: formatCompactNumber(quote.marketCap),
      peRatio: peRatio > 0 ? peRatio.toFixed(2) : '-',
      sparklineData: local?.sparklineData || [],
    };
  };

  const getExactSearchMatch = async (
    symbol: string,
    targetCategory: ScreenerCategory
  ): Promise<any | null> => {
    try {
      const results = await searchMarketSymbols(symbol, targetCategory);
      const normalized = normalizeSearchSymbol(symbol, targetCategory);
      return results.find((item: any) => {
        if (!isYahooResultForCategory(item, targetCategory)) return false;
        return normalizeSearchSymbol(String(item?.symbol || ''), targetCategory) === normalized;
      }) || null;
    } catch {
      return null;
    }
  };

  const enrichAssetMetadata = async (
    asset: Asset,
    symbol: string,
    targetCategory: ScreenerCategory
  ): Promise<Asset> => {
    const resolvedCategory = getScreenerCategory(targetCategory);
    const needsName = !asset.name || asset.name.toUpperCase() === asset.ticker.toUpperCase();
    const needsMarketCap = asset.marketCap === '-';
    const needsPeRatio = asset.peRatio === '-';

    if (!needsName && !needsMarketCap && !needsPeRatio) {
      return asset;
    }

    const lookupSymbol = resolvedCategory === 'crypto'
      ? (symbol.toUpperCase().endsWith('-USD') ? symbol.toUpperCase() : `${symbol.toUpperCase()}-USD`)
      : symbol.toUpperCase();

    const [liveMetadata, summary, searchMatch, pageMetrics] = await Promise.all([
      fetchLiveQuoteMetadata(lookupSymbol),
      fetchYahooQuoteSummary(lookupSymbol),
      needsName ? getExactSearchMatch(symbol, targetCategory) : Promise.resolve(null),
      (needsMarketCap || needsPeRatio) ? fetchYahooQuotePageMetrics(lookupSymbol) : Promise.resolve(null),
    ]);

    const liveMarketCapValue = getNumericValue(liveMetadata?.marketCap);
    const livePeRatioValue = getNumericValue(liveMetadata?.trailingPE) || (
      asset.price > 0 && getNumericValue(liveMetadata?.epsTrailingTwelveMonths) > 0
        ? asset.price / getNumericValue(liveMetadata?.epsTrailingTwelveMonths)
        : 0
    );
    const summaryPrice = summary?.price;
    const summaryDetail = summary?.summaryDetail;
    const summaryStats = summary?.defaultKeyStatistics;
    const summaryMarketCap = summaryPrice?.marketCap ?? summaryDetail?.marketCap;
    const summaryPeRatio = summaryStats?.trailingPE ?? summaryDetail?.trailingPE;

    const resolvedName =
      liveMetadata?.shortName ||
      liveMetadata?.longName ||
      summaryPrice?.shortName ||
      summaryPrice?.longName ||
      searchMatch?.shortname ||
      searchMatch?.longname ||
      asset.name;
    const resolvedMarketCap = liveMarketCapValue > 0
      ? formatCompactNumber(liveMarketCapValue)
      : formatCompactNumber(summaryMarketCap);
    const resolvedPeRatio = livePeRatioValue > 0 ? livePeRatioValue : getNumericValue(summaryPeRatio);

    return {
      ...asset,
      name: resolvedName || asset.name,
      marketCap: needsMarketCap
        ? (resolvedMarketCap !== '-' ? resolvedMarketCap : (pageMetrics?.marketCap || asset.marketCap))
        : asset.marketCap,
      peRatio: needsPeRatio
        ? (resolvedPeRatio > 0 ? resolvedPeRatio.toFixed(2) : (pageMetrics?.trailingPE || asset.peRatio))
        : asset.peRatio,
    };
  };

  const mapChartFallbackToAsset = async (
    symbol: string,
    targetCategory: ScreenerCategory,
    sourceData: Asset[]
  ): Promise<Asset> => {
    const resolvedCategory = getScreenerCategory(targetCategory);
    const normalized = normalizeSearchSymbol(symbol, targetCategory);
    const local = sourceData.find((item) => item.ticker.toUpperCase() === normalized);
    const lookupSymbol = resolvedCategory === 'crypto'
      ? (normalized.endsWith('-USD') ? normalized : `${normalized}-USD`)
      : normalized;

    try {
      const data = await fetchStockData(lookupSymbol, '5d', '1d');
      const quote = data?.indicators?.quote?.[0];
      if (!quote || !Array.isArray(quote.close) || !Array.isArray(quote.open)) {
        return toFallbackAsset(normalized, sourceData);
      }

      const closes = quote.close.filter((c: any) => c !== null && Number.isFinite(c));
      const opens = quote.open.filter((o: any) => o !== null && Number.isFinite(o));
      const volumes = Array.isArray(quote.volume)
        ? quote.volume.filter((v: any) => v !== null && Number.isFinite(v))
        : [];

      if (closes.length === 0) {
        return toFallbackAsset(normalized, sourceData);
      }

      const current = closes[closes.length - 1];
      const prev = closes.length > 1 ? closes[closes.length - 2] : (opens[0] ?? current);
      const change = current - prev;
      const changePercent = prev !== 0 ? (change / prev) * 100 : 0;
      const latestVolume = volumes.length > 0 ? volumes[volumes.length - 1] : undefined;
      const sparklineData = closes.slice(-6).map((value: number) => Math.max(0.01, value));

      return {
        ticker: normalized,
        name: local?.name || normalized,
        price: current,
        change,
        changePercent,
        volume: typeof latestVolume === 'number' && Number.isFinite(latestVolume) && latestVolume > 0
          ? formatCompactNumber(latestVolume)
          : (local?.volume || '-'),
        marketCap: local?.marketCap || '-',
        peRatio: local?.peRatio || '-',
        sparklineData: sparklineData.length > 0 ? sparklineData : [],
      };
    } catch {
      return toFallbackAsset(normalized, sourceData);
    }
  };

  const resolveUserSelectedAssets = async (
    targetCategory: ScreenerCategory,
    selectedSymbols: string[],
    sourceData: Asset[],
  ): Promise<Asset[]> => {
    if (selectedSymbols.length === 0) return [];

    const resolvedCategory = getScreenerCategory(targetCategory);
    const quoteSymbols = resolvedCategory === 'crypto'
      ? selectedSymbols.map((symbol) => symbol.toUpperCase().endsWith('-USD') ? symbol.toUpperCase() : `${symbol.toUpperCase()}-USD`)
      : selectedSymbols.map((symbol) => symbol.toUpperCase());
    const quotes = await fetchYahooQuotes(quoteSymbols);

    const quoteBySymbol = new Map<string, any>();
    quotes.forEach((quote) => {
      const normalized = normalizeSearchSymbol(String(quote?.symbol || ''), targetCategory);
      if (!normalized || quoteBySymbol.has(normalized)) return;
      quoteBySymbol.set(normalized, quote);
    });

    const missing = selectedSymbols
      .map((symbol) => normalizeSearchSymbol(symbol, targetCategory))
      .filter((symbol) => !quoteBySymbol.has(symbol));

    const chartFallbackMap = new Map<string, Asset>();
    if (missing.length > 0) {
      const chartFallbacks = await Promise.all(
        missing.map(async (symbol) => ({
          symbol,
          asset: await mapChartFallbackToAsset(symbol, targetCategory, sourceData),
        }))
      );
      chartFallbacks.forEach(({ symbol, asset }) => {
        chartFallbackMap.set(symbol, asset);
      });
    }

    const resolvedAssets = selectedSymbols.map((symbol) => {
      const normalized = normalizeSearchSymbol(symbol, targetCategory);
      const quote = quoteBySymbol.get(normalized);
      if (quote) return mapYahooQuoteToAsset(quote, targetCategory, sourceData);
      const chartAsset = chartFallbackMap.get(normalized);
      if (chartAsset) return chartAsset;
      return toFallbackAsset(normalized, sourceData);
    });

    return Promise.all(
      resolvedAssets.map((asset, index) =>
        enrichAssetMetadata(asset, selectedSymbols[index], targetCategory)
      )
    );
  };

  useEffect(() => {
    let mounted = true;

    const fetchUserSelectedCards = async () => {
      if (!isScreenerCategory(category)) {
        if (mounted) setUserSelectedCardData([]);
        return;
      }

      const targetCategory: ScreenerCategory = category;
      const selectedSymbols = getUserSelectedSymbols(targetCategory);
      const categoryBaseData = getCategoryBaseData(targetCategory);

      if (selectedSymbols.length === 0) {
        if (mounted) setUserSelectedCardData([]);
        return;
      }

      if (mounted) {
        setUserSelectedCardData(
          selectedSymbols.map((symbol) =>
            createPlaceholderAsset(normalizeSearchSymbol(symbol, targetCategory))
          )
        );
      }

      const resolved = await resolveUserSelectedAssets(targetCategory, selectedSymbols, categoryBaseData);
      if (!mounted) return;

      setUserSelectedCardData(resolved);
    };

    fetchUserSelectedCards();
    return () => {
      mounted = false;
    };
  }, [category, userSelectedStocks, userSelectedOptions, userSelectedEtfs, userSelectedCrypto, stocksData, etfsData, cryptoData]);

  useEffect(() => {
    let mounted = true;

    const fetchStockScreenerData = async () => {
      if (!isScreenerCategory(category)) return;

      try {
        const targetCategory: ScreenerCategory = category;

        if (targetCategory === 'options') {
          if (stockScreenerTab === 'user_selected') {
            const selectedSymbols = new Set(getUserSelectedSymbols(targetCategory).map((symbol) => symbol.toUpperCase()));

            if (selectedSymbols.size === 0) {
              if (mounted) setOptionsScreenerData([]);
              return;
            }

            const cachedMostActiveRows = getCachedOptionRows('most_actives');
            const cachedTopGainersRows = getCachedOptionRows('day_gainers');
            const cachedUserSelectedRows = filterOptionRowsByUnderlying(
              mergeOptionRowsBySymbol(cachedMostActiveRows, cachedTopGainersRows),
              selectedSymbols
            );

            if (mounted && cachedUserSelectedRows.length > 0) {
              setOptionsScreenerData(cachedUserSelectedRows);
            }

            const [resolvedMostActiveRows, resolvedTopGainersRows] = await Promise.all([
              loadOptionScreenerRows('most_actives'),
              loadOptionScreenerRows('day_gainers'),
            ]);

            const filteredRows = filterOptionRowsByUnderlying(
              mergeOptionRowsBySymbol(resolvedMostActiveRows, resolvedTopGainersRows),
              selectedSymbols
            );

            if (mounted && !areOptionRowsEqual(cachedUserSelectedRows, filteredRows)) {
              setOptionsScreenerData(filteredRows);
            }
            return;
          }

          const cachedRows = getCachedOptionRows(stockScreenerTab);

          if (mounted && cachedRows.length > 0) {
            setOptionsScreenerData(cachedRows);
            return;
          }

          const normalizedRows = await loadOptionScreenerRows(stockScreenerTab);

          console.debug('[Research screener fetch]', {
            category: targetCategory,
            tab: stockScreenerTab,
            screenerId: getPredefinedScreenerId(targetCategory, stockScreenerTab),
            rawResponseSize: normalizedRows.length,
            normalizedRowsLength: normalizedRows.length,
          });

          if (mounted) {
            setOptionsScreenerData(normalizedRows);
          }
          return;
        }

        if (stockScreenerTab === 'user_selected') {
          return;
        }

        const response = await fetchMarketScreener<Asset>(targetCategory, stockScreenerTab);
        const normalizedRows = (response.items || []).map((asset) => ({
          ...asset,
          sparklineData: Array.isArray(asset.sparklineData) ? asset.sparklineData : [],
        }));
        console.debug('[Research screener fetch]', {
          category: targetCategory,
          tab: stockScreenerTab,
          screenerId: getPredefinedScreenerId(targetCategory, stockScreenerTab),
          rawResponseSize: normalizedRows.length,
          normalizedRowsLength: normalizedRows.length,
          updatedAt: response.updatedAt,
        });
        if (mounted) {
          setStockScreenerData(normalizedRows);
        }
      } catch (error) {
        console.error('Failed to fetch stock screener data:', error);
        if (mounted) {
          if (category === 'options') {
            setOptionsScreenerData([]);
          } else {
            setStockScreenerData([]);
          }
        }
      }
    };

    fetchStockScreenerData();
    return () => {
      mounted = false;
    };
  }, [category, stockScreenerTab, userSelectedStocks, userSelectedOptions, userSelectedEtfs, userSelectedCrypto, stocksData, etfsData, cryptoData]);

  useEffect(() => {
    let mounted = true;

    const runSearch = async () => {
      if (!isScreenerCategory(category)) {
        if (mounted) {
          setStockSearchResults([]);
          setIsSearchingStocks(false);
        }
        return;
      }

      const query = stockSearchQuery.trim();
      if (!query) {
        if (mounted) {
          setStockSearchResults([]);
          setIsSearchingStocks(false);
        }
        return;
      }

      setIsSearchingStocks(true);
      try {
        const targetCategory: ScreenerCategory = category;
        const gatewayResults = await searchMarketSymbols(query, targetCategory);
        const mappedYahoo: StockSearchResult[] = gatewayResults
          .slice(0, 8)
          .map((item: any) => ({
            symbol: normalizeSearchSymbol(String(item.symbol || ''), targetCategory),
            name: item.name || item.symbol || 'Unknown',
            exchange: item.exchange,
            quoteType: String(item.quoteType || '').toUpperCase(),
          }))
          .filter((item: StockSearchResult) => !!item.symbol);

        if (mappedYahoo.length > 0) {
          if (mounted) setStockSearchResults(mappedYahoo);
          return;
        }

        const categoryUniverse = getCategoryBaseData(category);
        const localUniverse = [...categoryUniverse, ...stockScreenerData];
        const filteredLocal = localUniverse
          .filter((item, index, arr) => arr.findIndex(x => x.ticker === item.ticker) === index)
          .filter((item) => {
            const q = query.toLowerCase();
            return item.ticker.toLowerCase().includes(q) || item.name.toLowerCase().includes(q);
          })
          .slice(0, 8)
          .map((item) => ({ symbol: item.ticker, name: item.name }));

        if (mounted) setStockSearchResults(filteredLocal);
      } catch (error) {
        console.error('Stock search failed:', error);
        if (mounted) setStockSearchResults([]);
      } finally {
        if (mounted) setIsSearchingStocks(false);
      }
    };

    const timer = setTimeout(runSearch, 250);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [category, stockSearchQuery, stocksData, etfsData, cryptoData, stockScreenerData]);

  const handleAddUserSelectedStock = async () => {
    if (!isScreenerCategory(category)) return;

    const query = stockSearchQuery.trim();
    if (!query) return;

    setIsAddingStock(true);
    try {
      const queryUpper = query.toUpperCase();
      const targetCategory: ScreenerCategory = category;
      const normalizedQuery = normalizeSearchSymbol(queryUpper, targetCategory);
      
      // Only use search results if we have an exact match
      let symbol: string | undefined;
      const exactMatch = stockSearchResults.find((item) => item.symbol === normalizedQuery);
      if (exactMatch) {
        symbol = exactMatch.symbol;
      }

      // If not found in current results, search Yahoo
      if (!symbol) {
        const results = await searchMarketSymbols(query, targetCategory);
        const matched = results.find((item: any) => {
          if (!isYahooResultForCategory(item, targetCategory)) return false;
          return normalizeSearchSymbol(String(item?.symbol || ''), targetCategory) === normalizedQuery;
        });
        if (matched) {
          symbol = normalizeSearchSymbol(String(matched.symbol || ''), targetCategory);
        }
      }

      // If still not found, try direct quote lookup
      if (!symbol) {
        const fallbackSymbols = getScreenerCategory(targetCategory) === 'crypto'
          ? [queryUpper, `${queryUpper}-USD`]
          : [queryUpper];
        const fallbackQuote = await fetchYahooQuotes(fallbackSymbols);
        const matchedQuote = fallbackQuote.find((quote: any) => isQuoteForCategory(quote, targetCategory));
        if (matchedQuote?.symbol) {
          symbol = normalizeSearchSymbol(String(matchedQuote.symbol), targetCategory);
        }
      }

      // If we couldn't find the symbol anywhere, exit silently
      if (!symbol) {
        setStockSearchQuery('');
        setStockSearchResults([]);
        setIsAddingStock(false);
        return;
      }

      // Ensure symbol is trimmed and uppercase
      const cleanedSymbol = getScreenerCategory(targetCategory) === 'crypto'
        ? symbol.trim().toUpperCase().replace(/-USD$/i, '')
        : symbol.trim().toUpperCase();

      if (targetCategory === 'options') {
        setUserSelectedOptions((prev) => {
          if (prev.includes(cleanedSymbol)) return prev;
          return [...prev, cleanedSymbol];
        });
      } else if (getScreenerCategory(targetCategory) === 'stocks') {
        setUserSelectedStocks((prev) => {
          if (prev.includes(cleanedSymbol)) return prev;
          return [...prev, cleanedSymbol];
        });
      } else if (getScreenerCategory(targetCategory) === 'etfs') {
        setUserSelectedEtfs((prev) => {
          if (prev.includes(cleanedSymbol)) return prev;
          return [...prev, cleanedSymbol];
        });
      } else {
        setUserSelectedCrypto((prev) => {
          if (prev.includes(cleanedSymbol)) return prev;
          return [...prev, cleanedSymbol];
        });
      }

      // Ensure tab switches and clean up search state
      setStockScreenerTab('user_selected');
      setStockSearchQuery('');
      setStockSearchResults([]);
    } catch (error) {
      console.error('Failed to add user selected stock:', error);
      setStockSearchQuery('');
      setStockSearchResults([]);
    } finally {
      setIsAddingStock(false);
    }
  };

  const removeUserSelectedStock = (symbol: string) => {
    if (!isScreenerCategory(category)) return;

    const confirmed = window.confirm(`Remove ${symbol} from user selected stocks?`);
    if (!confirmed) return;

    if (category === 'options') {
      setUserSelectedOptions((prev) => prev.filter((item) => item !== symbol));
    } else if (getScreenerCategory(category) === 'stocks') {
      setUserSelectedStocks((prev) => prev.filter((item) => item !== symbol));
    } else if (getScreenerCategory(category) === 'etfs') {
      setUserSelectedEtfs((prev) => prev.filter((item) => item !== symbol));
    } else {
      setUserSelectedCrypto((prev) => prev.filter((item) => item !== symbol));
    }

    setStockSearchResults([]);
  };

  const reorderSymbols = (symbols: string[], draggedSymbol: string, targetSymbol: string): string[] => {
    const fromIndex = symbols.findIndex((item) => item.toUpperCase() === draggedSymbol.toUpperCase());
    const toIndex = symbols.findIndex((item) => item.toUpperCase() === targetSymbol.toUpperCase());
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return symbols;

    const next = [...symbols];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
  };

  const reorderAssetsByTicker = (assets: Asset[], draggedSymbol: string, targetSymbol: string): Asset[] => {
    const fromIndex = assets.findIndex((item) => item.ticker.toUpperCase() === draggedSymbol.toUpperCase());
    const toIndex = assets.findIndex((item) => item.ticker.toUpperCase() === targetSymbol.toUpperCase());
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return assets;

    const next = [...assets];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
  };

  const reorderUserSelected = (draggedSymbol: string, targetSymbol: string) => {
    if (!isScreenerCategory(category)) return;

    if (category === 'options') {
      setUserSelectedOptions((prev) => reorderSymbols(prev, draggedSymbol, targetSymbol));
    } else if (getScreenerCategory(category) === 'stocks') {
      setUserSelectedStocks((prev) => reorderSymbols(prev, draggedSymbol, targetSymbol));
    } else if (getScreenerCategory(category) === 'etfs') {
      setUserSelectedEtfs((prev) => reorderSymbols(prev, draggedSymbol, targetSymbol));
    } else {
      setUserSelectedCrypto((prev) => reorderSymbols(prev, draggedSymbol, targetSymbol));
    }

    setUserSelectedCardData((prev) => reorderAssetsByTicker(prev, draggedSymbol, targetSymbol));
    if (stockScreenerTab === 'user_selected') {
      setStockScreenerData((prev) => reorderAssetsByTicker(prev, draggedSymbol, targetSymbol));
    }
  };

  const handleUserSelectedDragStart = (symbol: string) => {
    setDraggedUserSymbol(symbol);
    setDragOverUserSymbol(symbol);
  };

  const handleUserSelectedDrop = (targetSymbol: string) => {
    if (draggedUserSymbol && draggedUserSymbol !== targetSymbol) {
      reorderUserSelected(draggedUserSymbol, targetSymbol);
    }
    setDraggedUserSymbol(null);
    setDragOverUserSymbol(null);
  };

  const handleUserSelectedDragEnd = () => {
    setDraggedUserSymbol(null);
    setDragOverUserSymbol(null);
  };

  const getCurrentData = (): Asset[] => {
    switch (category) {
      case 'stocks': return stocksData;
      case 'etfs': return etfsData;
      case 'options': return stocksData;
      case 'crypto': return cryptoData;
      default: return stocksData;
    }
  };

  const displayedStockScreenerData = useMemo(
    () => stockScreenerData,
    [stockScreenerData],
  );

  const displayedUserSelectedCardData = useMemo(() => {
    if (!isScreenerCategory(category)) {
      return userSelectedCardData;
    }

    const latestScreenerByTicker = new Map(
      displayedStockScreenerData.map((asset) => [asset.ticker.toUpperCase(), asset]),
    );

    return userSelectedCardData.map((asset) => {
      const latestAsset = latestScreenerByTicker.get(asset.ticker.toUpperCase());
      if (!latestAsset) {
        return asset;
      }

      return {
        ...asset,
        name: asset.name && asset.name !== asset.ticker ? asset.name : latestAsset.name,
        volume: asset.volume !== '-' ? asset.volume : latestAsset.volume,
        marketCap: asset.marketCap !== '-' ? asset.marketCap : latestAsset.marketCap,
        peRatio: asset.peRatio !== '-' ? asset.peRatio : latestAsset.peRatio,
        sparklineData: asset.sparklineData.length > 0
          ? asset.sparklineData
          : (Array.isArray(latestAsset.sparklineData) ? latestAsset.sparklineData : []),
      };
    });
  }, [category, displayedStockScreenerData, userSelectedCardData]);

  const topCardSymbols = useMemo(
    () => displayedUserSelectedCardData.map((asset) => asset.ticker),
    [displayedUserSelectedCardData],
  );
  const latestTopCardQuotes = useLatestQuotes(topCardSymbols);
  const displayedTopCardData = useMemo(() => {
    const screenerSparklineByTicker = new Map(
      displayedStockScreenerData.map((asset) => [asset.ticker.toUpperCase(), asset.sparklineData]),
    );
    const userSelectedSparklineByTicker = new Map(
      userSelectedCardData.map((asset) => [asset.ticker.toUpperCase(), asset.sparklineData]),
    );

    return displayedUserSelectedCardData.map((asset) => {
      const liveQuote = topCardLiveQuotes[asset.ticker.toUpperCase()];
      const latestQuote = latestTopCardQuotes[asset.ticker.toUpperCase()];
      const screenerSparkline = screenerSparklineByTicker.get(asset.ticker.toUpperCase());
      const userSelectedSparkline = userSelectedSparklineByTicker.get(asset.ticker.toUpperCase());
      const nextSparklineData = asset.sparklineData.length > 0
        ? asset.sparklineData
        : (Array.isArray(screenerSparkline) && screenerSparkline.length > 0
          ? screenerSparkline
          : (Array.isArray(userSelectedSparkline) && userSelectedSparkline.length > 0
            ? userSelectedSparkline
            : (topCardSparklineData[asset.ticker.toUpperCase()] || [])));

      return {
        ...asset,
        price: Number.isFinite(liveQuote?.price)
          ? Number(liveQuote.price)
          : (Number.isFinite(latestQuote?.price) ? Number(latestQuote.price) : asset.price),
        change: Number.isFinite(liveQuote?.change)
          ? Number(liveQuote.change)
          : (Number.isFinite(latestQuote?.change) ? Number(latestQuote.change) : asset.change),
        changePercent: Number.isFinite(liveQuote?.changePercent)
          ? Number(liveQuote.changePercent)
          : (Number.isFinite(latestQuote?.changePercent) ? Number(latestQuote.changePercent) : asset.changePercent),
        volume: Number.isFinite(liveQuote?.volume)
          ? formatQuoteVolume(Number(liveQuote.volume))
          : (Number.isFinite(latestQuote?.volume) ? formatQuoteVolume(Number(latestQuote.volume)) : asset.volume),
        sparklineData: nextSparklineData,
      };
    });
  }, [displayedStockScreenerData, displayedUserSelectedCardData, latestTopCardQuotes, topCardLiveQuotes, topCardSparklineData, userSelectedCardData]);

  useEffect(() => {
    if (!isScreenerCategory(category)) {
      return;
    }

    let mounted = true;

    const fetchTopCardLiveQuotes = async () => {
      const targetCategory: ScreenerCategory = category;
      const symbols = displayedUserSelectedCardData.map((asset) =>
        getScreenerCategory(targetCategory) === 'crypto'
          ? `${asset.ticker.toUpperCase()}-USD`
          : asset.ticker.toUpperCase()
      );

      if (symbols.length === 0) {
        if (mounted) {
          setTopCardLiveQuotes({});
          setIsLoadingLivePrices(false);
        }
        return;
      }

      setIsLoadingLivePrices(true);
      try {
        const quotes = await fetchYahooQuotes(symbols);
        if (!mounted) return;

        const nextQuotes = quotes.reduce<Record<string, {
          price?: number;
          change?: number;
          changePercent?: number;
          volume?: number;
        }>>((acc, quote) => {
          const normalizedTicker = normalizeSearchSymbol(String(quote?.symbol || ''), targetCategory);
          if (!normalizedTicker) return acc;

          acc[normalizedTicker] = {
            price: getOptionalNumericValue(quote?.regularMarketPrice) ?? undefined,
            change: getOptionalNumericValue(quote?.regularMarketChange) ?? undefined,
            changePercent: getOptionalNumericValue(quote?.regularMarketChangePercent) ?? undefined,
            volume: getOptionalNumericValue(quote?.regularMarketVolume) ?? undefined,
          };
          return acc;
        }, {});

        setTopCardLiveQuotes(nextQuotes);
      } catch (error) {
        console.error('Failed to fetch top card live quotes:', error);
      } finally {
        if (mounted) {
          setIsLoadingLivePrices(false);
        }
      }
    };

    void fetchTopCardLiveQuotes();
    const intervalId = window.setInterval(fetchTopCardLiveQuotes, 30000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [category, displayedUserSelectedCardData]);

  useEffect(() => {
    if (!isScreenerCategory(category)) {
      return;
    }

    let mounted = true;

    const fetchMissingTopCardSparklines = async () => {
      const targetCategory: ScreenerCategory = category;
      const missingAssets = displayedUserSelectedCardData.filter((asset) => {
        if (Array.isArray(asset.sparklineData) && asset.sparklineData.length >= 2) {
          return false;
        }

        const fetchedSparkline = topCardSparklineData[asset.ticker.toUpperCase()];
        return !Array.isArray(fetchedSparkline) || fetchedSparkline.length < 2;
      });

      if (missingAssets.length === 0) {
        return;
      }

      const fetchedSparklines = await Promise.all(
        missingAssets.map(async (asset) => {
          try {
            const chart = await fetchStockData(
              getTopCardSparklineLookupSymbol(asset.ticker, targetCategory),
              '5d',
              '1d',
            );
            const closes = Array.isArray(chart?.indicators?.quote?.[0]?.close)
              ? chart.indicators.quote[0].close.filter((value: any) => value !== null && Number.isFinite(value))
              : [];
            return {
              ticker: asset.ticker.toUpperCase(),
              sparklineData: closes.slice(-6).map((value: number) => Math.max(0.01, value)),
            };
          } catch {
            return {
              ticker: asset.ticker.toUpperCase(),
              sparklineData: [] as number[],
            };
          }
        }),
      );

      if (!mounted) return;

      setTopCardSparklineData((current) => {
        const next = { ...current };
        fetchedSparklines.forEach(({ ticker, sparklineData }) => {
          if (sparklineData.length >= 2) {
            next[ticker] = sparklineData;
          }
        });
        return next;
      });
    };

    void fetchMissingTopCardSparklines();

    return () => {
      mounted = false;
    };
  }, [category, displayedUserSelectedCardData, topCardSparklineData]);
  const getTrendingAssets = () => {
    if (!isScreenerCategory(category)) {
      return getCurrentData().slice(0, 6);
    }

    return displayedTopCardData;
  };
  const getScreenerAssets = () => getCurrentData();
  const displayedScreenerRows = category === 'options'
    ? (stockScreenerTab === 'user_selected' ? displayedUserSelectedCardData : optionsScreenerData)
    : (isScreenerCategory(category)
      ? (stockScreenerTab === 'user_selected' ? displayedUserSelectedCardData : displayedStockScreenerData)
      : getScreenerAssets());
  const hideAddColumnForOptionsUserSelected = category === 'options' && stockScreenerTab === 'user_selected';
  const totalScreenerRows = displayedScreenerRows.length;
  const totalScreenerPages = Math.max(1, Math.ceil(totalScreenerRows / screenerRowsPerPage));
  const safeScreenerPage = Math.min(screenerCurrentPage, totalScreenerPages);
  const screenerStartIndex = (safeScreenerPage - 1) * screenerRowsPerPage;
  const paginatedScreenerRows = displayedScreenerRows.slice(screenerStartIndex, screenerStartIndex + screenerRowsPerPage);
  const screenerStartRow = totalScreenerRows === 0 ? 0 : screenerStartIndex + 1;
  const screenerEndRow = totalScreenerRows === 0 ? 0 : Math.min(screenerStartIndex + screenerRowsPerPage, totalScreenerRows);

  useEffect(() => {
    setScreenerCurrentPage(1);
  }, [category, stockScreenerTab]);

  useEffect(() => {
    setScreenerCurrentPage(1);
  }, [screenerRowsPerPage]);

  useEffect(() => {
    if (screenerCurrentPage > totalScreenerPages) {
      setScreenerCurrentPage(totalScreenerPages);
    }
  }, [screenerCurrentPage, totalScreenerPages]);

  useEffect(() => {
    if (!isScreenerCategory(category)) return;

    console.debug('[Research screener pagination]', {
      category,
      tab: stockScreenerTab,
      filteredRowsLength: displayedScreenerRows.length,
      paginatedRowsLength: paginatedScreenerRows.length,
      currentPage: safeScreenerPage,
      rowsPerPage: screenerRowsPerPage,
      totalPages: totalScreenerPages,
    });
  }, [
    category,
    displayedScreenerRows.length,
    paginatedScreenerRows.length,
    safeScreenerPage,
    screenerRowsPerPage,
    stockScreenerTab,
    totalScreenerPages,
  ]);

  const addToPortfolio = (ticker: string, name: string) => {
    if (portfolioItems.find(item => item.ticker === ticker)) return;
    if (portfolioItems.length >= 15) return;
    
    setPortfolioItems([...portfolioItems, { ticker, name, amount: 0 }]);
  };

  const removeFromPortfolio = (ticker: string) => {
    const confirmed = window.confirm(`Remove ${ticker} from this portfolio?`);
    if (!confirmed) return;

    setPortfolioItems(portfolioItems.filter(item => item.ticker !== ticker));
  };

  const updateAmount = (ticker: string, newAmount: number) => {
    setPortfolioItems(portfolioItems.map(item => 
      item.ticker === ticker ? { ...item, amount: Math.max(0, newAmount) } : item
    ));
  };

  const handleSavePortfolio = () => {
    if (!isValidPortfolio) return;

    // Create a new portfolio object
    const newPortfolio = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      name: portfolioName || 'Untitled Portfolio',
      budget: portfolioBudget,
      items: portfolioItems,
      totalAllocated: totalAllocated,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Get existing portfolios from localStorage
    const existing = localStorage.getItem('userPortfolios');
    const portfolios = existing ? JSON.parse(existing) : [];
    
    // Add new portfolio to the list
    portfolios.push(newPortfolio);
    
    // Save back to localStorage
    localStorage.setItem('userPortfolios', JSON.stringify(portfolios));

    // Reset the form
    setPortfolioItems([]);
    setPortfolioName('Untitled Portfolio');
    setPortfolioBudget(10000);
    localStorage.removeItem(PORTFOLIO_DRAFT_ITEMS_KEY);
    localStorage.removeItem(PORTFOLIO_DRAFT_NAME_KEY);
    localStorage.removeItem(PORTFOLIO_DRAFT_BUDGET_KEY);

    // Navigate to the user portfolio page
    navigate('/research/portfolio');
  };

  const handleClearPortfolio = () => {
    const confirmed = window.confirm('Clear current portfolio? This will remove all selected assets and reset the portfolio settings.');
    if (!confirmed) return;

    setPortfolioItems([]);
    setPortfolioName('Untitled Portfolio');
    setPortfolioBudget(10000);
    setIsEditingName(false);
    setIsEditingBudget(false);
    localStorage.removeItem(PORTFOLIO_DRAFT_ITEMS_KEY);
    localStorage.removeItem(PORTFOLIO_DRAFT_NAME_KEY);
    localStorage.removeItem(PORTFOLIO_DRAFT_BUDGET_KEY);
  };

  // Calculate percentage based on total capital or total allocated
  const getPercentage = (amount: number): number => {
    if (portfolioBudget > 0) {
      return (amount / portfolioBudget) * 100;
    }
    return 0;
  };

  const totalAllocated = portfolioItems.reduce((sum, item) => sum + item.amount, 0);
  const remainingCash = portfolioBudget - totalAllocated;
  const allocationTolerance = 0.01;
  const isOverAllocated = remainingCash < 0;
  const isFullyAllocated = Math.abs(remainingCash) <= allocationTolerance;
  const isValidPortfolio = !isOverAllocated && isFullyAllocated && portfolioItems.length > 0;
  const deployedPercentage = portfolioBudget > 0 ? (totalAllocated / portfolioBudget) * 100 : 0;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const renderMiniChart = (data: number[]) => {
    if (data.length < 2) return null;

    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    
    const points = data.map((value, index) => {
      const x = (index / (data.length - 1)) * 100;
      const y = 40 - ((value - min) / range) * 30;
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg className="w-full h-full" viewBox="0 0 100 50" preserveAspectRatio="none">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  const formatCategoryLabel = (cat: AssetCategory) => {
    return cat === 'etfs' ? 'ETFs' : cat.charAt(0).toUpperCase() + cat.slice(1);
  };

  const getCategoryLabel = () => {
    return formatCategoryLabel(category);
  };

  const getSearchPlaceholder = () => {
    if (category === 'stocks') return 'Search Stocks (e.g. AMD)';
    if (category === 'options') return 'Search Stocks (e.g. AMD)';
    if (category === 'etfs') return 'Search ETFs (e.g. SPY)';
    if (category === 'crypto') return 'Search Crypto (e.g. BTC)';
    return 'Search symbol';
  };

  const handleStockScreenerTabChange = (nextTab: StockScreenerTab) => {
    if (nextTab === stockScreenerTab) return;

    setStockScreenerTab(nextTab);
  };

  return (
    <div className="flex gap-6 h-[calc(100vh-180px)] overflow-hidden">
      {/* Left Content Area - 65% */}
      <div className="flex-1 min-w-0 overflow-y-auto pr-2 space-y-6 scrollbar-hide">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-100 mb-2">Portfolio Builder</h1>
          <p className="text-slate-400 mb-6">Discover assets and allocate your capital</p>
          
          {/* Category Tabs */}
          <div className="flex gap-2">
            {(['stocks', 'etfs', 'options', 'crypto'] as AssetCategory[]).map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  category === cat
                    ? 'bg-slate-800 text-slate-100 border border-slate-700'
                    : 'bg-slate-900/50 text-slate-400 border border-slate-800 hover:text-slate-100 hover:border-slate-700'
                }`}
              >
                {formatCategoryLabel(cat)}
              </button>
            ))}
          </div>
        </div>

        {/* Most Trending - Carousel */}
        <div className="relative">
          <div className="flex items-center mb-4">
            <h2 className="flex items-center gap-2 text-xl font-semibold leading-tight text-slate-100">
              {isScreenerCategory(category) ? 'User Selected in' : 'Most Trending in'} {getCategoryLabel()}
              {isLoadingLivePrices && <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />}
            </h2>
          </div>

          <div 
            ref={scrollRef}
            className="overflow-x-auto pb-3 -mx-2 px-2 scrollbar-hide"
          >
            <div className="flex gap-4 min-w-max">
              {getTrendingAssets().map((asset) => (
                <div
                  key={asset.ticker}
                  draggable={isScreenerCategory(category)}
                  onDragStart={(e) => {
                    if (!isScreenerCategory(category)) return;
                    e.dataTransfer.effectAllowed = 'move';
                    handleUserSelectedDragStart(asset.ticker);
                  }}
                  onDragOver={(e) => {
                    if (!isScreenerCategory(category) || !draggedUserSymbol) return;
                    e.preventDefault();
                    setDragOverUserSymbol(asset.ticker);
                  }}
                  onDrop={(e) => {
                    if (!isScreenerCategory(category) || !draggedUserSymbol) return;
                    e.preventDefault();
                    handleUserSelectedDrop(asset.ticker);
                  }}
                  onDragEnd={handleUserSelectedDragEnd}
                  onClick={() => {
                    navigate(getResearchDetailPathForCategory(asset.ticker, category), {
                      state: { initialAsset: asset },
                    });
                  }}
                  className={`bg-slate-900/50 border rounded-lg p-4 hover:border-emerald-600/50 hover:shadow-lg hover:shadow-emerald-500/10 transition-all cursor-pointer ${
                    isScreenerCategory(category) && dragOverUserSymbol === asset.ticker
                      ? 'border-emerald-500'
                      : 'border-slate-800'
                  }`}
                  style={{ minWidth: '240px', maxWidth: '240px' }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-slate-100 font-semibold truncate">{asset.ticker}</div>
                      <div className="text-slate-400 text-xs truncate">{asset.name}</div>
                    </div>
                    {category !== 'options' && (
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          addToPortfolio(asset.ticker, asset.name);
                        }}
                        disabled={
                          portfolioItems.some(item => item.ticker === asset.ticker) ||
                          portfolioItems.length >= 15
                        }
                        className="ml-2 h-7 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Add
                      </Button>
                    )}
                  </div>

                  <div className="mb-3">
                    <div className="text-slate-100 font-bold">
                      ${asset.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className={`text-sm ${asset.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {asset.change >= 0 ? '+' : ''}{asset.change.toFixed(2)} ({asset.changePercent >= 0 ? '+' : ''}{asset.changePercent.toFixed(2)}%)
                    </div>
                  </div>

                  <div className={`h-12 mb-3 ${asset.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {renderMiniChart(asset.sparklineData)}
                  </div>

                  <div className="pt-3 border-t border-slate-800 text-xs">
                    <span className="text-slate-500">Volume: </span>
                    <span className="text-slate-300">{asset.volume}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-slate-900/50 border border-slate-800 rounded-lg overflow-visible">
          <div className="relative z-30 flex items-center justify-between p-4 border-b border-slate-800 gap-4 flex-wrap">
                {isScreenerCategory(category) ? (
                  <>
                            <div className="flex items-center gap-6 flex-wrap">
                              <h2 className="text-slate-100">Asset Screener</h2>
                              <div className="flex items-center gap-2 flex-wrap">
                                {STOCK_SCREENER_TABS.map((tab) => (
                                  <button
                                    key={tab.key}
                                    onClick={() => handleStockScreenerTabChange(tab.key)}
                                    className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                                      stockScreenerTab === tab.key
                                        ? 'bg-slate-800 text-slate-100 border border-slate-700'
                                        : 'bg-slate-900/50 text-slate-400 border border-slate-800 hover:text-slate-100 hover:border-slate-700'
                                    }`}
                                  >
                                    {tab.label}
                                  </button>
                                ))}
                              </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <input
                          type="text"
                          value={stockSearchQuery}
                          onChange={(e) => {
                            setStockSearchQuery(e.target.value);
                          }}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddUserSelectedStock()}
                          placeholder={getSearchPlaceholder()}
                          className="px-3 py-1.5 bg-slate-800/50 border border-slate-700 rounded text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
                        />
                        {(stockSearchQuery.trim().length > 0 && stockSearchResults.length > 0) && (
                          <div className="absolute z-20 mt-1 w-full min-w-[320px] bg-slate-900 border border-slate-700 rounded-md shadow-lg overflow-hidden">
                            <div className="max-h-56 overflow-y-auto">
                              {stockSearchResults.map((result) => (
                                <button
                                  key={result.symbol}
                                  onClick={() => {
                                    setStockSearchQuery(result.symbol);
                                    setStockSearchResults([result]);
                                  }}
                                  className="w-full text-left px-3 py-2 hover:bg-slate-800 transition-colors"
                                >
                                  <div className="text-slate-100 text-sm font-medium">{result.symbol}</div>
                                  <div className="text-slate-400 text-xs truncate">
                                    {result.name}{result.exchange ? ` • ${result.exchange}` : ''}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <Button
                        onClick={handleAddUserSelectedStock}
                        disabled={isAddingStock || !stockSearchQuery.trim()}
                        className="h-8 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40"
                      >
                        {isAddingStock ? 'Adding...' : 'Add'}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-3">
                    <h2 className="text-slate-100 mr-2">Asset Screener</h2>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                {category === 'options' && stockScreenerTab !== 'user_selected' ? (
                  <table className="w-full table-fixed">
                    <colgroup>
                      <col style={{ width: OPTIONS_SCREENER_COLUMN_WIDTHS.symbol }} />
                      <col style={{ width: OPTIONS_SCREENER_COLUMN_WIDTHS.name }} />
                      <col style={{ width: OPTIONS_SCREENER_COLUMN_WIDTHS.underlyingSymbol }} />
                      <col style={{ width: OPTIONS_SCREENER_COLUMN_WIDTHS.strike }} />
                      <col style={{ width: OPTIONS_SCREENER_COLUMN_WIDTHS.expirationDate }} />
                      <col style={{ width: OPTIONS_SCREENER_COLUMN_WIDTHS.price }} />
                      <col style={{ width: OPTIONS_SCREENER_COLUMN_WIDTHS.change }} />
                      <col style={{ width: OPTIONS_SCREENER_COLUMN_WIDTHS.changePercent }} />
                      <col style={{ width: OPTIONS_SCREENER_COLUMN_WIDTHS.bid }} />
                      <col style={{ width: OPTIONS_SCREENER_COLUMN_WIDTHS.ask }} />
                      <col style={{ width: OPTIONS_SCREENER_COLUMN_WIDTHS.volume }} />
                      <col style={{ width: OPTIONS_SCREENER_COLUMN_WIDTHS.openInterest }} />
                      <col style={{ width: OPTIONS_SCREENER_COLUMN_WIDTHS.add }} />
                    </colgroup>
                    <thead className="bg-slate-900/50">
                      <tr className="border-b border-slate-800">
                        <th className="text-left text-slate-400 text-xs font-medium py-3 px-4">Symbol</th>
                        <th className="text-left text-slate-400 text-xs font-medium py-3 px-4">Name</th>
                        <th className="text-left text-slate-400 text-xs font-medium py-3 px-4">Underlying Symbol</th>
                        <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Strike</th>
                        <th className="text-left text-slate-400 text-xs font-medium py-3 px-4">Expiration Date</th>
                        <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Price</th>
                        <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Change</th>
                        <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Change %</th>
                        <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Bid</th>
                        <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Ask</th>
                        <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Volume</th>
                        <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Open Interest</th>
                        <th className="text-right text-slate-400 text-xs font-medium py-3 px-4 w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {totalScreenerRows === 0 ? (
                        <tr>
                          <td colSpan={13} className="py-8 px-4 text-center text-slate-400">
                            No screener data available.
                          </td>
                        </tr>
                      ) : paginatedScreenerRows.map((row) => {
                        const optionRow = row as OptionScreenerRow;

                        return (
                          <tr
                            key={optionRow.symbol}
                            onClick={() => navigate(`/research/options/${encodeURIComponent(optionRow.underlyingSymbol || optionRow.symbol)}`, {
                            })}
                            className="border-b border-slate-800/50 hover:bg-slate-800/50 transition-colors cursor-pointer"
                          >
                            <td className="py-3 px-4">
                              <span className="text-slate-100 text-sm font-medium">{optionRow.symbol}</span>
                            </td>
                            <td className="py-3 px-4 text-slate-300 text-sm">{optionRow.name}</td>
                            <td className="py-3 px-4 text-slate-300 text-sm">{optionRow.underlyingSymbol || '-'}</td>
                            <td className="py-3 px-4 text-right text-slate-300 text-sm">
                              {typeof optionRow.strike === 'number' ? optionRow.strike.toFixed(2) : '-'}
                            </td>
                            <td className="py-3 px-4 text-slate-300 text-sm">{optionRow.expirationDate}</td>
                            <td className="py-3 px-4 text-right text-slate-100 text-sm">{formatOptionMoney(optionRow.price)}</td>
                            <td className="py-3 px-4 text-right text-sm">
                              <span className={`${(optionRow.change ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {formatOptionChange(optionRow.change)}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right text-sm">
                              <span className={`${(optionRow.changePercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {formatOptionPercent(optionRow.changePercent)}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right text-slate-300 text-sm">{formatOptionMoney(optionRow.bid)}</td>
                            <td className="py-3 px-4 text-right text-slate-300 text-sm">{formatOptionMoney(optionRow.ask)}</td>
                            <td className="py-3 px-4 text-right text-slate-300 text-sm">{formatOptionCount(optionRow.volume)}</td>
                            <td className="py-3 px-4 text-right text-slate-300 text-sm">{formatOptionCount(optionRow.openInterest)}</td>
                            <td className="py-3 px-4 text-right">
                              <Button
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  addToPortfolio(optionRow.symbol, optionRow.name);
                                }}
                                disabled={
                                  portfolioItems.some(item => item.ticker === optionRow.symbol) ||
                                  portfolioItems.length >= 15
                                }
                                className="h-7 w-7 p-0 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Plus className="w-3 h-3" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full table-fixed">
                    <colgroup>
                      <col style={{ width: SCREENER_COLUMN_WIDTHS.actions }} />
                      <col style={{ width: SCREENER_COLUMN_WIDTHS.symbol }} />
                      <col style={{ width: SCREENER_COLUMN_WIDTHS.name }} />
                      <col style={{ width: SCREENER_COLUMN_WIDTHS.price }} />
                      <col style={{ width: SCREENER_COLUMN_WIDTHS.change }} />
                      <col style={{ width: SCREENER_COLUMN_WIDTHS.changePercent }} />
                      <col style={{ width: SCREENER_COLUMN_WIDTHS.volume }} />
                      <col style={{ width: SCREENER_COLUMN_WIDTHS.marketCap }} />
                      <col style={{ width: SCREENER_COLUMN_WIDTHS.peRatio }} />
                      {!hideAddColumnForOptionsUserSelected && (
                        <col style={{ width: SCREENER_COLUMN_WIDTHS.add }} />
                      )}
                    </colgroup>
                    <thead className="bg-slate-900/50">
                      <tr className="border-b border-slate-800">
                        <th className="text-left text-slate-400 text-xs font-medium py-3 px-4 w-10"></th>
                        <th className="text-left text-slate-400 text-xs font-medium py-3 px-4 min-w-[100px]">Symbol</th>
                        <th className="text-left text-slate-400 text-xs font-medium py-3 px-4 min-w-[180px]">Name</th>
                        <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Price</th>
                        <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Change</th>
                        <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Change %</th>
                        <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Volume</th>
                        <th className="text-right text-slate-400 text-xs font-medium py-3 px-4">Market Cap</th>
                        <th className="text-right text-slate-400 text-xs font-medium py-3 px-4 min-w-[120px]">P/E Ratio (TTM)</th>
                        {!hideAddColumnForOptionsUserSelected && (
                          <th className="text-right text-slate-400 text-xs font-medium py-3 px-4 w-12"></th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {totalScreenerRows === 0 ? (
                        <tr>
                          <td colSpan={hideAddColumnForOptionsUserSelected ? 9 : 10} className="py-8 px-4 text-center text-slate-400">
                            No screener data available.
                          </td>
                        </tr>
                      ) : paginatedScreenerRows.map((asset) => {
                        const stockRow = asset as Asset;

                        return (
                          <tr
                            key={stockRow.ticker}
                            draggable={isScreenerCategory(category) && stockScreenerTab === 'user_selected'}
                            onDragStart={(e) => {
                              if (!(isScreenerCategory(category) && stockScreenerTab === 'user_selected')) return;
                              e.dataTransfer.effectAllowed = 'move';
                              handleUserSelectedDragStart(stockRow.ticker);
                            }}
                            onDragOver={(e) => {
                              if (!(isScreenerCategory(category) && stockScreenerTab === 'user_selected') || !draggedUserSymbol) return;
                              e.preventDefault();
                              setDragOverUserSymbol(stockRow.ticker);
                            }}
                            onDrop={(e) => {
                              if (!(isScreenerCategory(category) && stockScreenerTab === 'user_selected') || !draggedUserSymbol) return;
                              e.preventDefault();
                              handleUserSelectedDrop(stockRow.ticker);
                            }}
                            onDragEnd={handleUserSelectedDragEnd}
                            onClick={() => navigate(
                              getResearchDetailPathForCategory(stockRow.ticker, category),
                              {
                              state: { initialAsset: stockRow },
                              }
                            )}
                            className={`border-b border-slate-800/50 hover:bg-slate-800/50 transition-colors cursor-pointer ${
                              isScreenerCategory(category) && stockScreenerTab === 'user_selected' && dragOverUserSymbol === stockRow.ticker
                                ? 'bg-slate-800/50'
                                : ''
                            }`}
                          >
                            <td className="py-3 px-4 text-left">
                              {isScreenerCategory(category) && stockScreenerTab === 'user_selected' && (
                                <div className="flex items-center gap-2">
                                  <span className="text-slate-500 text-xs cursor-grab select-none" title="Drag to reorder">⋮⋮</span>
                                  <Button
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeUserSelectedStock(stockRow.ticker);
                                    }}
                                    className="h-7 px-2 bg-slate-800/60 hover:bg-red-600/80 text-slate-400 hover:text-red-400 transition-all"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <div className="text-slate-100 text-sm font-medium">{stockRow.ticker}</div>
                            </td>
                            <td className="py-3 px-4">
                              <div className="text-slate-300 text-sm">{stockRow.name}</div>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className="text-slate-100 text-sm">
                                ${stockRow.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className={`text-sm font-medium ${stockRow.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {stockRow.change >= 0 ? '+' : ''}{stockRow.change.toFixed(2)}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className={`text-sm font-medium ${stockRow.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {stockRow.changePercent >= 0 ? '+' : ''}{stockRow.changePercent.toFixed(2)}%
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className="text-slate-300 text-sm">{stockRow.volume}</span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className="text-slate-300 text-sm">{stockRow.marketCap}</span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <span className="text-slate-300 text-sm">{stockRow.peRatio}</span>
                            </td>
                            {!hideAddColumnForOptionsUserSelected && (
                              <td className="py-3 px-4 text-right">
                                <Button
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    addToPortfolio(stockRow.ticker, stockRow.name);
                                  }}
                                  disabled={
                                    portfolioItems.some(item => item.ticker === stockRow.ticker) ||
                                    portfolioItems.length >= 15
                                  }
                                  className="h-7 w-7 p-0 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                >
                                  <Plus className="w-3 h-3" />
                                </Button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
          <TablePagination
            currentPage={safeScreenerPage}
            endRow={screenerEndRow}
            onPageChange={setScreenerCurrentPage}
            onRowsPerPageChange={setScreenerRowsPerPage}
            rowsPerPage={screenerRowsPerPage}
            startRow={screenerStartRow}
            totalPages={totalScreenerPages}
            totalRows={totalScreenerRows}
          />
        </div>
      </div>

      {/* Right Panel - Portfolio Builder - 35% */}
      <div className="w-[420px] flex-shrink-0">
        <div className="sticky top-0 bg-slate-900 border border-slate-800 rounded-lg overflow-hidden h-fit max-h-[calc(100vh-180px)] flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-slate-800 flex-shrink-0">
            {isEditingName ? (
              <input
                type="text"
                value={portfolioName}
                onChange={(e) => setPortfolioName(e.target.value)}
                onBlur={() => setIsEditingName(false)}
                onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)}
                autoFocus
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-slate-100 font-medium focus:outline-none focus:border-emerald-600"
              />
            ) : (
              <h3
                onClick={() => setIsEditingName(true)}
                className="text-slate-100 font-medium cursor-pointer hover:text-emerald-400 transition-colors"
              >
                {portfolioName}
              </h3>
            )}
            <p className="text-slate-500 text-xs mt-1">
              {portfolioItems.length} {portfolioItems.length === 1 ? 'asset' : 'assets'}
            </p>
          </div>

          {/* Total Capital (Optional) */}
          <div className="p-4 border-b border-slate-800 flex-shrink-0">
            <div className="text-slate-400 text-xs mb-2">Portfolio Budget</div>
            {isEditingBudget ? (
              <input
                type="number"
                value={portfolioBudget || ''}
                onChange={(e) => setPortfolioBudget(e.target.value ? parseFloat(e.target.value) : 10000)}
                onBlur={() => setIsEditingBudget(false)}
                onKeyDown={(e) => e.key === 'Enter' && setIsEditingBudget(false)}
                placeholder="Enter amount"
                autoFocus
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-slate-100 font-bold text-xl focus:outline-none focus:border-emerald-600"
              />
            ) : (
              <div
                onClick={() => setIsEditingBudget(true)}
                className="text-slate-100 font-bold text-xl cursor-pointer hover:text-emerald-400 transition-colors"
              >
                {formatCurrency(portfolioBudget)}
              </div>
            )}
          </div>

          {/* Portfolio Items - Scrollable */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {portfolioItems.length === 0 ? (
              <div className="p-8 text-center">
                <div className="text-slate-500 text-sm mb-2">No assets selected</div>
                <div className="text-slate-600 text-xs">
                  Click "+ Add" to start building your portfolio
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {portfolioItems.map((item) => {
                  const percentage = getPercentage(item.amount);
                  
                  return (
                    <div key={item.ticker} className="p-4 hover:bg-slate-800/30 transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-slate-100 text-sm font-medium">{item.ticker}</div>
                          <div className="text-slate-500 text-xs truncate">{item.name}</div>
                        </div>
                        <button
                          onClick={() => removeFromPortfolio(item.ticker)}
                          className="text-slate-500 hover:text-red-400 transition-colors ml-2"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      
                      {/* Amount Input (editable) */}
                      <div className="mb-3">
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                          <input
                            type="number"
                            value={item.amount || ''}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              updateAmount(item.ticker, isNaN(val) ? 0 : val);
                            }}
                            step="100"
                            min="0"
                            max={portfolioBudget}
                            placeholder="0"
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 pl-7 text-slate-100 text-sm focus:outline-none focus:border-emerald-600"
                          />
                        </div>
                      </div>

                      {/* Draggable Slider */}
                      <div className="mb-3">
                        <input
                          type="range"
                          min="0"
                          max={portfolioBudget}
                          step="100"
                          value={item.amount || 0}
                          onChange={(e) => {
                            updateAmount(item.ticker, parseFloat(e.target.value));
                          }}
                          className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:bg-emerald-400 [&::-webkit-slider-thumb]:hover:scale-110 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-emerald-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:transition-all [&::-moz-range-thumb]:hover:bg-emerald-400 [&::-moz-range-thumb]:hover:scale-110"
                          style={{
                            background: `linear-gradient(to right, rgb(16 185 129) 0%, rgb(16 185 129) ${percentage}%, rgb(30 41 59) ${percentage}%, rgb(30 41 59) 100%)`
                          }}
                        />
                      </div>

                      {/* Percentage Display (read-only) */}
                      <div className="mb-2">
                        <div className="text-slate-500 text-xs">
                          Allocation: <span className="text-slate-300 font-medium">{percentage.toFixed(1)}%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {portfolioItems.length > 0 && (
            <div className="p-4 border-t border-slate-800 space-y-4 flex-shrink-0 bg-slate-900">
              {/* Subtle Progress Bar - Capital Deployed */}
              <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500/40 transition-all duration-300"
                  style={{ width: `${Math.min(deployedPercentage, 100)}%` }}
                />
              </div>

              {/* Remaining Cash - Core Metric */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Remaining Cash</span>
                <span className={`font-medium text-base ${
                  isOverAllocated ? 'text-red-400' : 'text-emerald-400'
                }`}>
                  {formatCurrency(remainingCash)}
                </span>
              </div>

              {/* Warning if over-allocated */}
              {isOverAllocated && (
                <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded px-3 py-2">
                  Allocation exceeds total capital
                </div>
              )}

              {/* Warning if under-allocated */}
              {!isOverAllocated && !isFullyAllocated && (
                <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/50 rounded px-3 py-2">
                  Allocate the full portfolio budget before saving
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-2">
                <Button
                  onClick={handleSavePortfolio}
                  disabled={!isValidPortfolio}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save Portfolio
                </Button>
                <Button
                  onClick={handleClearPortfolio}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                >
                  Clear Portfolio
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
