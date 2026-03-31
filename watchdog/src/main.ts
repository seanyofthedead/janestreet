/**
 * Watchdog process entry point.
 * Runs as a SEPARATE Node.js process from the trading engine.
 */

import http from 'http';
import pino from 'pino';
import { loadWatchdogConfig } from './config.js';
import { KillSwitch } from './kill-switch.js';
import { HealthChecker } from './health-checker.js';

const logger = pino({ name: 'watchdog' });

function main(): void {
  const config = loadWatchdogConfig();
  logger.info({ enginePort: config.enginePort, watchdogPort: config.watchdogPort }, 'Watchdog starting');

  const killSwitch = new KillSwitch(config, logger);
  const healthChecker = new HealthChecker(config, killSwitch, logger);

  // ---------------------------------------------------------------------------
  // HTTP Server
  // ---------------------------------------------------------------------------

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${config.watchdogPort}`);

    // CORS headers for dashboard
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /watchdog-alive — liveness probe for the engine to poll
    if (req.method === 'GET' && url.pathname === '/watchdog-alive') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'alive', timestamp: new Date().toISOString() }));
      return;
    }

    // GET /status — current watchdog status
    if (req.method === 'GET' && url.pathname === '/status') {
      const status = healthChecker.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // POST /kill — manual kill switch trigger (requires auth)
    if (req.method === 'POST' && url.pathname === '/kill') {
      const apiKey = req.headers['x-api-key'];
      if (apiKey !== config.localApiSecret) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      logger.warn('Manual kill switch triggered via API');
      const result = await killSwitch.activate('Manual trigger via /kill endpoint');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(config.watchdogPort, '127.0.0.1', () => {
    logger.info({ port: config.watchdogPort }, 'Watchdog HTTP server listening');
  });

  // ---------------------------------------------------------------------------
  // Start health check polling
  // ---------------------------------------------------------------------------

  healthChecker.start();

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  const shutdown = (): void => {
    logger.info('Shutting down watchdog');
    healthChecker.stop();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('Watchdog fully initialized');
}

main();
