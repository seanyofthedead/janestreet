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
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
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

  req.on('close', () => {
    for (const { event, fn } of listeners) {
      orchestrator.bus.off(event, fn as any);
    }
  });
}

function handleAccount(res: ServerResponse, orchestrator: Orchestrator): void {
  const snapshot = orchestrator.state.getPortfolioSnapshot();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(snapshot));
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
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  logger.info('=== Jane Street Trading Engine ===');

  // Load configuration
  const config = loadConfig();
  logger.info({ port: config.enginePort }, 'Configuration loaded');

  // Initialize Alpaca client
  const alpacaClient = new AlpacaClient(config, logger);
  const marketDataStream = new MarketDataStream(config, alpacaClient, logger);
  const orderManager = new OrderManager(config, alpacaClient, logger);

  // Initialize engine components
  const bus = new EventBus(logger);
  const state = new State(logger);
  const strategyRunner = new StrategyRunner(logger);
  const conflictResolver = new ConflictResolver(logger);
  const configPoller = new ConfigPoller(config, bus, logger);
  const performanceTracker = new PerformanceTracker();

  // Create orchestrator
  const orchestrator = new Orchestrator(
    config,
    alpacaClient,
    marketDataStream,
    orderManager,
    bus,
    state,
    strategyRunner,
    conflictResolver,
    configPoller,
    performanceTracker,
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
  });

  // Start orchestrator
  await orchestrator.start();

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
