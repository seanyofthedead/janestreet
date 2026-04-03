#!/usr/bin/env npx tsx
/**
 * Run regime backtest comparison: baseline vs oracle.
 * Requires historical data in data/. Run scripts/download-historical-data.ts first.
 * Usage: npx tsx scripts/run-regime-backtest.ts
 *
 * NOTE: This script cannot run directly because the backtest runner imports
 * Melange-compiled modules with bare imports that require vitest's alias resolution.
 * Use `npx vitest run backtest/test/run-regime-comparison.test.ts` instead.
 */

console.log('This script requires vitest alias resolution for Melange modules.');
console.log('Run instead: npx vitest run backtest/test/run-regime-comparison.test.ts');
process.exit(0);
