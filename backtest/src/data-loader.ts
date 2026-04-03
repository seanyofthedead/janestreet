/**
 * Data loader for historical bar data.
 * Loads from JSON cache files or downloads from Alpaca REST API.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Bar {
  timestamp: number; // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = '1Min' | '5Min' | '15Min' | '1Hour' | '1Day';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');

/**
 * Load bars from a local JSON cache file in data/{symbol}_{timeframe}.json
 */
export async function loadBars(
  symbol: string,
  timeframe: Timeframe,
  start: Date,
  end: Date,
): Promise<Bar[]> {
  const filePath = cacheFilePath(symbol, timeframe);
  if (!existsSync(filePath)) {
    throw new Error(`No cached data for ${symbol} ${timeframe}. File not found: ${filePath}`);
  }
  const raw = await readFile(filePath, 'utf-8');
  const bars: Bar[] = JSON.parse(raw);

  const startMs = start.getTime();
  const endMs = end.getTime();
  return bars.filter(b => b.timestamp >= startMs && b.timestamp <= endMs);
}

/**
 * Download bars from Alpaca REST API and save to cache.
 * Uses the v2 bars endpoint with pagination.
 */
export async function downloadBars(
  symbol: string,
  timeframe: Timeframe,
  start: Date,
  end: Date,
  alpacaApiKey: string,
  alpacaSecret: string,
): Promise<Bar[]> {
  const allBars: Bar[] = [];
  let pageToken: string | undefined;
  const alpacaTimeframe = toAlpacaTimeframe(timeframe);
  const isCrypto = symbol.includes('/');
  const baseUrl = isCrypto
    ? 'https://data.alpaca.markets/v1beta3/crypto/us'
    : 'https://data.alpaca.markets/v2/stocks';

  do {
    // Basic rate limiting: 200ms delay between requests
    if (pageToken) {
      await delay(200);
    }

    const params = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
      timeframe: alpacaTimeframe,
      limit: '10000',
      adjustment: 'split',
    });
    if (pageToken) params.set('page_token', pageToken);

    const url = `${baseUrl}/${encodeURIComponent(symbol)}/bars?${params}`;
    const response = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': alpacaApiKey,
        'APCA-API-SECRET-KEY': alpacaSecret,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Alpaca API error ${response.status}: ${body}`);
    }

    const data = await response.json() as AlpacaBarsResponse;
    if (data.bars) {
      for (const bar of data.bars) {
        allBars.push({
          timestamp: new Date(bar.t).getTime(),
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v,
        });
      }
    }
    pageToken = data.next_page_token ?? undefined;
  } while (pageToken);

  // Save to cache
  await saveBars(symbol, timeframe, allBars);
  return allBars;
}

/**
 * Save bars to the local cache directory.
 */
async function saveBars(symbol: string, timeframe: Timeframe, bars: Bar[]): Promise<void> {
  const filePath = cacheFilePath(symbol, timeframe);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(filePath, JSON.stringify(bars, null, 2), 'utf-8');
}

function cacheFilePath(symbol: string, timeframe: Timeframe): string {
  return join(DATA_DIR, `${symbol.toUpperCase()}_${timeframe}.json`);
}

function toAlpacaTimeframe(tf: Timeframe): string {
  switch (tf) {
    case '1Min': return '1Min';
    case '5Min': return '5Min';
    case '15Min': return '15Min';
    case '1Hour': return '1Hour';
    case '1Day': return '1Day';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface AlpacaBar {
  t: string;  // ISO timestamp
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
  v: number;  // volume
}

interface AlpacaBarsResponse {
  bars: AlpacaBar[] | null;
  next_page_token: string | null;
}

/**
 * Load bars for multiple symbols, returning a map.
 */
export async function loadMultiSymbolBars(
  symbols: string[],
  timeframe: Timeframe,
  start: Date,
  end: Date,
): Promise<Map<string, Bar[]>> {
  const result = new Map<string, Bar[]>();
  for (const symbol of symbols) {
    const bars = await loadBars(symbol, timeframe, start, end);
    result.set(symbol, bars);
  }
  return result;
}
