/**
 * Persists trading signals to DynamoDB for historical querying.
 * Writes are fire-and-forget to avoid blocking the tick loop.
 */

import pino from 'pino';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoClient, TABLE_SIGNALS } from './dynamodb.js';

export interface SignalRecord {
  symbol: string;
  timestamp: number;
  strategy: string;
  side: string;
  confidence: number;
  targetPrice: number;
}

export class SignalStore {
  private readonly logger: pino.Logger;

  constructor(logger?: pino.Logger) {
    this.logger = (logger ?? pino({ name: 'signal-store' })).child({
      component: 'signal-store',
    });
  }

  /**
   * Persist a signal to DynamoDB. Fire-and-forget — errors are logged,
   * not thrown, so the tick loop is never blocked.
   */
  persist(signal: SignalRecord): void {
    const client = getDynamoClient();
    client
      .send(
        new PutCommand({
          TableName: TABLE_SIGNALS,
          Item: {
            symbol: signal.symbol,
            timestamp: signal.timestamp,
            strategy: signal.strategy,
            side: signal.side,
            confidence: signal.confidence,
            targetPrice: signal.targetPrice,
          },
        }),
      )
      .catch((err) => {
        this.logger.error(
          { err: (err as Error).message, symbol: signal.symbol },
          'Failed to persist signal',
        );
      });
  }

  /**
   * Query signals for a symbol within a time range.
   * Optionally filter by strategy name.
   */
  async query(
    symbol: string,
    since: number,
    until?: number,
    strategy?: string,
  ): Promise<SignalRecord[]> {
    const client = getDynamoClient();

    let keyCondition = 'symbol = :sym AND #ts >= :since';
    const exprNames: Record<string, string> = { '#ts': 'timestamp' };
    const exprValues: Record<string, unknown> = {
      ':sym': symbol,
      ':since': since,
    };

    if (until) {
      keyCondition = 'symbol = :sym AND #ts BETWEEN :since AND :until';
      exprValues[':until'] = until;
    }

    let filterExpression: string | undefined;
    if (strategy) {
      filterExpression = 'strategy = :strat';
      exprValues[':strat'] = strategy;
    }

    const result = await client.send(
      new QueryCommand({
        TableName: TABLE_SIGNALS,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ...(filterExpression ? { FilterExpression: filterExpression } : {}),
        ScanIndexForward: true, // ascending by timestamp
      }),
    );

    return (result.Items ?? []) as SignalRecord[];
  }
}
