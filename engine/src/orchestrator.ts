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
import { PerformanceTracker } from './performance-tracker.js';
import { SignalStore } from './signal-store.js';

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

/** Market open/close times (Eastern Time) */
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MINUTE = 30;
const MARKET_CLOSE_HOUR = 16;
const MARKET_CLOSE_MINUTE = 0;

/**
 * Get current Eastern Time (handles EST/EDT automatically).
 */
function getEasternTime(): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date());
  return {
    hour: parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10),
    minute: parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10),
  };
}

/**
 * Check if the given Eastern Time is during market hours (9:30 AM - 4:00 PM ET).
 */
function isMarketOpen(hour: number, minute: number): boolean {
  const timeMinutes = hour * 60 + minute;
  const openMinutes = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;
  const closeMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;
  return timeMinutes >= openMinutes && timeMinutes < closeMinutes;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class Orchestrator {
  private readonly logger: pino.Logger;
  private readonly config: EngineConfig;
  readonly alpacaClient: AlpacaClient;
  private readonly marketData: MarketDataStream;
  private readonly orderManager: OrderManager;
  readonly bus: EventBus;
  readonly state: State;
  readonly strategyRunner: StrategyRunner;
  readonly conflictResolver: ConflictResolver;
  readonly configPoller: ConfigPoller;
  private readonly performanceTracker: PerformanceTracker;
  readonly signalStore: SignalStore;

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
    performanceTracker: PerformanceTracker,
    signalStore: SignalStore,
    logger?: pino.Logger,
  ) {
    this.config = config;
    this.alpacaClient = client;
    this.marketData = marketData;
    this.orderManager = orderManager;
    this.bus = bus;
    this.state = state;
    this.strategyRunner = strategyRunner;
    this.conflictResolver = conflictResolver;
    this.configPoller = configPoller;
    this.performanceTracker = performanceTracker;
    this.signalStore = signalStore;
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
    this.alpacaClient.dispose();

    this.logger.info('Orchestrator stopped');
  }

  /** Acknowledge a halt, performing pre-validation and setting the flag */
  async acknowledgeHalt(): Promise<{ acknowledged: boolean; engineState: string; preValidationSkipped?: boolean }> {
    // Verify engine is in Halted state
    const engineState = this.state.engineState as any;
    const isHalted = typeof engineState === 'object' && engineState !== null && engineState.TAG === 1;
    if (!isHalted) {
      throw new Error('Engine is not in Halted state');
    }

    // Pre-validation: check if danger conditions persist
    let preValidationSkipped = false;
    try {
      const account = await this.alpacaClient.getAccount();
      const equity = parseFloat(String(account.equity));
      const peakEquity = this.state.peakEquity;

      // If equity has dropped more than 20% from peak, danger persists
      if (peakEquity > 0 && equity < peakEquity * 0.80) {
        throw new Error(
          `Cannot acknowledge halt: danger conditions persist (equity ${equity.toFixed(2)} is more than 20% below peak ${peakEquity.toFixed(2)})`,
        );
      }
    } catch (err) {
      // If it's our own danger-conditions error, re-throw
      if ((err as Error).message.includes('danger conditions persist')) {
        throw err;
      }
      // Alpaca unreachable — proceed with flag
      this.logger.warn({ err: (err as Error).message }, 'Alpaca unreachable during halt acknowledgment, skipping pre-validation');
      preValidationSkipped = true;
    }

    // Set acknowledgment in config poller (persists to DynamoDB)
    await this.configPoller.setAcknowledgment();

    // Emit halt-acknowledged event
    this.bus.emit('halt-acknowledged', {
      timestamp: Date.now(),
      preValidationSkipped: preValidationSkipped || undefined,
    });

    return {
      acknowledged: true,
      engineState: this.state.engineStateName,
      preValidationSkipped: preValidationSkipped || undefined,
    };
  }

  /**
   * Handle an external kill notification (e.g. from watchdog via POST /api/notify-kill).
   * Stops the tick loop, transitions to Halted, and emits circuit-breaker event.
   */
  async notifyExternalKill(
    reason: string,
    killErrors?: string[],
  ): Promise<{ acknowledged: boolean; engineState: string }> {
    // Stop the tick loop
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.running = false;

    // Emit circuit-breaker event
    this.bus.emit('circuit-breaker', {
      previousState: this.state.engineStateName,
      newState: 'Halted',
      reason,
      killErrors,
      timestamp: Date.now(),
    });

    // Transition to Halted via OCaml state machine (same pattern as handleKillSwitch)
    const result = EngineState.apply_transition(this.state.engineState, {
      TAG: 1, // Kill_triggered
      _0: reason,
    });
    if (result.TAG === 0) {
      this.transitionTo(result._0, EngineState.to_string(result._0));
    }

    return { acknowledged: true, engineState: this.state.engineStateName };
  }

  /** Notify that watchdog is alive (called from health endpoint or external signal) */
  notifyWatchdogAlive(): void {
    this.watchdogAlive = true;
    this.state.lastHeartbeat = Date.now();
  }

  // -----------------------------------------------------------------------
  // Order cancel / Position close
  // -----------------------------------------------------------------------

  /**
   * Cancel an order by client_order_id.
   * Delegates to OrderManager and emits an 'order-canceled' event.
   */
  async cancelOrder(clientOrderId: string): Promise<{ clientOrderId: string; alpacaOrderId: string; status: string; engineState: string }> {
    const result = await this.orderManager.cancelOrder(clientOrderId);

    this.bus.emit('order-canceled', {
      clientOrderId: result.clientOrderId,
      alpacaOrderId: result.alpacaOrderId,
      status: result.status,
      timestamp: Date.now(),
    });

    return { ...result, engineState: this.state.engineStateName };
  }

  /**
   * Close a position by symbol.
   * Sends close request to Alpaca, records P&L, reconciles state, and emits event.
   */
  async closePosition(symbol: string): Promise<{ symbol: string; closedPnl: number; status: string; engineState: string }> {
    const position = this.state.getPosition(symbol);
    if (!position) {
      throw new Error(`No position found for symbol: ${symbol}`);
    }

    const unrealizedPl = position.unrealizedPl;

    await this.alpacaClient.closePosition(symbol);

    this.performanceTracker.recordTrade('manual_close', unrealizedPl, Date.now());

    try {
      await this.state.reconcileWithAlpaca(this.alpacaClient);
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'Reconciliation after position close failed');
    }

    this.bus.emit('position-closed', {
      symbol,
      closedPnl: unrealizedPl,
      status: 'close_requested',
      timestamp: Date.now(),
    });

    return { symbol, closedPnl: unrealizedPl, status: 'close_requested', engineState: this.state.engineStateName };
  }

  // -----------------------------------------------------------------------
  // Strategy toggle
  // -----------------------------------------------------------------------

  /**
   * Enable or disable a strategy by ID or name.
   * Validates phase restrictions when enabling.
   */
  async toggleStrategy(
    idOrName: string,
    enabled: boolean,
  ): Promise<{ strategy: string; enabled: boolean; engineState: string }> {
    // Build lookup for resolving idOrName
    const nameById: Record<string, string> = {
      '0': 'Mean_reversion',
      '1': 'Sector_rotation',
      '2': 'Calendar_seasonal',
      '3': 'Momentum',
      '4': 'Market_making',
    };
    const nameByLower: Record<string, string> = {};
    const idByName: Record<string, number> = {};
    for (const [id, name] of Object.entries(nameById)) {
      nameByLower[name.toLowerCase()] = name;
      idByName[name] = parseInt(id, 10);
    }

    // Resolve to canonical name
    const canonicalName = nameById[idOrName] ?? nameByLower[idOrName.toLowerCase()];
    if (!canonicalName) {
      throw new Error(`Unknown strategy: ${idOrName}`);
    }
    const strategyId = idByName[canonicalName];

    // If enabling, check phase restriction
    if (enabled) {
      const phase = Types.phase_of_equity(this.state.equity) as Phase;
      if (!Types.strategy_enabled_for_phase(phase, strategyId)) {
        throw new Error(
          `Strategy ${canonicalName} is blocked by phase restriction (current phase: ${phase})`,
        );
      }
    }

    // Persist to DynamoDB and refresh config
    await this.configPoller.setStrategyEnabled(canonicalName, enabled);

    // Emit event
    this.bus.emit('strategy-toggled', {
      strategyName: canonicalName,
      enabled,
      timestamp: Date.now(),
    });

    return {
      strategy: canonicalName,
      enabled,
      engineState: this.state.engineStateName,
    };
  }

  /**
   * Update risk threshold config fields via the ConfigPoller.
   * Returns the updated config snapshot.
   */
  async updateConfig(
    updates: Partial<import('./config-poller.js').RuntimeConfig>,
  ): Promise<import('./config-poller.js').RuntimeConfig> {
    return this.configPoller.updateRiskThresholds(updates);
  }

  // -----------------------------------------------------------------------
  // State machine
  // -----------------------------------------------------------------------

  private async enterStarting(): Promise<void> {
    this.transitionTo(0, 'Starting'); // Starting = 0

    try {
      if (this.config.simulationMode) {
        // Simulation mode: set synthetic state, skip live connections
        this.logger.info('Simulation mode: skipping Alpaca reconciliation and live connections');
        this.state.equity = 1000;
        this.state.cash = 1000;
        this.state.buyingPower = 1000;
        this.state.peakEquity = 1000;
      } else {
        // Reconcile with Alpaca
        await this.state.reconcileWithAlpaca(this.alpacaClient);

        // Connect market data and order streams
        this.marketData.connect();
        this.orderManager.connectTradeUpdates();
      }

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
        const bars = await this.alpacaClient.getBars(
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

      this.bus.emit('warmup-complete', {
        strategies: this.strategyRunner
          .getMetrics()
          .filter((m) => m.isPrimed)
          .map((m) => m.name),
        barsLoaded: totalBars,
        durationMs: Date.now() - warmupStart,
        timestamp: Date.now(),
      });

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

    // Check market hours transitions (Trading <-> Off_hours)
    this.checkMarketHoursTransitions();

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

    // Keep daily P&L current
    this.state.updateDailyPnl();

    // Determine phase and regime
    const phase = Types.phase_of_equity(this.state.equity) as Phase;
    const regime = this.computeRegime();

    // Get enabled strategies config
    const { enabledStrategies } = this.configPoller.getConfig();

    // Process based on current state
    if (EngineState.is_trading_allowed(this.state.engineState)) {
      // TRADING: Full signal processing and order submission
      await this.processTradingTick(marketData, phase, regime, enabledStrategies);
    } else if (currentStateName === 'Read_only' || currentStateName === 'Off_hours') {
      // READ_ONLY / OFF_HOURS: Process data, update indicators, no orders
      this.strategyRunner.runStrategies(marketData, phase, regime, enabledStrategies);
    }
    // Cooldown, Halted, Starting, Warming_up: do nothing
  }

  private async processTradingTick(
    marketData: SymbolMarketData[],
    phase: Phase,
    regime: RegimeType,
    enabledStrategies?: Record<string, boolean>,
  ): Promise<void> {
    // 1. Fan out market data to strategy runner
    const signals = this.strategyRunner.runStrategies(marketData, phase, regime, enabledStrategies);

    if (signals.length === 0) return;

    // 2. Emit signal events and persist to DynamoDB
    for (const signal of signals) {
      const signalEvent = {
        strategy: STRATEGY_NAMES[signal.strategy] ?? 'unknown',
        symbol: signal.symbol,
        side: signal.side === 0 ? 'buy' : 'sell',
        confidence: SignalMod.confidence(signal),
        targetPrice: signal.target_price,
        timestamp: signal.timestamp,
      };
      this.bus.emit('signal', signalEvent);
      // Fire-and-forget persistence — errors logged inside SignalStore
      this.signalStore.persist(signalEvent);
    }

    // 3. Resolve conflicts
    const resolved = this.conflictResolver.resolve(signals);

    this.logger.info({ rawSignals: signals.length, resolved: resolved.length }, 'Signal resolution');

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

      // Log risk decision
      this.logger.info({
        symbol: signal.symbol,
        side: signal.side === 0 ? 'buy' : 'sell',
        riskDecision: JSON.stringify(riskDecision),
      }, 'Risk engine decision');

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
    if (this.config.simulationMode) return;
    const { hour, minute } = getEasternTime();

    // 3:50 PM ET — unwind market making
    if (hour === UNWIND_MM_HOUR && minute >= UNWIND_MM_MINUTE && !this.mmUnwound) {
      this.mmUnwound = true;
      this.logger.info('Market close: unwinding market making positions');
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
    if (hour < MARKET_OPEN_HOUR || (hour === MARKET_OPEN_HOUR && minute < MARKET_OPEN_MINUTE)) {
      this.mmUnwound = false;
      this.ordersCanceled = false;
    }
  }

  private checkMarketHoursTransitions(): void {
    if (this.config.simulationMode) return;
    const { hour, minute } = getEasternTime();
    const marketOpen = isMarketOpen(hour, minute);

    // Trading -> Off_hours at market close
    if (!marketOpen && this.state.engineState === 2 /* Trading */) {
      this.logger.info('Market closed, transitioning to Off_hours');
      const result = EngineState.apply_transition(this.state.engineState, 3); // Market_close
      if (result.TAG === 0) {
        this.transitionTo(result._0, EngineState.to_string(result._0));

        // Stop trading loop during off hours
        if (this.tickTimer) {
          clearInterval(this.tickTimer);
          this.tickTimer = null;
        }

        // Persist daily performance metrics
        this.performanceTracker.persistDaily().catch((err) => {
          this.logger.error({ err: (err as Error).message }, 'Failed to persist daily metrics');
        });

        // Reset daily flags for next session
        this.mmUnwound = false;
        this.ordersCanceled = false;
      }
    }

    // Off_hours -> Warming_up at market open
    if (marketOpen && this.state.engineState === 3 /* Off_hours */) {
      this.logger.info('Market open, transitioning to Warming_up');
      const result = EngineState.apply_transition(this.state.engineState, 2); // Market_open
      if (result.TAG === 0) {
        this.transitionTo(result._0, EngineState.to_string(result._0));
        this.enterWarmingUp().catch((err) => {
          this.logger.error({ err: (err as Error).message }, 'Post-open warmup failed');
        });
      }
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
