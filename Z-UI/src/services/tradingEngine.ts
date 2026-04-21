/**
 * Paper-trading execution rules (BUY/SELL/SHORT/COVER in this phase):
 * - Market: fills immediately at latest price.
 * - Limit:
 *   - BUY fills when latest <= limit.
 *   - SELL/SHORT fills when latest >= limit.
 * - Stop Limit:
 *   - BUY triggers when latest >= stop; then fills only if latest <= limit.
 *   - SELL triggers when latest <= stop; then fills only if latest >= limit.
 *   - SHORT entry triggers when latest >= stop; then fills only if latest >= limit.
 * - Trailing Stop:
 *   - BUY entry: fixed referencePrice; trigger above reference + trail.
 *   - SELL exit: running referenceHigh; trigger below dynamic stop.
 *   - SHORT entry: running referenceLow; trigger above dynamic trigger.
 *   - COVER exit: running referenceLow; trigger above dynamic trigger.
 *
 * Simplified short margin model:
 * - On SHORT fill, proceeds go to `shortProceeds` (not buyingPower).
 * - Required initial margin is reserved from buyingPower via `marginHeld`.
 * - BUYING POWER CHECK for SHORT: buyingPower >= initialMarginRate * estimatedNotional.
 * - Borrow limit is deterministic via `getBorrowLimit(symbol)`.
 *
 * COVER accounting (simplified):
 * - Pay cover cost from `shortProceeds` first, then `buyingPower`.
 * - Release initial margin proportional to covered quantity using short entry avg price.
 * - Net buyingPower delta = -remainingCostAfterProceeds + marginRelease.
 */

export type OrderAction = 'BUY' | 'SELL' | 'SHORT' | 'COVER';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP_LIMIT' | 'TRAILING_STOP';
export type Duration = 'DAY' | 'GTC';
export type TrailMode = 'DOLLAR' | 'PERCENT';
export type OrderStatus = 'DRAFT' | 'PENDING' | 'FILLED' | 'CANCELLED' | 'REJECTED';

export const INITIAL_MARGIN_RATE = 0.5;
export const MAINTENANCE_MARGIN_RATE = 0.3;
export const DEFAULT_BORROW_LIMIT = 1000;

export interface OrderRecord {
  id: string;
  createdAt: string;
  symbol: string;
  action: OrderAction;
  quantity: number;
  orderType: OrderType;
  duration: Duration;
  limitPrice?: number;
  stopPrice?: number;
  trailMode?: TrailMode;
  trailValue?: number;
  referencePrice?: number;
  referenceHigh?: number;
  referenceLow?: number;
  status: OrderStatus;
  filledAt?: string;
  filledPrice?: number;
  fees?: number;
  notes?: string;
}

export interface TradingTradeRecord {
  id: string;
  createdAt: string;
  symbol: string;
  side: 'BUY' | 'SELL' | 'SHORT' | 'COVER';
  quantity: number;
  price: number;
  notional: number;
  fees: number;
  orderId: string;
  realizedPnL?: number;
  costBasisUsed?: number;
  entryPriceUsed?: number;
}

export interface TradingHoldingRecord {
  symbol: string;
  quantity: number;
  avgCost: number;
}

export interface TradingPositionRecord {
  symbol: string;
  longQty: number;
  longAvgCost: number;
  shortQty: number;
  shortAvgPrice: number;
}

export interface TradingAccountSnapshot {
  buyingPower: number;
  reservedBuyingPower: number;
  totalEquity?: number;
  holdings?: TradingHoldingRecord[];
  positions?: TradingPositionRecord[];
  shortProceeds?: number;
  marginHeld?: number;
  marginCall?: boolean;
  updatedAt: string;
}

export interface PlaceOrderDraft {
  symbol: string;
  action: OrderAction;
  quantity: number;
  orderType: OrderType;
  duration: Duration;
  limitPrice?: number;
  stopPrice?: number;
  trailMode?: TrailMode;
  trailValue?: number;
}

export interface ValidationResult {
  ok: boolean;
  valid: boolean;
  errors: string[];
  reason?: string;
}

export interface ExecutionDecision {
  status: 'FILLED' | 'PENDING' | 'REJECTED';
  filledPrice?: number;
  notes?: string;
  orderPatch?: Partial<OrderRecord>;
}

export interface OrderValidationContext {
  availableSellShares?: number;
  longQty?: number;
  shortQty?: number;
  borrowLimitRemaining?: number;
  initialMarginRate?: number;
  shortProceeds?: number;
}

export interface OrderExecutionContext {
  buyingPower: number;
  availableSellShares?: number;
  longQty?: number;
  shortQty?: number;
  borrowLimitRemaining?: number;
  initialMarginRate?: number;
  shortProceeds?: number;
}

function isPositiveNumber(value: number | undefined): value is number {
  return Number.isFinite(value) && (value as number) > 0;
}

export function getBorrowLimit(_symbol: string): number {
  return DEFAULT_BORROW_LIMIT;
}

export function calculateRequiredInitialMargin(
  notional: number,
  initialMarginRate: number = INITIAL_MARGIN_RATE
): number {
  if (!Number.isFinite(notional) || notional <= 0) return 0;
  if (!Number.isFinite(initialMarginRate) || initialMarginRate <= 0) return 0;
  return notional * initialMarginRate;
}

export function calculateMaintenanceMargin(
  notional: number,
  maintenanceMarginRate: number = MAINTENANCE_MARGIN_RATE
): number {
  if (!Number.isFinite(notional) || notional <= 0) return 0;
  if (!Number.isFinite(maintenanceMarginRate) || maintenanceMarginRate <= 0) return 0;
  return notional * maintenanceMarginRate;
}

export function estimateOrderNotional(draft: PlaceOrderDraft, latestPrice: number): number | null {
  if (!Number.isFinite(latestPrice) || latestPrice <= 0) return null;
  const qty = Number(draft.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return null;

  switch (draft.orderType) {
    case 'MARKET':
      return latestPrice * qty;
    case 'LIMIT':
    case 'STOP_LIMIT':
      return isPositiveNumber(draft.limitPrice) ? draft.limitPrice * qty : null;
    case 'TRAILING_STOP':
      return latestPrice * qty;
    default:
      return null;
  }
}

export function estimateBuyOrderCost(draft: PlaceOrderDraft, latestPrice: number): number | null {
  return estimateOrderNotional(draft, latestPrice);
}

export function estimateShortInitialMargin(
  draft: PlaceOrderDraft,
  latestPrice: number,
  initialMarginRate: number = INITIAL_MARGIN_RATE
): number | null {
  const notional = estimateOrderNotional(draft, latestPrice);
  if (notional === null) return null;
  return calculateRequiredInitialMargin(notional, initialMarginRate);
}

export function calculateMaxBuyableShares(
  buyingPower: number,
  orderType: OrderType,
  latestPrice: number,
  limitPrice?: number
): number {
  if (!Number.isFinite(buyingPower) || buyingPower <= 0) return 0;
  if (!Number.isFinite(latestPrice) || latestPrice <= 0) return 0;

  if (orderType === 'LIMIT' || orderType === 'STOP_LIMIT') {
    if (!isPositiveNumber(limitPrice)) return 0;
    return Math.max(0, Math.floor(buyingPower / limitPrice));
  }

  return Math.max(0, Math.floor(buyingPower / latestPrice));
}

export function calculateMaxSellableShares(availableQuantity: number): number {
  if (!Number.isFinite(availableQuantity) || availableQuantity <= 0) return 0;
  return Math.max(0, Math.floor(availableQuantity));
}

export function calculateMaxShortableShares(
  buyingPower: number,
  borrowLimitRemaining: number,
  orderType: OrderType,
  latestPrice: number,
  limitPrice?: number,
  initialMarginRate: number = INITIAL_MARGIN_RATE
): number {
  if (!Number.isFinite(buyingPower) || buyingPower <= 0) return 0;
  if (!Number.isFinite(borrowLimitRemaining) || borrowLimitRemaining <= 0) return 0;
  if (!Number.isFinite(initialMarginRate) || initialMarginRate <= 0) return 0;

  const priceBasis =
    orderType === 'LIMIT' || orderType === 'STOP_LIMIT'
      ? (isPositiveNumber(limitPrice) ? limitPrice : null)
      : (Number.isFinite(latestPrice) && latestPrice > 0 ? latestPrice : null);

  if (priceBasis === null) return 0;

  const maxByMargin = Math.floor(buyingPower / (initialMarginRate * priceBasis));
  const maxByBorrow = Math.floor(borrowLimitRemaining);
  return Math.max(0, Math.min(maxByMargin, maxByBorrow));
}

export function validateOrderInput(
  draft: PlaceOrderDraft,
  latestPrice: number | null,
  buyingPower: number,
  validationContext: OrderValidationContext = {}
): ValidationResult {
  const errors: string[] = [];
  const {
    availableSellShares = 0,
    longQty = 0,
    shortQty = 0,
    borrowLimitRemaining = Number.POSITIVE_INFINITY,
    initialMarginRate = INITIAL_MARGIN_RATE,
    shortProceeds = 0,
  } = validationContext;

  if (!draft.symbol.trim()) errors.push('Symbol is required.');
  if (!Number.isInteger(draft.quantity) || draft.quantity <= 0) {
    errors.push('Quantity must be a positive integer.');
  }
  if (latestPrice === null || !Number.isFinite(latestPrice) || latestPrice <= 0) {
    errors.push('Live quote unavailable. Try again in a moment.');
  }

  if (draft.action !== 'BUY' && draft.action !== 'SELL' && draft.action !== 'SHORT' && draft.action !== 'COVER') {
    errors.push('Only BUY, SELL, SHORT, and COVER are supported in this version.');
  }

  if (draft.orderType === 'LIMIT' || draft.orderType === 'STOP_LIMIT') {
    if (!isPositiveNumber(draft.limitPrice)) {
      errors.push('Limit price must be greater than 0.');
    }
  }

  if (draft.orderType === 'STOP_LIMIT') {
    if (!isPositiveNumber(draft.stopPrice)) {
      errors.push('Stop price must be greater than 0.');
    }
  }

  if (draft.orderType === 'TRAILING_STOP') {
    if (!draft.trailMode) errors.push('Trailing mode is required.');
    if (!isPositiveNumber(draft.trailValue)) {
      errors.push('Trailing value must be greater than 0.');
    }
  }

  if (draft.action === 'BUY') {
    if (shortQty > 0) {
      errors.push('Cannot open LONG while a short position exists for this symbol.');
    }

    if (errors.length === 0 && latestPrice !== null) {
      const estimatedCost = estimateOrderNotional(draft, latestPrice);
      if (estimatedCost === null) {
        errors.push('Unable to estimate order cost.');
      } else if (estimatedCost > buyingPower) {
        errors.push(
          `Insufficient buying power. Need $${estimatedCost.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}, have $${buyingPower.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}.`
        );
      }
    }
  }

  if (draft.action === 'SELL') {
    if (!Number.isFinite(availableSellShares) || availableSellShares <= 0) {
      errors.push('No shares available to sell for this symbol.');
    } else if (draft.quantity > Math.floor(availableSellShares)) {
      errors.push(`Insufficient shares. Need ${draft.quantity}, have ${Math.floor(availableSellShares)}.`);
    }
  }

  if (draft.action === 'SHORT') {
    if (longQty > 0) {
      errors.push('Cannot open SHORT while a long position exists for this symbol.');
    }

    if (!Number.isFinite(borrowLimitRemaining) || borrowLimitRemaining <= 0) {
      errors.push('No borrow availability for this symbol.');
    } else if (draft.quantity > Math.floor(borrowLimitRemaining)) {
      errors.push(`Borrow limit exceeded. Max shortable now is ${Math.floor(borrowLimitRemaining)} shares.`);
    }

    if (errors.length === 0 && latestPrice !== null) {
      const estimatedNotional = estimateOrderNotional(draft, latestPrice);
      if (estimatedNotional === null) {
        errors.push('Unable to estimate short notional.');
      } else {
        const requiredMargin = calculateRequiredInitialMargin(estimatedNotional, initialMarginRate);
        if (requiredMargin > buyingPower) {
          errors.push(
            `Insufficient buying power for initial margin. Need $${requiredMargin.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}, have $${buyingPower.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}.`
          );
        }
      }
    }

    if (shortQty < 0) {
      errors.push('Invalid short position state.');
    }
  }

  if (draft.action === 'COVER') {
    if (!Number.isFinite(shortQty) || shortQty <= 0) {
      errors.push('No short position to cover.');
    } else if (draft.quantity > Math.floor(shortQty)) {
      errors.push(`Insufficient short shares. Need ${draft.quantity}, have ${Math.floor(shortQty)}.`);
    }

    if (errors.length === 0 && latestPrice !== null) {
      const estimatedCost = estimateOrderNotional(draft, latestPrice);
      if (estimatedCost === null) {
        errors.push('Unable to estimate cover cost.');
      } else if (estimatedCost > (buyingPower + shortProceeds)) {
        errors.push(
          `Insufficient funds to cover. Need $${estimatedCost.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}, available $${(buyingPower + shortProceeds).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}.`
        );
      }
    }
  }

  return { ok: errors.length === 0, valid: errors.length === 0, errors, reason: errors[0] };
}

export function validateBuyOrderInput(
  draft: PlaceOrderDraft,
  latestPrice: number | null,
  buyingPower: number
): ValidationResult {
  return validateOrderInput({ ...draft, action: 'BUY' }, latestPrice, buyingPower);
}

export function createOrderRecordFromDraft(draft: PlaceOrderDraft, latestPrice: number): OrderRecord {
  return {
    id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    symbol: draft.symbol.trim().toUpperCase(),
    action: draft.action,
    quantity: draft.quantity,
    orderType: draft.orderType,
    duration: draft.duration,
    limitPrice: draft.limitPrice,
    stopPrice: draft.stopPrice,
    trailMode: draft.trailMode,
    trailValue: draft.trailValue,
    referencePrice: draft.orderType === 'TRAILING_STOP' && draft.action === 'BUY' ? latestPrice : undefined,
    referenceHigh: draft.orderType === 'TRAILING_STOP' && draft.action === 'SELL' ? latestPrice : undefined,
    referenceLow: draft.orderType === 'TRAILING_STOP' && (draft.action === 'SHORT' || draft.action === 'COVER') ? latestPrice : undefined,
    status: 'DRAFT',
    fees: 0,
  };
}

export function decideBuyFill(order: OrderRecord, latestPrice: number): ExecutionDecision {
  if (!Number.isFinite(latestPrice) || latestPrice <= 0) {
    return { status: 'REJECTED', notes: 'Latest price unavailable.' };
  }

  switch (order.orderType) {
    case 'MARKET':
      return { status: 'FILLED', filledPrice: latestPrice };

    case 'LIMIT':
      if (isPositiveNumber(order.limitPrice) && latestPrice <= order.limitPrice) {
        return { status: 'FILLED', filledPrice: latestPrice };
      }
      return { status: 'PENDING', notes: 'Waiting for price at or below limit.' };

    case 'STOP_LIMIT': {
      if (!isPositiveNumber(order.stopPrice) || !isPositiveNumber(order.limitPrice)) {
        return { status: 'REJECTED', notes: 'Missing stop/limit price.' };
      }
      if (latestPrice < order.stopPrice) {
        return { status: 'PENDING', notes: 'Waiting for stop trigger.' };
      }
      if (latestPrice <= order.limitPrice) {
        return { status: 'FILLED', filledPrice: latestPrice };
      }
      return { status: 'PENDING', notes: 'Triggered; waiting for price at or below limit.' };
    }

    case 'TRAILING_STOP': {
      if (!isPositiveNumber(order.referencePrice) || !isPositiveNumber(order.trailValue) || !order.trailMode) {
        return { status: 'REJECTED', notes: 'Missing trailing stop parameters.' };
      }
      const triggerPrice = order.trailMode === 'DOLLAR'
        ? order.referencePrice + order.trailValue
        : order.referencePrice * (1 + order.trailValue / 100);

      if (latestPrice >= triggerPrice) {
        return { status: 'FILLED', filledPrice: latestPrice };
      }
      return { status: 'PENDING', notes: `Waiting for trigger at ${triggerPrice.toFixed(2)}.` };
    }

    default:
      return { status: 'REJECTED', notes: 'Unsupported order type.' };
  }
}

export function decideSellFill(order: OrderRecord, latestPrice: number): ExecutionDecision {
  if (!Number.isFinite(latestPrice) || latestPrice <= 0) {
    return { status: 'REJECTED', notes: 'Latest price unavailable.' };
  }

  switch (order.orderType) {
    case 'MARKET':
      return { status: 'FILLED', filledPrice: latestPrice };

    case 'LIMIT':
      if (isPositiveNumber(order.limitPrice) && latestPrice >= order.limitPrice) {
        return { status: 'FILLED', filledPrice: latestPrice };
      }
      return { status: 'PENDING', notes: 'Waiting for price at or above limit.' };

    case 'STOP_LIMIT': {
      if (!isPositiveNumber(order.stopPrice) || !isPositiveNumber(order.limitPrice)) {
        return { status: 'REJECTED', notes: 'Missing stop/limit price.' };
      }

      if (latestPrice > order.stopPrice) {
        return { status: 'PENDING', notes: 'Waiting for stop trigger.' };
      }

      if (latestPrice >= order.limitPrice) {
        return { status: 'FILLED', filledPrice: latestPrice };
      }

      return { status: 'PENDING', notes: 'Triggered; waiting for price at or above limit.' };
    }

    case 'TRAILING_STOP': {
      if (!isPositiveNumber(order.trailValue) || !order.trailMode) {
        return { status: 'REJECTED', notes: 'Missing trailing stop parameters.' };
      }

      const currentHigh = isPositiveNumber(order.referenceHigh) ? order.referenceHigh : latestPrice;
      const nextHigh = Math.max(currentHigh, latestPrice);
      const dynamicStop = order.trailMode === 'DOLLAR'
        ? nextHigh - order.trailValue
        : nextHigh * (1 - order.trailValue / 100);

      if (latestPrice <= dynamicStop) {
        return {
          status: 'FILLED',
          filledPrice: latestPrice,
          orderPatch: { referenceHigh: nextHigh },
        };
      }

      return {
        status: 'PENDING',
        notes: `Trailing stop at ${dynamicStop.toFixed(2)} (high ${nextHigh.toFixed(2)}).`,
        orderPatch: { referenceHigh: nextHigh },
      };
    }

    default:
      return { status: 'REJECTED', notes: 'Unsupported order type.' };
  }
}

export function decideShortFill(order: OrderRecord, latestPrice: number): ExecutionDecision {
  if (!Number.isFinite(latestPrice) || latestPrice <= 0) {
    return { status: 'REJECTED', notes: 'Latest price unavailable.' };
  }

  switch (order.orderType) {
    case 'MARKET':
      return { status: 'FILLED', filledPrice: latestPrice };

    case 'LIMIT':
      if (isPositiveNumber(order.limitPrice) && latestPrice >= order.limitPrice) {
        return { status: 'FILLED', filledPrice: latestPrice };
      }
      return { status: 'PENDING', notes: 'Waiting for short entry at or above limit.' };

    case 'STOP_LIMIT': {
      if (!isPositiveNumber(order.stopPrice) || !isPositiveNumber(order.limitPrice)) {
        return { status: 'REJECTED', notes: 'Missing stop/limit price.' };
      }

      if (latestPrice < order.stopPrice) {
        return { status: 'PENDING', notes: 'Waiting for stop trigger.' };
      }

      if (latestPrice >= order.limitPrice) {
        return { status: 'FILLED', filledPrice: latestPrice };
      }

      return { status: 'PENDING', notes: 'Triggered; waiting for price at or above limit.' };
    }

    case 'TRAILING_STOP': {
      if (!isPositiveNumber(order.trailValue) || !order.trailMode) {
        return { status: 'REJECTED', notes: 'Missing trailing entry parameters.' };
      }

      const currentLow = isPositiveNumber(order.referenceLow) ? order.referenceLow : latestPrice;
      const nextLow = Math.min(currentLow, latestPrice);
      const trigger = order.trailMode === 'DOLLAR'
        ? nextLow + order.trailValue
        : nextLow * (1 + order.trailValue / 100);

      if (latestPrice >= trigger) {
        return {
          status: 'FILLED',
          filledPrice: latestPrice,
          orderPatch: { referenceLow: nextLow },
        };
      }

      return {
        status: 'PENDING',
        notes: `Trailing short trigger at ${trigger.toFixed(2)} (low ${nextLow.toFixed(2)}).`,
        orderPatch: { referenceLow: nextLow },
      };
    }

    default:
      return { status: 'REJECTED', notes: 'Unsupported order type.' };
  }
}

export function decideCoverFill(order: OrderRecord, latestPrice: number): ExecutionDecision {
  if (!Number.isFinite(latestPrice) || latestPrice <= 0) {
    return { status: 'REJECTED', notes: 'Latest price unavailable.' };
  }

  switch (order.orderType) {
    case 'MARKET':
      return { status: 'FILLED', filledPrice: latestPrice };

    case 'LIMIT':
      if (isPositiveNumber(order.limitPrice) && latestPrice <= order.limitPrice) {
        return { status: 'FILLED', filledPrice: latestPrice };
      }
      return { status: 'PENDING', notes: 'Waiting for cover at or below limit.' };

    case 'STOP_LIMIT': {
      if (!isPositiveNumber(order.stopPrice) || !isPositiveNumber(order.limitPrice)) {
        return { status: 'REJECTED', notes: 'Missing stop/limit price.' };
      }
      if (latestPrice < order.stopPrice) {
        return { status: 'PENDING', notes: 'Waiting for stop trigger.' };
      }
      if (latestPrice <= order.limitPrice) {
        return { status: 'FILLED', filledPrice: latestPrice };
      }
      return { status: 'PENDING', notes: 'Triggered; waiting for price at or below limit.' };
    }

    case 'TRAILING_STOP': {
      if (!isPositiveNumber(order.trailValue) || !order.trailMode) {
        return { status: 'REJECTED', notes: 'Missing trailing cover parameters.' };
      }

      const currentLow = isPositiveNumber(order.referenceLow) ? order.referenceLow : latestPrice;
      const nextLow = Math.min(currentLow, latestPrice);
      const trigger = order.trailMode === 'DOLLAR'
        ? nextLow + order.trailValue
        : nextLow * (1 + order.trailValue / 100);

      if (latestPrice >= trigger) {
        return {
          status: 'FILLED',
          filledPrice: latestPrice,
          orderPatch: { referenceLow: nextLow },
        };
      }

      return {
        status: 'PENDING',
        notes: `Trailing cover trigger at ${trigger.toFixed(2)} (low ${nextLow.toFixed(2)}).`,
        orderPatch: { referenceLow: nextLow },
      };
    }

    default:
      return { status: 'REJECTED', notes: 'Unsupported order type.' };
  }
}

export function decideOrderFill(order: OrderRecord, latestPrice: number): ExecutionDecision {
  if (order.action === 'BUY') return decideBuyFill(order, latestPrice);
  if (order.action === 'SELL') return decideSellFill(order, latestPrice);
  if (order.action === 'SHORT') return decideShortFill(order, latestPrice);
  if (order.action === 'COVER') return decideCoverFill(order, latestPrice);
  return { status: 'REJECTED', notes: 'Unsupported order action.' };
}

export function calculateCoverSettlement(
  fillCost: number,
  qty: number,
  entryPrice: number,
  shortProceeds: number,
  marginHeld: number,
  initialMarginRate: number = INITIAL_MARGIN_RATE
) {
  const safeFillCost = Number.isFinite(fillCost) && fillCost > 0 ? fillCost : 0;
  const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const safeEntryPrice = Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : 0;
  const safeShortProceeds = Number.isFinite(shortProceeds) && shortProceeds > 0 ? shortProceeds : 0;
  const safeMarginHeld = Number.isFinite(marginHeld) && marginHeld > 0 ? marginHeld : 0;

  const useFromProceeds = Math.min(safeShortProceeds, safeFillCost);
  const remainingCost = safeFillCost - useFromProceeds;
  const configuredRelease = calculateRequiredInitialMargin(safeEntryPrice * safeQty, initialMarginRate);
  const marginRelease = Math.min(safeMarginHeld, configuredRelease);
  const realizedPnL = (safeEntryPrice - (safeQty > 0 ? safeFillCost / safeQty : 0)) * safeQty;

  return {
    useFromProceeds,
    remainingCost,
    marginRelease,
    shortProceedsDelta: -useFromProceeds,
    buyingPowerDelta: -remainingCost + marginRelease,
    marginHeldDelta: -marginRelease,
    realizedPnL,
    entryPriceUsed: safeEntryPrice,
  };
}

export function executeOrderDecision(
  order: OrderRecord,
  latestPrice: number,
  executionContext: OrderExecutionContext
): ExecutionDecision {
  const {
    buyingPower,
    availableSellShares = 0,
    longQty = 0,
    shortQty = 0,
    borrowLimitRemaining = Number.POSITIVE_INFINITY,
    initialMarginRate = INITIAL_MARGIN_RATE,
    shortProceeds = 0,
  } = executionContext;

  const fillDecision = decideOrderFill(order, latestPrice);
  if (fillDecision.status !== 'FILLED' || !Number.isFinite(fillDecision.filledPrice)) {
    return fillDecision;
  }

  const notional = (fillDecision.filledPrice as number) * order.quantity;
  const fees = Number(order.fees || 0);

  if (order.action === 'BUY') {
    if (shortQty > 0) {
      return { status: 'REJECTED', notes: 'Cannot open LONG while a short position exists for this symbol.' };
    }
    if (notional + fees > buyingPower) {
      return { status: 'REJECTED', notes: 'Insufficient buying power at execution time.' };
    }
  }

  if (order.action === 'SELL') {
    if (!Number.isFinite(availableSellShares) || availableSellShares < order.quantity) {
      return { status: 'REJECTED', notes: 'Insufficient shares at execution time.' };
    }
  }

  if (order.action === 'SHORT') {
    if (longQty > 0) {
      return { status: 'REJECTED', notes: 'Cannot short while long shares exist.' };
    }

    if (!Number.isFinite(borrowLimitRemaining) || borrowLimitRemaining < order.quantity) {
      return { status: 'REJECTED', notes: 'Borrow limit exceeded at execution time.' };
    }

    if (shortQty < 0) {
      return { status: 'REJECTED', notes: 'Invalid short position state.' };
    }

    const requiredMargin = calculateRequiredInitialMargin(notional, initialMarginRate);
    if (requiredMargin + fees > buyingPower) {
      return { status: 'REJECTED', notes: 'Insufficient buying power for initial margin at execution time.' };
    }
  }

  if (order.action === 'COVER') {
    if (!Number.isFinite(shortQty) || shortQty < order.quantity) {
      return { status: 'REJECTED', notes: 'Insufficient short shares at execution time.' };
    }
    if (notional + fees > buyingPower + shortProceeds) {
      return { status: 'REJECTED', notes: 'Insufficient funds to cover at execution time.' };
    }
  }

  return fillDecision;
}

export function executeBuyOrderDecision(
  order: OrderRecord,
  latestPrice: number,
  buyingPower: number
): ExecutionDecision {
  return executeOrderDecision({ ...order, action: 'BUY' }, latestPrice, { buyingPower });
}
