import type { StrategyModule, SymbolMarketData, Regime, StrategySignal } from './types.js';

function generate(data: SymbolMarketData, regime: Regime): StrategySignal | null {
  if (data.bars.length < 50) return null;

  const recent = data.bars.slice(-10);
  const older = data.bars.slice(-50, -10);
  const recentAvg = recent.reduce((s, b) => s + b.c, 0) / recent.length;
  const olderAvg = older.reduce((s, b) => s + b.c, 0) / older.length;

  const momentum = (recentAvg - olderAvg) / olderAvg;
  // Intraday 1-min bars: 0.01% trend is detectable
  if (Math.abs(momentum) < 0.0001) return null;

  const side = momentum > 0 ? 0 : 1;
  // Scale: 0.02% → 0.4 (Moderate), 0.04% → 0.8 (Strong)
  const conf = Math.min(Math.abs(momentum) * 2000, 0.9);
  const strengthTag = conf >= 0.7 ? 0 : conf >= 0.4 ? 1 : 2;

  return {
    strategy: 3,
    symbol: data.symbol,
    side,
    strength: { TAG: strengthTag, _0: conf },
    target_price: data.price * (1 + momentum * 0.5),
    max_position_pct: regime === 3 ? 0.02 : 0.06,
    timestamp: Date.now(),
  };
}

const momentumStrategy: StrategyModule = {
  id: 3,
  name: 'Momentum',
  minBars: 50,
  generate,
};

export default momentumStrategy;
