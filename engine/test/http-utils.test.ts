/**
 * Tests for HTTP utility functions: auth, body parsing, response helpers.
 */

import { describe, it, expect } from 'vitest';
import { requireAuth, parseJsonBody, sendJson, sendError } from '../src/http-utils.js';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { Readable } from 'stream';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(headers: Record<string, string> = {}): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  for (const [key, value] of Object.entries(headers)) {
    req.headers[key.toLowerCase()] = value;
  }
  return req;
}

function makeReadable(body: string): IncomingMessage {
  const req = makeReq();
  // Simulate data + end events
  process.nextTick(() => {
    if (body) {
      req.push(Buffer.from(body));
    }
    req.push(null);
  });
  return req;
}

function makeRes(): { res: ServerResponse; getOutput: () => { status: number; body: string } } {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  const res = new ServerResponse(req);
  let status = 200;
  let body = '';

  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = ((code: number, ...args: any[]) => {
    status = code;
    return originalWriteHead(code, ...args);
  }) as any;

  const originalEnd = res.end.bind(res);
  res.end = ((chunk?: any, ...args: any[]) => {
    if (chunk) body = chunk.toString();
    return originalEnd(chunk, ...args);
  }) as any;

  return { res, getOutput: () => ({ status, body }) };
}

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

describe('requireAuth', () => {
  it('returns true when X-API-Key matches secret', () => {
    const req = makeReq({ 'X-API-Key': 'test-secret-123' });
    expect(requireAuth(req, 'test-secret-123')).toBe(true);
  });

  it('returns false when X-API-Key is missing', () => {
    const req = makeReq({});
    expect(requireAuth(req, 'test-secret-123')).toBe(false);
  });

  it('returns false when X-API-Key is wrong', () => {
    const req = makeReq({ 'X-API-Key': 'wrong-key' });
    expect(requireAuth(req, 'test-secret-123')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseJsonBody
// ---------------------------------------------------------------------------

describe('parseJsonBody', () => {
  it('parses valid JSON body', async () => {
    const req = makeReadable('{"name":"test","value":42}');
    const result = await parseJsonBody<{ name: string; value: number }>(req);
    expect(result).toEqual({ name: 'test', value: 42 });
  });

  it('rejects invalid JSON', async () => {
    const req = makeReadable('not json');
    await expect(parseJsonBody(req)).rejects.toThrow('Invalid JSON');
  });

  it('rejects empty body by default', async () => {
    const req = makeReadable('');
    await expect(parseJsonBody(req)).rejects.toThrow('Empty request body');
  });

  it('returns null for empty body when optional', async () => {
    const req = makeReadable('');
    const result = await parseJsonBody(req, { optional: true });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sendJson / sendError
// ---------------------------------------------------------------------------

describe('sendJson', () => {
  it('sends JSON response with correct status and content type', () => {
    const { res, getOutput } = makeRes();
    sendJson(res, 200, { success: true, data: [1, 2, 3] });
    const output = getOutput();
    expect(output.status).toBe(200);
    expect(JSON.parse(output.body)).toEqual({ success: true, data: [1, 2, 3] });
  });

  it('supports non-200 status codes', () => {
    const { res, getOutput } = makeRes();
    sendJson(res, 201, { created: true });
    expect(getOutput().status).toBe(201);
  });
});

describe('sendError', () => {
  it('sends error response with message', () => {
    const { res, getOutput } = makeRes();
    sendError(res, 404, 'Not found');
    const output = getOutput();
    expect(output.status).toBe(404);
    expect(JSON.parse(output.body)).toEqual({ error: 'Not found' });
  });

  it('supports various status codes', () => {
    const { res, getOutput } = makeRes();
    sendError(res, 401, 'Unauthorized');
    expect(getOutput().status).toBe(401);
  });
});
