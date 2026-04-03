#!/usr/bin/env npx tsx
/**
 * Download 3 months of historical bar data from Alpaca for regime backtest.
 * Requires ALPACA_API_KEY and ALPACA_SECRET_KEY in .env.
 * Usage: npx tsx scripts/download-historical-data.ts
 */

import { config as dotenvConfig } from 'dotenv';
import { downloadBars } from '../backtest/src/data-loader.js';

dotenvConfig();

const SYMBOLS = ['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'];
const START_DATE = new Date('2026-01-02T00:00:00Z');
const END_DATE = new Date('2026-03-27T23:59:59Z');

async function main() {
  const apiKey = process.env.ALPACA_API_KEY;
  const apiSecret = process.env.ALPACA_SECRET_KEY;
  if (!apiKey || !apiSecret) {
    console.error('Missing ALPACA_API_KEY or ALPACA_SECRET_KEY in .env');
    process.exit(1);
  }

  console.log(`Downloading ${START_DATE.toISOString().slice(0,10)} to ${END_DATE.toISOString().slice(0,10)}\n`);

  for (const symbol of SYMBOLS) {
    console.log(`[${symbol}] 1-min bars...`);
    try {
      const bars = await downloadBars(symbol, '1Min', START_DATE, END_DATE, apiKey, apiSecret);
      console.log(`  done: ${bars.length} bars`);
    } catch (err) {
      console.error(`  failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log('\n[SPY] 1-day bars...');
  try {
    const bars = await downloadBars('SPY', '1Day', START_DATE, END_DATE, apiKey, apiSecret);
    console.log(`  done: ${bars.length} bars`);
  } catch (err) {
    console.error(`  failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log('\nDone. Run: npx vitest run backtest/test/calibrate-gates.test.ts');
}

main().catch(e => { console.error(e); process.exit(1); });
