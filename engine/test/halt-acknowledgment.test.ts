/**
 * Tests for halt acknowledgment functionality:
 * - ConfigPoller.setAcknowledgment sets the flag and writes to DynamoDB
 * - In-memory flag is set even if DynamoDB write fails
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigPoller } from '../src/config-poller.js';
import { EventBus } from '../src/event-bus.js';

// ---------------------------------------------------------------------------
// Mock DynamoDB
// ---------------------------------------------------------------------------

const mockSend = vi.fn();

vi.mock('../src/dynamodb.js', () => ({
  getDynamoClient: () => ({
    send: mockSend,
  }),
  TABLE_CONFIG: 'trading-config',
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfigPoller(): ConfigPoller {
  const bus = new EventBus();
  const config = { configPollIntervalMs: 60_000 } as any;
  return new ConfigPoller(config, bus);
}

// ---------------------------------------------------------------------------
// ConfigPoller.setAcknowledgment
// ---------------------------------------------------------------------------

describe('ConfigPoller.setAcknowledgment', () => {
  beforeEach(() => {
    mockSend.mockReset();
  });

  it('sets the in-memory humanAcknowledged flag and writes to DynamoDB', async () => {
    // GetCommand returns an existing config item
    mockSend
      .mockResolvedValueOnce({ Item: { key: 'RUNTIME_CONFIG', humanAcknowledged: false } })
      // PutCommand succeeds
      .mockResolvedValueOnce({});

    const poller = makeConfigPoller();
    expect(poller.isHumanAcknowledged()).toBe(false);

    await poller.setAcknowledgment();

    expect(poller.isHumanAcknowledged()).toBe(true);

    // Verify DynamoDB was called: GetCommand then PutCommand
    expect(mockSend).toHaveBeenCalledTimes(2);

    // The PutCommand should contain humanAcknowledged: true
    const putCall = mockSend.mock.calls[1][0];
    expect(putCall.input.Item.humanAcknowledged).toBe(true);
    expect(putCall.input.Item.key).toBe('RUNTIME_CONFIG');
  });

  it('creates a new config item if none exists in DynamoDB', async () => {
    // GetCommand returns no item
    mockSend
      .mockResolvedValueOnce({ Item: undefined })
      .mockResolvedValueOnce({});

    const poller = makeConfigPoller();
    await poller.setAcknowledgment();

    expect(poller.isHumanAcknowledged()).toBe(true);

    // PutCommand should still have the key and flag
    const putCall = mockSend.mock.calls[1][0];
    expect(putCall.input.Item.key).toBe('RUNTIME_CONFIG');
    expect(putCall.input.Item.humanAcknowledged).toBe(true);
  });

  it('sets in-memory flag before DynamoDB write, throws on DynamoDB failure', async () => {
    // GetCommand succeeds
    mockSend
      .mockResolvedValueOnce({ Item: { key: 'RUNTIME_CONFIG' } })
      // PutCommand fails
      .mockRejectedValueOnce(new Error('DynamoDB write failed'));

    const poller = makeConfigPoller();

    await expect(poller.setAcknowledgment()).rejects.toThrow('DynamoDB write failed');

    // In-memory flag should still be set (it was set before the DynamoDB write)
    expect(poller.isHumanAcknowledged()).toBe(true);
  });

  it('throws when GetCommand fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB read failed'));

    const poller = makeConfigPoller();

    await expect(poller.setAcknowledgment()).rejects.toThrow('DynamoDB read failed');

    // In-memory flag should still be set (it was set before DynamoDB operations)
    expect(poller.isHumanAcknowledged()).toBe(true);
  });

  it('clearAcknowledgment resets the flag after setAcknowledgment', async () => {
    mockSend
      .mockResolvedValueOnce({ Item: { key: 'RUNTIME_CONFIG' } })
      .mockResolvedValueOnce({});

    const poller = makeConfigPoller();
    await poller.setAcknowledgment();
    expect(poller.isHumanAcknowledged()).toBe(true);

    poller.clearAcknowledgment();
    expect(poller.isHumanAcknowledged()).toBe(false);
  });
});
