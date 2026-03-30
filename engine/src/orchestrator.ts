/**
 * Main trading loop implementing the engine state machine.
 * Orchestrates strategy execution, risk checks, and order submission.
 */

import pino from 'pino';
import * as EngineState from '../../trading-core-js/trading-core/lib/engine_state.js';
import * as Risk from '../../trading-core-js/trading-core/lib/risk.js';
import * as Types from '../../trading-core-js/trading-core/lib/types.js';
import * as Regime from '../../trading-core-js/trading-core/lib/regime.js';
import * as SignalMod from '../../trading-core-js/trading-core/lib/signal.js';
import * as RiskConfig from '../../trading-core-js/trading-core/lib/risk_config.js';

import type { AlpacaClient } from './alpaca/client.js';
import type { MarketDataStream } from './alpaca/market-data.js';
import type { OrderManager } from './alpaca/order-manager.js';
import type { EngineConfig } from './config.js';
import { EventBus } from './event-bus.js';
import { State } from './state.js';
import { StrategyRunner, STRATEGY_NAMES, type SymbolMarketData, type Phase, type Regime as RegimeType, type StrategySignal } from './strategy-runner.js';
import { ConflictResolver } from './conflict-resolver.js';
import { ConfigPoller } from './config-poller.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Market close procedures (ET) */
const UNWIND_MM_HOUR = 15;
const UNWIND_MM_MINUTE = 50;
const CANCEL_ALL_HOUR = 15;
const CANCEL_ALL_MINUTE = 55;

const WARMUP_BAR_COUNT = 100;
const COOLDOWN_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class Orchestrator {
  private readonly logger: pino.Logger;
  private readonly config: EngineConfig;
  private readonly client: AlpacaClient;
  private readonly marketData: MarketDataStream;
  private readonly orderManager: OrderManager;
  readonly bus: EventBus;
  readonly state: State;
  readonly strategyRunner: StrategyRunner;
  readonly conflictResolver: ConflictResolver;
  readonly configPoller: ConfigPoller;

  /** Market data buffer: latest bars per symbol */
  private barBuffer: Map<string, Array<{ o: number; h: number; l: number; c: number; v: number }>> = new Map();

  /** Latest quotes per symbol */
  private latestQuotes: Map<string, { bid: number; ask: number; price: number; volume: number }> = new Map();

  /** Tick interval timer */
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  /** Heartbeat timer */
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  /** Watchdog-alive received */
  private watchdogAlive: boolean = false;

  /** Whether market close procedures have been triggered today */
  private mmUnwound: boolean = false;
  private ordersCanceled: boolean = false;

  /** Running flag */
  private running: boolean = false;

  constructor(
    config: EngineConfig,
    client: AlpacaClient,
    marketData: MarketDataStream,
    orderManager: OrderManager,
    bus: EventBus,
    state: State,
    strategyRunner: StrategyRunner,
    conflictResolver: ConflictResolver,
    configPoller: ConfigPoller,
    logger?: pino.Logger,
  ) {
    this.config = config;
    this.client = client;
    this.marketData = marketData;
    this.orderManager = orderManager;
    this.bus = bus;
    this.state = state;
    this.strategyRunner = strategyRunner;
    this.conflictResolver = conflictResolver;
    this.configPoller = configPoller;
    this.logger = (logger ?? pino({ name: 'orchestrator' })).child({ component: 'orchestrator' });
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Start the orchestrator */
  async start(): Promise<void> {
    this.running = true;
    this.logger.info('Orchestrator starting');

    // Wire up market data events
    this.wireMarketDataEvents();

    // Wire up order events
    this.wireOrderEvents();

    // Start config poller
    this.configPoller.start();

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.emitHeartbeat();
    }, this.config.heartbeatIntervalMs);

    // Enter Starting state
    await this.enterStarting();
  }

  /** Stop the orchestrator gracefully */
  async stop(): Promise<void> {
    this.running = false;
    this.logger.info('Orchestrator stopping');

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.configPoller.stop();
    this.marketData.disconnect();
    this.orderManager.disconnectTradeUpdates();
    this.client.dispose();

    this.logger.info('Orchestrator stopped');
  }

  /** Notify that watchdog is alive (called from health endpoint or external signal) */
  notifyWatchdogAlive(): void {
    this.watchdogAlive = true;
    this.state.lastHeartbeat = Date.now();
  }

  // -----------------------------------------------------------------------
  // State machine
  // -----------------------------------------------------------------------

  private async enterStarting(): Promise<void> {
    this.transitionTo(0, 'Starting'); // Starting = 0

    try {
      // Reconcile with Alpaca
      await this.state.reconcileWithAlpaca(this.client);

      // Connect market data and order streams
      this.marketData.connect();
      this.orderManager.connectTradeUpdates();

      // In production, we would wait for watchdog. For now, auto-advance.
      // Wait up to 10 seconds for watchdog
      const watchdogTimeout = 10_000;
      const startWait = Date.now();

      const waitForWatchdog = (): void => {
        if (!this.running) return;

        if (this.watchdogAlive || Date.now() - startWait > watchdogTimeout) {
          if (!this.watchdogAlive) {
            this.logger.warn('Watchdog not detected, proceeding anyway');
          }

          // Transition: Starting -> Warming_up
          const result = EngineState.apply_transition(this.state.engineState, 0); // Watchdog_connected = 0
          if (result.TAG === 0) { // Ok
            this.transitionTo(result._0, 'Warming_up');
            this.enterWarmingUp().catch((err) => {
              this.logger.error({ err: (err as Error).message }, 'Warmup failed');
            });
          } else {
            this.logger.error({ error: result._0 }, 'Invalid state transition');
          }
          return;
        }

        setTimeout(waitForWatchdog, 500);
      };

      waitForWatchdog();
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'Starting phase failed');
    }
  }

  private async enterWarmingUp(): Promise<void> {
    this.logger.info('Entering warmup phase');
    const warmupStart = Date.now();
    const symbols = this.configPoller.getSymbols();

    // Subscribe to market data for all symbols
    this.marketData.subscribe(symbols, symbols);

    // Fetch historical bars for warmup
    const now = new Date();
    const start = new Date(now.getTime() - WARMUP_BAR_COUNT * 60 * 1000); // ~100 minutes ago

    let totalBars = 0;
    for (const symbol of symbols) {
      try {
        const bars = await this.client.getBars(
          symbol,
          '1Min',
          start.toISOString(),
          now.toISOString(),
        );

        const barData = bars.map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));
        this.barBuffer.set(symbol, barData);
        totalBars += barData.length;

        // Check each strategy for primed status
        for (let i = 0; i <= 4; i++) {
          this.strategyRunner.checkPrimed(i as 0 | 1 | 2 | 3 | 4, barData.length);
        }
      } catch (err) {
        this.logger.error(
          { symbol, err: (err as Error).message },
          'Failed to fetch warmup bars',
        );
      }
    }

    // Determine current phase
    const phase = Types.phase_of_equity(this.state.equity) as Phase;

    if (this.strategyRunner.allPrimed(phase)) {
      const durationMs = Date.now() - warmupStart;
      this.logger.info({ totalBars, durationMs }, 'Warmup complete');

      this.bus.emit('warmup-complete', {
        strategies: this.strategyRunner
          .getMetrics()
          .filter((m) => m.isPrimed)
          .map((m) => m.name),
        barsLoaded: totalBars,
        durationMs,
        timestamp: Date.now(),
      });

      // Transition: Warming_up -> Trading
      const result = EngineState.apply_transition(this.state.engineState, 1); // Warmup_complete = 1
      if (result.TAG === 0) {
        this.transitionTo(result._0, 'Trading');
        this.startTradingLoop();
      }
    } else {
      this.logger.warn('Not all strategies primed, starting trading loop anyway');
      const result = EngineState.apply_transition(this.state.engineState, 1);
      if (result.TAG === 0) {
        this.transitionTo(result._0, 'Trading');
        this.startTradingLoop();
      }
    }
  }

  private startTradingLoop(): void {
    this.logger.info({ intervalMs: this.config.tickIntervalMs }, 'Starting trading loop');

    this.tickTimer = setInterval(() => {
      this.tick().catch((err) => {
        this.logger.error({ err: (err as Error).message }, 'Tick error');
      });
    }, this.config.tickIntervalMs);
  }

  // -----------------------------------------------------------------------
  // Main tick
  // -----------------------------------------------------------------------

  private async tick(): Promise<void> {
    if (!this.running) return;
    this.state.tickCount++;

    const currentStateName = EngineState.to_string(this.state.engineState);

    // Check for market close procedures
    this.checkMarketCloseProcedures();

    // Check cooldown expiry
    this.checkCooldownExpiry();

    // Check for human acknowledgment in Halted state
    this.checkHaltedRecovery();

    // Build market data snapshots
    const marketData = this.buildMarketDataSnapshots();

    // Emit tick event
    const prices: Record<string, number> = {};
    for (const [symbol, quote] of this.latestQuotes) {
      prices[symbol] = quote.price;
    }
    this.bus.emit('tick', {
      timestamp: Date.now(),
      symbols: Array.from(this.latestQuotes.keys()),
      prices,
    });

    // Update positions with latest prices
    for (const [symbol, quote] of this.latestQuotes) {
      this.state.updatePosition(symbol, quote.price);
    }

    // Determine phase and regime
    const phase = Types.phase_of_equity(this.state.equity) as Phase;
    const regime = this.computeRegime();

    // Process based on current state
    if (EngineState.is_trading_allowed(this.state.engineState)) {
      // TRADING: Full signal processing and order submission
      await this.processTradingTick(marketData, phase, regime);
    } else if (currentStateName === 'Read_only' || currentStateName === 'Off_hours') {
      // READ_ONLY / OFF_HOURS: Process data, update indicators, no orders
      this.strategyRunner.runStrategies(marketData, phase, regime);
    }
    // Cooldown, Halted, Starting, Warming_up: do nothing
  }

  private async processTradingTick(
    marketData: SymbolMarketData[],
    phase: Phase,
    regime: RegimeType,
  ): Promise<void> {
    // 1. Fan out market data to strategy runner
    const signals = this.strategyRunner.runStrategies(marketData, phase, regime);

    if (signals.length === 0) return;

    // 2. Emit signal events
    for (const signal of signals) {
      this.bus.emit('signal', {
        strategy: STRATEGY_NAMES[signal.strategy] ?? 'unknown',
        symbol: signal.symbol,
        side: signal.side === 0 ? 'buy' : 'sell',
        confidence: SignalMod.confidence(signal),
        targetPrice: signal.target_price,
        timestamp: signal.timestamp,
      });
    }

    // 3. Resolve conflicts
    const resolved = this.conflictResolver.resolve(signals);

    // 4. Run each signal through risk engine
    const riskConfig = this.configPoller.toOcamlRiskConfig();
    const portfolio = this.state.toOcamlPortfolio();
    const pdtTracker = { day_trades_used: this.state.dayTradeCount, max_day_trades: 3 };

    for (const signal of resolved) {
      const riskDecision = Risk.evaluate(
        riskConfig,
        portfolio,
        signal,
        pdtTracker,
        phase,
        this.state.lastHeartbeat,
        Date.now(),
        this.state.dailyPnl,
        this.state.peakEquity,
      );

      // Check risk decision
      if (typeof riskDecision === 'number' && riskDecision === 0) {
        // Allow — submit order
        await this.submitOrder(signal);
      } else if (typeof riskDecision === 'object' && riskDecision !== null) {
        const tag = riskDecision.TAG;
        if (tag === 0) {
          // Reduce_size — submit with reduced quantity
          this.logger.info(
            { symbol: signal.symbol, factor: riskDecision._0 },
            'Risk: reducing order size',
          );
          await this.submitOrder(signal, riskDecision._0 as number);
        } else if (tag === 1) {
          // Reject
          this.bus.emit('risk-alert', {
            level: 'warning',
            message: riskDecision._0 as string,
            signal: {
              strategy: STRATEGY_NAMES[signal.strategy] ?? 'unknown',
              symbol: signal.symbol,
              side: signal.side === 0 ? 'buy' : 'sell',
              confidence: SignalMod.confidence(signal),
              targetPrice: signal.target_price,
              timestamp: signal.timestamp,
            },
            riskDecision: 'reject',
            timestamp: Date.now(),
          });
        } else if (tag === 2) {
          // Flatten_all
          this.logger.warn({ reason: riskDecision._0 }, 'Risk: FLATTEN ALL');
          await this.handleFlattenAll(riskDecision._0 as string);
        } else if (tag === 3) {
          // Kill_switch
          this.logger.error({ reason: riskDecision._0 }, 'Risk: KILL SWITCH');
          await this.handleKillSwitch(riskDecision._0 as string);
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Order submission
  // -----------------------------------------------------------------------

  private async submitOrder(signal: StrategySignal, sizeFactor: number = 1.0): Promise<void> {
    const strategyName = STRATEGY_NAMES[signal.strategy] ?? 'unknown';
    const side = signal.side === 0 ? 'buy' : 'sell' as const;
    const positionPct = signal.max_position_pct * sizeFactor;
    const notional = this.state.equity * positionPct;

    if (notional < 1) {
      this.logger.debug({ symbol: signal.symbol, notional }, 'Order too small, skipping');
      return;
    }

    try {
      const order = await this.orderManager.submitOrder({
        strategy: strategyName.toLowerCase(),
        symbol: signal.symbol,
        side,
        limitPrice: signal.target_price,
        notional: Math.round(notional * 100) / 100,
        timeInForce: 'day',
      });

      // Track in state
      this.state.addOrder({
        clientOrderId: order.client_order_id,
        orderId: order.id,
        symbol: signal.symbol,
        side,
        qty: order.qty ?? 0,
        limitPrice: signal.target_price,
        status: order.status,
        strategy: strategyName,
        createdAt: order.created_at,
        filledQty: 0,
        filledAvgPrice: undefined,
      });

      // Emit event
      this.bus.emit('order-submitted', {
        clientOrderId: order.client_order_id,
        symbol: signal.symbol,
        side,
        qty: order.qty ?? notional / signal.target_price,
        limitPrice: signal.target_price,
        strategy: strategyName,
        timestamp: Date.now(),
      });
    } catch (err) {
      this.logger.error(
        { symbol: signal.symbol, strategy: strategyName, err: (err as Error).message },
        'Order submission failed',
      );
    }
  }

  // -----------------------------------------------------------------------
  // Risk escalation handlers
  // -----------------------------------------------------------------------

  private async handleFlattenAll(reason: string): Promise<void> {
    this.bus.emit('circuit-breaker', {
      reason,
      previousState: EngineState.to_string(this.state.engineState),
      newState: 'Cooldown',
      timestamp: Date.now(),
    });

    // Cancel all orders and close positions
    try {
      await this.orderManager.killSwitchCancelAll();
      await this.orderManager.killSwitchCloseAll();
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'Flatten all failed');
    }

    // Transition to Cooldown
    const result = EngineState.apply_transition(this.state.engineState, {
      TAG: 0, // Flatten_triggered
      _0: reason,
    });
    if (result.TAG === 0) {
      this.transitionTo(result._0, EngineState.to_string(result._0));
    }
  }

  private async handleKillSwitch(reason: string): Promise<void> {
    this.bus.emit('circuit-breaker', {
      reason,
      previousState: EngineState.to_string(this.state.engineState),
      newState: 'Halted',
      timestamp: Date.now(),
    });

    try {
      await this.orderManager.killSwitchCancelAll();
      await this.orderManager.killSwitchCloseAll();
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'Kill switch failed');
    }

    const result = EngineState.apply_transition(this.state.engineState, {
      TAG: 1, // Kill_triggered
      _0: reason,
    });
    if (result.TAG === 0) {
      this.transitionTo(result._0, EngineState.to_string(result._0));
    }
  }

  // -----------------------------------------------------------------------
  // Market close procedures
  // -----------------------------------------------------------------------

  private checkMarketCloseProcedures(): void {
    const now = new Date();
    const hour = now.getUTCHours() - 4; // Approximate ET (not DST-aware)
    const minute = now.getUTCMinutes();

    // 3:50 PM ET — unwind market making
    if (hour === UNWIND_MM_HOUR && minute >= UNWIND_MM_MINUTE && !this.mmUnwound) {
      this.mmUnwound = true;
      this.logger.info('Market close: unwinding market making positions');
      // Cancel MM orders
      // In production, we would selectively cancel only MM strategy orders
    }

    // 3:55 PM ET — cancel all orders
    if (hour === CANCEL_ALL_HOUR && minute >= CANCEL_ALL_MINUTE && !this.ordersCanceled) {
      this.ordersCanceled = true;
      this.logger.info('Market close: cancelling all orders');
      this.orderManager.killSwitchCancelAll().catch((err) => {
        this.logger.error({ err: (err as Error).message }, 'Market close cancel failed');
      });
    }

    // Reset flags at start of day
    if (hour < 9 || (hour === 9 && minute < 30)) {
      this.mmUnwound = false;
      this.ordersCanceled = false;
    }
  }

  // -----------------------------------------------------------------------
  // Cooldown / Halted recovery
  // -----------------------------------------------------------------------

  private checkCooldownExpiry(): void {
    const engineState = this.state.engineState as any;
    if (
      typeof engineState === 'object' &&
      engineState !== null &&
      engineState.TAG === 0 && // Cooldown
      Date.now() >= engineState.until * 1000 // until is in seconds
    ) {
      this.logger.info('Cooldown expired, transitioning to Warming_up');
      const result = EngineState.apply_transition(this.state.engineState, 8); // Cooldown_expired = 8
      if (result.TAG === 0) {
        this.transitionTo(result._0, EngineState.to_string(result._0));
        // Re-enter warmup
        this.enterWarmingUp().catch((err) => {
          this.logger.error({ err: (err as Error).message }, 'Post-cooldown warmup failed');
        });
      }
    }
  }

  private checkHaltedRecovery(): void {
    const engineState = this.state.engineState as any;
    if (
      typeof engineState === 'object' &&
      engineState !== null &&
      engineState.TAG === 1 && // Halted
      this.configPoller.isHumanAcknowledged()
    ) {
      this.logger.info('Human acknowledgment received, restarting');
      this.configPoller.clearAcknowledgment();
      const result = EngineState.apply_transition(this.state.engineState, 9); // Human_acknowledged = 9
      if (result.TAG === 0) {
        this.transitionTo(result._0, EngineState.to_string(result._0));
        this.enterStarting().catch((err) => {
          this.logger.error({ err: (err as Error).message }, 'Post-halt restart failed');
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // State transition helper
  // -----------------------------------------------------------------------

  private transitionTo(newState: unknown, stateName: string): void {
    const previousName = this.state.engineStateName;
    this.state.engineState = newState;
    this.state.engineStateName = stateName;

    this.bus.emit('state-transition', {
      from: previousName,
      to: stateName,
      trigger: 'orchestrator',
      timestamp: Date.now(),
    });

    this.logger.info({ from: previousName, to: stateName }, 'State transition');
  }

  // -----------------------------------------------------------------------
  // Market data wiring
  // -----------------------------------------------------------------------

  private wireMarketDataEvents(): void {
    this.marketData.on('trade' as any, (symbol: string, trade: any) => {
      const quote = this.latestQuotes.get(symbol);
      if (quote) {
        quote.price = trade.p;
        quote.volume += trade.s;
      } else {
        this.latestQuotes.set(symbol, {
          bid: trade.p,
          ask: trade.p,
          price: trade.p,
          volume: trade.s,
        });
      }
    });

    this.marketData.on('quote' as any, (symbol: string, quote: any) => {
      this.latestQuotes.set(symbol, {
        bid: quote.bp,
        ask: quote.ap,
        price: (quote.bp + quote.ap) / 2,
        volume: 0,
      });
    });

    this.marketData.on('bar' as any, (symbol: string, bar: any) => {
      const existing = this.barBuffer.get(symbol) ?? [];
      existing.push({ o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v });
      // Keep last 200 bars
      if (existing.length > 200) existing.splice(0, existing.length - 200);
      this.barBuffer.set(symbol, existing);
    });
  }

  private wireOrderEvents(): void {
    this.orderManager.on('orderUpdate' as any, (event: any) => {
      this.state.updateOrder(event.clientOrderId, {
        status: event.order.status,
        filledQty: event.fillQty,
        filledAvgPrice: event.fillPrice,
      });

      if (event.type === 'fill' || event.type === 'partial_fill') {
        this.bus.emit('order-filled', {
          clientOrderId: event.clientOrderId,
          symbol: event.order.symbol,
          side: event.order.side,
          filledQty: event.fillQty ?? 0,
          avgPrice: event.fillPrice ?? 0,
          timestamp: Date.now(),
        });
      }
    });
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private buildMarketDataSnapshots(): SymbolMarketData[] {
    const snapshots: SymbolMarketData[] = [];
    const symbols = this.configPoller.getSymbols();

    for (const symbol of symbols) {
      const quote = this.latestQuotes.get(symbol);
      const bars = this.barBuffer.get(symbol) ?? [];

      if (!quote) continue;

      snapshots.push({
        symbol,
        price: quote.price,
        bid: quote.bid,
        ask: quote.ask,
        volume: quote.volume,
        bars,
      });
    }

    return snapshots;
  }

  private computeRegime(): RegimeType {
    // In production, VIX and ADX would come from market data
    // For now, use defaults (normal regime)
    const vix = 18.0;
    const adx = 22.0;
    return Regime.classify(vix, adx) as RegimeType;
  }

  private emitHeartbeat(): void {
    this.state.lastHeartbeat = Date.now();

    this.bus.emit('heartbeat', {
      engineState: this.state.engineStateName,
      uptimeMs: Date.now() - this.state.startedAt,
      tickCount: this.state.tickCount,
      activeOrders: this.state.getAllActiveOrders().length,
      positionCount: this.state.getAllPositions().length,
      timestamp: Date.now(),
    });
  }
}
