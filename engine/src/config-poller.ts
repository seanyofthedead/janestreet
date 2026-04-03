/**
 * Runtime configuration polling.
 * Polls DynamoDB config table for updated risk limits and strategy parameters.
 * Currently stubbed with defaults.
 */

import pino from 'pino';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { EventBus } from './event-bus.js';
import type { EngineConfig, AssetClass } from './config.js';
import { assetClassForSymbol } from './config.js';
import { getDynamoClient, TABLE_CONFIG } from './dynamodb.js';
import { STRATEGY_NAMES } from './strategies/index.js';

// ---------------------------------------------------------------------------
// Runtime config shape
// ---------------------------------------------------------------------------

export interface CryptoRiskOverrides {
  maxPositionPct?: number;
  maxSectorPct?: number;
  minCashReservePct?: number;
  maxDailyLossPct?: number;
  maxDrawdownReducePct?: number;
  maxDrawdownFlattenPct?: number;
}

export interface RuntimeConfig {
  /** Risk limits */
  maxPositionPct: number;
  maxSectorPct: number;
  minCashReservePct: number;
  maxDailyLossPct: number;
  maxDrawdownReducePct: number;
  maxDrawdownFlattenPct: number;
  maxOrderRatePerMin: number;
  heartbeatTimeoutSeconds: number;
  maxPositionsByPhase: number;

  /** Symbol universe (equities) */
  symbols: string[];

  /** Symbol universe (crypto) */
  cryptoSymbols: string[];

  /** Crypto-specific risk overrides (merged onto base config for crypto signals) */
  cryptoRiskOverrides: CryptoRiskOverrides;

  /** Strategy toggles */
  enabledStrategies: Record<string, boolean>;

  /** Human acknowledgment flag (for halted state recovery) */
  humanAcknowledged: boolean;

  /** Last updated timestamp */
  lastUpdated: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

function defaultRuntimeConfig(): RuntimeConfig {
  return {
    maxPositionPct: 0.15,
    maxSectorPct: 0.40,
    minCashReservePct: 0.15,
    maxDailyLossPct: 0.05,
    maxDrawdownReducePct: 0.10,
    maxDrawdownFlattenPct: 0.20,
    maxOrderRatePerMin: 10,
    heartbeatTimeoutSeconds: 15,
    maxPositionsByPhase: 6,
    symbols: ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'],
    cryptoSymbols: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
    cryptoRiskOverrides: {
      maxPositionPct: 0.10,
      maxSectorPct: 1.0,        // disable sector concentration for crypto
      maxDailyLossPct: 0.08,    // wider tolerance for crypto volatility
    },
    enabledStrategies: {
      Mean_reversion: true,
      Sector_rotation: true,
      Calendar_seasonal: true,
      Momentum: true,
      Market_making: true,
    },
    humanAcknowledged: false,
    lastUpdated: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Strategy name lookup (derived from canonical STRATEGY_NAMES)
// ---------------------------------------------------------------------------

/** Reverse lookup: lowercase name -> canonical name */
const STRATEGY_NAME_LOOKUP: Record<string, string> = Object.fromEntries(
  Object.values(STRATEGY_NAMES).map((name) => [name.toLowerCase(), name]),
);

// Also allow numeric string IDs
for (const [id, name] of Object.entries(STRATEGY_NAMES)) {
  STRATEGY_NAME_LOOKUP[id] = name;
}

// ---------------------------------------------------------------------------
// ConfigPoller
// ---------------------------------------------------------------------------

export class ConfigPoller {
  private readonly logger: pino.Logger;
  private readonly bus: EventBus;
  private readonly pollIntervalMs: number;
  private readonly assetClass: AssetClass;
  private current: RuntimeConfig;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: EngineConfig, bus: EventBus, logger?: pino.Logger) {
    this.logger = (logger ?? pino({ name: 'config-poller' })).child({
      component: 'config-poller',
    });
    this.bus = bus;
    this.pollIntervalMs = config.configPollIntervalMs;
    this.assetClass = config.assetClass;
    this.current = defaultRuntimeConfig();
  }

  /** Start polling for config changes */
  start(): void {
    this.logger.info({ intervalMs: this.pollIntervalMs }, 'Starting config poller');
    this.pollTimer = setInterval(() => {
      this.poll().catch((err) => {
        this.logger.error({ err: (err as Error).message }, 'Config poll failed');
      });
    }, this.pollIntervalMs);
  }

  /** Stop polling */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.logger.info('Config poller stopped');
  }

  /** Get current runtime config */
  getConfig(): RuntimeConfig {
    return this.current;
  }

  /** Get equity symbol universe */
  getSymbols(): string[] {
    return this.current.symbols;
  }

  /** Get crypto symbol universe */
  getCryptoSymbols(): string[] {
    return this.current.cryptoSymbols;
  }

  /** Get all symbols based on configured asset class */
  getAllSymbols(): string[] {
    switch (this.assetClass) {
      case 'equity':
        return this.current.symbols;
      case 'crypto':
        return this.current.cryptoSymbols;
      case 'both':
        return [...this.current.symbols, ...this.current.cryptoSymbols];
    }
  }

  /** Check if human has acknowledged a halt */
  isHumanAcknowledged(): boolean {
    return this.current.humanAcknowledged;
  }

  /** Clear the human acknowledgment flag after processing */
  clearAcknowledgment(): void {
    this.current.humanAcknowledged = false;
  }

  /** Set the human acknowledgment flag and persist to DynamoDB */
  async setAcknowledgment(): Promise<void> {
    // Set in-memory flag first
    this.current.humanAcknowledged = true;

    // Persist to DynamoDB
    try {
      const client = getDynamoClient();
      const result = await client.send(
        new GetCommand({
          TableName: TABLE_CONFIG,
          Key: { key: 'RUNTIME_CONFIG' },
        }),
      );

      const item = result.Item ?? { key: 'RUNTIME_CONFIG' };
      item.humanAcknowledged = true;
      item.lastUpdated = Date.now();

      await client.send(
        new PutCommand({
          TableName: TABLE_CONFIG,
          Item: item,
        }),
      );

      this.logger.info('Human acknowledgment set and persisted to DynamoDB');
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'Failed to persist acknowledgment to DynamoDB');
      throw err;
    }
  }

  /** Force an immediate config poll from DynamoDB */
  async forcePoll(): Promise<void> {
    await this.poll();
  }

  /** Enable or disable a strategy by name, persisting to DynamoDB */
  async setStrategyEnabled(strategyName: string, enabled: boolean): Promise<void> {
    const canonicalName = STRATEGY_NAME_LOOKUP[strategyName.toLowerCase()];
    if (!canonicalName) {
      throw new Error(`Unknown strategy: ${strategyName}`);
    }

    const client = getDynamoClient();

    // Read current config from DynamoDB
    const result = await client.send(
      new GetCommand({
        TableName: TABLE_CONFIG,
        Key: { key: 'RUNTIME_CONFIG' },
      }),
    );

    const item = result.Item ?? { key: 'RUNTIME_CONFIG' };
    if (!item.enabledStrategies) {
      item.enabledStrategies = { ...this.current.enabledStrategies };
    }
    item.enabledStrategies[canonicalName] = enabled;
    item.lastUpdated = Date.now();

    // Write back
    await client.send(
      new PutCommand({
        TableName: TABLE_CONFIG,
        Item: item,
      }),
    );

    // Refresh in-memory config
    try {
      await this.forcePoll();
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message, strategy: canonicalName, enabled },
        'forcePoll failed after setStrategyEnabled, falling back to direct mutation',
      );
      this.current.enabledStrategies[canonicalName] = enabled;
    }

    this.logger.info({ strategy: canonicalName, enabled }, 'Strategy enabled/disabled');
  }

  /** Whitelist of risk threshold fields that can be updated via API */
  private static readonly UPDATABLE_RISK_FIELDS = new Set([
    'maxPositionPct',
    'maxSectorPct',
    'minCashReservePct',
    'maxDailyLossPct',
    'maxDrawdownReducePct',
    'maxDrawdownFlattenPct',
    'maxOrderRatePerMin',
    'heartbeatTimeoutSeconds',
    'maxPositionsByPhase',
  ]);

  /**
   * Update risk threshold fields and persist to DynamoDB.
   * Only numeric risk fields are accepted — strategy toggles, symbols, and
   * acknowledgment have dedicated methods.
   */
  async updateRiskThresholds(
    updates: Partial<RuntimeConfig>,
  ): Promise<RuntimeConfig> {
    // Validate: only whitelisted fields
    const invalidFields = Object.keys(updates).filter(
      (k) => !ConfigPoller.UPDATABLE_RISK_FIELDS.has(k),
    );
    if (invalidFields.length > 0) {
      throw new Error(`Non-updatable fields: ${invalidFields.join(', ')}`);
    }

    // Validate: all values must be positive numbers
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value !== 'number' || value < 0) {
        throw new Error(`Invalid value for ${key}: must be a non-negative number`);
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new Error('No fields to update');
    }

    const client = getDynamoClient();

    // Read current config from DynamoDB
    const result = await client.send(
      new GetCommand({
        TableName: TABLE_CONFIG,
        Key: { key: 'RUNTIME_CONFIG' },
      }),
    );

    const item = result.Item ?? { key: 'RUNTIME_CONFIG' };

    // Merge updates
    for (const [key, value] of Object.entries(updates)) {
      item[key] = value;
    }
    item.lastUpdated = Date.now();

    // Write back
    await client.send(
      new PutCommand({
        TableName: TABLE_CONFIG,
        Item: item,
      }),
    );

    // Refresh in-memory config
    try {
      await this.forcePoll();
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message, fields: Object.keys(updates) },
        'forcePoll failed after updateRiskThresholds, falling back to direct mutation',
      );
      for (const [key, value] of Object.entries(updates)) {
        (this.current as Record<string, unknown>)[key] = value;
      }
    }

    this.logger.info({ fields: Object.keys(updates) }, 'Risk thresholds updated');
    return this.current;
  }

  /**
   * Build a risk config object compatible with the OCaml risk engine.
   */
  toOcamlRiskConfig(signalAssetClass?: 'equity' | 'crypto'): {
    max_position_pct: number;
    max_sector_pct: number;
    min_cash_reserve_pct: number;
    max_daily_loss_pct: number;
    max_drawdown_reduce_pct: number;
    max_drawdown_flatten_pct: number;
    max_order_rate_per_min: number;
    heartbeat_timeout_seconds: number;
    max_positions_by_phase: number;
  } {
    const overrides = signalAssetClass === 'crypto' ? this.current.cryptoRiskOverrides : {};
    return {
      max_position_pct: overrides.maxPositionPct ?? this.current.maxPositionPct,
      max_sector_pct: overrides.maxSectorPct ?? this.current.maxSectorPct,
      min_cash_reserve_pct: overrides.minCashReservePct ?? this.current.minCashReservePct,
      max_daily_loss_pct: overrides.maxDailyLossPct ?? this.current.maxDailyLossPct,
      max_drawdown_reduce_pct: overrides.maxDrawdownReducePct ?? this.current.maxDrawdownReducePct,
      max_drawdown_flatten_pct: overrides.maxDrawdownFlattenPct ?? this.current.maxDrawdownFlattenPct,
      max_order_rate_per_min: this.current.maxOrderRatePerMin,
      heartbeat_timeout_seconds: this.current.heartbeatTimeoutSeconds,
      max_positions_by_phase: this.current.maxPositionsByPhase,
    };
  }

  // -----------------------------------------------------------------------
  // Internal polling
  // -----------------------------------------------------------------------

  private async poll(): Promise<void> {
    this.logger.debug('Polling for config changes');

    try {
      const newConfig = await this.fetchFromDynamoDB();

      // Detect changes
      const changedKeys = this.detectChanges(this.current, newConfig);
      if (changedKeys.length > 0) {
        this.logger.info({ changedKeys }, 'Config changed');
        this.current = newConfig;
        this.bus.emit('config-change', {
          changedKeys,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'Failed to fetch config');
    }
  }

  /** Fetch config from DynamoDB. Falls back to current config on error or missing item. */
  private async fetchFromDynamoDB(): Promise<RuntimeConfig> {
    try {
      const client = getDynamoClient();
      const result = await client.send(
        new GetCommand({
          TableName: TABLE_CONFIG,
          Key: { key: 'RUNTIME_CONFIG' },
        }),
      );

      if (!result.Item) {
        return this.current; // No config stored yet — use defaults
      }

      return this.parseConfig(result.Item);
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'DynamoDB config fetch failed, using last-known-good');
      return this.current;
    }
  }

  /** Map DynamoDB item fields to RuntimeConfig, using current values as defaults for missing fields */
  private parseConfig(item: Record<string, unknown>): RuntimeConfig {
    const defaults = this.current;
    return {
      maxPositionPct: (item.maxPositionPct as number) ?? defaults.maxPositionPct,
      maxSectorPct: (item.maxSectorPct as number) ?? defaults.maxSectorPct,
      minCashReservePct: (item.minCashReservePct as number) ?? defaults.minCashReservePct,
      maxDailyLossPct: (item.maxDailyLossPct as number) ?? defaults.maxDailyLossPct,
      maxDrawdownReducePct: (item.maxDrawdownReducePct as number) ?? defaults.maxDrawdownReducePct,
      maxDrawdownFlattenPct: (item.maxDrawdownFlattenPct as number) ?? defaults.maxDrawdownFlattenPct,
      maxOrderRatePerMin: (item.maxOrderRatePerMin as number) ?? defaults.maxOrderRatePerMin,
      heartbeatTimeoutSeconds: (item.heartbeatTimeoutSeconds as number) ?? defaults.heartbeatTimeoutSeconds,
      maxPositionsByPhase: (item.maxPositionsByPhase as number) ?? defaults.maxPositionsByPhase,
      symbols: (item.symbols as string[]) ?? defaults.symbols,
      cryptoSymbols: (item.cryptoSymbols as string[]) ?? defaults.cryptoSymbols,
      cryptoRiskOverrides: (item.cryptoRiskOverrides as CryptoRiskOverrides) ?? defaults.cryptoRiskOverrides,
      enabledStrategies: (item.enabledStrategies as Record<string, boolean>) ?? defaults.enabledStrategies,
      humanAcknowledged: (item.humanAcknowledged as boolean) ?? defaults.humanAcknowledged,
      lastUpdated: (item.lastUpdated as number) ?? Date.now(),
    };
  }

  /** Compare two configs and return keys that differ */
  private detectChanges(prev: RuntimeConfig, next: RuntimeConfig): string[] {
    const changed: string[] = [];
    const keys = Object.keys(prev) as (keyof RuntimeConfig)[];

    for (const key of keys) {
      if (key === 'lastUpdated') continue;
      const prevVal = JSON.stringify(prev[key]);
      const nextVal = JSON.stringify(next[key]);
      if (prevVal !== nextVal) {
        changed.push(key);
      }
    }

    return changed;
  }
}
