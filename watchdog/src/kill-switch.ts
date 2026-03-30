/**
 * Kill switch — emergency stop using the watchdog's OWN Alpaca client.
 * Cancels all orders, closes all positions, logs and alerts.
 */

import { createRequire } from 'module';
import pino from 'pino';
import type { WatchdogConfig } from './config.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;
const KILL_TIMEOUT_MS = 5_000;

export class KillSwitch {
  private readonly alpaca: any;
  private readonly logger: pino.Logger;
  private activated = false;

  constructor(config: WatchdogConfig, logger?: pino.Logger) {
    this.logger = (logger ?? pino({ name: 'kill-switch' })).child({ component: 'kill-switch' });

    // Dynamic require for the CommonJS Alpaca SDK
    const require = createRequire(import.meta.url);
    const Alpaca = require('@alpacahq/alpaca-trade-api');

    this.alpaca = new Alpaca({
      keyId: config.alpacaApiKey,
      secretKey: config.alpacaSecretKey,
      baseUrl: config.alpacaBaseUrl,
      paper: config.alpacaBaseUrl.includes('paper'),
    });
  }

  /** Whether the kill switch has been activated */
  get isActivated(): boolean {
    return this.activated;
  }

  /**
   * Activate the kill switch:
   * 1. Cancel all open orders
   * 2. Close all positions
   * 3. Log kill event to DynamoDB (stub)
   * 4. Send SNS alert (stub)
   *
   * Completes within 5 seconds or logs failure.
   */
  async activate(reason: string): Promise<{ success: boolean; errors: string[] }> {
    this.logger.warn({ reason }, 'KILL SWITCH ACTIVATED');
    this.activated = true;

    const errors: string[] = [];
    const deadline = Date.now() + KILL_TIMEOUT_MS;

    // Step 1: Cancel all open orders
    try {
      await this.retryWithBackoff(() => this.alpaca.cancelAllOrders(), 'cancelAllOrders', deadline);
      this.logger.info('All open orders cancelled');
    } catch (err: unknown) {
      const msg = `Failed to cancel orders: ${err instanceof Error ? err.message : String(err)}`;
      this.logger.error({ err }, msg);
      errors.push(msg);
    }

    // Step 2: Close all positions
    if (Date.now() < deadline) {
      try {
        await this.retryWithBackoff(() => this.alpaca.closeAllPositions(), 'closeAllPositions', deadline);
        this.logger.info('All positions closed');
      } catch (err: unknown) {
        const msg = `Failed to close positions: ${err instanceof Error ? err.message : String(err)}`;
        this.logger.error({ err }, msg);
        errors.push(msg);
      }
    } else {
      const msg = 'Deadline exceeded before closing positions';
      this.logger.error(msg);
      errors.push(msg);
    }

    // Step 3: Log kill event to DynamoDB (stub)
    await this.logKillEvent(reason, errors);

    // Step 4: Send SNS alert (stub)
    await this.sendAlert(reason, errors);

    const success = errors.length === 0;
    this.logger.info({ success, errors }, 'Kill switch sequence complete');
    return { success, errors };
  }

  /**
   * Retry an async operation with backoff.
   * Handles Alpaca 406 (connection limit) specifically.
   */
  private async retryWithBackoff(
    fn: () => Promise<unknown>,
    label: string,
    deadline: number,
  ): Promise<void> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (Date.now() >= deadline) {
        throw new Error(`${label}: deadline exceeded after ${attempt - 1} attempts`);
      }

      try {
        await fn();
        return;
      } catch (err: unknown) {
        const statusCode = (err as any)?.statusCode ?? (err as any)?.status;
        const isRetryable = statusCode === 406 || statusCode === 429 || statusCode === 500;

        if (!isRetryable || attempt === MAX_RETRIES) {
          throw err;
        }

        this.logger.warn(
          { attempt, label, statusCode },
          `${label} failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`,
        );

        const delay = Math.min(RETRY_DELAY_MS * attempt, deadline - Date.now());
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
  }

  /** Stub: Log kill event to DynamoDB */
  private async logKillEvent(reason: string, errors: string[]): Promise<void> {
    // TODO: Implement DynamoDB logging
    this.logger.info(
      { reason, errors, timestamp: new Date().toISOString() },
      'Kill event logged (stub — DynamoDB not yet implemented)',
    );
  }

  /** Stub: Send SNS alert */
  private async sendAlert(reason: string, errors: string[]): Promise<void> {
    // TODO: Implement SNS alerting
    this.logger.info(
      { reason, errorCount: errors.length },
      'Alert sent (stub — SNS not yet implemented)',
    );
  }
}
