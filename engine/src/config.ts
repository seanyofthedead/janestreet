/**
 * Environment-based configuration for the trading engine.
 * Loads from .env via dotenv and provides typed config object.
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

function optionalEnv(key: string, defaultValue?: string): string | undefined {
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

export interface EngineConfig {
  /** Alpaca API key */
  alpacaApiKey: string;
  /** Alpaca secret key */
  alpacaSecretKey: string;
  /** Alpaca base URL (paper or live) */
  alpacaBaseUrl: string;

  /** Secret for authenticating local API requests */
  localApiSecret: string;

  /** Engine HTTP server port */
  enginePort: number;
  /** Watchdog HTTP server port */
  watchdogPort: number;
  /** Dashboard HTTP server port */
  dashboardPort: number;

  /** DynamoDB endpoint (optional, for local dev with localstack) */
  dynamoDbEndpoint: string | undefined;

  /** Main tick interval in milliseconds */
  tickIntervalMs: number;
  /** Heartbeat interval in milliseconds */
  heartbeatIntervalMs: number;
  /** Config poll interval in milliseconds */
  configPollIntervalMs: number;

  /** Simulation mode: replay historical data during off-hours */
  simulationMode: boolean;
  /** Date to replay in YYYY-MM-DD format (defaults to previous trading day) */
  simulationDate: string | undefined;
  /** Replay speed multiplier (1 = real-time, 10 = 10x faster) */
  simulationSpeed: number;
}

export function loadConfig(): EngineConfig {
  return {
    alpacaApiKey: requiredEnv('ALPACA_API_KEY'),
    alpacaSecretKey: requiredEnv('ALPACA_SECRET_KEY'),
    alpacaBaseUrl: optionalEnv('ALPACA_BASE_URL', 'https://paper-api.alpaca.markets') as string,

    localApiSecret: requiredEnv('LOCAL_API_SECRET'),

    enginePort: intEnv('ENGINE_PORT', 3001),
    watchdogPort: intEnv('WATCHDOG_PORT', 3002),
    dashboardPort: intEnv('DASHBOARD_PORT', 3000),

    dynamoDbEndpoint: optionalEnv('DYNAMODB_ENDPOINT'),

    tickIntervalMs: intEnv('TICK_INTERVAL_MS', 1000),
    heartbeatIntervalMs: intEnv('HEARTBEAT_INTERVAL_MS', 5000),
    configPollIntervalMs: intEnv('CONFIG_POLL_INTERVAL_MS', 60000),

    simulationMode: process.env.SIMULATION_MODE === 'true',
    simulationDate: optionalEnv('SIMULATION_DATE'),
    simulationSpeed: intEnv('SIMULATION_SPEED', 1),
  };
}

/** Singleton config instance — call loadConfig() to initialize */
let _config: EngineConfig | null = null;

export function getConfig(): EngineConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/** Reset config singleton (for testing) */
export function resetConfig(): void {
  _config = null;
}
