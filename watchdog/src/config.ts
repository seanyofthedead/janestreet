/**
 * Environment-based configuration for the watchdog process.
 * Shares the same .env file as the trading engine.
 */

import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../../.env') });

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

function intEnv(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid integer, got: ${raw}`);
  }
  return parsed;
}

function floatEnv(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseFloat(raw);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number, got: ${raw}`);
  }
  return parsed;
}

export interface WatchdogConfig {
  /** Alpaca API key (watchdog has its own client) */
  alpacaApiKey: string;
  /** Alpaca secret key */
  alpacaSecretKey: string;
  /** Alpaca base URL (paper or live) */
  alpacaBaseUrl: string;

  /** Engine HTTP server port (to poll health) */
  enginePort: number;
  /** Watchdog HTTP server port */
  watchdogPort: number;

  /** Secret for authenticating local API requests */
  localApiSecret: string;

  /** Health check polling interval in milliseconds */
  healthCheckIntervalMs: number;
  /** Number of consecutive missed heartbeats before triggering kill switch */
  maxMissedHeartbeats: number;

  /** Daily loss threshold (absolute dollar amount) for auto-kill */
  dailyLossThreshold: number;
  /** Order rate anomaly multiplier (10x = orders coming 10x faster than normal) */
  orderRateAnomalyMultiplier: number;
}

export function loadWatchdogConfig(): WatchdogConfig {
  return {
    alpacaApiKey: requiredEnv('ALPACA_API_KEY'),
    alpacaSecretKey: requiredEnv('ALPACA_SECRET_KEY'),
    alpacaBaseUrl: optionalEnv('ALPACA_BASE_URL', 'https://paper-api.alpaca.markets'),

    enginePort: intEnv('ENGINE_PORT', 3001),
    watchdogPort: intEnv('WATCHDOG_PORT', 3002),

    localApiSecret: requiredEnv('LOCAL_API_SECRET'),

    healthCheckIntervalMs: intEnv('WATCHDOG_HEALTH_CHECK_INTERVAL_MS', 5_000),
    maxMissedHeartbeats: intEnv('WATCHDOG_MAX_MISSED_HEARTBEATS', 3),

    dailyLossThreshold: floatEnv('WATCHDOG_DAILY_LOSS_THRESHOLD', 1000),
    orderRateAnomalyMultiplier: floatEnv('WATCHDOG_ORDER_RATE_ANOMALY_MULTIPLIER', 10),
  };
}

/** Singleton config instance */
let _config: WatchdogConfig | null = null;

export function getWatchdogConfig(): WatchdogConfig {
  if (!_config) {
    _config = loadWatchdogConfig();
  }
  return _config;
}

/** Reset config singleton (for testing) */
export function resetWatchdogConfig(): void {
  _config = null;
}
