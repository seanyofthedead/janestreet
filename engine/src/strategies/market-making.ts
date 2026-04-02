import type { StrategyModule, SymbolMarketData, Regime, StrategySignal } from './types.js';

function generate(data: SymbolMarketData, _regime: Regime): StrategySignal | null {
  if (data.bars.length < 10) return null;

  const spread = data.ask - data.bid;
  const midpoint = (data.ask + data.bid) / 2;
  const spreadPct = spread / midpoint;

  // Intraday: any meaningful spread is tradeable (IEX often has wider spreads)
  if (spreadPct < 0.0001) return null;

  // Market making buys at bid, sells at ask
  const side = Math.random() > 0.5 ? 0 : 1;
  const price = side === 0 ? data.bid + spread * 0.25 : data.ask - spread * 0.25;
  // Scale for tighter spreads: 0.01% → 0.5 (Moderate), 0.02% → 0.8 (Strong)
  const conf = Math.min(spreadPct * 5000, 0.8);
  const strengthTag = conf >= 0.7 ? 0 : conf >= 0.4 ? 1 : 2;

  return {
    strategy: 4,
    symbol: data.symbol,
    side,
    strength: { TAG: strengthTag, _0: conf },
    target_price: price,
    max_position_pct: 0.04,
    timestamp: Date.now(),
  };
}

const marketMaking: StrategyModule = {
  id: 4,
  name: 'Market_making',
  minBars: 10,
  missThreshold: 100, // Should signal on nearly every tick if spread exists
  generate,
};

export default marketMaking;
