import { assetClassForSymbol } from '../config.js';
import type { StrategyModule, SymbolMarketData, Regime, StrategySignal } from './types.js';

function generate(data: SymbolMarketData, regime: Regime): StrategySignal | null {
  if (data.bars.length < 30) return null;

  // Calendar/seasonal anomalies are equity-specific; skip for crypto
  if (assetClassForSymbol(data.symbol) === 'crypto') return null;

  // Seasonal anomalies break down in crises
  if (regime === 3) return null;

  const now = new Date();
  const dayOfMonth = now.getDate();
  const month = now.getMonth() + 1; // 1-indexed
  const daysInMonth = new Date(now.getFullYear(), month, 0).getDate();

  // Turn-of-month effect: last 3 days + first 3 days are bullish
  const isTurnOfMonth = dayOfMonth >= daysInMonth - 2 || dayOfMonth <= 3;

  // Sell-in-May: May through October tends bearish, Nov-Apr bullish
  const isSellInMay = month >= 5 && month <= 10;

  if (isTurnOfMonth) {
    // Turn-of-month: Moderate Buy — strongest seasonal signal
    return {
      strategy: 2,
      symbol: data.symbol,
      side: 0,
      strength: { TAG: 1, _0: 0.55 }, // Moderate
      target_price: data.price * 1.005,
      max_position_pct: 0.04,
      timestamp: Date.now(),
    };
  }

  if (isSellInMay) {
    // Summer months: Moderate Sell
    return {
      strategy: 2,
      symbol: data.symbol,
      side: 1,
      strength: { TAG: 1, _0: 0.45 }, // Moderate
      target_price: data.price * 0.995,
      max_position_pct: 0.04,
      timestamp: Date.now(),
    };
  }

  // Nov-Apr: Moderate Buy
  return {
    strategy: 2,
    symbol: data.symbol,
    side: 0,
    strength: { TAG: 1, _0: 0.50 }, // Moderate
    target_price: data.price * 1.003,
    max_position_pct: 0.04,
    timestamp: Date.now(),
  };
}

const calendarSeasonal: StrategyModule = {
  id: 2,
  name: 'Calendar_seasonal',
  minBars: 30,
  missThreshold: 1000, // Date-driven signals have long quiet periods mid-month
  generate,
};

export default calendarSeasonal;
