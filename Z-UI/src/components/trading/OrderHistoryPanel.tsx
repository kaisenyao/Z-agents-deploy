import { useMemo, useState } from "react";
import type { OrderRecord, OrderStatus, TradingTradeRecord } from "../../services/tradingEngine";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "../ui/sheet";

type OrderActionFilter = "ALL" | "BUY" | "SELL" | "SHORT" | "COVER";
type OrderStatusFilter = "ALL" | OrderStatus;
type TimeRangeFilter = "1D" | "1W" | "1M" | "ALL";
type SortKey = "createdAt" | "symbol" | "action" | "orderType" | "quantity" | "status" | "duration" | "filledPrice";
type SortDirection = "asc" | "desc";

interface OrderHistoryPanelProps {
  orders: OrderRecord[];
  trades: TradingTradeRecord[];
  onCancelOrder: (orderId: string) => void;
}

function formatOrderTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPrice(value: number | undefined, fallback = "—") {
  if (!Number.isFinite(value)) return fallback;
  return `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNotional(value: number | undefined) {
  if (!Number.isFinite(value)) return "—";
  return `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatActionLabel(action: OrderRecord["action"]) {
  if (action === "BUY") return "Buy";
  if (action === "SELL") return "Sell";
  if (action === "SHORT") return "Short";
  return "Cover";
}

function formatOrderTypeLabel(orderType: OrderRecord["orderType"]) {
  if (orderType === "STOP_LIMIT") return "Stop Limit";
  if (orderType === "TRAILING_STOP") return "Trailing Stop";
  return orderType.charAt(0) + orderType.slice(1).toLowerCase();
}

function formatPriceSummary(order: OrderRecord) {
  if (order.orderType === "MARKET") return "MKT";
  if (order.orderType === "LIMIT") return `LMT ${formatPrice(order.limitPrice, "$—")}`;
  if (order.orderType === "STOP_LIMIT") {
    return `STP ${formatPrice(order.stopPrice, "$—")} / LMT ${formatPrice(order.limitPrice, "$—")}`;
  }
  if (order.orderType === "TRAILING_STOP") {
    if (order.trailMode === "PERCENT") return `TRAIL ${order.trailValue ?? "—"}%`;
    return `TRAIL ${formatPrice(order.trailValue, "$—")}`;
  }
  return "—";
}

function getActionPillClass(action: OrderRecord["action"]) {
  if (action === "BUY" || action === "COVER") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  return "bg-red-500/15 text-red-300 border-red-500/30";
}

function getStatusPillClass(status: OrderRecord["status"]) {
  if (status === "PENDING") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  if (status === "FILLED") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (status === "CANCELLED") return "bg-slate-500/20 text-slate-300 border-slate-500/30";
  if (status === "REJECTED") return "bg-red-500/15 text-red-300 border-red-500/30";
  return "bg-slate-500/20 text-slate-300 border-slate-500/30";
}

function getPendingOrderInvalidReason(order: OrderRecord): string | null {
  if (order.status !== "PENDING") return null;
  if (order.orderType === "LIMIT" && !(Number.isFinite(order.limitPrice) && Number(order.limitPrice) > 0)) {
    return "Missing limit price";
  }
  if (
    order.orderType === "STOP_LIMIT" &&
    (!(Number.isFinite(order.stopPrice) && Number(order.stopPrice) > 0) ||
      !(Number.isFinite(order.limitPrice) && Number(order.limitPrice) > 0))
  ) {
    return "Missing stop/limit price";
  }
  if (
    order.orderType === "TRAILING_STOP" &&
    (!order.trailMode || !(Number.isFinite(order.trailValue) && Number(order.trailValue) > 0))
  ) {
    return "Missing trailing configuration";
  }
  return null;
}

function getStatusSortWeight(status: OrderRecord["status"]) {
  if (status === "PENDING") return 0;
  if (status === "FILLED") return 1;
  if (status === "CANCELLED") return 2;
  if (status === "REJECTED") return 3;
  return 4;
}

function getTimeThreshold(range: TimeRangeFilter) {
  if (range === "ALL") return 0;
  const now = Date.now();
  if (range === "1D") return now - 24 * 60 * 60 * 1000;
  if (range === "1W") return now - 7 * 24 * 60 * 60 * 1000;
  return now - 30 * 24 * 60 * 60 * 1000;
}

export function OrderHistoryPanel({ orders, trades, onCancelOrder }: OrderHistoryPanelProps) {
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>("ALL");
  const [actionFilter, setActionFilter] = useState<OrderActionFilter>("ALL");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [timeRangeFilter, setTimeRangeFilter] = useState<TimeRangeFilter>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const tradesByOrderId = useMemo(() => {
    const grouped = new Map<string, TradingTradeRecord[]>();
    for (const trade of trades) {
      if (!trade.orderId) continue;
      const bucket = grouped.get(trade.orderId) || [];
      bucket.push(trade);
      grouped.set(trade.orderId, bucket);
    }
    return grouped;
  }, [trades]);

  const filteredOrders = useMemo(() => {
    const normalizedSymbol = symbolFilter.trim().toUpperCase();
    const threshold = getTimeThreshold(timeRangeFilter);

    const filtered = orders.filter((order) => {
      if (statusFilter !== "ALL" && order.status !== statusFilter) return false;
      if (actionFilter !== "ALL" && order.action !== actionFilter) return false;
      if (normalizedSymbol && !order.symbol.toUpperCase().includes(normalizedSymbol)) return false;
      if (threshold > 0) {
        const createdAtMs = new Date(order.createdAt).getTime();
        if (!Number.isFinite(createdAtMs) || createdAtMs < threshold) return false;
      }
      return true;
    });

    const direction = sortDirection === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      if (sortKey === "createdAt") {
        const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return diff * direction;
      }
      if (sortKey === "symbol") return a.symbol.localeCompare(b.symbol) * direction;
      if (sortKey === "action") return a.action.localeCompare(b.action) * direction;
      if (sortKey === "orderType") return a.orderType.localeCompare(b.orderType) * direction;
      if (sortKey === "quantity") return (a.quantity - b.quantity) * direction;
      if (sortKey === "status") return (getStatusSortWeight(a.status) - getStatusSortWeight(b.status)) * direction;
      if (sortKey === "duration") return a.duration.localeCompare(b.duration) * direction;
      return ((a.filledPrice || 0) - (b.filledPrice || 0)) * direction;
    });

    return filtered;
  }, [orders, statusFilter, actionFilter, symbolFilter, timeRangeFilter, sortKey, sortDirection]);

  const selectedOrder = useMemo(
    () => (selectedOrderId ? orders.find((order) => order.id === selectedOrderId) || null : null),
    [orders, selectedOrderId]
  );

  const selectedOrderTrades = useMemo(() => {
    if (!selectedOrder) return [];
    const list = tradesByOrderId.get(selectedOrder.id) || [];
    return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [selectedOrder, tradesByOrderId]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "createdAt" ? "desc" : "asc");
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
      <div className="mb-6">
        <h2 className="text-slate-100">Order History</h2>
        <p className="text-slate-400 text-sm mt-1">All order states for stocks, ETFs, crypto, and options-backed actions.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as OrderStatusFilter)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-slate-600"
        >
          <option value="ALL">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="FILLED">Filled</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <select
          value={actionFilter}
          onChange={(event) => setActionFilter(event.target.value as OrderActionFilter)}
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm focus:outline-none focus:border-slate-600"
        >
          <option value="ALL">All Actions</option>
          <option value="BUY">Buy</option>
          <option value="SELL">Sell</option>
          <option value="SHORT">Short</option>
          <option value="COVER">Cover</option>
        </select>
        <input
          value={symbolFilter}
          onChange={(event) => setSymbolFilter(event.target.value)}
          placeholder="Search symbol"
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-sm placeholder:text-slate-500 focus:outline-none focus:border-slate-600"
        />
        <div className="flex rounded-lg border border-slate-700 overflow-hidden">
          {(["1D", "1W", "1M", "ALL"] as TimeRangeFilter[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRangeFilter(range)}
              className={`flex-1 px-3 py-2 text-xs transition-colors ${
                timeRangeFilter === range
                  ? "bg-slate-700 text-slate-100"
                  : "bg-slate-900 text-slate-400 hover:text-slate-200"
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      <div className="hidden md:block overflow-x-auto">
        <table className="w-full min-w-[1100px]">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="text-left pb-3 pr-4 text-xs text-slate-400">
                <button className="hover:text-slate-200" onClick={() => toggleSort("createdAt")}>Time</button>
              </th>
              <th className="text-left pb-3 pr-4 text-xs text-slate-400">
                <button className="hover:text-slate-200" onClick={() => toggleSort("symbol")}>Symbol</button>
              </th>
              <th className="text-left pb-3 pr-4 text-xs text-slate-400">
                <button className="hover:text-slate-200" onClick={() => toggleSort("action")}>Action</button>
              </th>
              <th className="text-left pb-3 pr-4 text-xs text-slate-400">
                <button className="hover:text-slate-200" onClick={() => toggleSort("orderType")}>Type</button>
              </th>
              <th className="text-right pb-3 pr-4 text-xs text-slate-400">
                <button className="hover:text-slate-200" onClick={() => toggleSort("quantity")}>Qty</button>
              </th>
              <th className="text-left pb-3 pr-4 text-xs text-slate-400">Status</th>
              <th className="text-left pb-3 pr-4 text-xs text-slate-400">Price Summary</th>
              <th className="text-right pb-3 pr-4 text-xs text-slate-400">
                <button className="hover:text-slate-200" onClick={() => toggleSort("filledPrice")}>Filled Price</button>
              </th>
              <th className="text-left pb-3 pr-4 text-xs text-slate-400">
                <button className="hover:text-slate-200" onClick={() => toggleSort("duration")}>Duration</button>
              </th>
              <th className="text-left pb-3 pr-4 text-xs text-slate-400">Checks</th>
              <th className="text-right pb-3 text-xs text-slate-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-8 text-center text-slate-400 text-sm">No orders match the current filters.</td>
              </tr>
            ) : (
              filteredOrders.map((order) => {
                const linkedTrades = tradesByOrderId.get(order.id) || [];
                const missingFillRecord = order.status === "FILLED" && linkedTrades.length === 0;
                const invalidPendingReason = getPendingOrderInvalidReason(order);

                return (
                  <tr
                    key={order.id}
                    onClick={() => setSelectedOrderId(order.id)}
                    className="border-b border-slate-800/60 hover:bg-slate-800/30 cursor-pointer"
                  >
                    <td className="py-3 pr-4 text-sm text-slate-300">{formatOrderTimestamp(order.createdAt)}</td>
                    <td className="py-3 pr-4 text-sm text-slate-100 font-medium">{order.symbol}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex px-2 py-1 rounded border text-xs ${getActionPillClass(order.action)}`}>
                        {formatActionLabel(order.action)}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-sm text-slate-300">{formatOrderTypeLabel(order.orderType)}</td>
                    <td className="py-3 pr-4 text-sm text-right text-slate-300">{order.quantity}</td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex px-2 py-1 rounded border text-xs ${getStatusPillClass(order.status)}`}>
                        {order.status.charAt(0) + order.status.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-sm text-slate-300">{formatPriceSummary(order)}</td>
                    <td className="py-3 pr-4 text-sm text-right text-slate-300">{formatPrice(order.filledPrice)}</td>
                    <td className="py-3 pr-4 text-sm text-slate-300">{order.duration}</td>
                    <td className="py-3 pr-4 text-xs">
                      <div className="flex flex-col gap-1">
                        {missingFillRecord && (
                          <span className="inline-flex px-2 py-1 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-300">
                            Missing fill record
                          </span>
                        )}
                        {invalidPendingReason && (
                          <span className="inline-flex px-2 py-1 rounded border border-red-500/30 bg-red-500/10 text-red-300">
                            Invalid order data
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 text-right">
                      {order.status === "PENDING" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-slate-700 text-slate-200 hover:bg-slate-800"
                          onClick={(event) => {
                            event.stopPropagation();
                            onCancelOrder(order.id);
                          }}
                        >
                          Cancel
                        </Button>
                      ) : (
                        <span className="text-slate-500 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="md:hidden space-y-3">
        {filteredOrders.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm">No orders match the current filters.</div>
        ) : (
          filteredOrders.map((order) => {
            const linkedTrades = tradesByOrderId.get(order.id) || [];
            const missingFillRecord = order.status === "FILLED" && linkedTrades.length === 0;
            const invalidPendingReason = getPendingOrderInvalidReason(order);

            return (
              <div
                key={order.id}
                onClick={() => setSelectedOrderId(order.id)}
                className="border border-slate-800 rounded-lg p-4 bg-slate-950/40 space-y-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-slate-100 font-semibold">{order.symbol}</div>
                    <div className="text-xs text-slate-400">{formatOrderTimestamp(order.createdAt)}</div>
                  </div>
                  <span className={`inline-flex px-2 py-1 rounded border text-xs ${getStatusPillClass(order.status)}`}>
                    {order.status.charAt(0) + order.status.slice(1).toLowerCase()}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="text-slate-400">Action</div>
                  <div className="text-right text-slate-200">{formatActionLabel(order.action)}</div>
                  <div className="text-slate-400">Type</div>
                  <div className="text-right text-slate-200">{formatOrderTypeLabel(order.orderType)}</div>
                  <div className="text-slate-400">Qty</div>
                  <div className="text-right text-slate-200">{order.quantity}</div>
                  <div className="text-slate-400">Price</div>
                  <div className="text-right text-slate-200">{formatPriceSummary(order)}</div>
                </div>

                {(missingFillRecord || invalidPendingReason) && (
                  <div className="space-y-1">
                    {missingFillRecord && (
                      <div className="inline-flex px-2 py-1 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-xs">
                        Missing fill record
                      </div>
                    )}
                    {invalidPendingReason && (
                      <div className="inline-flex px-2 py-1 rounded border border-red-500/30 bg-red-500/10 text-red-300 text-xs">
                        Invalid order data
                      </div>
                    )}
                  </div>
                )}

                {order.status === "PENDING" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full border-slate-700 text-slate-200 hover:bg-slate-800"
                    onClick={(event) => {
                      event.stopPropagation();
                      onCancelOrder(order.id);
                    }}
                  >
                    Cancel Order
                  </Button>
                )}
              </div>
            );
          })
        )}
      </div>

      <Sheet open={Boolean(selectedOrder)} onOpenChange={(open) => !open && setSelectedOrderId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl bg-slate-950 border-slate-800 text-slate-100 overflow-y-auto">
          {selectedOrder && (
            <>
              <SheetHeader className="border-b border-slate-800 pb-4">
                <SheetTitle className="text-slate-100 text-xl">
                  {selectedOrder.symbol} • {formatActionLabel(selectedOrder.action)}
                </SheetTitle>
                <div>
                  <span className={`inline-flex px-2 py-1 rounded border text-xs ${getStatusPillClass(selectedOrder.status)}`}>
                    {selectedOrder.status.charAt(0) + selectedOrder.status.slice(1).toLowerCase()}
                  </span>
                </div>
              </SheetHeader>

              <div className="px-4 pb-4 space-y-6">
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-200">Core</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-slate-400">Created At</div>
                    <div className="text-right text-slate-200">{formatOrderTimestamp(selectedOrder.createdAt)}</div>
                    <div className="text-slate-400">Order Type</div>
                    <div className="text-right text-slate-200">{formatOrderTypeLabel(selectedOrder.orderType)}</div>
                    <div className="text-slate-400">Duration</div>
                    <div className="text-right text-slate-200">{selectedOrder.duration}</div>
                    <div className="text-slate-400">Quantity</div>
                    <div className="text-right text-slate-200">{selectedOrder.quantity}</div>
                  </div>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-200">Parameters</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {selectedOrder.orderType === "LIMIT" && (
                      <>
                        <div className="text-slate-400">Limit Price</div>
                        <div className="text-right text-slate-200">{formatPrice(selectedOrder.limitPrice)}</div>
                      </>
                    )}
                    {selectedOrder.orderType === "STOP_LIMIT" && (
                      <>
                        <div className="text-slate-400">Stop Price</div>
                        <div className="text-right text-slate-200">{formatPrice(selectedOrder.stopPrice)}</div>
                        <div className="text-slate-400">Limit Price</div>
                        <div className="text-right text-slate-200">{formatPrice(selectedOrder.limitPrice)}</div>
                      </>
                    )}
                    {selectedOrder.orderType === "TRAILING_STOP" && (
                      <>
                        <div className="text-slate-400">Trail Mode</div>
                        <div className="text-right text-slate-200">{selectedOrder.trailMode || "—"}</div>
                        <div className="text-slate-400">Trail Value</div>
                        <div className="text-right text-slate-200">
                          {selectedOrder.trailMode === "PERCENT"
                            ? `${selectedOrder.trailValue ?? "—"}%`
                            : formatPrice(selectedOrder.trailValue)}
                        </div>
                        <div className="text-slate-400">Reference High</div>
                        <div className="text-right text-slate-200">{formatPrice(selectedOrder.referenceHigh)}</div>
                        <div className="text-slate-400">Reference Low</div>
                        <div className="text-right text-slate-200">{formatPrice(selectedOrder.referenceLow)}</div>
                      </>
                    )}
                    {selectedOrder.orderType === "MARKET" && (
                      <>
                        <div className="text-slate-400">Price Rule</div>
                        <div className="text-right text-slate-200">Market execution</div>
                      </>
                    )}
                  </div>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-200">Execution</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="text-slate-400">Filled At</div>
                    <div className="text-right text-slate-200">{selectedOrder.filledAt ? formatOrderTimestamp(selectedOrder.filledAt) : "Not filled"}</div>
                    <div className="text-slate-400">Filled Price</div>
                    <div className="text-right text-slate-200">{formatPrice(selectedOrder.filledPrice)}</div>
                    <div className="text-slate-400">Filled Quantity</div>
                    <div className="text-right text-slate-200">
                      {Number.isFinite(selectedOrder.filledQty) ? selectedOrder.filledQty : "Not filled"}
                    </div>
                  </div>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-200">Linked Trades</h3>
                  {selectedOrderTrades.length === 0 ? (
                    <div className="text-xs text-slate-400 border border-slate-800 rounded-lg p-3">No linked trades found for this order.</div>
                  ) : (
                    <div className="overflow-x-auto border border-slate-800 rounded-lg">
                      <table className="w-full min-w-[560px]">
                        <thead>
                          <tr className="border-b border-slate-800 bg-slate-900/70">
                            <th className="text-left py-2 px-3 text-xs text-slate-400">Time</th>
                            <th className="text-right py-2 px-3 text-xs text-slate-400">Qty</th>
                            <th className="text-right py-2 px-3 text-xs text-slate-400">Price</th>
                            <th className="text-right py-2 px-3 text-xs text-slate-400">Notional</th>
                            <th className="text-right py-2 px-3 text-xs text-slate-400">Realized P/L</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedOrderTrades.map((trade) => (
                            <tr key={trade.id} className="border-b border-slate-800/60 last:border-b-0">
                              <td className="py-2 px-3 text-xs text-slate-300">{formatOrderTimestamp(trade.createdAt)}</td>
                              <td className="py-2 px-3 text-xs text-right text-slate-300">{trade.quantity}</td>
                              <td className="py-2 px-3 text-xs text-right text-slate-300">{formatPrice(trade.price)}</td>
                              <td className="py-2 px-3 text-xs text-right text-slate-300">{formatNotional(trade.notional)}</td>
                              <td className={`py-2 px-3 text-xs text-right ${
                                Number(trade.realizedPnL || 0) >= 0 ? "text-emerald-300" : "text-red-300"
                              }`}>
                                {Number.isFinite(trade.realizedPnL)
                                  ? formatNotional(trade.realizedPnL)
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>

              <SheetFooter className="border-t border-slate-800 p-4">
                {selectedOrder.status === "PENDING" && (
                  <Button
                    variant="outline"
                    className="border-slate-700 text-slate-100 hover:bg-slate-800"
                    onClick={() => onCancelOrder(selectedOrder.id)}
                  >
                    Cancel Order
                  </Button>
                )}
                <Button onClick={() => setSelectedOrderId(null)} className="bg-slate-800 hover:bg-slate-700 text-slate-100">
                  Close
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
