/**
 * MockOrderManager: simulates order fills using historical bar data
 * from the SimulationController. Drop-in replacement for the real
 * OrderManager during simulation mode.
 */

import { EventEmitter } from 'events';
import pino from 'pino';
import { makeClientOrderId } from '../alpaca/order-manager.js';
import type { OrderParams, OrderEvent } from '../alpaca/order-manager.js';
import type { AlpacaOrder } from '../alpaca/types.js';
import type { SimulationController, ReplayBar } from './controller.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SLIPPAGE_PCT = 0.0005; // 5 bps

// ---------------------------------------------------------------------------
// MockOrderManager
// ---------------------------------------------------------------------------

export class MockOrderManager extends EventEmitter {
  private readonly logger: pino.Logger;
  private readonly simulationController: SimulationController;
  private readonly slippagePct: number;

  /** Pending orders awaiting fill */
  private pendingOrders: Map<string, { order: AlpacaOrder; params: OrderParams }> = new Map();

  /** All tracked orders (including filled) */
  private trackedOrders: Map<string, AlpacaOrder> = new Map();

  constructor(
    simulationController: SimulationController,
    logger?: pino.Logger,
    slippagePct: number = DEFAULT_SLIPPAGE_PCT,
  ) {
    super();
    this.simulationController = simulationController;
    this.slippagePct = slippagePct;
    this.logger = (logger ?? pino({ name: 'mock-order-manager' })).child({
      component: 'mock-order-manager',
    });

    // Register for bar events to process pending fills
    this.simulationController.onBar((symbol, bar) => {
      this.processPendingFills(symbol, bar);
    });
  }

  // -----------------------------------------------------------------------
  // Order submission (matches real OrderManager interface)
  // -----------------------------------------------------------------------

  async submitOrder(params: OrderParams): Promise<AlpacaOrder> {
    const strategy = params.strategy;
    const symbol = params.symbol;
    const clientOrderId = makeClientOrderId(strategy, symbol);

    // Calculate qty from notional if needed
    let qty = params.qty ?? 0;
    if (!qty && params.notional && params.limitPrice > 0) {
      qty = Math.round((params.notional / params.limitPrice) * 100) / 100;
    }

    const order: AlpacaOrder = {
      id: `sim-${clientOrderId}`,
      client_order_id: clientOrderId,
      created_at: new Date().toISOString(),
      asset_id: `sim-asset-${symbol}`,
      symbol,
      qty,
      filled_qty: 0,
      filled_avg_price: undefined,
      order_class: '',
      order_type: 'limit',
      type: 'limit',
      side: params.side,
      time_in_force: params.timeInForce ?? 'day',
      limit_price: params.limitPrice,
      status: 'new',
      extended_hours: params.extendedHours ?? false,
    };

    this.trackedOrders.set(clientOrderId, order);
    this.pendingOrders.set(clientOrderId, { order, params });

    this.logger.info(
      { clientOrderId, symbol, side: params.side, qty, limitPrice: params.limitPrice },
      'Simulation order submitted',
    );

    // Emit 'new' order event
    const newEvent: OrderEvent = {
      type: 'new',
      clientOrderId,
      order,
      timestamp: new Date().toISOString(),
    };
    this.emit('orderUpdate', newEvent);

    return order;
  }

  // -----------------------------------------------------------------------
  // Fill simulation
  // -----------------------------------------------------------------------

  /**
   * Process pending fills when a new bar arrives for a symbol.
   * Fills at the bar's open price +/- slippage.
   */
  private processPendingFills(symbol: string, bar: ReplayBar): void {
    for (const [clientOrderId, pending] of this.pendingOrders) {
      if (pending.order.symbol !== symbol) continue;

      const fillPrice = pending.params.side === 'buy'
        ? bar.o * (1 + this.slippagePct)
        : bar.o * (1 - this.slippagePct);

      const fillQty = pending.order.qty ?? 0;

      // Update order status
      pending.order.status = 'filled';
      pending.order.filled_qty = fillQty;
      pending.order.filled_avg_price = Math.round(fillPrice * 100) / 100;
      pending.order.filled_at = new Date().toISOString();

      this.trackedOrders.set(clientOrderId, pending.order);
      this.pendingOrders.delete(clientOrderId);

      this.logger.info(
        { clientOrderId, symbol, fillPrice: pending.order.filled_avg_price, fillQty },
        'Simulation order filled',
      );

      // Emit fill event matching wireOrderEvents() expectation
      const fillEvent: OrderEvent = {
        type: 'fill',
        clientOrderId,
        order: pending.order,
        timestamp: new Date().toISOString(),
        fillPrice: pending.order.filled_avg_price,
        fillQty,
      };
      this.emit('orderUpdate', fillEvent);
    }
  }

  // -----------------------------------------------------------------------
  // Interface stubs (match real OrderManager API surface)
  // -----------------------------------------------------------------------

  connectTradeUpdates(): void {
    this.logger.debug('Simulation: connectTradeUpdates (no-op)');
  }

  disconnectTradeUpdates(): void {
    this.logger.debug('Simulation: disconnectTradeUpdates (no-op)');
  }

  async killSwitchCancelAll(): Promise<void> {
    this.logger.info('Simulation: killSwitchCancelAll — cancelling all pending');
    for (const [clientOrderId, pending] of this.pendingOrders) {
      pending.order.status = 'canceled';
      this.trackedOrders.set(clientOrderId, pending.order);
    }
    this.pendingOrders.clear();
  }

  async killSwitchCloseAll(): Promise<void> {
    this.logger.info('Simulation: killSwitchCloseAll (no-op in simulation)');
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  getTrackedOrder(clientOrderId: string): AlpacaOrder | undefined {
    return this.trackedOrders.get(clientOrderId);
  }

  getAllTrackedOrders(): Map<string, AlpacaOrder> {
    return new Map(this.trackedOrders);
  }

  getPendingCount(): number {
    return this.pendingOrders.size;
  }
}
