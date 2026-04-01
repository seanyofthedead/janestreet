/**
 * HTTP utility functions for the engine API.
 * Auth, response helpers, and body parsing.
 */

import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Check X-API-Key header against the expected secret.
 * Returns true if authentication passes.
 */
export function requireAuth(req: IncomingMessage, secret: string): boolean {
  const apiKey = req.headers['x-api-key'];
  return apiKey === secret;
}

/**
 * Parse JSON request body. Returns the parsed object.
 * Throws on invalid JSON or timeout.
 * If optional is true, returns null for empty bodies instead of throwing.
 */
export async function parseJsonBody<T = unknown>(
  req: IncomingMessage,
  options?: { optional?: boolean; timeoutMs?: number },
): Promise<T | null> {
  const { optional = false, timeoutMs = 10_000 } = options ?? {};

  return new Promise<T | null>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      reject(new Error('Request body timeout'));
    }, timeoutMs);

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      clearTimeout(timer);
      const body = Buffer.concat(chunks).toString('utf-8').trim();
      if (!body) {
        if (optional) {
          resolve(null);
          return;
        }
        reject(new Error('Empty request body'));
        return;
      }
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        reject(new Error('Invalid JSON in request body'));
      }
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Send a JSON response with the given status code.
 */
export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Send a JSON error response.
 */
export function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}
