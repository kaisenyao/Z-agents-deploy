import { Eye } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Button } from '../ui/button';
import type { Duration, OrderAction, OrderType, PlaceOrderDraft, TrailMode } from '../../services/tradingEngine';
import {
  INITIAL_MARGIN_RATE,
  calculateMaxBuyableShares,
  calculateMaxSellableShares,
  calculateMaxShortableShares,
  calculateRequiredInitialMargin,
  decideOrderFill,
  estimateOrderNotional,
  validateOrderInput,
} from '../../services/tradingEngine';

interface PlaceOrderResult {
  ok: boolean;
  message: string;
  status: 'FILLED' | 'PENDING' | 'REJECTED';
  orderId?: string;
}

interface PlaceOrderPanelProps {
  symbol: string;
  latestPrice: number | null;
  buyingPower: number;
  availableSellShares: number;
  longQuantity: number;
  shortQuantity: number;
  shortAvgPrice: number;
  shortProceeds: number;
  borrowLimitRemaining: number;
  disabled?: boolean;
  tradable?: boolean;
  nonTradableReason?: string | null;
  onPlaceOrder: (draft: PlaceOrderDraft) => Promise<PlaceOrderResult>;
}

const DEFAULT_ACTION: OrderAction = 'BUY';
const DEFAULT_ORDER_TYPE: OrderType = 'MARKET';
const DEFAULT_DURATION: Duration = 'DAY';
const DEFAULT_TRAIL_MODE: TrailMode = 'DOLLAR';
const HIDDEN_VALIDATION_MESSAGES = new Set([
  'Live quote unavailable. Try again in a moment.',
]);

function formatMoney(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function orderTypeLabel(orderType: OrderType) {
  return orderType.replace('_', ' ');
}

export function PlaceOrderPanel({
  symbol,
  latestPrice,
  buyingPower,
  availableSellShares,
  longQuantity,
  shortQuantity,
  shortAvgPrice,
  shortProceeds,
  borrowLimitRemaining,
  disabled = false,
  tradable = true,
  nonTradableReason = null,
  onPlaceOrder,
}: PlaceOrderPanelProps) {
  const [action, setAction] = useState<OrderAction>(DEFAULT_ACTION);
  const [quantityInput, setQuantityInput] = useState<string>('1');
  const [orderType, setOrderType] = useState<OrderType>(DEFAULT_ORDER_TYPE);
  const [duration, setDuration] = useState<Duration>(DEFAULT_DURATION);
  const [limitPriceInput, setLimitPriceInput] = useState<string>('');
  const [stopPriceInput, setStopPriceInput] = useState<string>('');
  const [trailMode, setTrailMode] = useState<TrailMode>(DEFAULT_TRAIL_MODE);
  const [trailValueInput, setTrailValueInput] = useState<string>('');
  const [showPreview, setShowPreview] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const quantity = Number.parseInt(quantityInput, 10);
  const limitPrice = Number.parseFloat(limitPriceInput);
  const stopPrice = Number.parseFloat(stopPriceInput);
  const trailValue = Number.parseFloat(trailValueInput);

  const draft = useMemo<PlaceOrderDraft>(() => ({
    symbol,
    action,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    orderType,
    duration,
    limitPrice: Number.isFinite(limitPrice) ? limitPrice : undefined,
    stopPrice: Number.isFinite(stopPrice) ? stopPrice : undefined,
    trailMode: orderType === 'TRAILING_STOP' ? trailMode : undefined,
    trailValue: orderType === 'TRAILING_STOP' && Number.isFinite(trailValue) ? trailValue : undefined,
  }), [symbol, action, quantity, orderType, duration, limitPrice, stopPrice, trailMode, trailValue]);

  const validation = validateOrderInput(draft, latestPrice, buyingPower, {
    availableSellShares,
    longQty: longQuantity,
    shortQty: shortQuantity,
    borrowLimitRemaining,
    initialMarginRate: INITIAL_MARGIN_RATE,
    shortProceeds,
  });
  const primaryValidationMessage = (validation.reason || validation.errors[0] || null);
  const visibleValidationMessage = primaryValidationMessage && !HIDDEN_VALIDATION_MESSAGES.has(primaryValidationMessage)
    ? primaryValidationMessage
    : null;
  const estimatedNotional = latestPrice !== null ? estimateOrderNotional(draft, latestPrice) : null;
  const estimatedInitialMargin = action === 'SHORT' && typeof estimatedNotional === 'number'
    ? calculateRequiredInitialMargin(estimatedNotional, INITIAL_MARGIN_RATE)
    : null;
  const estimatedCoverPnL = action === 'COVER' && typeof latestPrice === 'number' && Number.isFinite(latestPrice)
    ? (shortAvgPrice - latestPrice) * Math.max(0, Number.isFinite(quantity) ? quantity : 0)
    : null;
  const canPreview = !disabled && tradable && validation.valid;

  const maxBuyShares = calculateMaxBuyableShares(
    buyingPower,
    orderType,
    latestPrice ?? 0,
    Number.isFinite(limitPrice) ? limitPrice : undefined
  );
  const maxSellShares = calculateMaxSellableShares(availableSellShares);
  const maxShortShares = calculateMaxShortableShares(
    buyingPower,
    borrowLimitRemaining,
    orderType,
    latestPrice ?? 0,
    Number.isFinite(limitPrice) ? limitPrice : undefined,
    INITIAL_MARGIN_RATE
  );
  const directionConflict =
    (action === 'BUY' && Number.isFinite(shortQuantity) && shortQuantity > 0) ||
    (action === 'SHORT' && Number.isFinite(longQuantity) && longQuantity > 0);

  const maxShares = directionConflict
    ? 0
    : action === 'BUY'
    ? maxBuyShares
    : action === 'SELL'
      ? maxSellShares
      : action === 'SHORT'
        ? maxShortShares
        : Math.max(0, Math.floor(shortQuantity || 0));

  const fillExpectation = latestPrice !== null ? decideOrderFill({
    id: 'preview',
    createdAt: new Date().toISOString(),
    symbol,
    action,
    quantity: Math.max(0, Number.isFinite(quantity) ? quantity : 0),
    orderType,
    duration,
    limitPrice: Number.isFinite(limitPrice) ? limitPrice : undefined,
    stopPrice: Number.isFinite(stopPrice) ? stopPrice : undefined,
    trailMode: orderType === 'TRAILING_STOP' ? trailMode : undefined,
    trailValue: orderType === 'TRAILING_STOP' && Number.isFinite(trailValue) ? trailValue : undefined,
    referencePrice: action === 'BUY' ? latestPrice : undefined,
    referenceHigh: action === 'SELL' ? latestPrice : undefined,
    referenceLow: (action === 'SHORT' || action === 'COVER') ? latestPrice : undefined,
    status: 'DRAFT',
    fees: 0,
  }, latestPrice) : { status: 'REJECTED' as const, notes: 'Quote unavailable.' };

  const resetForm = () => {
    setShowPreview(false);
    setAction(DEFAULT_ACTION);
    setQuantityInput('1');
    setOrderType(DEFAULT_ORDER_TYPE);
    setDuration(DEFAULT_DURATION);
    setLimitPriceInput('');
    setStopPriceInput('');
    setTrailMode(DEFAULT_TRAIL_MODE);
    setTrailValueInput('');
  };

  const clearForm = () => {
    setFeedback(null);
    resetForm();
  };

  const handleResetClick = () => {
    const confirmed = window.confirm('Reset this order? This will clear your current order inputs and preview.');
    if (!confirmed) return;
    clearForm();
  };

  const handleShowMax = () => {
    if (!maxShares) return;
    setQuantityInput(String(maxShares));
  };

  const handlePreview = () => {
    if (!canPreview) {
      const previewErrorMessage = nonTradableReason || visibleValidationMessage || 'Order input is invalid.';
      setFeedback({
        type: 'error',
        message: previewErrorMessage,
      });
      return;
    }
    setFeedback(null);
    setShowPreview(true);
    window.requestAnimationFrame(() => {
      previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handlePrimaryAction = async () => {
    if (showPreview) {
      await handlePlaceOrder();
      return;
    }
    handlePreview();
  };

  const handlePlaceOrder = async () => {
    if (!canPreview || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const result = await onPlaceOrder(draft);
      setFeedback({
        type: result.ok ? 'success' : 'error',
        message: result.ok
          ? result.status === 'PENDING'
            ? 'Order submitted successfully and is pending.'
            : 'Order placed successfully.'
          : result.message,
      });
      if (result.ok) {
        resetForm();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6">
      <h2 className="text-slate-100 mb-5">Place Order</h2>

      {feedback && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          feedback.type === 'success'
            ? 'bg-emerald-900/30 border border-emerald-800/50 text-emerald-400'
            : 'bg-red-900/30 border border-red-800/50 text-red-400'
        }`}>
          {feedback.message}
        </div>
      )}

      {!tradable && nonTradableReason && (
        <div className="mb-4 p-3 rounded-lg text-sm bg-red-900/20 border border-red-800/40 text-red-300">
          {nonTradableReason}
        </div>
      )}

      {!validation.valid && visibleValidationMessage && (
        <div className="mb-4 p-3 rounded-lg text-sm bg-red-900/20 border border-red-800/40 text-red-300">
          {visibleValidationMessage}
        </div>
      )}

      <div className="space-y-4">
        <div className="grid gap-4" style={{ gridTemplateColumns: '2fr 1fr 1.5fr 1fr' }}>
          <div>
            <label className="text-slate-400 text-xs mb-2 block">Action</label>
            <div className="flex gap-0.5 bg-slate-900 rounded-lg p-1 border border-slate-800 h-[42px]">
              <button
                type="button"
                onClick={() => {
                  setAction('BUY');
                  setShowPreview(false);
                  setFeedback(null);
                }}
                className={`flex-1 rounded-md text-sm font-medium border ${
                  action === 'BUY'
                    ? 'bg-emerald-900/50 text-emerald-400 border-emerald-800/50'
                    : 'text-slate-300 border-transparent hover:text-slate-100'
                }`}
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => {
                  setAction('SELL');
                  setShowPreview(false);
                  setFeedback(null);
                }}
                className={`flex-1 rounded-md text-sm font-medium border ${
                  action === 'SELL'
                    ? 'bg-red-900/50 text-red-400 border-red-800/50'
                    : 'text-slate-300 border-transparent hover:text-slate-100'
                }`}
              >
                Sell
              </button>
              <button
                type="button"
                onClick={() => {
                  setAction('SHORT');
                  setShowPreview(false);
                  setFeedback(null);
                }}
                className={`flex-1 rounded-md text-sm font-medium border ${
                  action === 'SHORT'
                    ? 'bg-emerald-900/50 text-emerald-400 border-emerald-800/50'
                    : 'text-slate-300 border-transparent hover:text-slate-100'
                }`}
              >
                Short
              </button>
              <button
                type="button"
                onClick={() => {
                  setAction('COVER');
                  setShowPreview(false);
                  setFeedback(null);
                }}
                className={`flex-1 rounded-md text-sm font-medium border ${
                  action === 'COVER'
                    ? 'bg-red-900/50 text-red-400 border-red-800/50'
                    : 'text-slate-300 border-transparent hover:text-slate-100'
                }`}
              >
                Cover
              </button>
            </div>
          </div>

          <div>
            <label className="text-slate-400 text-xs mb-2 block">Quantity</label>
            <input
              type="number"
              min={1}
              step={1}
              value={quantityInput}
              onChange={(e) => setQuantityInput(e.target.value)}
              placeholder="1"
              disabled={disabled || !tradable}
              className="w-full h-[42px] bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleShowMax}
              disabled={maxShares <= 0 || disabled}
              className="mt-2 text-xs inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 disabled:text-slate-500 disabled:cursor-not-allowed"
            >
              <Eye className="w-3 h-3" />
              Show Max
            </button>
          </div>

          <div>
            <label className="text-slate-400 text-xs mb-2 block">Order Type</label>
            <select
              value={orderType}
              onChange={(e) => setOrderType(e.target.value as OrderType)}
              disabled={disabled || !tradable}
              className="w-full h-[42px] bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 disabled:opacity-60"
            >
              <option value="MARKET">Market</option>
              <option value="LIMIT">Limit</option>
              <option value="STOP_LIMIT">Stop Limit</option>
              <option value="TRAILING_STOP">Trailing Stop</option>
            </select>
          </div>

          <div>
            <label className="text-slate-400 text-xs mb-2 block">Duration</label>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value as Duration)}
              disabled={disabled || !tradable}
              className="w-full h-[42px] bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 disabled:opacity-60"
            >
              <option value="DAY">Day</option>
              <option value="GTC">Good Until Cancelled (GTC)</option>
            </select>
          </div>
        </div>

        {(orderType === 'LIMIT' || orderType === 'STOP_LIMIT' || orderType === 'TRAILING_STOP') && (
          <div className="grid gap-4" style={{ gridTemplateColumns: orderType === 'TRAILING_STOP' ? '1fr 1fr 1fr' : '1fr 1fr' }}>
            {orderType === 'STOP_LIMIT' && (
              <div>
                <label className="text-slate-400 text-xs mb-2 block">Stop Price</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={stopPriceInput}
                  onChange={(e) => setStopPriceInput(e.target.value)}
                  placeholder="0.00"
                  disabled={disabled || !tradable}
                  className="w-full h-[42px] bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 disabled:opacity-60"
                />
              </div>
            )}

            {(orderType === 'LIMIT' || orderType === 'STOP_LIMIT') && (
              <div>
                <label className="text-slate-400 text-xs mb-2 block">Limit Price</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={limitPriceInput}
                  onChange={(e) => setLimitPriceInput(e.target.value)}
                  placeholder="0.00"
                  disabled={disabled || !tradable}
                  className="w-full h-[42px] bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 disabled:opacity-60"
                />
              </div>
            )}

            {orderType === 'TRAILING_STOP' && (
              <>
                <div>
                  <label className="text-slate-400 text-xs mb-2 block">Parameter</label>
                  <select
                    value={trailMode}
                    onChange={(e) => setTrailMode(e.target.value as TrailMode)}
                    disabled={disabled || !tradable}
                    className="w-full h-[42px] bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 disabled:opacity-60"
                  >
                    <option value="DOLLAR">$</option>
                    <option value="PERCENT">%</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 text-xs mb-2 block">Trail Value</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={trailValueInput}
                    onChange={(e) => setTrailValueInput(e.target.value)}
                    placeholder="0.00"
                    disabled={disabled || !tradable}
                    className="w-full h-[42px] bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-600 disabled:opacity-60"
                  />
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-3">
            <Button
              onClick={handlePrimaryAction}
              disabled={!canPreview || disabled}
              className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Placing...' : showPreview ? 'Place Order' : 'Preview Order'}
            </Button>
            <Button
              onClick={handleResetClick}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            >
              Reset
            </Button>
          </div>

          <div className="flex items-center gap-4">
            <div className="inline-flex items-center gap-3 whitespace-nowrap rounded-md border border-slate-800/70 bg-slate-900/40 px-3 py-1.5">
              <span className="text-slate-400 text-sm">
                {action === 'BUY'
                  ? 'Estimated Cost:'
                  : action === 'SELL'
                    ? 'Estimated Proceeds:'
                    : action === 'SHORT'
                      ? 'Estimated Notional:'
                      : 'Estimated Cover Cost:'}
              </span>
              <span className="text-slate-100 text-lg font-semibold">${formatMoney(estimatedNotional)}</span>
            </div>
            {action === 'SHORT' && (
              <div className="inline-flex items-center gap-3 whitespace-nowrap rounded-md border border-slate-800/70 bg-slate-900/40 px-3 py-1.5">
                <span className="text-slate-400 text-sm">Initial Margin:</span>
                <span className="text-amber-300 text-lg font-semibold">${formatMoney(estimatedInitialMargin)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {showPreview && (
        <div ref={previewRef} className="mt-4 p-4 rounded-lg border border-slate-700 bg-slate-900/60">
          <h3 className="text-slate-100 mb-3">Order Preview</h3>
          <p className="text-slate-300 text-sm mb-3">
            You are {action === 'BUY' ? 'BUYING' : action === 'SELL' ? 'SELLING' : action === 'SHORT' ? 'SHORTING' : 'BUYING TO COVER'} {draft.quantity} shares of {symbol}.
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm mb-3">
            <div className="text-slate-400">Symbol</div>
            <div className="text-slate-200">{symbol}</div>
            <div className="text-slate-400">Action</div>
            <div className="text-slate-200">{action}</div>
            <div className="text-slate-400">Quantity</div>
            <div className="text-slate-200">{draft.quantity}</div>
            <div className="text-slate-400">Order Type</div>
            <div className="text-slate-200">{orderTypeLabel(orderType)}</div>
            <div className="text-slate-400">Duration</div>
            <div className="text-slate-200">{duration}</div>
            <div className="text-slate-400">Buying Power</div>
            <div className="text-slate-200">${formatMoney(buyingPower)}</div>
            <div className="text-slate-400">Available Sell Shares</div>
            <div className="text-slate-200">{Math.max(0, Math.floor(availableSellShares || 0))}</div>
            <div className="text-slate-400">Borrow Remaining</div>
            <div className="text-slate-200">{Math.max(0, Math.floor(borrowLimitRemaining || 0))}</div>
            <div className="text-slate-400">Short Proceeds</div>
            <div className="text-slate-200">${formatMoney(shortProceeds)}</div>
            <div className="text-slate-400">Short Qty</div>
            <div className="text-slate-200">{Math.max(0, Math.floor(shortQuantity || 0))}</div>
            <div className="text-slate-400">Short Avg Entry</div>
            <div className="text-slate-200">${formatMoney(shortAvgPrice)}</div>
            <div className="text-slate-400">
              {action === 'BUY'
                ? 'Estimated Cost'
                : action === 'SELL'
                  ? 'Estimated Proceeds'
                  : action === 'SHORT'
                    ? 'Estimated Notional'
                    : 'Estimated Cover Cost'}
            </div>
            <div className="text-slate-200">${formatMoney(estimatedNotional)}</div>
            {action === 'SHORT' && (
              <>
                <div className="text-slate-400">Required Initial Margin</div>
                <div className="text-slate-200">${formatMoney(estimatedInitialMargin)}</div>
              </>
            )}
            {action === 'COVER' && (
              <>
                <div className="text-slate-400">Estimated Realized P/L</div>
                <div className={typeof estimatedCoverPnL === 'number' && estimatedCoverPnL >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                  ${formatMoney(estimatedCoverPnL)}
                </div>
              </>
            )}
            <div className="text-slate-400">Fill Behavior</div>
            <div className="text-slate-200">
              {fillExpectation.status === 'FILLED' ? 'Will fill now' : fillExpectation.status === 'PENDING' ? 'Will be pending' : 'Rejected'}
              {fillExpectation.notes ? ` (${fillExpectation.notes})` : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
