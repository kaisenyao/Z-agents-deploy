import { Search, TrendingUp, TrendingDown, Loader2, ArrowLeft, Download, AlertTriangle } from "lucide-react";
import { Button } from "../components/ui/button";
import { useState, useEffect, useMemo } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { fetchLiveOptionsChain, fetchStockData, fetchYahooQuotePageMetrics, fetchYahooQuotes, searchYahooSymbols } from "../lib/api";
import { useAccountMetrics } from "../hooks/useAccountMetrics";
import { useTradeContext } from "../context/TradeContext";
import { OPTIONS_HOLDINGS, CRYPTO_HOLDINGS, STOCK_HOLDINGS, INITIAL_TRADE_HISTORY } from "../data/portfolioHoldings";
import { PlaceOrderPanel } from "../components/trading/PlaceOrderPanel";
import type { PlaceOrderDraft, OrderRecord, TradingTradeRecord } from "../services/tradingEngine";
import {
  INITIAL_MARGIN_RATE,
  MAINTENANCE_MARGIN_RATE,
  calculateCoverSettlement,
  calculateMaintenanceMargin,
  calculateRequiredInitialMargin,
  createOrderRecordFromDraft,
  executeOrderDecision,
  getBorrowLimit,
} from "../services/tradingEngine";
import {
  loadTradingAccountSnapshot,
  loadTradingOrders,
  loadTradingTrades,
  saveTradingAccountSnapshot,
  saveTradingOrders,
  saveTradingTrades,
} from "../store/tradingStore";
import { useSearchParams } from "react-router";
import { classifyAssetClass, normalizeAssetSymbol } from "../services/assetPricing";
import {
  formatEasternTimeLabel,
  getTradeTabMarketStatus,
  isAssetTradable,
  type TradeAssetType,
} from "../services/marketHours";

function formatVolume(volume: number | null | undefined): string {
  if (typeof volume !== "number" || !Number.isFinite(volume) || volume <= 0) {
    return "-";
  }
  if (volume >= 1_000_000_000_000) return `${(volume / 1_000_000_000_000).toFixed(2)}T`;
  if (volume >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(2)}B`;
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(2)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(2)}K`;
  return Math.round(volume).toString();
}

function formatCompactNumber(value: number | undefined | null) {
  if (value === undefined || value === null || !Number.isFinite(value) || value <= 0) return '-';
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatMoney(value: number | undefined | null, fractionDigits: number = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatDetailMetricMoney(value: number | undefined | null, fractionDigits: number = 2): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `$${formatMoney(value, fractionDigits)}`;
}

function parseOptionDate(value: string | number | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    const timestamp = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatOptionLastTradeDate(value: string | number | Date | null | undefined): string {
  const date = parseOptionDate(value);
  if (!date) return "N/A";

  return date.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/New_York",
  });
}

function formatOptionExpirationLabel(value: string | number | Date): string {
  const date = parseOptionDate(value);
  if (!date) return "Invalid date";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatPercentChange(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

type OrderHistoryFilter = "ALL" | "OPEN" | "FILLED" | "CANCELLED" | "REJECTED";
type OrderHistorySortKey = "id" | "symbol" | "asset" | "side" | "orderType" | "quantity" | "price" | "total" | "status" | "time";
type OrderHistorySortDirection = "asc" | "desc";
type CanonicalOrderStatus = "PENDING" | "FILLED" | "CANCELLED" | "REJECTED";

interface OrderHistoryRow {
  id: string;
  symbol: string;
  asset: string;
  side: string;
  orderType: string;
  quantity: number;
  priceText: string;
  totalText: string;
  status: CanonicalOrderStatus;
  statusLabel: string;
  timeValue: string;
  timeMs: number;
  priceValue: number | null;
  totalValue: number | null;
  details?: string;
}

function formatOrderTypeLabel(orderType: OrderRecord["orderType"] | string | undefined): string {
  if (orderType === "STOP_LIMIT") return "Stop Limit";
  if (orderType === "TRAILING_STOP") return "Trailing Stop";
  if (orderType === "MARKET") return "Market";
  if (orderType === "LIMIT") return "Limit";
  return "Market";
}

const ETF_DESCRIPTION_PATTERN = /\bETF\b|Trust|Fund|Index/i;
const ETF_SYMBOLS = new Set<string>([
  ...STOCK_HOLDINGS
    .filter((holding) => ETF_DESCRIPTION_PATTERN.test(String(holding.description || "")))
    .map((holding) => String(holding.symbol || "").toUpperCase()),
  ...INITIAL_TRADE_HISTORY
    .filter((trade) => trade.assetType === "ETF")
    .map((trade) => String(trade.symbol || "").toUpperCase()),
]);

const CRYPTO_SYMBOLS = new Set<string>([
  ...CRYPTO_HOLDINGS.map((holding) => String(holding.symbol || "").toUpperCase()),
  ...INITIAL_TRADE_HISTORY
    .filter((trade) => trade.assetType === "Crypto")
    .map((trade) => String(trade.symbol || "").toUpperCase()),
]);

function inferAssetFromSymbol(symbol: string | undefined): string {
  const normalized = String(symbol || "").trim().toUpperCase();
  const baseSymbol = normalized.replace(/-USD$/i, "");
  if (!normalized) return "Stock";
  if (CRYPTO_SYMBOLS.has(normalized) || CRYPTO_SYMBOLS.has(baseSymbol) || normalized.endsWith("-USD")) return "Crypto";
  if (ETF_SYMBOLS.has(normalized) || ETF_SYMBOLS.has(baseSymbol)) return "ETF";
  if (/^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(normalized) || /^[A-Z]{1,6}\s+\d{1,2}\/\d{1,2}\s+\d+(\.\d+)?[CP]$/.test(normalized)) {
    return "Option";
  }
  return "Stock";
}

function toTradeAssetType(value: string | undefined | null): TradeAssetType {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "crypto") return "crypto";
  if (normalized === "etf") return "etf";
  if (normalized === "stock") return "stock";
  if (normalized === "option") return "option";
  if (normalized === "cash") return "cash";
  return "unknown";
}

function TradeMarketStatusIndicator({
  isOpen,
  timeLabel,
}: {
  isOpen: boolean;
  timeLabel: string;
}) {
  const label = isOpen ? "Market Open" : "Market Closed";
  const dotColor = isOpen ? "#10b981" : "#ef4444";

  return (
    <div className="flex items-center gap-2">
      <div
        className="w-2 h-2 rounded-full animate-pulse"
        style={{ backgroundColor: dotColor }}
      ></div>
      <span className="text-slate-400 text-sm">{label}</span>
      <span className="text-slate-400 text-sm">· {timeLabel}</span>
    </div>
  );
}

function normalizeOrderStatus(status: string | undefined): CanonicalOrderStatus {
  if (status === "FILLED") return "FILLED";
  if (status === "PENDING") return "PENDING";
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "REJECTED") return "REJECTED";
  return "PENDING";
}

function getStatusLabel(status: CanonicalOrderStatus): string {
  if (status === "FILLED") return "Filled";
  if (status === "PENDING") return "Pending";
  if (status === "CANCELLED") return "Cancelled";
  if (status === "REJECTED") return "Rejected";
  return "Pending";
}

function getTrailingLabel(mode?: string, value?: number) {
  if (!Number.isFinite(value)) return "—";
  if (mode === "PERCENT") return `${formatMoney(value)}%`;
  return `$${formatMoney(value)}`;
}

function getOrderHistoryStatusRank(status: CanonicalOrderStatus): number {
  if (status === "PENDING") return 0;
  if (status === "FILLED") return 1;
  if (status === "CANCELLED") return 2;
  if (status === "REJECTED") return 3;
  return 4;
}

function compareNullableNumbers(a: number | null, b: number | null) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function mapOrderToHistoryRow(order: Partial<OrderRecord>): OrderHistoryRow {
  const quantity = Number(order.quantity) > 0 ? Number(order.quantity) : 0;
  const status = normalizeOrderStatus(order.status);
  const orderType = String(order.orderType || "MARKET");
  const duration = order.duration || "DAY";
  const hasFilledPrice = Number.isFinite(order.filledPrice);
  const hasLimitPrice = Number.isFinite(order.limitPrice);
  const hasStopPrice = Number.isFinite(order.stopPrice);
  const priceText =
    status === "FILLED" && hasFilledPrice
      ? `$${formatMoney(order.filledPrice)}`
      : orderType === "LIMIT" || orderType === "STOP_LIMIT"
        ? (hasLimitPrice ? `$${formatMoney(order.limitPrice)}` : "—")
        : orderType === "TRAILING_STOP"
          ? getTrailingLabel(order.trailMode, order.trailValue)
          : "MKT";

  const totalText =
    status === "FILLED" && hasFilledPrice
      ? `$${formatMoney((order.filledPrice as number) * quantity)}`
      : orderType === "LIMIT" || orderType === "STOP_LIMIT"
        ? (hasLimitPrice ? `$${formatMoney((order.limitPrice as number) * quantity)}` : "—")
        : "—";

  const details =
    orderType === "STOP_LIMIT"
      ? `Stop: ${hasStopPrice ? `$${formatMoney(order.stopPrice)}` : "—"}, Limit: ${hasLimitPrice ? `$${formatMoney(order.limitPrice)}` : "—"} · ${duration}`
      : orderType === "TRAILING_STOP"
        ? `Trail: ${getTrailingLabel(order.trailMode, order.trailValue)} · ${duration}`
        : duration;

  const timeValue = status === "FILLED" && order.filledAt ? order.filledAt : order.createdAt || "";
  const timeMs = new Date(timeValue).getTime();

  return {
    id: String(order.id || "N/A"),
    symbol: String(order.symbol || "N/A"),
    asset: inferAssetFromSymbol(order.symbol),
    side: String(order.action || "BUY"),
    orderType: formatOrderTypeLabel(orderType),
    quantity,
    priceText,
    totalText,
    status,
    statusLabel: getStatusLabel(status),
    timeValue,
    timeMs: Number.isFinite(timeMs) ? timeMs : 0,
    priceValue: status === "FILLED" && hasFilledPrice ? Number(order.filledPrice) : (hasLimitPrice ? Number(order.limitPrice) : null),
    totalValue:
      status === "FILLED" && hasFilledPrice
        ? Number(order.filledPrice) * quantity
        : (hasLimitPrice ? Number(order.limitPrice) * quantity : null),
    details,
  };
}

function mapBrokerTradeToHistoryRow(trade: Partial<TradingTradeRecord>): OrderHistoryRow {
  const quantity = Number(trade.quantity) > 0 ? Number(trade.quantity) : 0;
  const notional = Number.isFinite(trade.notional) ? Number(trade.notional) : quantity * (Number(trade.price) || 0);
  const timeValue = String(trade.createdAt || "");
  const timeMs = new Date(timeValue).getTime();

  return {
    id: String(trade.orderId || trade.id || "N/A"),
    symbol: String(trade.symbol || "N/A"),
    asset: inferAssetFromSymbol(trade.symbol),
    side: String(trade.side || "BUY"),
    orderType: "Market",
    quantity,
    priceText: Number.isFinite(trade.price) ? `$${formatMoney(trade.price)}` : "—",
    totalText: Number.isFinite(notional) ? `$${formatMoney(notional)}` : "—",
    status: "FILLED",
    statusLabel: "Filled",
    timeValue,
    timeMs: Number.isFinite(timeMs) ? timeMs : 0,
    priceValue: Number.isFinite(trade.price) ? Number(trade.price) : null,
    totalValue: Number.isFinite(notional) ? Number(notional) : null,
  };
}

function mapLegacyTradeToHistoryRow(trade: any): OrderHistoryRow {
  const status: CanonicalOrderStatus = trade?.status === "PENDING"
    ? "PENDING"
    : trade?.status === "REJECTED"
      ? "REJECTED"
      : trade?.status === "CANCELLED"
        ? "CANCELLED"
        : "FILLED";
  const quantity = Number(trade?.quantity) > 0 ? Number(trade.quantity) : 0;
  const price = Number(trade?.price);
  const total = Number.isFinite(trade?.total) ? Number(trade.total) : quantity * (Number.isFinite(price) ? price : 0);
  const timeValue = String(trade?.date || "");
  const timeMs = new Date(timeValue).getTime();

  return {
    id: String(trade?.id || "N/A"),
    symbol: String(trade?.symbol || "N/A"),
    asset: String(trade?.assetType || inferAssetFromSymbol(trade?.symbol)),
    side: String(trade?.side || "Buy"),
    orderType: "Market",
    quantity,
    priceText: Number.isFinite(price) ? `$${formatMoney(price)}` : "—",
    totalText: Number.isFinite(total) ? `$${formatMoney(total)}` : "—",
    status,
    statusLabel: getStatusLabel(status),
    timeValue,
    timeMs: Number.isFinite(timeMs) ? timeMs : 0,
    priceValue: Number.isFinite(price) ? price : null,
    totalValue: Number.isFinite(total) ? total : null,
  };
}

function getQuoteNumber(value: any): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value?.raw === "number" && Number.isFinite(value.raw)) {
    return value.raw;
  }

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

function formatXAxisTimestamp(timestamp: number, chartTimeRange: string): string {
  const date = new Date(timestamp * 1000);
  if (chartTimeRange === "1D") {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  if (chartTimeRange === "ALL") {
    return date.toLocaleDateString("en-US", { year: "numeric" });
  }
  if (chartTimeRange === "YTD" || chartTimeRange === "1Y") {
    return date.toLocaleDateString("en-US", { month: "short" });
  }
  return date.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
  });
}

function formatTooltipTimestamp(timestamp: number, chartTimeRange: string): string {
  const date = new Date(timestamp * 1000);
  if (chartTimeRange === "1D") {
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getChartMinTickGap(chartTimeRange: string): number {
  if (chartTimeRange === "1D") return 28;
  if (chartTimeRange === "1W") return 36;
  if (chartTimeRange === "1M" || chartTimeRange === "3M") return 40;
  if (chartTimeRange === "YTD" || chartTimeRange === "1Y") return 48;
  return 52;
}

interface StockSearchResult {
  symbol: string;
  name: string;
  exchange?: string;
  lookupSymbol?: string;
}

function isRelevantEquitySearchResult(item: any) {
  const quoteType = String(item?.quoteType || "").toUpperCase();
  return (
    quoteType === "EQUITY" ||
    quoteType === "ETF"
  );
}

const DIRECT_CRYPTO_SYMBOLS = new Set([
  "BTC",
  "ETH",
  "SOL",
  "DOGE",
  "ADA",
  "XRP",
  "DOT",
  "AVAX",
  "LTC",
  "BCH",
  "LINK",
  "MATIC",
]);

function normalizeCryptoLookupSymbol(symbol: string) {
  const upper = symbol.trim().toUpperCase();
  if (!upper) return upper;
  if (upper.endsWith("-USD")) return upper;
  return DIRECT_CRYPTO_SYMBOLS.has(upper) ? `${upper}-USD` : upper;
}

function dedupeSearchResults(results: StockSearchResult[]) {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${result.lookupSymbol || result.symbol}|${result.exchange || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchTradeEquitySearchResults(query: string): Promise<StockSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const searchResults = await searchYahooSymbols(trimmed);

  const mappedYahoo = searchResults
    .filter((item: any) => isRelevantEquitySearchResult(item))
    .map((item: any) => {
      const rawSymbol = String(item.symbol || "").toUpperCase();
      return {
        symbol: rawSymbol,
        name: item.shortname || item.longname || rawSymbol || "Unknown",
        exchange: item.exchDisp || item.exchange,
        lookupSymbol: rawSymbol,
      };
    })
    .filter((item: StockSearchResult) => !!item.symbol);

  return dedupeSearchResults(mappedYahoo).slice(0, 8);
}

async function fetchTradeCryptoSearchResults(query: string): Promise<StockSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const upperQuery = trimmed.toUpperCase();
  const isDirectCryptoQuery =
    DIRECT_CRYPTO_SYMBOLS.has(upperQuery) || upperQuery.endsWith("-USD");
  const normalizedCryptoLookup = normalizeCryptoLookupSymbol(upperQuery);

  const [searchResults, directCryptoQuotes] = await Promise.all([
    searchYahooSymbols(trimmed),
    isDirectCryptoQuery ? fetchYahooQuotes([normalizedCryptoLookup]) : Promise.resolve([]),
  ]);

  const mappedYahoo = searchResults
    .filter((item: any) => {
      const quoteType = String(item?.quoteType || "").toUpperCase();
      const symbol = String(item?.symbol || "").toUpperCase();
      return quoteType === "CRYPTOCURRENCY" || quoteType === "CURRENCY" || symbol.endsWith("-USD");
    })
    .map((item: any) => {
      const rawSymbol = String(item.symbol || "").toUpperCase();
      const displaySymbol = rawSymbol.replace(/-USD$/i, "");
      return {
        symbol: displaySymbol,
        name: item.shortname || item.longname || rawSymbol || "Unknown",
        exchange: "Crypto",
        lookupSymbol: normalizeCryptoLookupSymbol(displaySymbol),
      };
    })
    .filter((item: StockSearchResult) => !!item.symbol);

  const directCryptoResult = (() => {
    if (!isDirectCryptoQuery || !directCryptoQuotes.length) return [];
    const quote = directCryptoQuotes[0];
    if (!quote?.symbol) return [];
    const displaySymbol = upperQuery.replace(/-USD$/i, "");
    return [{
      symbol: displaySymbol,
      name: quote.shortName || quote.longName || `${displaySymbol} USD`,
      exchange: "Crypto",
      lookupSymbol: String(quote.symbol).toUpperCase(),
    }];
  })();

  return dedupeSearchResults([...directCryptoResult, ...mappedYahoo]).slice(0, 8);
}

async function fetchTradeOptionsSearchResults(query: string): Promise<StockSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const searchResults = await searchYahooSymbols(trimmed);
  const mappedYahoo = searchResults
    .filter((item: any) => {
      const quoteType = String(item?.quoteType || "").toUpperCase();
      return quoteType === "EQUITY" || quoteType === "ETF";
    })
    .map((item: any) => {
      const rawSymbol = String(item.symbol || "").toUpperCase();
      return {
        symbol: rawSymbol,
        name: item.shortname || item.longname || rawSymbol || "Unknown",
        exchange: item.exchDisp || item.exchange,
        lookupSymbol: rawSymbol,
      };
    })
    .filter((item: StockSearchResult) => !!item.symbol);

  return dedupeSearchResults(mappedYahoo).slice(0, 8);
}

export function Trade() {
  const { executeTrade, holdings, shortPositions, cash, shortProceeds, marginHeld, tradeHistory } = useTradeContext();
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<
    "stocks" | "options" | "crypto" | "orders"
  >("stocks");
  const [selectedStockSymbol, setSelectedStockSymbol] = useState<string | null>(null);
  const [selectedCryptoSymbol, setSelectedCryptoSymbol] = useState<string | null>(null);
  const [stockSearchQuery, setStockSearchQuery] = useState("");
  const [cryptoSearchQuery, setCryptoSearchQuery] = useState("");
  const [chartTimeRange, setChartTimeRange] = useState("1D");
  
  // Real-time detail data state for the active trade tab
  const [isLoadingStock, setIsLoadingStock] = useState(false);
  const [liveStockData, setLiveStockData] = useState<any>(null);
  const [liveChartData, setLiveChartData] = useState<any[]>([]);
  const [searchError, setSearchError] = useState<string>("");
  const [stockSearchResults, setStockSearchResults] = useState<StockSearchResult[]>([]);
  const [cryptoSearchResults, setCryptoSearchResults] = useState<StockSearchResult[]>([]);

  // Options-specific state
  const [optionsSearchQuery, setOptionsSearchQuery] =
    useState("");
  const [optionsSearchResults, setOptionsSearchResults] = useState<StockSearchResult[]>([]);
  const [selectedOptionsSymbol, setSelectedOptionsSymbol] =
    useState<string | null>(null);
  const [selectedExpiration, setSelectedExpiration] =
    useState("");
  const [availableExpirationDates, setAvailableExpirationDates] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedView, setSelectedView] =
    useState("Near the Money");
  const [optionType, setOptionType] = useState<'calls' | 'puts'>('calls');
  const [optionsChainData, setOptionsChainData] = useState<{
    calls: any[];
    puts: any[];
  }>({ calls: [], puts: [] });
  const [marketClock, setMarketClock] = useState(() => new Date());

  // Holdings data - Use TradeContext as source of truth
  const [optionsHoldings] = useState(OPTIONS_HOLDINGS);
  const [cryptoHoldings] = useState(CRYPTO_HOLDINGS);
  const shortsHoldings = useMemo(
    () =>
      Array.from(shortPositions.values()).map((shortHolding) => ({
        symbol: shortHolding.symbol,
        description: shortHolding.description,
        quantity: shortHolding.quantity,
        currentPrice: shortHolding.currentPrice,
        avgShortPrice: shortHolding.avgCost || shortHolding.purchasePrice || 0,
        purchaseDate: shortHolding.purchaseDate,
      })),
    [shortPositions],
  );
  const [brokerOrders, setBrokerOrders] = useState<OrderRecord[]>(() => loadTradingOrders());
  const [brokerTrades, setBrokerTrades] = useState<TradingTradeRecord[]>(() => loadTradingTrades());

  useEffect(() => {
    if (searchParams.get("tab") === "orders") {
      setActiveTab("orders");
    }
  }, [searchParams]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setMarketClock(new Date());
    }, 30000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const runSearch = async () => {
      const query = stockSearchQuery.trim();
      if (activeTab !== "stocks" || selectedStockSymbol || !query) {
        if (mounted) {
          setStockSearchResults([]);
        }
        return;
      }

      try {
        const results = await fetchTradeEquitySearchResults(query);
        if (mounted) {
          setStockSearchResults(results);
        }
      } catch (error) {
        console.error("Trade symbol search failed:", error);
        if (mounted) {
          setStockSearchResults([]);
        }
      }
    };

    const timer = window.setTimeout(runSearch, 250);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
    }, [activeTab, selectedStockSymbol, stockSearchQuery]);

  useEffect(() => {
    let mounted = true;

    const runCryptoSearch = async () => {
      const query = cryptoSearchQuery.trim();
      if (activeTab !== "crypto" || selectedCryptoSymbol || !query) {
        if (mounted) {
          setCryptoSearchResults([]);
        }
        return;
      }

      try {
        const results = await fetchTradeCryptoSearchResults(query);
        if (mounted) {
          setCryptoSearchResults(results);
        }
      } catch (error) {
        console.error("Crypto symbol search failed:", error);
        if (mounted) {
          setCryptoSearchResults([]);
        }
      }
    };

    const timer = window.setTimeout(runCryptoSearch, 250);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [activeTab, selectedCryptoSymbol, cryptoSearchQuery]);

  useEffect(() => {
    let mounted = true;

    const runOptionsSearch = async () => {
      const query = optionsSearchQuery.trim();
      if (activeTab !== "options" || selectedOptionsSymbol || !query) {
        if (mounted) {
          setOptionsSearchResults([]);
        }
        return;
      }

      try {
        const results = await fetchTradeOptionsSearchResults(query);
        if (mounted) {
          setOptionsSearchResults(results);
        }
      } catch (error) {
        console.error("Options symbol search failed:", error);
        if (mounted) {
          setOptionsSearchResults([]);
        }
      }
    };

    const timer = window.setTimeout(runOptionsSearch, 250);
    return () => {
      mounted = false;
      window.clearTimeout(timer);
    };
  }, [activeTab, selectedOptionsSymbol, optionsSearchQuery]);

  // Calculate account metrics from TradeContext holdings - ensures consistency with Dashboard
  const accountMetrics = useAccountMetrics(
    holdings.filter((holding) => classifyAssetClass(holding.symbol, holding.description, holding.assetType) !== 'crypto'),
    optionsHoldings,
    [
      ...cryptoHoldings,
      ...holdings
        .filter((holding) => classifyAssetClass(holding.symbol, holding.description, holding.assetType) === 'crypto')
        .map((holding) => ({
          symbol: normalizeAssetSymbol(holding.symbol),
          description: holding.description,
          quantity: holding.quantity,
          currentPrice: holding.currentPrice,
          purchasePrice: holding.avgCost || holding.purchasePrice,
          todayChange: holding.todayChange,
          purchaseDate: holding.purchaseDate || new Date().toISOString(),
          previousClosePrice: holding.previousClosePrice,
          assetType: 'Crypto' as const,
        })),
    ],
    shortsHoldings,
    cash,
    shortProceeds,
    marginHeld,
    tradeHistory,
  );

  // Persist paper-trading state (versioned keys)
  useEffect(() => {
    saveTradingOrders(brokerOrders);
  }, [brokerOrders]);

  useEffect(() => {
    saveTradingTrades(brokerTrades);
  }, [brokerTrades]);

  useEffect(() => {
    const accountMaintenanceRequired = Array.from(shortPositions.values()).reduce((sum, shortHolding) => {
      const qty = Number(shortHolding.quantity) || 0;
      const px = Number(shortHolding.currentPrice || shortHolding.avgCost || shortHolding.purchasePrice || 0);
      return sum + calculateMaintenanceMargin(qty * px, MAINTENANCE_MARGIN_RATE);
    }, 0);
    const accountMarginBuffer = cash + marginHeld;

    saveTradingAccountSnapshot({
      buyingPower: cash,
      reservedBuyingPower: 0,
      holdings: holdings.map((holding) => ({
        symbol: holding.symbol,
        quantity: holding.quantity,
        avgCost: holding.avgCost || holding.purchasePrice || 0,
      })),
      positions: [
        ...holdings.map((holding) => ({
          symbol: holding.symbol,
          longQty: Number(holding.quantity) || 0,
          longAvgCost: Number(holding.avgCost || holding.purchasePrice || 0),
          shortQty: 0,
          shortAvgPrice: 0,
        })),
        ...Array.from(shortPositions.values())
          .filter((shortHolding) => Number(shortHolding.quantity) > 0)
          .map((shortHolding) => ({
            symbol: shortHolding.symbol,
            longQty: 0,
            longAvgCost: 0,
            shortQty: Number(shortHolding.quantity) || 0,
            shortAvgPrice: Number(shortHolding.avgCost || shortHolding.purchasePrice || 0),
          })),
      ],
      shortProceeds,
      marginHeld,
      marginCall: accountMarginBuffer < accountMaintenanceRequired,
      totalEquity: accountMetrics.totalPortfolioValue,
      updatedAt: new Date().toISOString(),
    });
  }, [cash, holdings, shortPositions, shortProceeds, marginHeld, accountMetrics.totalPortfolioValue]);

  // Initialize from snapshot only if legacy cash/holdings keys are empty (non-destructive)
  useEffect(() => {
    const snapshot = loadTradingAccountSnapshot();
    if (!snapshot) return;
    if (holdings.length > 0) return;
    if (cash > 0) return;
    if (!Number.isFinite(snapshot.buyingPower)) return;
    // Keep this hook as a future migration point without overwriting existing local data.
  }, [cash, holdings.length]);

  // Fetch options data when symbol or expiration changes
  useEffect(() => {
    let mounted = true;

    const fetchOptionsChain = async () => {
      if (!selectedOptionsSymbol) {
        if (mounted) {
          setAvailableExpirationDates([]);
          setOptionsChainData({ calls: [], puts: [] });
          setSelectedExpiration("");
        }
        return;
      }

      try {
        const metadata = await fetchLiveOptionsChain(selectedOptionsSymbol);
        const expirationDates: string[] = metadata?.expirationDates || [];
        if (!expirationDates.length) {
          throw new Error("No expiration dates returned from live options endpoint");
        }

        const fetchedExpirationDates = expirationDates.map((isoDate) => {
          const date = new Date(isoDate);
          return {
            value: date.toISOString().split("T")[0],
            label: formatOptionExpirationLabel(isoDate),
          };
        });

        if (mounted) {
          setAvailableExpirationDates(fetchedExpirationDates.map(({ value, label }) => ({ value, label })));
        }

        const selectedDateData =
          fetchedExpirationDates.find((date) => date.value === selectedExpiration) || fetchedExpirationDates[0];

        if (mounted && selectedDateData.value !== selectedExpiration) {
          setSelectedExpiration(selectedDateData.value);
        }

        const liveChain = await fetchLiveOptionsChain(selectedOptionsSymbol, selectedDateData.value);
        if (!liveChain) {
          throw new Error("No options data returned for selected expiration");
        }

        if (mounted) {
          setOptionsChainData({ calls: liveChain.calls || [], puts: liveChain.puts || [] });
        }
      } catch (error) {
        console.error("Failed to fetch options chain:", error);
        if (mounted) {
          setAvailableExpirationDates([]);
          setOptionsChainData({ calls: [], puts: [] });
          setSelectedExpiration("");
        }
      }
    };

    fetchOptionsChain();
    return () => {
      mounted = false;
    };
  }, [selectedOptionsSymbol, selectedExpiration]);

  const executeOptionsSearchResult = (result: StockSearchResult) => {
    const displaySymbol = result.symbol.toUpperCase();
    const lookupSymbol = result.lookupSymbol || displaySymbol;

    setLiveStockData(null);
    setLiveChartData([]);
    setOptionsChainData({ calls: [], puts: [] });
    setOptionsSearchQuery(displaySymbol);
    setOptionsSearchResults([]);
    setSearchError("");
    setIsLoadingStock(true);
    setSelectedOptionsSymbol(lookupSymbol);
  };

  const executeTradeSearchResult = (result: StockSearchResult, tab: "stocks" | "crypto") => {
    const displaySymbol = result.symbol.toUpperCase();
    const lookupSymbol = tab === "crypto"
      ? (result.lookupSymbol || normalizeCryptoLookupSymbol(displaySymbol))
      : (result.lookupSymbol || displaySymbol);

    setLiveStockData(null);
    setLiveChartData([]);
    setSelectedOptionsSymbol(null);
    setSearchError("");
    setIsLoadingStock(true);

    if (tab === "stocks") {
      setStockSearchQuery(displaySymbol);
      setStockSearchResults([]);
      setSelectedStockSymbol(lookupSymbol);
    } else {
      setCryptoSearchQuery(displaySymbol);
      setCryptoSearchResults([]);
      setSelectedCryptoSymbol(lookupSymbol);
    }
  };

  const handleOptionsSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = optionsSearchQuery.trim();
    if (!query) return;

    setIsLoadingStock(true);
    setSearchError("");

    try {
      const results = await fetchTradeOptionsSearchResults(query);
      setOptionsSearchResults(results);

      if (results.length === 0) {
        setSearchError(`No results found for "${query.toUpperCase()}".`);
        setIsLoadingStock(false);
        return;
      }

      executeOptionsSearchResult(results[0]);
    } catch (error) {
      console.error("Options symbol search failed:", error);
      setOptionsSearchResults([]);
      setSearchError(`Unable to search for "${query.toUpperCase()}". Please try again.`);
      setIsLoadingStock(false);
    }
  };

  const handleSelectOptionsSearchResult = (result: StockSearchResult) => {
    executeOptionsSearchResult(result);
  };

  // Realistic trading chart data for each timeframe
  const chartDataByTimeRange: Record<
    string,
    Array<{ time: string; price: number }>
  > = {
    "1D": [
      { time: "9:30", price: 135.8 },
      { time: "9:45", price: 136.5 },
      { time: "10:00", price: 136.2 },
      { time: "10:30", price: 137.4 },
      { time: "11:00", price: 136.9 },
      { time: "11:30", price: 135.5 },
      { time: "12:00", price: 134.8 },
      { time: "12:30", price: 135.2 },
      { time: "13:00", price: 136.1 },
      { time: "13:30", price: 137.2 },
      { time: "14:00", price: 138.5 },
      { time: "14:30", price: 137.8 },
      { time: "15:00", price: 139.2 },
      { time: "15:30", price: 140.1 },
      { time: "16:00", price: 140.25 },
    ],
    "1W": [
      { time: "Mon", price: 132.5 },
      { time: "Tue", price: 133.8 },
      { time: "Wed", price: 135.2 },
      { time: "Thu", price: 134.1 },
      { time: "Fri", price: 136.5 },
      { time: "Sat", price: 138.4 },
      { time: "Sun", price: 140.25 },
    ],
    "1M": [
      { time: "Feb 1", price: 128.5 },
      { time: "Feb 5", price: 130.2 },
      { time: "Feb 8", price: 129.8 },
      { time: "Feb 12", price: 132.1 },
      { time: "Feb 15", price: 134.5 },
      { time: "Feb 18", price: 133.2 },
      { time: "Feb 22", price: 136.8 },
      { time: "Feb 25", price: 138.5 },
      { time: "Feb 28", price: 140.25 },
    ],
    "3M": [
      { time: "Dec", price: 118.5 },
      { time: "Dec 15", price: 122.3 },
      { time: "Jan", price: 124.8 },
      { time: "Jan 15", price: 120.5 },
      { time: "Feb", price: 128.2 },
      { time: "Feb 15", price: 134.5 },
      { time: "Feb 28", price: 140.25 },
    ],
    "YTD": [
      { time: "Jan", price: 132.5 },
      { time: "Feb", price: 138.4 },
      { time: "Mar", price: 140.25 },
    ],
    "1Y": [
      { time: "Mar", price: 108.13 },
      { time: "Apr", price: 115.4 },
      { time: "May", price: 112.8 },
      { time: "Jun", price: 118.5 },
      { time: "Jul", price: 124.2 },
      { time: "Aug", price: 128.9 },
      { time: "Sep", price: 135.4 },
      { time: "Oct", price: 142.6 },
      { time: "Nov", price: 138.2 },
      { time: "Dec", price: 132.5 },
      { time: "Jan", price: 128.8 },
      { time: "Feb", price: 140.25 },
    ],
    ALL: [
      { time: "2018", price: 28.5 },
      { time: "2019", price: 35.8 },
      { time: "2020", price: 42.2 },
      { time: "2021", price: 58.9 },
      { time: "2022", price: 48.5 },
      { time: "2023", price: 95.2 },
      { time: "2024", price: 142.3 },
      { time: "2025", price: 138.2 },
      { time: "2026", price: 140.25 },
    ],
  };

  const currentChartData = chartDataByTimeRange[chartTimeRange];
  const changeLabel = "Today";

  // Custom tooltip
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

  const formatTradeTimestamp = (timestamp: string) =>
    (() => {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return timestamp || "N/A";
      return date.toLocaleString("en-US", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    })();

  const getOrderStatusClasses = (status: CanonicalOrderStatus) => {
    if (status === "REJECTED") {
      return "bg-red-900/30 text-red-400 border border-red-800/50";
    }

    if (status === "PENDING") {
      return "bg-yellow-900/30 text-yellow-400 border border-yellow-800/50";
    }

    if (status === "CANCELLED") {
      return "bg-slate-800 text-slate-300 border border-slate-700";
    }

    return "bg-emerald-900/30 text-emerald-400 border border-emerald-800/50";
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = stockSearchQuery.trim();
    if (!query) return;

    setIsLoadingStock(true);
    setSearchError("");

    try {
      const results = await fetchTradeEquitySearchResults(query);
      setStockSearchResults(results);

      if (results.length === 0) {
        setSearchError(`No results found for "${query.toUpperCase()}".`);
        setIsLoadingStock(false);
        return;
      }

      executeTradeSearchResult(results[0], "stocks");
    } catch (error) {
      console.error("Trade symbol search failed:", error);
      setStockSearchResults([]);
      setSearchError(`Unable to search for "${query.toUpperCase()}". Please try again.`);
      setIsLoadingStock(false);
    }
  };

  const handleSelectStockSearchResult = (result: StockSearchResult) => {
    executeTradeSearchResult(result, "stocks");
  };

  const handleCryptoSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = cryptoSearchQuery.trim();
    if (!query) return;

    setIsLoadingStock(true);
    setSearchError("");

    try {
      const results = await fetchTradeCryptoSearchResults(query);
      setCryptoSearchResults(results);

      if (results.length === 0) {
        setSearchError(`No results found for "${query.toUpperCase()}".`);
        setIsLoadingStock(false);
        return;
      }

      executeTradeSearchResult(results[0], "crypto");
    } catch (error) {
      console.error("Crypto symbol search failed:", error);
      setCryptoSearchResults([]);
      setSearchError(`Unable to search for "${query.toUpperCase()}". Please try again.`);
      setIsLoadingStock(false);
    }
  };

  const handleSelectCryptoSearchResult = (result: StockSearchResult) => {
    executeTradeSearchResult(result, "crypto");
  };

  // Effect to load live detail data for the active trade tab
  useEffect(() => {
    const symbolToUse = activeTab === "options"
      ? selectedOptionsSymbol
      : activeTab === "crypto"
        ? selectedCryptoSymbol
        : activeTab === "stocks"
          ? selectedStockSymbol
          : null;
    if (!symbolToUse) return;

    let isActive = true;

    let interval = "1d";
    let queryRange = chartTimeRange.toLowerCase();
    if (chartTimeRange === "1D") {
      interval = "5m";
      queryRange = "1d";
    } else if (chartTimeRange === "1W") {
      interval = "15m";
      queryRange = "5d";
    } else if (chartTimeRange === "1M") {
      interval = "1d";
      queryRange = "1mo";
    } else if (chartTimeRange === "3M") {
      interval = "1d";
      queryRange = "3mo";
    } else if (chartTimeRange === "YTD") {
      interval = "1d";
      queryRange = "ytd";
    } else if (chartTimeRange === "1Y") {
      interval = "1d";
      queryRange = "1y";
    } else if (chartTimeRange === "ALL") {
      interval = "1mo";
      queryRange = "max";
    }

    const loadData = async () => {
      setIsLoadingStock(true);

      try {
        const [data, daySummaryData, yearSummaryData, volumeSummaryData, quotes, pageMetrics] = await Promise.all([
          fetchStockData(symbolToUse, queryRange, interval),
          fetchStockData(symbolToUse, "1d", "5m"),
          fetchStockData(symbolToUse, "1y", "1d"),
          fetchStockData(symbolToUse, "5d", "1d"),
          fetchYahooQuotes([symbolToUse]),
          fetchYahooQuotePageMetrics(symbolToUse),
        ]);

        if (!isActive) return;

        const quote = quotes && quotes.length > 0 ? quotes[0] : null;
        const daySummary = getChartExtremes(daySummaryData);
        const yearSummary = getChartExtremes(yearSummaryData);
        const summaryVolume = getLatestVolumeFromChart(volumeSummaryData);

        if (data?.indicators?.quote?.[0]?.close) {
          const closes = data.indicators.quote[0].close.filter(c => c !== null);
          const opens = data.indicators.quote[0].open.filter(c => c !== null);
          const highs = data.indicators.quote[0].high.filter(c => c !== null);
          const lows = data.indicators.quote[0].low.filter(c => c !== null);
          const volumes = data.indicators.quote[0].volume.filter(c => c !== null);
          const timestamps = Array.isArray(data.timestamp) ? data.timestamp : [];
          const rawCloses = Array.isArray(data.indicators?.quote?.[0]?.close)
            ? data.indicators.quote[0].close
            : [];
          const summaryCloses = (volumeSummaryData?.indicators?.quote?.[0]?.close || []).filter((c: any) => c !== null);
          const summaryOpens = (volumeSummaryData?.indicators?.quote?.[0]?.open || []).filter((o: any) => o !== null);

          if (closes.length > 0) {
            // Keep detail-page daily move consistent with screener/trending cards:
            // current close minus previous daily close from a 5d/1d series.
            const summaryCurrent = summaryCloses.length > 0 ? summaryCloses[summaryCloses.length - 1] : undefined;
            const summaryPrev = summaryCloses.length > 1
              ? summaryCloses[summaryCloses.length - 2]
              : (summaryOpens[0] ?? summaryCurrent);
            const fallbackCurrent = closes[closes.length - 1] || 0;
            const fallbackPrev = closes[closes.length - 2] || opens[0] || fallbackCurrent;
            const fallbackPrice = summaryCurrent ?? fallbackCurrent;
            const fallbackPrevClose = summaryPrev ?? fallbackPrev;
            const quotePrice = getQuoteNumber(quote?.regularMarketPrice);
            const quoteChange = getQuoteNumber(quote?.regularMarketChange);
            const quoteChangePercent = getQuoteNumber(quote?.regularMarketChangePercent);
            const currentPrice = quotePrice ?? fallbackPrice;
            const change = quoteChange ?? (fallbackPrice - fallbackPrevClose);
            const changePercent = quoteChangePercent ?? (fallbackPrevClose !== 0 ? ((change / fallbackPrevClose) * 100) : 0);
            const isCryptoSymbol =
              symbolToUse.toUpperCase().endsWith("-USD") ||
              String(quote?.quoteType || "").toUpperCase() === "CRYPTOCURRENCY";
            const displaySymbol = isCryptoSymbol
              ? symbolToUse.replace(/-USD$/i, "").toUpperCase()
              : symbolToUse.toUpperCase();
            const mCap = getQuoteNumber(quote?.marketCap);
            const resolvedMarketCap = mCap !== undefined
              ? formatCompactNumber(mCap)
              : (pageMetrics?.marketCap || "-");
            const pe = getQuoteNumber(quote?.trailingPE);
            const dayHigh = getQuoteNumber(quote?.regularMarketDayHigh);
            const dayLow = getQuoteNumber(quote?.regularMarketDayLow);
            const week52High = getQuoteNumber(quote?.fiftyTwoWeekHigh);
            const week52Low = getQuoteNumber(quote?.fiftyTwoWeekLow);
            const liveVolume = getQuoteNumber(quote?.regularMarketVolume);

            const formatted = timestamps
              .map((ts, index) => {
                const price = rawCloses[index];
                if (price === null || price === undefined || !Number.isFinite(price)) return null;
                return {
                  time: formatXAxisTimestamp(ts, chartTimeRange),
                  fullTime: formatTooltipTimestamp(ts, chartTimeRange),
                  price,
                };
              })
              .filter((point): point is { time: string; fullTime: string; price: number } => point !== null);

            setLiveChartData(formatted);
            setLiveStockData({
              symbol: displaySymbol,
              company: quote?.shortName || quote?.longName || displaySymbol,
              exchange: isCryptoSymbol ? "Crypto" : (quote?.fullExchangeName || "Market"),
              price: currentPrice,
              change,
              changePercent,
              volume: formatVolume(summaryVolume ?? liveVolume ?? volumes[volumes.length - 1]),
              dayHigh: dayHigh ?? daySummary.high ?? Math.max(...highs),
              dayLow: dayLow ?? daySummary.low ?? Math.min(...lows),
              week52High: week52High ?? yearSummary.high ?? Math.max(...highs),
              week52Low: week52Low ?? yearSummary.low ?? Math.min(...lows),
              marketCap: resolvedMarketCap,
              pe: pe ? pe.toFixed(2) : "-",
            });
            setIsLoadingStock(false);
            return;
          }
        }

        setLiveStockData(null);
        setLiveChartData([]);
        setIsLoadingStock(false);
      } catch (error) {
        if (!isActive) return;
        console.error("Error loading trade detail data:", error);
        setLiveStockData(null);
        setLiveChartData([]);
        setIsLoadingStock(false);
      }
    };

    loadData();
    return () => {
      isActive = false;
    };
  }, [activeTab, selectedStockSymbol, selectedCryptoSymbol, selectedOptionsSymbol, chartTimeRange]);

  // When symbol changes, reset live stock data so it re-fetches cleanly
  useEffect(() => {
    setLiveStockData(null);
    setLiveChartData([]);
  }, [selectedStockSymbol, selectedCryptoSymbol, selectedOptionsSymbol]);

  const getHoldingQuantityForSymbol = (symbol: string) => {
    const normalized = symbol.toUpperCase();
    const stripped = normalized.replace(/-USD$/i, "");
    return holdings.reduce((sum, holding) => {
      const holdingSymbol = String(holding.symbol || "").toUpperCase();
      const holdingStripped = holdingSymbol.replace(/-USD$/i, "");
      if (holdingSymbol === normalized || holdingStripped === stripped) {
        return sum + (Number(holding.quantity) || 0);
      }
      return sum;
    }, 0);
  };

  const getShortQuantityForSymbol = (symbol: string) => {
    const normalized = symbol.toUpperCase();
    const stripped = normalized.replace(/-USD$/i, "");
    let totalShort = 0;
    shortPositions.forEach((shortHolding, shortSymbol) => {
      const mappedSymbol = String(shortSymbol || shortHolding?.symbol || "").toUpperCase();
      const mappedStripped = mappedSymbol.replace(/-USD$/i, "");
      if (mappedSymbol === normalized || mappedStripped === stripped) {
        totalShort += Number(shortHolding?.quantity) || 0;
      }
    });
    return totalShort;
  };

  const getBorrowLimitRemainingForSymbol = (symbol: string) => {
    const borrowLimit = getBorrowLimit(symbol);
    const currentShort = getShortQuantityForSymbol(symbol);
    return Math.max(0, Math.floor(borrowLimit - currentShort));
  };

  const getShortAvgPriceForSymbol = (symbol: string) => {
    const normalized = symbol.toUpperCase();
    const stripped = normalized.replace(/-USD$/i, "");
    let avg = 0;
    shortPositions.forEach((shortHolding, shortSymbol) => {
      const mappedSymbol = String(shortSymbol || shortHolding?.symbol || "").toUpperCase();
      const mappedStripped = mappedSymbol.replace(/-USD$/i, "");
      if (mappedSymbol === normalized || mappedStripped === stripped) {
        avg = Number(shortHolding?.avgCost || shortHolding?.purchasePrice || 0);
      }
    });
    return avg;
  };

  const handlePlaceOrder = async (draft: PlaceOrderDraft) => {
    const activeTradeSymbol = activeTab === "crypto" ? selectedCryptoSymbol : activeTab === "stocks" ? selectedStockSymbol : null;
    const activeTradeAssetType = activeTab === "crypto" ? "crypto" : activeTab === "stocks" ? activeStocksTabAssetType : "unknown";

    if (!activeTradeSymbol || !currentDisplayedStockData || (activeTab !== "stocks" && activeTab !== "crypto")) {
      return { ok: false, message: 'No active symbol selected.', status: 'REJECTED' as const };
    }

    if (
      (activeTab === "stocks" && !(activeTradeAssetType === "stock" || activeTradeAssetType === "etf")) ||
      (activeTab === "crypto" && activeTradeAssetType !== "crypto")
    ) {
      return { ok: false, message: 'Selected symbol is not valid for this tab.', status: 'REJECTED' as const };
    }

    if (!isAssetTradable(activeTradeAssetType, marketClock)) {
      return {
        ok: false,
        message: tradeTabNonTradableReason || 'This asset is not tradable right now.',
        status: 'REJECTED' as const,
      };
    }

    const latestPrice = currentDisplayedStockData.price;
    if (!Number.isFinite(latestPrice) || latestPrice <= 0) {
      return { ok: false, message: 'Live quote unavailable.', status: 'REJECTED' as const };
    }

    const order = createOrderRecordFromDraft(
      {
        ...draft,
        symbol: activeTradeSymbol.toUpperCase(),
      },
      latestPrice
    );

    const availableShares = getHoldingQuantityForSymbol(activeTradeSymbol.toUpperCase());
    const longQty = getHoldingQuantityForSymbol(activeTradeSymbol.toUpperCase());
    const shortQty = getShortQuantityForSymbol(activeTradeSymbol.toUpperCase());
    const borrowLimitRemaining = getBorrowLimitRemainingForSymbol(activeTradeSymbol.toUpperCase());
    const decision = executeOrderDecision(order, latestPrice, {
      buyingPower: cash,
      availableSellShares: availableShares,
      longQty,
      shortQty,
      borrowLimitRemaining,
      initialMarginRate: INITIAL_MARGIN_RATE,
      shortProceeds,
    });
    const nowIso = new Date().toISOString();

    if (decision.status === 'FILLED' && Number.isFinite(decision.filledPrice)) {
      const filledPrice = decision.filledPrice as number;
      const side = draft.action === 'SELL' ? 'Sell' : draft.action === 'SHORT' ? 'Short' : draft.action === 'COVER' ? 'Cover' : 'Buy';
      const holdingBeforeSell = side === 'Sell'
        ? holdings.find((holding) => {
            const holdingSymbol = String(holding.symbol || "").toUpperCase();
            return (
              holdingSymbol === activeTradeSymbol.toUpperCase() ||
              holdingSymbol.replace(/-USD$/i, "") === activeTradeSymbol.toUpperCase().replace(/-USD$/i, "")
            );
          })
        : null;
      const avgCostAtSell = Number(holdingBeforeSell?.avgCost || holdingBeforeSell?.purchasePrice || 0);
      const entryPriceAtCover = draft.action === 'COVER' ? getShortAvgPriceForSymbol(activeTradeSymbol.toUpperCase()) : 0;

      const result = executeTrade(
        activeTradeSymbol,
        draft.quantity,
        filledPrice,
        side,
        currentDisplayedStockData.company
      );

      if (!result.success) {
        const rejectedOrder: OrderRecord = {
          ...order,
          status: 'REJECTED',
          notes: result.message,
        };
        setBrokerOrders((prev) => [rejectedOrder, ...prev]);
        return { ok: false, message: result.message, status: 'REJECTED' as const, orderId: rejectedOrder.id };
      }

      const filledOrder: OrderRecord = {
        ...order,
        ...decision.orderPatch,
        status: 'FILLED',
        filledAt: nowIso,
        filledPrice,
        notes: 'Filled immediately.',
      };

      const tradeRecord: TradingTradeRecord = {
        id: `trd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: nowIso,
        symbol: activeTradeSymbol.toUpperCase(),
        side: draft.action,
        quantity: draft.quantity,
        price: filledPrice,
        notional: filledPrice * draft.quantity,
        fees: Number(filledOrder.fees || 0),
        orderId: filledOrder.id,
        entryPriceUsed: side === 'Cover' ? entryPriceAtCover : undefined,
        costBasisUsed: side === 'Cover' ? entryPriceAtCover * draft.quantity : (side === 'Sell' ? avgCostAtSell * draft.quantity : undefined),
        realizedPnL: side === 'Cover'
          ? (entryPriceAtCover - filledPrice) * draft.quantity
          : (side === 'Sell' ? (filledPrice - avgCostAtSell) * draft.quantity : undefined),
      };

      setBrokerOrders((prev) => [filledOrder, ...prev]);
      setBrokerTrades((prev) => [tradeRecord, ...prev]);
      const marginText = draft.action === 'SHORT'
        ? ` Initial margin reserved: $${formatMoney(calculateRequiredInitialMargin(filledPrice * draft.quantity, INITIAL_MARGIN_RATE))}.`
        : '';
      return {
        ok: true,
        message: `Order filled at $${formatMoney(filledPrice)}.${marginText}`,
        status: 'FILLED' as const,
        orderId: filledOrder.id,
      };
    }

    const pendingOrder: OrderRecord = {
      ...order,
      ...decision.orderPatch,
      status: 'PENDING',
      notes: decision.notes || 'Order is pending.',
    };
    setBrokerOrders((prev) => [pendingOrder, ...prev]);
    return { ok: true, message: 'Order submitted and pending.', status: 'PENDING' as const, orderId: pendingOrder.id };
  };

  // Poll pending BUY/SELL/SHORT/COVER orders and attempt fills
  useEffect(() => {
    const pendingOrders = brokerOrders.filter(
      (order) => order.status === 'PENDING' && (order.action === 'BUY' || order.action === 'SELL' || order.action === 'SHORT' || order.action === 'COVER')
    );
    if (pendingOrders.length === 0) return;

    let mounted = true;
    const intervalId = window.setInterval(async () => {
      if (!mounted) return;

      const symbols = [...new Set(pendingOrders.map((order) => order.symbol.toUpperCase()))];
      if (symbols.length === 0) return;

      try {
        const quotes = await fetchYahooQuotes(symbols);
        const quoteBySymbol = new Map<string, any>();
        quotes.forEach((quote) => {
          const symbol = String(quote?.symbol || '').toUpperCase();
          if (!symbol || quoteBySymbol.has(symbol)) return;
          quoteBySymbol.set(symbol, quote);
        });

        let workingBuyingPower = cash;
        let workingShortProceeds = shortProceeds;
        let workingMarginHeld = marginHeld;
        const holdingsDeltaBySymbol = new Map<string, number>();
        const shortDeltaBySymbol = new Map<string, number>();
        const nowIso = new Date().toISOString();
        const tradesToAdd: TradingTradeRecord[] = [];
        let changed = false;

        const getWorkingShares = (symbol: string) => {
          const key = symbol.toUpperCase().replace(/-USD$/i, "");
          return getHoldingQuantityForSymbol(symbol) + (holdingsDeltaBySymbol.get(key) || 0);
        };

        const adjustWorkingShares = (symbol: string, quantityDelta: number) => {
          const key = symbol.toUpperCase().replace(/-USD$/i, "");
          holdingsDeltaBySymbol.set(key, (holdingsDeltaBySymbol.get(key) || 0) + quantityDelta);
        };

        const getWorkingShortShares = (symbol: string) => {
          const key = symbol.toUpperCase().replace(/-USD$/i, "");
          return getShortQuantityForSymbol(symbol) + (shortDeltaBySymbol.get(key) || 0);
        };

        const adjustWorkingShortShares = (symbol: string, quantityDelta: number) => {
          const key = symbol.toUpperCase().replace(/-USD$/i, "");
          shortDeltaBySymbol.set(key, (shortDeltaBySymbol.get(key) || 0) + quantityDelta);
        };

        setBrokerOrders((prev) => prev.map((order) => {
          if (!(order.status === 'PENDING' && (order.action === 'BUY' || order.action === 'SELL' || order.action === 'SHORT' || order.action === 'COVER'))) return order;

          const quote = quoteBySymbol.get(order.symbol.toUpperCase());
          const livePrice = getQuoteNumber(quote?.regularMarketPrice);
          if (!Number.isFinite(livePrice) || (livePrice as number) <= 0) return order;

          const availableShares = getWorkingShares(order.symbol);
          const longQty = getWorkingShares(order.symbol);
          const shortQty = getWorkingShortShares(order.symbol);
          const borrowLimitRemaining = Math.max(0, getBorrowLimit(order.symbol) - shortQty);
          const decision = executeOrderDecision(order, livePrice as number, {
            buyingPower: workingBuyingPower,
            availableSellShares: availableShares,
            longQty,
            shortQty,
            borrowLimitRemaining,
            initialMarginRate: INITIAL_MARGIN_RATE,
            shortProceeds: workingShortProceeds,
          });
          if (decision.status === 'PENDING') {
            if (decision.orderPatch && Object.keys(decision.orderPatch).length > 0) {
              changed = true;
              return {
                ...order,
                ...decision.orderPatch,
                notes: decision.notes || order.notes,
              };
            }
            return order;
          }

          if (decision.status === 'REJECTED') {
            changed = true;
            return {
              ...order,
              ...decision.orderPatch,
              status: 'REJECTED',
              notes: decision.notes || 'Rejected during polling.',
            };
          }

          const filledPrice = decision.filledPrice as number;
          const side = order.action === 'SELL' ? 'Sell' : order.action === 'SHORT' ? 'Short' : order.action === 'COVER' ? 'Cover' : 'Buy';
          const holdingBeforeSell = side === 'Sell'
            ? holdings.find((holding) => {
                const holdingSymbol = String(holding.symbol || "").toUpperCase();
                return (
                  holdingSymbol === order.symbol.toUpperCase() ||
                  holdingSymbol.replace(/-USD$/i, "") === order.symbol.toUpperCase().replace(/-USD$/i, "")
                );
              })
            : null;
          const avgCostAtSell = Number(holdingBeforeSell?.avgCost || holdingBeforeSell?.purchasePrice || 0);
          const entryPriceAtCover = side === 'Cover' ? getShortAvgPriceForSymbol(order.symbol.toUpperCase()) : 0;

          const result = executeTrade(order.symbol, order.quantity, filledPrice, side, order.symbol);
          if (!result.success) {
            changed = true;
            return { ...order, status: 'REJECTED', notes: result.message };
          }

          if (order.action === 'BUY') {
            workingBuyingPower -= filledPrice * order.quantity;
            adjustWorkingShares(order.symbol, order.quantity);
          } else if (order.action === 'SELL') {
            workingBuyingPower += filledPrice * order.quantity;
            adjustWorkingShares(order.symbol, -order.quantity);
          } else if (order.action === 'SHORT') {
            workingShortProceeds += filledPrice * order.quantity;
            workingBuyingPower -= calculateRequiredInitialMargin(
              filledPrice * order.quantity,
              INITIAL_MARGIN_RATE
            );
            workingMarginHeld += calculateRequiredInitialMargin(
              filledPrice * order.quantity,
              INITIAL_MARGIN_RATE
            );
            adjustWorkingShortShares(order.symbol, order.quantity);
          } else if (order.action === 'COVER') {
            const settlement = calculateCoverSettlement(
              filledPrice * order.quantity,
              order.quantity,
              entryPriceAtCover,
              workingShortProceeds,
              workingMarginHeld,
              INITIAL_MARGIN_RATE
            );
            workingShortProceeds = Math.max(0, workingShortProceeds + settlement.shortProceedsDelta);
            workingBuyingPower += settlement.buyingPowerDelta;
            workingMarginHeld = Math.max(0, workingMarginHeld + settlement.marginHeldDelta);
            adjustWorkingShortShares(order.symbol, -order.quantity);
          }
          changed = true;
          tradesToAdd.push({
            id: `trd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: nowIso,
            symbol: order.symbol,
            side: order.action,
            quantity: order.quantity,
            price: filledPrice,
            notional: filledPrice * order.quantity,
            fees: Number(order.fees || 0),
            orderId: order.id,
            entryPriceUsed: side === 'Cover' ? entryPriceAtCover : undefined,
            costBasisUsed: side === 'Cover'
              ? entryPriceAtCover * order.quantity
              : (side === 'Sell' ? avgCostAtSell * order.quantity : undefined),
            realizedPnL: side === 'Cover'
              ? (entryPriceAtCover - filledPrice) * order.quantity
              : (side === 'Sell' ? (filledPrice - avgCostAtSell) * order.quantity : undefined),
          });

          return {
            ...order,
            ...decision.orderPatch,
            status: 'FILLED',
            filledAt: nowIso,
            filledPrice,
            notes: 'Filled from pending poll.',
          };
        }));

        if (changed && tradesToAdd.length > 0) {
          setBrokerTrades((prev) => [...tradesToAdd, ...prev]);
        }
      } catch (error) {
        console.error('Pending order poll failed:', error);
      }
    }, 20000);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [brokerOrders, cash, shortProceeds, marginHeld, executeTrade, holdings, shortPositions]);

  const activeTradeSymbol = activeTab === "crypto" ? selectedCryptoSymbol : activeTab === "stocks" ? selectedStockSymbol : null;
  const activeLookupSymbol = activeTab === "options" ? selectedOptionsSymbol : activeTradeSymbol;
  const activeDisplaySymbol = activeLookupSymbol
    ? activeLookupSymbol.replace(/-USD$/i, "").toUpperCase()
    : "";
  const hasMatchingLiveStockData = Boolean(
    liveStockData &&
    activeDisplaySymbol &&
    String(liveStockData.symbol || "").toUpperCase() === activeDisplaySymbol
  );
  const currentDisplayedStockData = hasMatchingLiveStockData ? liveStockData : null;
  const currentDisplayedChartData = hasMatchingLiveStockData
    ? (liveChartData.length > 0 ? liveChartData : currentChartData)
    : [];
  const isDetailLoading = Boolean(activeLookupSymbol) && (!currentDisplayedStockData || isLoadingStock);
  const isPositive = currentDisplayedStockData ? currentDisplayedStockData.change >= 0 : false;
  const activeStocksTabAssetType = useMemo<TradeAssetType>(() => {
    if (!selectedStockSymbol) return "unknown";
    const inferred = toTradeAssetType(liveStockData?.assetType || inferAssetFromSymbol(selectedStockSymbol));
    return inferred === "stock" || inferred === "etf" ? inferred : "unknown";
  }, [liveStockData?.assetType, selectedStockSymbol]);
  const activeCryptoTabAssetType = useMemo<TradeAssetType>(() => {
    if (!selectedCryptoSymbol) return "unknown";
    return "crypto";
  }, [selectedCryptoSymbol]);
  const tradeTabMarketStatus = useMemo(
    () => getTradeTabMarketStatus({
      activeTab,
      selectedAssetType:
        activeTab === "stocks"
          ? activeStocksTabAssetType
          : activeTab === "crypto"
            ? activeCryptoTabAssetType
            : activeTab === "options"
              ? "option"
              : "unknown",
      date: marketClock,
    }),
    [activeCryptoTabAssetType, activeStocksTabAssetType, activeTab, marketClock],
  );
  const showTradeMarketStatus = activeTab !== "orders";
  const isTradeMarketOpen = tradeTabMarketStatus.tone === "open";
  const currentEasternTimeLabel = useMemo(() => formatEasternTimeLabel(marketClock), [marketClock]);
  useEffect(() => {
    if (!activeLookupSymbol) return;

    let active = true;

    const refreshQuote = async () => {
      try {
        const [quotes, pageMetrics] = await Promise.all([
          fetchYahooQuotes([activeLookupSymbol]),
          fetchYahooQuotePageMetrics(activeLookupSymbol),
        ]);
        if (!active || !quotes.length) return;

        const quote = quotes[0];
        const isCryptoSymbol =
          activeLookupSymbol.toUpperCase().endsWith("-USD") ||
          String(quote?.quoteType || "").toUpperCase() === "CRYPTOCURRENCY";
        const displaySymbol = isCryptoSymbol
          ? activeLookupSymbol.replace(/-USD$/i, "").toUpperCase()
          : activeLookupSymbol.toUpperCase();
        const quotePrice = getQuoteNumber(quote?.regularMarketPrice);
        const quoteChange = getQuoteNumber(quote?.regularMarketChange);
        const quoteChangePercent = getQuoteNumber(quote?.regularMarketChangePercent);
        const dayHigh = getQuoteNumber(quote?.regularMarketDayHigh);
        const dayLow = getQuoteNumber(quote?.regularMarketDayLow);
        const week52High = getQuoteNumber(quote?.fiftyTwoWeekHigh);
        const week52Low = getQuoteNumber(quote?.fiftyTwoWeekLow);
        const trailingPE = getQuoteNumber(quote?.trailingPE);
        const marketCap = getQuoteNumber(quote?.marketCap);
        const regularMarketVolume = getQuoteNumber(quote?.regularMarketVolume);

        if (
          quotePrice === undefined &&
          quoteChange === undefined &&
          quoteChangePercent === undefined &&
          dayHigh === undefined &&
          dayLow === undefined &&
          week52High === undefined &&
          week52Low === undefined &&
          trailingPE === undefined &&
          marketCap === undefined &&
          regularMarketVolume === undefined
        ) {
          return;
        }

        setLiveStockData((current: any) => {
          if (!current) return current;
          if (String(current.symbol || "").toUpperCase() !== displaySymbol) return current;

          return {
            ...current,
            symbol: displaySymbol,
            company: quote?.shortName || quote?.longName || current.company,
            exchange: isCryptoSymbol ? "Crypto" : (quote?.fullExchangeName || current.exchange || "Market"),
            price: quotePrice ?? current.price,
            change: quoteChange ?? current.change,
            changePercent: quoteChangePercent ?? current.changePercent,
            dayHigh: dayHigh ?? current.dayHigh,
            dayLow: dayLow ?? current.dayLow,
            week52High: week52High ?? current.week52High,
            week52Low: week52Low ?? current.week52Low,
            volume: regularMarketVolume !== undefined
              ? formatVolume(regularMarketVolume)
              : current.volume,
            marketCap: marketCap !== undefined
              ? formatCompactNumber(marketCap)
              : (pageMetrics?.marketCap || current.marketCap),
            pe: trailingPE
              ? trailingPE.toFixed(2)
              : current.pe,
          };
        });
      } catch (error) {
        console.error("Error refreshing trade detail quote:", error);
      }
    };

    refreshQuote();
    const intervalId = window.setInterval(refreshQuote, 30000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [activeLookupSymbol]);
  const tradeTabNonTradableReason = useMemo(() => {
    if (activeTab === "stocks") {
      if (!selectedStockSymbol) return "Select a symbol to view trading availability.";
      if (activeStocksTabAssetType === "unknown") return "Selected symbol is not tradable in Stocks / ETFs.";
      if (isAssetTradable(activeStocksTabAssetType, marketClock)) return null;
      return `${tradeTabMarketStatus.label}. Trading for this asset is only enabled during the regular session.`;
    }

    if (activeTab === "crypto") {
      if (!selectedCryptoSymbol) return "Select a symbol to view trading availability.";
      return null;
    }

    return null;
  }, [activeStocksTabAssetType, activeTab, marketClock, selectedCryptoSymbol, selectedStockSymbol, tradeTabMarketStatus.label]);
  const selectedShortQty = activeTradeSymbol ? getShortQuantityForSymbol(activeTradeSymbol) : 0;
  const selectedShortNotional = selectedShortQty > 0 && currentDisplayedStockData
    ? currentDisplayedStockData.price * selectedShortQty
    : 0;
  const selectedMaintenanceRequired = calculateMaintenanceMargin(
    selectedShortNotional,
    MAINTENANCE_MARGIN_RATE
  );
  const selectedMarginBuffer = cash + marginHeld;
  const selectedMarginCall = selectedShortQty > 0 && selectedMarginBuffer < selectedMaintenanceRequired;
  const isPrimaryTradeTab = activeTab === "stocks" || activeTab === "crypto";
  const selectedPrimarySymbol = activeTab === "crypto" ? selectedCryptoSymbol : selectedStockSymbol;
  const primarySearchQuery = activeTab === "crypto" ? cryptoSearchQuery : stockSearchQuery;
  const primarySearchResults = activeTab === "crypto" ? cryptoSearchResults : stockSearchResults;
  const primaryTabTitle = activeTab === "crypto" ? "Trade Crypto" : "Trade Stocks / ETFs";
  const primarySearchPlaceholder = activeTab === "crypto"
    ? "Search a Crypto symbol (e.g., BTC, ETH, SOL)"
    : "Search a Stock / ETF symbol (e.g., NVDA, SPY)";
  const primarySearchLoadingLabel = activeTab === "crypto"
    ? "Searching for the Crypto..."
    : "Searching for the Stock / ETF...";
  const primarySearchEmptyLabel = activeTab === "crypto"
    ? "Enter a Crypto symbol to begin trading"
    : "Enter a Stock / ETF symbol to begin trading";
  const [orderHistoryFilter, setOrderHistoryFilter] = useState<OrderHistoryFilter>("ALL");
  const [orderHistorySearch, setOrderHistorySearch] = useState("");
  const [orderHistorySortKey, setOrderHistorySortKey] = useState<OrderHistorySortKey>("time");
  const [orderHistorySortDirection, setOrderHistorySortDirection] = useState<OrderHistorySortDirection>("desc");
  const hasOrderRecords = brokerOrders.length > 0;
  const historyRows = useMemo(() => {
    const rows = hasOrderRecords
      ? brokerOrders.map((order) => mapOrderToHistoryRow(order))
      : (brokerTrades.length > 0
          ? brokerTrades.map((trade) => mapBrokerTradeToHistoryRow(trade))
          : tradeHistory.map((trade) => mapLegacyTradeToHistoryRow(trade)));
    return rows;
  }, [hasOrderRecords, brokerOrders, brokerTrades, tradeHistory]);

  const toggleOrderHistorySort = (key: OrderHistorySortKey) => {
    if (orderHistorySortKey === key) {
      setOrderHistorySortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }

    setOrderHistorySortKey(key);
    setOrderHistorySortDirection(key === "time" ? "desc" : "asc");
  };

  const getOrderHistorySortIndicator = (key: OrderHistorySortKey) => {
    if (orderHistorySortKey !== key) return "";
    return orderHistorySortDirection === "asc" ? " ▲" : " ▼";
  };

  const filteredHistoryRows = useMemo(() => {
    const searchTerm = orderHistorySearch.trim().toLowerCase();
    const filteredRows = historyRows.filter((row) => {
      if (orderHistoryFilter === "ALL") return true;
      if (orderHistoryFilter === "OPEN") return row.status === "PENDING";
      if (orderHistoryFilter === "FILLED") return row.status === "FILLED";
      if (orderHistoryFilter === "CANCELLED") return row.status === "CANCELLED";
      return row.status === "REJECTED";
    }).filter((row) => {
      if (!searchTerm) return true;
      return [
        row.id,
        row.symbol,
        row.asset,
        row.side,
        row.orderType,
        row.status,
        row.statusLabel,
      ].some((value) => String(value).toLowerCase().includes(searchTerm));
    });

    const direction = orderHistorySortDirection === "asc" ? 1 : -1;
    filteredRows.sort((a, b) => {
      if (orderHistorySortKey === "id") return a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" }) * direction;
      if (orderHistorySortKey === "symbol") return a.symbol.localeCompare(b.symbol, undefined, { numeric: true, sensitivity: "base" }) * direction;
      if (orderHistorySortKey === "asset") return a.asset.localeCompare(b.asset, undefined, { numeric: true, sensitivity: "base" }) * direction;
      if (orderHistorySortKey === "side") return a.side.localeCompare(b.side, undefined, { sensitivity: "base" }) * direction;
      if (orderHistorySortKey === "orderType") return a.orderType.localeCompare(b.orderType, undefined, { sensitivity: "base" }) * direction;
      if (orderHistorySortKey === "quantity") return (a.quantity - b.quantity) * direction;
      if (orderHistorySortKey === "price") return compareNullableNumbers(a.priceValue, b.priceValue) * direction;
      if (orderHistorySortKey === "total") return compareNullableNumbers(a.totalValue, b.totalValue) * direction;
      if (orderHistorySortKey === "status") {
        return (getOrderHistoryStatusRank(a.status) - getOrderHistoryStatusRank(b.status)) * direction;
      }
      return (a.timeMs - b.timeMs) * direction;
    });

    return filteredRows;
  }, [historyRows, orderHistoryFilter, orderHistorySearch, orderHistorySortDirection, orderHistorySortKey]);

  const handleDownloadOrderHistory = () => {
    if (filteredHistoryRows.length === 0) return;

    const escapeCsvValue = (value: unknown) => {
      const raw = value === null || value === undefined ? "" : String(value);
      if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
      return raw;
    };

    const header = [
      "Order ID",
      "Symbol / Contract",
      "Asset",
      "Side",
      "Order Type",
      "Details",
      "Quantity",
      "Price",
      "Total",
      "Status",
      "Time",
    ];

    const body = filteredHistoryRows.map((row) => [
      row.id,
      row.symbol,
      row.asset,
      row.side,
      row.orderType,
      row.details || "",
      row.quantity,
      row.priceText,
      row.totalText,
      row.statusLabel,
      formatTradeTimestamp(row.timeValue),
    ]);

    const csvContent = [header, ...body]
      .map((line) => line.map((cell) => escapeCsvValue(cell)).join(","))
      .join("\n");

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = new Blob([`\uFEFF${csvContent}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `order-history-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const renderAssetDetailSkeleton = () => (
    <div className="grid grid-cols-5 gap-6">
      <div className="col-span-2 bg-slate-900/50 border border-slate-800 rounded-xl p-5 animate-pulse">
        <div className="mb-4">
          <div className="text-slate-100 text-xl font-semibold mb-1">
            {activeDisplaySymbol || "Loading"}
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-slate-100 mb-2">Trade</h1>
        <p className="text-slate-400">
          Execute trades and review order history
        </p>
      </div>

      {/* Sub Tabs */}
      <div className="flex gap-1 border-b border-slate-800">
        <button
          onClick={() => setActiveTab("stocks")}
          className={`px-4 py-2 text-sm transition-colors border-b-2 ${
            activeTab === "stocks"
              ? "border-emerald-500 text-slate-100"
              : "border-transparent text-slate-400 hover:text-slate-100"
          }`}
        >
          Stocks / ETFs
        </button>
        <button
          onClick={() => setActiveTab("options")}
          className={`px-4 py-2 text-sm transition-colors border-b-2 ${
            activeTab === "options"
              ? "border-emerald-500 text-slate-100"
              : "border-transparent text-slate-400 hover:text-slate-100"
          }`}
        >
          Options
        </button>
        <button
          onClick={() => setActiveTab("crypto")}
          className={`px-4 py-2 text-sm transition-colors border-b-2 ${
            activeTab === "crypto"
              ? "border-emerald-500 text-slate-100"
              : "border-transparent text-slate-400 hover:text-slate-100"
          }`}
        >
          Crypto
        </button>
        <button
          onClick={() => setActiveTab("orders")}
          className={`px-4 py-2 text-sm transition-colors border-b-2 ${
            activeTab === "orders"
              ? "border-emerald-500 text-slate-100"
              : "border-transparent text-slate-400 hover:text-slate-100"
          }`}
        >
          Order History
        </button>
      </div>

      {/* Account Info Bar */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div>
              <span className="text-slate-400 text-xs mr-2">
                Account Value:
              </span>
              <span className="text-slate-100 text-sm font-medium">
                ${accountMetrics.totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-slate-400 text-xs mr-2">
                Buying Power:
              </span>
              <span className="text-slate-100 text-sm font-medium">
                ${accountMetrics.buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-slate-400 text-xs mr-2">
                Cash:
              </span>
              <span className="text-slate-100 text-sm font-medium">
                ${accountMetrics.cashValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
          {showTradeMarketStatus && (
            <TradeMarketStatusIndicator
              isOpen={isTradeMarketOpen}
              timeLabel={currentEasternTimeLabel}
            />
          )}
        </div>
      </div>

      {/* Tab Content */}
      {isPrimaryTradeTab && (
        <div className="space-y-6">
          {/* STATE 1: No Symbol Selected - Search Only */}
          {!selectedPrimarySymbol && (
            <div className="flex items-center justify-center min-h-[500px]">
              <div className="w-full max-w-2xl">
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-10 text-center">
                  <h2 className="text-slate-100 text-2xl mb-6">
                    {primaryTabTitle}
                  </h2>
                  <form onSubmit={activeTab === "crypto" ? handleCryptoSearch : handleSearch}>
                    <div className="relative mb-4">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                      {isLoadingStock && (
                        <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-500 animate-spin" />
                      )}
                      <input
                        type="text"
                        value={primarySearchQuery}
                        onChange={(e) => {
                          if (activeTab === "crypto") {
                            setCryptoSearchQuery(e.target.value);
                          } else {
                            setStockSearchQuery(e.target.value);
                          }
                          setSearchError("");
                        }}
                        placeholder={primarySearchPlaceholder}
                        disabled={isLoadingStock}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-12 pr-4 py-4 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 disabled:opacity-50"
                      />
                      {(primarySearchQuery.trim().length > 0 && primarySearchResults.length > 0 && !isLoadingStock) && (
                        <div className="absolute z-20 mt-2 w-full bg-slate-900 border border-slate-700 rounded-md shadow-lg overflow-hidden text-left">
                          <div className="max-h-64 overflow-y-auto">
                            {primarySearchResults.map((result) => (
                              <button
                                key={`${result.symbol}-${result.exchange || "local"}`}
                                type="button"
                                onClick={() => activeTab === "crypto" ? handleSelectCryptoSearchResult(result) : handleSelectStockSearchResult(result)}
                                className="w-full text-left px-4 py-3 border-b border-slate-800 last:border-b-0 hover:bg-slate-800 transition-colors"
                              >
                                <div className="text-slate-100 text-sm font-medium">
                                  {result.symbol}
                                </div>
                                <div className="text-slate-400 text-xs truncate">
                                  {result.name}{result.exchange ? ` • ${result.exchange}` : ""}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <button type="submit" className="sr-only">
                      Search
                    </button>
                  </form>
                  {searchError && (
                    <p className="text-red-400 text-sm mb-3">
                      {searchError}
                    </p>
                  )}
                  <p className="text-slate-500 text-sm">
                    {isLoadingStock ? primarySearchLoadingLabel : primarySearchEmptyLabel}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STATE 2: Symbol Selected - Full Trading Interface */}
          {selectedPrimarySymbol && (
            <div className="space-y-4">
              <button
                onClick={() => {
                  if (activeTab === "crypto") {
                    setSelectedCryptoSymbol(null);
                    setCryptoSearchQuery("");
                  } else {
                    setSelectedStockSymbol(null);
                    setStockSearchQuery("");
                  }
                }}
                className="flex items-center gap-2 text-slate-400 hover:text-slate-100 transition-colors text-sm font-medium"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Search
              </button>

              {/* Top Section: Stock Info + Chart */}
              {isDetailLoading || !currentDisplayedStockData ? renderAssetDetailSkeleton() : (
              <div className="grid grid-cols-5 gap-6">
                {/* LEFT: Stock Info Panel (40%) */}
                <div className="col-span-2 bg-slate-900/50 border border-slate-800 rounded-xl p-5">
                  {/* Header */}
                  <div className="mb-4">
                    <h2 className="text-slate-100 text-xl font-semibold mb-1">
                      {currentDisplayedStockData.company}
                    </h2>
                    <div className="text-slate-400 text-sm">
                      {currentDisplayedStockData.symbol} ·{" "}
                      {currentDisplayedStockData.exchange}
                    </div>
                  </div>

                  {/* Current Price - Very Prominent */}
                  <div className="mb-6 pb-6 border-b border-slate-800">
                    <div className="text-slate-100 text-4xl font-bold mb-2 flex items-center gap-3">
                      ${formatMoney(currentDisplayedStockData.price)}
                      {isLoadingStock && <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />}
                    </div>
                    <div
                      className={`flex items-center gap-2 text-lg ${isPositive ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {isPositive ? (
                        <TrendingUp className="w-5 h-5" />
                      ) : (
                        <TrendingDown className="w-5 h-5" />
                      )}
                      <span>
                        {isPositive ? "+" : ""}$
                        {formatMoney(Math.abs(currentDisplayedStockData.change))}{" "}
                        ({isPositive ? "+" : ""}
                        {currentDisplayedStockData.changePercent.toFixed(2)}%)
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
                          {formatDetailMetricMoney(currentDisplayedStockData.dayHigh)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 text-xs mb-1">
                          Day Low
                        </div>
                        <div className="text-slate-300 text-sm">
                          {formatDetailMetricMoney(currentDisplayedStockData.dayLow)}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-slate-500 text-xs mb-1">
                          52W High
                        </div>
                        <div className="text-slate-300 text-sm">
                          {formatDetailMetricMoney(currentDisplayedStockData.week52High)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 text-xs mb-1">
                          52W Low
                        </div>
                        <div className="text-slate-300 text-sm">
                          {formatDetailMetricMoney(currentDisplayedStockData.week52Low)}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-slate-500 text-xs mb-1">
                          Volume
                        </div>
                        <div className="text-slate-300 text-sm">
                          {currentDisplayedStockData.volume || "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 text-xs mb-1">
                          Market Cap
                        </div>
                        <div className="text-slate-300 text-sm">
                          {currentDisplayedStockData.marketCap || "-"}
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
                      {["1D", "1W", "1M", "3M", "YTD", "1Y", "ALL"].map((range) => (
                        <button
                          key={range}
                          onClick={() =>
                            setChartTimeRange(range)
                          }
                          className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                            chartTimeRange === range
                              ? "bg-slate-800 text-slate-100"
                              : "text-slate-400 hover:text-slate-100"
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
                      style={{ backgroundColor: "#0B1220" }}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full animate-pulse"
                            style={{ backgroundColor: isTradeMarketOpen ? "#10b981" : "#f43f5e" }}
                          ></div>
                          <span className="text-slate-400 text-xs">
                            {tradeTabMarketStatus.label}
                          </span>
                        </div>
                        <div className="text-slate-500 text-xs">
                          {activeTab === "crypto" ? "Live 24/7" : `As of ${currentEasternTimeLabel}`}
                        </div>
                      </div>
                    <div
                      key={`trade-chart-${selectedPrimarySymbol}-${chartTimeRange}`}
                      className="relative flex-1 min-h-[280px] chart-reveal"
                    >
                      <ResponsiveContainer
                        width="100%"
                        height="100%"
                      >
                        <AreaChart
                          data={currentDisplayedChartData}
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
                            dataKey="time"
                            stroke="#475569"
                            tick={{
                              fill: "#64748b",
                              fontSize: 10,
                            }}
                            axisLine={{ stroke: "#1e293b" }}
                            tickLine={false}
                            interval="preserveStartEnd"
                            minTickGap={getChartMinTickGap(chartTimeRange)}
                          />
                          <YAxis
                            stroke="#475569"
                            tick={{
                              fill: "#64748b",
                              fontSize: 10,
                            }}
                            axisLine={{ stroke: "#1e293b" }}
                            tickLine={false}
                            domain={[
                              "dataMin - 2",
                              "dataMax + 2",
                            ]}
                            tickFormatter={(value) =>
                              `$${formatMoney(Number(value), 0)}`
                            }
                          />
                          <Tooltip
                            content={<CustomTooltip />}
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
                              fill: "#10b981",
                              stroke: "#064e3b",
                              strokeWidth: 2,
                            }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
              )}

              {/* Bottom Section: Order Form - Only visible when symbol selected */}
              {selectedMarginCall && (
                <div className="mb-4 rounded-lg border border-red-700/60 bg-red-900/20 px-4 py-3 text-sm text-red-300">
                  Margin Call Risk: maintenance required is ${formatMoney(selectedMaintenanceRequired)} with current
                  buffer ${formatMoney(selectedMarginBuffer)}.
                </div>
              )}
              <PlaceOrderPanel
                symbol={selectedPrimarySymbol}
                latestPrice={currentDisplayedStockData?.price ?? null}
                buyingPower={cash}
                availableSellShares={selectedPrimarySymbol ? getHoldingQuantityForSymbol(selectedPrimarySymbol) : 0}
                longQuantity={selectedPrimarySymbol ? getHoldingQuantityForSymbol(selectedPrimarySymbol) : 0}
                shortQuantity={selectedPrimarySymbol ? getShortQuantityForSymbol(selectedPrimarySymbol) : 0}
                shortAvgPrice={selectedPrimarySymbol ? getShortAvgPriceForSymbol(selectedPrimarySymbol) : 0}
                shortProceeds={shortProceeds}
                borrowLimitRemaining={selectedPrimarySymbol ? getBorrowLimitRemainingForSymbol(selectedPrimarySymbol) : 0}
                disabled={isDetailLoading || !currentDisplayedStockData}
                tradable={Boolean(selectedPrimarySymbol) && (
                  activeTab === "crypto"
                    ? isAssetTradable(activeCryptoTabAssetType, marketClock)
                    : isAssetTradable(activeStocksTabAssetType, marketClock)
                )}
                nonTradableReason={tradeTabNonTradableReason}
                onPlaceOrder={handlePlaceOrder}
              />
            </div>
          )}
        </div>
      )}

      {/* Options Tab */}
      {activeTab === "options" && (
        <div className="space-y-6">
          {/* STATE 1: Empty State - No Symbol Selected */}
          {!selectedOptionsSymbol && (
            <div className="flex items-center justify-center min-h-[500px]">
              <div className="w-full max-w-2xl">
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-10 text-center">
                  <h2 className="text-slate-100 text-2xl mb-6">
                    Trade Options
                  </h2>
                  <form onSubmit={handleOptionsSearch}>
                    <div className="relative mb-4">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                      {isLoadingStock && (
                        <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-500 animate-spin" />
                      )}
                      <input
                        type="text"
                        value={optionsSearchQuery}
                        onChange={(e) => {
                          setOptionsSearchQuery(e.target.value);
                          setSearchError("");
                        }}
                        placeholder="Search a Stock symbol (e.g., AAPL, TSLA, GOOGL)"
                        disabled={isLoadingStock}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-12 pr-4 py-4 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 disabled:opacity-50"
                      />
                      {(optionsSearchQuery.trim().length > 0 && optionsSearchResults.length > 0 && !isLoadingStock) && (
                        <div className="absolute z-20 mt-2 w-full bg-slate-900 border border-slate-700 rounded-md shadow-lg overflow-hidden text-left">
                          <div className="max-h-64 overflow-y-auto">
                            {optionsSearchResults.map((result) => (
                              <button
                                key={`${result.symbol}-${result.exchange || "local-options"}`}
                                type="button"
                                onClick={() => handleSelectOptionsSearchResult(result)}
                                className="w-full text-left px-4 py-3 border-b border-slate-800 last:border-b-0 hover:bg-slate-800 transition-colors"
                              >
                                <div className="text-slate-100 text-sm font-medium">
                                  {result.symbol}
                                </div>
                                <div className="text-slate-400 text-xs truncate">
                                  {result.name}{result.exchange ? ` • ${result.exchange}` : ""}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <button type="submit" className="sr-only">
                      Search
                    </button>
                  </form>
                  {searchError && (
                    <p className="text-red-400 text-sm mb-3">
                      {searchError}
                    </p>
                  )}
                  <p className="text-slate-500 text-sm">
                    {isLoadingStock ? "Searching for the Stock symbol..." : "Enter a Stock symbol to view options chain"}
                  </p>
                  <p className="mx-auto mt-6 flex max-w-xl items-start justify-center gap-2 text-center text-xs leading-relaxed text-slate-400">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      Options are provided for exploration only and are not executed within this system. Full trading functionality may be supported in future versions.
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STATE 2: Symbol Selected - Full Interface */}
          {selectedOptionsSymbol && (
            <div className="space-y-4">
              <button
                onClick={() => {
                  setSelectedOptionsSymbol(null);
                  setOptionsSearchQuery("");
                }}
                className="flex items-center gap-2 text-slate-400 hover:text-slate-100 transition-colors text-sm font-medium"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Search
              </button>

              {/* Top Section: Stock Info + Chart */}
              {isDetailLoading || !currentDisplayedStockData ? renderAssetDetailSkeleton() : (
              <div className="grid grid-cols-5 gap-6">
                {/* LEFT: Stock Info Panel */}
                <div className="col-span-2 bg-slate-900/50 border border-slate-800 rounded-xl p-5">
                  {/* Header */}
                  <div className="mb-4">
                    <h2 className="text-slate-100 text-xl font-semibold mb-1">
                      {currentDisplayedStockData.company}
                    </h2>
                    <div className="text-slate-400 text-sm">
                      {currentDisplayedStockData.symbol} ·{" "}
                      {currentDisplayedStockData.exchange}
                    </div>
                  </div>

                  {/* Current Price - Very Prominent */}
                  <div className="mb-6 pb-6 border-b border-slate-800">
                    <div className="text-slate-100 text-4xl font-bold mb-2 flex items-center gap-3">
                      ${formatMoney(currentDisplayedStockData.price)}
                      {isLoadingStock && <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />}
                    </div>
                    <div
                      className={`flex items-center gap-2 text-lg ${isPositive ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {isPositive ? (
                        <TrendingUp className="w-5 h-5" />
                      ) : (
                        <TrendingDown className="w-5 h-5" />
                      )}
                      <span>
                        {isPositive ? "+" : ""}$
                        {formatMoney(Math.abs(currentDisplayedStockData.change))}{" "}
                        ({isPositive ? "+" : ""}
                        {currentDisplayedStockData.changePercent.toFixed(2)}%)
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
                          {formatDetailMetricMoney(currentDisplayedStockData.dayHigh)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 text-xs mb-1">
                          Day Low
                        </div>
                        <div className="text-slate-300 text-sm">
                          {formatDetailMetricMoney(currentDisplayedStockData.dayLow)}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-slate-500 text-xs mb-1">
                          52W High
                        </div>
                        <div className="text-slate-300 text-sm">
                          {formatDetailMetricMoney(currentDisplayedStockData.week52High)}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 text-xs mb-1">
                          52W Low
                        </div>
                        <div className="text-slate-300 text-sm">
                          {formatDetailMetricMoney(currentDisplayedStockData.week52Low)}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-slate-500 text-xs mb-1">
                          Volume
                        </div>
                        <div className="text-slate-300 text-sm">
                          {currentDisplayedStockData.volume || "-"}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 text-xs mb-1">
                          Market Cap
                        </div>
                        <div className="text-slate-300 text-sm">
                          {currentDisplayedStockData.marketCap || "-"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* RIGHT: Chart Panel */}
                <div className="col-span-3 bg-slate-900/50 border border-slate-800 rounded-xl p-5 flex flex-col min-h-0">
                  {/* Chart Header */}
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-slate-100 text-lg">
                      Price Chart
                    </h3>

                    {/* Time Range Selector */}
                    <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
                      {["1D", "1W", "1M", "3M", "YTD", "1Y", "ALL"].map((range) => (
                        <button
                          key={range}
                          onClick={() =>
                            setChartTimeRange(range)
                          }
                          className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                            chartTimeRange === range
                              ? "bg-slate-800 text-slate-100"
                              : "text-slate-400 hover:text-slate-100"
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
                      style={{ backgroundColor: "#0B1220" }}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full animate-pulse"
                            style={{ backgroundColor: isTradeMarketOpen ? "#10b981" : "#f43f5e" }}
                          ></div>
                          <span className="text-slate-400 text-xs">
                            {tradeTabMarketStatus.label}
                          </span>
                        </div>
                        <div className="text-slate-500 text-xs">
                          {activeTab === "crypto" ? "Live 24/7" : `As of ${currentEasternTimeLabel}`}
                        </div>
                      </div>
                    <div
                      key={`options-chart-${selectedOptionsSymbol}-${chartTimeRange}`}
                      className="relative flex-1 min-h-[280px] chart-reveal"
                    >
                      <ResponsiveContainer
                        width="100%"
                        height="100%"
                      >
                        <AreaChart
                          data={currentDisplayedChartData}
                          margin={{
                            top: 10,
                            right: 10,
                            left: 0,
                            bottom: 0,
                          }}
                        >
                          <defs>
                            <linearGradient
                              id="priceGradientOptions"
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
                            dataKey="time"
                            stroke="#475569"
                            tick={{
                              fill: "#64748b",
                              fontSize: 10,
                            }}
                            axisLine={{ stroke: "#1e293b" }}
                            tickLine={false}
                            interval="preserveStartEnd"
                            minTickGap={getChartMinTickGap(chartTimeRange)}
                          />
                          <YAxis
                            stroke="#475569"
                            tick={{
                              fill: "#64748b",
                              fontSize: 10,
                            }}
                            axisLine={{ stroke: "#1e293b" }}
                            tickLine={false}
                            domain={[
                              "dataMin - 2",
                              "dataMax + 2",
                            ]}
                            tickFormatter={(value) =>
                              `$${formatMoney(Number(value), 0)}`
                            }
                          />
                          <Tooltip
                            content={<CustomTooltip />}
                          />
                          <Area
                            type="linear"
                            dataKey="price"
                            stroke="#10b981"
                            strokeWidth={2.5}
                            fill="url(#priceGradientOptions)"
                            isAnimationActive={false}
                            dot={false}
                            activeDot={{
                              r: 5,
                              fill: "#10b981",
                              stroke: "#064e3b",
                              strokeWidth: 2,
                            }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
              )}

              {/* Bottom Section: Options Chain */}
              {isDetailLoading || !currentDisplayedStockData ? (
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 animate-pulse">
                <div className="h-6 w-40 bg-slate-800 rounded mb-4" />
                <div className="h-10 w-full bg-slate-800 rounded mb-4" />
                <div className="h-64 w-full bg-slate-900/70 rounded" />
              </div>
              ) : (
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl overflow-hidden">
                {/* Options Chain Header with Filters */}
                <div className="p-4 border-b border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-slate-100 text-lg font-semibold">{optionType === 'calls' ? 'Calls' : 'Puts'}</h2>
                      <p className="text-slate-400 text-sm">By Expiration Date</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4 flex-wrap">
                    {/* Expiration Date Dropdown */}
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

                {/* Options Chain Table */}
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
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const dataToShow = optionType === 'calls' ? optionsChainData.calls : optionsChainData.puts;
                        
                        if (!dataToShow || dataToShow.length === 0) {
                          return (
                            <tr>
                              <td colSpan={11} className="py-8 px-4 text-center text-slate-400">
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
          )}
        </div>
      )}

      {/* Order History Tab */}
      {activeTab === "orders" && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
          <div className="mb-6">
            <h2 className="text-slate-100">Order History</h2>
            <p className="text-slate-400 text-sm mt-1">
              Records all order states across stocks, ETFs, crypto, and options.
            </p>
          </div>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {([
                { key: "ALL", label: "All" },
                { key: "OPEN", label: "Open" },
                { key: "FILLED", label: "Filled" },
                { key: "CANCELLED", label: "Cancelled" },
                { key: "REJECTED", label: "Rejected" },
              ] as Array<{ key: OrderHistoryFilter; label: string }>).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setOrderHistoryFilter(item.key)}
                  className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                    orderHistoryFilter === item.key
                      ? "bg-slate-700 text-slate-100 border-slate-600"
                      : "bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                onClick={handleDownloadOrderHistory}
                disabled={filteredHistoryRows.length === 0}
                className="px-3 py-1.5 rounded bg-slate-900/70 border border-slate-600 text-sm text-slate-200 hover:bg-slate-800/80 disabled:opacity-40 whitespace-nowrap"
              >
                <Download className="w-4 h-4 mr-1.5" />
                Download
              </Button>
              <div className="w-52 md:w-56 shrink-0">
                <input
                  type="text"
                  value={orderHistorySearch}
                  onChange={(event) => setOrderHistorySearch(event.target.value)}
                  placeholder="Search"
                  className="w-full bg-slate-900/90 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-500"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left text-slate-400 text-xs font-normal pb-3 pr-4">
                    <button
                      type="button"
                      onClick={() => toggleOrderHistorySort("id")}
                      className="hover:text-slate-200"
                    >
                      Order ID{getOrderHistorySortIndicator("id")}
                    </button>
                  </th>
                  <th className="text-left text-slate-400 text-xs font-normal pb-3 pr-4">
                    <button
                      type="button"
                      onClick={() => toggleOrderHistorySort("symbol")}
                      className="hover:text-slate-200"
                    >
                      Symbol / Contract{getOrderHistorySortIndicator("symbol")}
                    </button>
                  </th>
                  <th className="text-left text-slate-400 text-xs font-normal pb-3 pr-4">
                    <button
                      type="button"
                      onClick={() => toggleOrderHistorySort("asset")}
                      className="hover:text-slate-200"
                    >
                      Asset{getOrderHistorySortIndicator("asset")}
                    </button>
                  </th>
                  <th className="text-left text-slate-400 text-xs font-normal pb-3 pr-4">
                    <button
                      type="button"
                      onClick={() => toggleOrderHistorySort("side")}
                      className="hover:text-slate-200"
                    >
                      Side{getOrderHistorySortIndicator("side")}
                    </button>
                  </th>
                  <th className="text-left text-slate-400 text-xs font-normal pb-3 pr-4">
                    <button
                      type="button"
                      onClick={() => toggleOrderHistorySort("orderType")}
                      className="hover:text-slate-200"
                    >
                      Order Type{getOrderHistorySortIndicator("orderType")}
                    </button>
                  </th>
                  <th className="text-right text-slate-400 text-xs font-normal pb-3 pr-4">
                    <button
                      type="button"
                      onClick={() => toggleOrderHistorySort("quantity")}
                      className="hover:text-slate-200"
                    >
                      Quantity{getOrderHistorySortIndicator("quantity")}
                    </button>
                  </th>
                  <th className="text-right text-slate-400 text-xs font-normal pb-3 pr-4">
                    <button
                      type="button"
                      onClick={() => toggleOrderHistorySort("price")}
                      className="hover:text-slate-200"
                    >
                      Price{getOrderHistorySortIndicator("price")}
                    </button>
                  </th>
                  <th className="text-right text-slate-400 text-xs font-normal pb-3 pr-4">
                    <button
                      type="button"
                      onClick={() => toggleOrderHistorySort("total")}
                      className="hover:text-slate-200"
                    >
                      Total{getOrderHistorySortIndicator("total")}
                    </button>
                  </th>
                  <th className="text-left text-slate-400 text-xs font-normal pb-3 pr-4">
                    <button
                      type="button"
                      onClick={() => toggleOrderHistorySort("status")}
                      className="hover:text-slate-200"
                    >
                      Status{getOrderHistorySortIndicator("status")}
                    </button>
                  </th>
                  <th className="text-left text-slate-400 text-xs font-normal pb-3 pr-4">
                    <button
                      type="button"
                      onClick={() => toggleOrderHistorySort("time")}
                      className="hover:text-slate-200"
                    >
                      Time{getOrderHistorySortIndicator("time")}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredHistoryRows.length === 0 ? (
                  <tr
                    className="border-b border-slate-800/50"
                  >
                    <td
                      colSpan={10}
                      className="py-8 text-center text-slate-400 text-sm"
                    >
                      No order history yet.
                    </td>
                  </tr>
                ) : (
                  filteredHistoryRows.map((row) => (
                    <tr
                      key={`${row.id}-${row.timeValue}`}
                      className="border-b border-slate-800/50"
                    >
                      <td className="py-3 pr-4">
                        <span className="text-slate-400 text-sm">
                          {row.id}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-slate-100 text-sm font-medium">
                          {row.symbol}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-slate-300 text-sm">
                          {row.asset}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`text-sm ${
                            String(row.side).toUpperCase() === "BUY" || String(row.side).toUpperCase() === "COVER"
                              ? "text-emerald-400"
                              : "text-red-400"
                          }`}
                        >
                          {row.side}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="text-slate-300 text-sm">{row.orderType}</div>
                        {row.details ? (
                          <div className="text-slate-500 text-xs mt-0.5">{row.details}</div>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-300 text-sm">
                          {row.quantity}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-300 text-sm">
                          {row.priceText}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="text-slate-300 text-sm">
                          {row.totalText}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`inline-block px-2 py-1 rounded text-xs ${getOrderStatusClasses(row.status)}`}
                        >
                          {row.statusLabel}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-slate-400 text-sm">
                          {formatTradeTimestamp(row.timeValue)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
