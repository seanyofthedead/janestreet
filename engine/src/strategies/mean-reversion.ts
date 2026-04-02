import type { StrategyModule, SymbolMarketData, Regime, StrategySignal } from './types.js';

function generate(data: SymbolMarketData, regime: Regime): StrategySignal | null {
  if (data.bars.length < 20) return null;

  // Simple mean reversion: compare current price to 20-bar SMA
  const sma = data.bars.slice(-20).reduce((sum, b) => sum + b.c, 0) / 20;
  const deviation = (data.price - sma) / sma;

  // Intraday 1-min bars: 0.02% deviation is meaningful for SPY
  if (Math.abs(deviation) < 0.0002) return null;

  const side = deviation > 0 ? 1 : 0; // Sell if above mean, buy if below
  const absDeviation = Math.abs(deviation);
  // Scale: 0.02% → 0.4 (Moderate), 0.04% → 0.8 (Strong)
  const conf = Math.min(absDeviation * 2000, 0.95);

  const strengthTag = conf >= 0.7 ? 0 : conf >= 0.4 ? 1 : 2;

  return {
    strategy: 0,
    symbol: data.symbol,
    side,
    strength: { TAG: strengthTag, _0: conf },
    target_price: sma,
    max_position_pct: regime === 3 ? 0.03 : 0.08,
    timestamp: Date.now(),
  };
}

const meanReversion: StrategyModule = {
  id: 0,
  name: 'Mean_reversion',
  minBars: 20,
  generate,
};

export default meanReversion;
