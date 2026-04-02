/**
 * Trading Engine entry point.
 * Initializes all components and starts the orchestrator + HTTP server.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import pino from 'pino';
import { loadConfig, type EngineConfig } from './config.js';
import { AlpacaClient } from './alpaca/client.js';
import { MarketDataStream } from './alpaca/market-data.js';
import { OrderManager } from './alpaca/order-manager.js';
import { EventBus, type EngineEventName } from './event-bus.js';
import { State } from './state.js';
import { StrategyRunner } from './strategy-runner.js';
import { ConflictResolver } from './conflict-resolver.js';
import { ConfigPoller } from './config-poller.js';
import { Orchestrator } from './orchestrator.js';
import { PerformanceTracker } from './performance-tracker.js';
import { SignalStore } from './signal-store.js';
import { requireAuth, sendJson, sendError, parseJsonBody } from './http-utils.js';
import { SimulationController, getPreviousTradingDay } from './simulation/controller.js';
import { MockOrderManager } from './simulation/mock-order-manager.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = pino({
  name: 'trading-engine',
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

function createHttpServer(
  config: EngineConfig,
  orchestrator: Orchestrator,
): ReturnType<typeof createServer> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${config.enginePort}`);
    const path = url.pathname;

    // CORS headers for dashboard
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const method = req.method ?? 'GET';

    try {
      // --- Parameterized routes (checked first) ---

      if (method === 'DELETE' && path.startsWith('/api/orders/')) {
        handleCancelOrder(req, res, config, orchestrator);
        return;
      }

      if (method === 'POST' && path.startsWith('/api/positions/') && path.endsWith('/close')) {
        handleClosePosition(req, res, config, orchestrator);
        return;
      }

      if (method === 'POST' && path === '/api/acknowledge-halt') {
        handleAcknowledgeHalt(req, res, config, orchestrator);
        return;
      }

      if (method === 'POST' && path === '/api/notify-kill') {
        handleNotifyKill(req, res, config, orchestrator);
        return;
      }

      if (method === 'POST' && path.startsWith('/api/strategies/') && path.split('/').length === 5) {
        handleStrategyToggle(req, res, config, orchestrator);
        return;
      }

      if (method === 'PATCH' && path === '/api/config') {
        handleConfigUpdate(req, res, config, orchestrator);
        return;
      }

      // --- Exact-match GET routes ---

      switch (path) {
        case '/health':
          handleHealth(res, orchestrator);
          break;
        case '/events':
          handleSSE(req, res, orchestrator);
          break;
        case '/api/account':
          handleAccount(res, orchestrator);
          break;
        case '/api/positions':
          handlePositions(res, orchestrator);
          break;
        case '/api/orders':
          handleOrders(res, orchestrator);
          break;
        case '/api/strategies':
          handleStrategies(res, orchestrator);
          break;
        case '/api/bars':
          handleBars(req, res, url, orchestrator);
          break;
        case '/api/signals':
          handleSignals(req, res, url, orchestrator);
          break;
        default:
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (err) {
      logger.error({ err: (err as Error).message, path }, 'HTTP handler error');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  return server;
}

function handleHealth(res: ServerResponse, orchestrator: Orchestrator): void {
  const state = orchestrator.state;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: 'ok',
      engineState: state.engineStateName,
      uptimeMs: Date.now() - state.startedAt,
      tickCount: state.tickCount,
      lastHeartbeat: state.lastHeartbeat,
      equity: state.equity,
      dailyPnl: state.dailyPnl,
      positions: state.getAllPositions().length,
      activeOrders: state.getAllActiveOrders().length,
      timestamp: Date.now(),
    }),
  );
}

function handleSSE(
  req: IncomingMessage,
  res: ServerResponse,
  orchestrator: Orchestrator,
): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write('data: {"type":"connected"}\n\n');

  const eventNames: EngineEventName[] = [
    'tick',
    'signal',
    'order-submitted',
    'order-filled',
    'risk-alert',
    'circuit-breaker',
    'state-transition',
    'warmup-complete',
    'heartbeat',
    'config-change',
    'order-canceled',
    'position-closed',
    'halt-acknowledged',
    'strategy-toggled',
  ];

  const listeners: Array<{ event: EngineEventName; fn: (...args: unknown[]) => void }> = [];

  for (const eventName of eventNames) {
    const fn = (payload: unknown) => {
      try {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch {
        // Client disconnected
      }
    };
    orchestrator.bus.on(eventName, fn as any);
    listeners.push({ event: eventName, fn: fn as any });
  }

  // SSE keepalive to prevent proxy/browser timeouts
  const keepalive = setInterval(() => {
    try { res.write(':keepalive\n\n'); } catch { /* disconnected */ }
  }, 15_000);

  req.on('close', () => {
    clearInterval(keepalive);
    for (const { event, fn } of listeners) {
      orchestrator.bus.off(event, fn as any);
    }
  });
}

function handleAccount(res: ServerResponse, orchestrator: Orchestrator): void {
  const snapshot = orchestrator.state.getPortfolioSnapshot();
  const response = {
    ...snapshot,
    buying_power: snapshot.buyingPower,
    daily_pnl: snapshot.dailyPnl,
    total_pnl: snapshot.totalUnrealizedPl,
    phase: orchestrator.state.engineStateName,
    currency: 'USD',
    status: 'active',
  };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}

function handlePositions(res: ServerResponse, orchestrator: Orchestrator): void {
  const positions = orchestrator.state.getAllPositions();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(positions));
}

function handleOrders(res: ServerResponse, orchestrator: Orchestrator): void {
  const orders = orchestrator.state.getAllActiveOrders();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(orders));
}

function handleStrategies(res: ServerResponse, orchestrator: Orchestrator): void {
  const metrics = orchestrator.strategyRunner.getMetrics();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(metrics));
}

// ---------------------------------------------------------------------------
// Mutating API Handlers (require X-API-Key auth)
// ---------------------------------------------------------------------------

async function handleCancelOrder(
  req: IncomingMessage,
  res: ServerResponse,
  config: EngineConfig,
  orchestrator: Orchestrator,
): Promise<void> {
  if (!requireAuth(req, config.localApiSecret)) {
    sendError(res, 401, 'Unauthorized');
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${config.enginePort}`);
  const segments = url.pathname.split('/');
  // /api/orders/:clientOrderId → segments = ['', 'api', 'orders', clientOrderId]
  const clientOrderId = segments[3];
  if (!clientOrderId) {
    sendError(res, 400, 'Missing order ID');
    return;
  }

  try {
    const result = await orchestrator.cancelOrder(clientOrderId);
    sendJson(res, 200, { ...result, engineState: orchestrator.state.engineStateName });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('not found') || message.includes('Not found')) {
      sendError(res, 404, message);
    } else if (message.includes('terminal state')) {
      sendError(res, 409, message);
    } else {
      logger.error({ err: message, clientOrderId }, 'Failed to cancel order');
      sendError(res, 502, `Alpaca error: ${message}`);
    }
  }
}

async function handleClosePosition(
  req: IncomingMessage,
  res: ServerResponse,
  config: EngineConfig,
  orchestrator: Orchestrator,
): Promise<void> {
  if (!requireAuth(req, config.localApiSecret)) {
    sendError(res, 401, 'Unauthorized');
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${config.enginePort}`);
  const segments = url.pathname.split('/');
  // /api/positions/:symbol/close → segments = ['', 'api', 'positions', symbol, 'close']
  const symbol = segments[3];
  if (!symbol) {
    sendError(res, 400, 'Missing symbol');
    return;
  }

  try {
    const result = await orchestrator.closePosition(symbol);
    sendJson(res, 200, { ...result, engineState: orchestrator.state.engineStateName });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('not found') || message.includes('No position')) {
      sendError(res, 404, message);
    } else {
      logger.error({ err: message, symbol }, 'Failed to close position');
      sendError(res, 502, `Alpaca error: ${message}`);
    }
  }
}

async function handleAcknowledgeHalt(
  req: IncomingMessage,
  res: ServerResponse,
  config: EngineConfig,
  orchestrator: Orchestrator,
): Promise<void> {
  if (!requireAuth(req, config.localApiSecret)) {
    sendError(res, 401, 'Unauthorized');
    return;
  }

  try {
    const result = await orchestrator.acknowledgeHalt();
    sendJson(res, 200, result);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('not in Halted') || message.includes('danger conditions')) {
      sendError(res, 409, message);
    } else {
      logger.error({ err: message }, 'Failed to acknowledge halt');
      sendError(res, 500, message);
    }
  }
}

async function handleNotifyKill(
  req: IncomingMessage,
  res: ServerResponse,
  config: EngineConfig,
  orchestrator: Orchestrator,
): Promise<void> {
  if (!requireAuth(req, config.localApiSecret)) {
    sendError(res, 401, 'Unauthorized');
    return;
  }

  try {
    const body = await parseJsonBody<{ reason?: string; errors?: string[] }>(req, { optional: true });
    const reason = body?.reason ?? 'External kill notification';
    const errors = body?.errors;

    const result = await orchestrator.notifyExternalKill(reason, errors);
    sendJson(res, 200, result);
  } catch (err) {
    const message = (err as Error).message;
    logger.error({ err: message }, 'Failed to process notify-kill');
    sendError(res, 500, message);
  }
}

async function handleStrategyToggle(
  req: IncomingMessage,
  res: ServerResponse,
  config: EngineConfig,
  orchestrator: Orchestrator,
): Promise<void> {
  if (!requireAuth(req, config.localApiSecret)) {
    sendError(res, 401, 'Unauthorized');
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${config.enginePort}`);
  const segments = url.pathname.split('/');
  // /api/strategies/:id/enable|disable → segments = ['', 'api', 'strategies', id, action]
  const idOrName = segments[3];
  const action = segments[4];

  if (!idOrName || (action !== 'enable' && action !== 'disable')) {
    sendError(res, 400, 'Invalid strategy toggle path. Use /api/strategies/:id/enable or /disable');
    return;
  }

  const enabled = action === 'enable';

  try {
    const result = await orchestrator.toggleStrategy(idOrName, enabled);
    sendJson(res, 200, result);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('Unknown strategy')) {
      sendError(res, 404, message);
    } else if (message.includes('phase restriction') || message.includes('blocked by phase')) {
      sendError(res, 409, message);
    } else {
      logger.error({ err: message, idOrName, action }, 'Failed to toggle strategy');
      sendError(res, 500, message);
    }
  }
}

// ---------------------------------------------------------------------------
// Config Update Handler
// ---------------------------------------------------------------------------

async function handleConfigUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  config: EngineConfig,
  orchestrator: Orchestrator,
): Promise<void> {
  if (!requireAuth(req, config.localApiSecret)) {
    sendError(res, 401, 'Unauthorized');
    return;
  }

  try {
    const body = await parseJsonBody<Record<string, unknown>>(req);
    if (!body || Object.keys(body).length === 0) {
      sendError(res, 400, 'Request body must contain at least one field to update');
      return;
    }

    const result = await orchestrator.updateConfig(body as any);
    sendJson(res, 200, result);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('Non-updatable fields') || message.includes('Invalid value') || message.includes('No fields')) {
      sendError(res, 400, message);
    } else {
      logger.error({ err: message }, 'Failed to update config');
      sendError(res, 500, message);
    }
  }
}

// ---------------------------------------------------------------------------
// Read-only API Handlers
// ---------------------------------------------------------------------------

function handleBars(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  orchestrator: Orchestrator,
): void {
  const symbol = url.searchParams.get('symbol') ?? 'SPY';
  const timeframe = url.searchParams.get('timeframe') ?? '5Min';
  const now = new Date();
  const start = url.searchParams.get('start') ?? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const end = url.searchParams.get('end') ?? now.toISOString();

  orchestrator.alpacaClient
    .getBars(symbol, timeframe, start, end)
    .then((bars) => {
      const candles = bars.map((b) => ({
        time: Math.floor(new Date(b.t).getTime() / 1000),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(candles));
    })
    .catch((err) => {
      logger.error({ err: (err as Error).message, symbol }, 'Failed to fetch bars');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch bars' }));
    });
}

function handleSignals(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  orchestrator: Orchestrator,
): void {
  const symbol = url.searchParams.get('symbol');
  if (!symbol) {
    sendError(res, 400, 'Missing required query parameter: symbol');
    return;
  }

  const since = Number(url.searchParams.get('since') ?? Date.now() - 24 * 60 * 60 * 1000);
  const untilParam = url.searchParams.get('until');
  const until = untilParam ? Number(untilParam) : undefined;
  const strategy = url.searchParams.get('strategy') ?? undefined;

  orchestrator.signalStore
    .query(symbol, since, until, strategy)
    .then((signals) => {
      sendJson(res, 200, signals);
    })
    .catch((err) => {
      logger.error({ err: (err as Error).message, symbol }, 'Failed to query signals');
      sendError(res, 500, 'Failed to query signals');
    });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  logger.info('=== Jane Street Trading Engine ===');

  // Load configuration
  const config = loadConfig();
  logger.info({ port: config.enginePort, simulationMode: config.simulationMode }, 'Configuration loaded');

  // Initialize components — conditional on simulation mode
  const alpacaClient = new AlpacaClient(config, logger);
  const marketDataStream = new MarketDataStream(config, alpacaClient, logger);
  const bus = new EventBus(logger);
  const state = new State(logger);
  const strategyRunner = new StrategyRunner(logger);
  const conflictResolver = new ConflictResolver(logger);
  const configPoller = new ConfigPoller(config, bus, logger);
  const performanceTracker = new PerformanceTracker();
  const signalStore = new SignalStore(logger);

  // Prevent unhandled 'error' events from crashing the process
  marketDataStream.on('error' as any, (err: Error) => {
    logger.warn({ err: err.message }, 'MarketDataStream error (suppressed)');
  });

  let orderManager: OrderManager | MockOrderManager;
  let simulationController: SimulationController | null = null;

  if (config.simulationMode) {
    logger.info('========================================');
    logger.info('  SIMULATION MODE ACTIVE');
    logger.info('========================================');

    simulationController = new SimulationController(marketDataStream, config, logger);
    orderManager = new MockOrderManager(simulationController, logger);

    // Load historical data for the target date
    const symbols = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'];
    const targetDate = config.simulationDate ?? getPreviousTradingDay();
    logger.info({ targetDate, speed: config.simulationSpeed, symbols: symbols.length }, 'Loading simulation data');

    const barCount = await simulationController.loadData(
      symbols,
      targetDate,
      config.alpacaApiKey,
      config.alpacaSecretKey,
    );

    if (barCount === 0) {
      logger.error({ targetDate }, 'No bars loaded for simulation date — is this a trading day?');
    }
  } else {
    orderManager = new OrderManager(config, alpacaClient, logger);
  }

  // Create orchestrator (MockOrderManager is structurally compatible)
  const orchestrator = new Orchestrator(
    config,
    alpacaClient,
    marketDataStream,
    orderManager as OrderManager,
    bus,
    state,
    strategyRunner,
    conflictResolver,
    configPoller,
    performanceTracker,
    signalStore,
    logger,
  );

  // Start HTTP server
  const server = createHttpServer(config, orchestrator);
  server.listen(config.enginePort, () => {
    logger.info({ port: config.enginePort }, 'HTTP server listening');
    logger.info(`  GET /health     — engine health`);
    logger.info(`  GET /events     — SSE event stream`);
    logger.info(`  GET /api/account    — portfolio snapshot`);
    logger.info(`  GET /api/positions  — current positions`);
    logger.info(`  GET /api/orders     — active orders`);
    logger.info(`  GET /api/strategies — strategy metrics`);
    logger.info(`  DELETE /api/orders/:id    — cancel order (auth)`);
    logger.info(`  POST /api/positions/:sym/close — close position (auth)`);
    logger.info(`  POST /api/acknowledge-halt     — ack halt (auth)`);
    logger.info(`  POST /api/notify-kill          — external kill (auth)`);
    logger.info(`  POST /api/strategies/:id/enable|disable (auth)`);
    logger.info(`  PATCH /api/config              — update risk thresholds (auth)`);
    logger.info(`  GET /api/signals?symbol=SPY    — query signal history`);
  });

  // Start orchestrator
  await orchestrator.start();

  // In simulation mode, pre-feed warmup bars then start replay
  if (simulationController) {
    const simCtrl = simulationController;
    bus.once('warmup-complete', () => {
      logger.info('Warmup complete — bulk-loading initial bars and starting simulation replay');

      // Bulk-load the first 100 bars per symbol instantly (no timer delay)
      // This primes the barBuffer so strategies have data from tick #1
      simCtrl.bulkReplay(100);

      // Prime all strategies and reset health (clear any misses from warmup period)
      for (let i = 0; i <= 4; i++) {
        strategyRunner.checkPrimed(i as 0 | 1 | 2 | 3 | 4, 100);
        strategyRunner.resetHealth(i as 0 | 1 | 2 | 3 | 4);
      }

      // Now start the timed replay for remaining bars
      simCtrl.startReplay();

      // Reset health again after a delay to clear any misses accumulated
      // during the first few ticks before bars arrive
      setTimeout(() => {
        for (let i = 0; i <= 4; i++) {
          strategyRunner.resetHealth(i as 0 | 1 | 2 | 3 | 4);
        }
        logger.info('Simulation: strategy health reset after initial replay period');
      }, 2000);
    });
  }

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutdown signal received');
    await orchestrator.stop();
    server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle unhandled rejections
  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'Unhandled rejection');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Engine failed to start');
  process.exit(1);
});
