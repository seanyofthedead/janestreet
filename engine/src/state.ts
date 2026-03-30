/**
 * In-memory portfolio and engine state.
 * Reconciles with Alpaca and persists to DynamoDB (stubbed).
 */

import pino from 'pino';
import type { AlpacaClient } from './alpaca/client.js';
import type { AlpacaPosition, AlpacaOrder } from './alpaca/types.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export interface Position {
  symbol: string;
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPl: number;
  side: 'long' | 'short';
}

export interface TrackedOrder {
  clientOrderId: string;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  limitPrice: number;
  status: string;
  strategy: string;
  createdAt: string;
  filledQty: number;
  filledAvgPrice: number | undefined;
}

export interface PortfolioSnapshot {
  equity: number;
  cash: number;
  buyingPower: number;
  positions: Position[];
  positionCount: number;
  dailyPnl: number;
  totalUnrealizedPl: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Engine state enum (mirrors OCaml engine_state)
// ---------------------------------------------------------------------------

export type EngineStateValue =
  | 'Starting'
  | 'Warming_up'
  | 'Trading'
  | 'Off_hours'
  | 'Read_only'
  | { type: 'Cooldown'; until: number; reason: string }
  | { type: 'Halted'; reason: string };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export class State {
  private readonly logger: pino.Logger;

  /** Current engine state (Melange-compatible representation) */
  engineState: unknown = 0; // Starting = 0

  /** Human-readable state name */
  engineStateName: string = 'Starting';

  /** Portfolio data */
  equity: number = 0;
  cash: number = 0;
  buyingPower: number = 0;
  dailyPnl: number = 0;
  peakEquity: number = 0;
  lastHeartbeat: number = Date.now();

  /** Positions indexed by symbol */
  private positions: Map<string, Position> = new Map();

  /** Active orders indexed by clientOrderId */
  private activeOrders: Map<string, TrackedOrder> = new Map();

  /** PDT day trade count */
  dayTradeCount: number = 0;

  /** Tick counter */
  tickCount: number = 0;

  /** Start time */
  readonly startedAt: number = Date.now();

  constructor(logger?: pino.Logger) {
    this.logger = (logger ?? pino({ name: 'state' })).child({ component: 'state' });
  }

  // -----------------------------------------------------------------------
  // Reconciliation
  // -----------------------------------------------------------------------

  /** Fetch positions and orders from Alpaca and sync local state */
  async reconcileWithAlpaca(client: AlpacaClient): Promise<void> {
    this.logger.info('Reconciling state with Alpaca');

    try {
      const [account, alpacaPositions, alpacaOrders] = await Promise.all([
        client.getAccount(),
        client.getPositions(),
        client.getOrders('open'),
      ]);

      // Update account data
      this.equity = account.equity;
      this.cash = account.cash;
      this.buyingPower = account.buying_power;
      this.dayTradeCount = account.daytrade_count;

      if (this.equity > this.peakEquity) {
        this.peakEquity = this.equity;
      }

      // Sync positions
      this.positions.clear();
      for (const ap of alpacaPositions) {
        this.positions.set(ap.symbol, this.alpacaPositionToInternal(ap));
      }

      // Sync active orders
      this.activeOrders.clear();
      for (const ao of alpacaOrders) {
        this.activeOrders.set(ao.client_order_id, this.alpacaOrderToInternal(ao));
      }

      this.logger.info(
        {
          equity: this.equity,
          positions: this.positions.size,
          activeOrders: this.activeOrders.size,
        },
        'Reconciliation complete',
      );

      await this.persistState();
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'Reconciliation failed');
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Position management
  // -----------------------------------------------------------------------

  /** Update a position with a new price */
  updatePosition(symbol: string, price: number): void {
    const pos = this.positions.get(symbol);
    if (!pos) return;

    pos.currentPrice = price;
    pos.marketValue = pos.qty * price;
    pos.unrealizedPl = (price - pos.avgEntryPrice) * pos.qty;
    this.positions.set(symbol, pos);
  }

  getPosition(symbol: string): Position | undefined {
    return this.positions.get(symbol);
  }

  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  // -----------------------------------------------------------------------
  // Order management
  // -----------------------------------------------------------------------

  /** Track a new order */
  addOrder(order: TrackedOrder): void {
    this.activeOrders.set(order.clientOrderId, order);
    this.logger.debug({ clientOrderId: order.clientOrderId, symbol: order.symbol }, 'Order tracked');
    this.persistState().catch(() => {});
  }

  /** Update an order based on a fill/cancel/etc event */
  updateOrder(
    clientOrderId: string,
    update: { status: string; filledQty?: number; filledAvgPrice?: number },
  ): void {
    const order = this.activeOrders.get(clientOrderId);
    if (!order) {
      this.logger.warn({ clientOrderId }, 'Order update for unknown order');
      return;
    }

    order.status = update.status;
    if (update.filledQty !== undefined) order.filledQty = update.filledQty;
    if (update.filledAvgPrice !== undefined) order.filledAvgPrice = update.filledAvgPrice;

    // Remove terminal orders after a short delay
    const terminalStatuses = ['filled', 'canceled', 'expired', 'rejected'];
    if (terminalStatuses.includes(order.status)) {
      setTimeout(() => {
        this.activeOrders.delete(clientOrderId);
      }, 30_000);
    }

    this.persistState().catch(() => {});
  }

  getOrder(clientOrderId: string): TrackedOrder | undefined {
    return this.activeOrders.get(clientOrderId);
  }

  getAllActiveOrders(): TrackedOrder[] {
    return Array.from(this.activeOrders.values());
  }

  // -----------------------------------------------------------------------
  // Portfolio snapshot
  // -----------------------------------------------------------------------

  /** Get current portfolio state for risk checks */
  getPortfolioSnapshot(): PortfolioSnapshot {
    const positions = this.getAllPositions();
    const totalUnrealizedPl = positions.reduce((acc, p) => acc + p.unrealizedPl, 0);

    return {
      equity: this.equity,
      cash: this.cash,
      buyingPower: this.buyingPower,
      positions,
      positionCount: positions.length,
      dailyPnl: this.dailyPnl,
      totalUnrealizedPl,
      timestamp: Date.now(),
    };
  }

  /**
   * Build a portfolio object compatible with the OCaml risk engine.
   * The Melange-compiled risk.evaluate expects a portfolio record with
   * { positions, cash, equity, buying_power, daily_pnl, total_pnl }.
   */
  toOcamlPortfolio(): {
    positions: unknown;
    cash: number;
    equity: number;
    buying_power: number;
    daily_pnl: number;
    total_pnl: number;
  } {
    // Build OCaml linked list of positions (0 = [])
    let positionList: unknown = 0;
    const posArray = this.getAllPositions();
    // Build in reverse so the list order matches the array order
    for (let i = posArray.length - 1; i >= 0; i--) {
      const p = posArray[i]!;
      positionList = {
        hd: {
          symbol: p.symbol,
          qty: p.qty,
          avg_entry_price: p.avgEntryPrice,
          current_price: p.currentPrice,
          strategy_id: 0,
          opened_at: 0,
        },
        tl: positionList,
      };
    }

    return {
      positions: positionList,
      cash: this.cash,
      equity: this.equity,
      buying_power: this.buyingPower,
      daily_pnl: this.dailyPnl,
      total_pnl: 0,
    };
  }

  // -----------------------------------------------------------------------
  // DynamoDB persistence (stubbed)
  // -----------------------------------------------------------------------

  private async persistState(): Promise<void> {
    // TODO: Persist to DynamoDB
    // const params = {
    //   TableName: 'engine-state',
    //   Item: {
    //     pk: 'ENGINE_STATE',
    //     sk: Date.now().toString(),
    //     equity: this.equity,
    //     cash: this.cash,
    //     positions: this.getAllPositions(),
    //     activeOrders: this.getAllActiveOrders(),
    //     engineState: this.engineStateName,
    //   },
    // };
    this.logger.debug('State persistence (stubbed)');
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private alpacaPositionToInternal(ap: AlpacaPosition): Position {
    return {
      symbol: ap.symbol,
      qty: ap.qty,
      avgEntryPrice: ap.avg_entry_price,
      currentPrice: ap.current_price,
      marketValue: ap.market_value,
      unrealizedPl: ap.unrealized_pl,
      side: ap.side,
    };
  }

  private alpacaOrderToInternal(ao: AlpacaOrder): TrackedOrder {
    // Extract strategy name from client_order_id (format: strategy_symbol_ts_nonce)
    const parts = ao.client_order_id.split('_');
    const strategy = parts[0] ?? 'unknown';

    return {
      clientOrderId: ao.client_order_id,
      orderId: ao.id,
      symbol: ao.symbol,
      side: ao.side,
      qty: ao.qty ?? 0,
      limitPrice: ao.limit_price ?? 0,
      status: ao.status,
      strategy,
      createdAt: ao.created_at,
      filledQty: ao.filled_qty,
      filledAvgPrice: ao.filled_avg_price ?? undefined,
    };
  }
}
