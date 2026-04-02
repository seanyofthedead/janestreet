/**
 * Shared DynamoDB client and table name constants.
 * Used by state persistence, config poller, and performance tracker.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Table names — must match scripts/setup-tables.ts
export const TABLE_STATE = 'trading-state';
export const TABLE_CONFIG = 'trading-config';
export const TABLE_HISTORY = 'trading-history';
export const TABLE_SIGNALS = 'trading-signals';

let _client: DynamoDBDocumentClient | null = null;

/**
 * Get singleton DynamoDB Document Client.
 * Uses DYNAMODB_ENDPOINT env var for local development.
 */
export function getDynamoClient(endpoint?: string): DynamoDBDocumentClient {
  if (_client) return _client;

  const resolvedEndpoint = endpoint ?? process.env.DYNAMODB_ENDPOINT;

  const baseClient = new DynamoDBClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    ...(resolvedEndpoint ? { endpoint: resolvedEndpoint } : {}),
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
    },
  });

  _client = DynamoDBDocumentClient.from(baseClient, {
    marshallOptions: { removeUndefinedValues: true },
  });

  return _client;
}

/** Reset the singleton (for testing) */
export function resetDynamoClient(): void {
  _client = null;
}
