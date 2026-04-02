import type { StrategyModule, SymbolMarketData, Regime, StrategySignal } from './types.js';

function generate(data: SymbolMarketData, regime: Regime): StrategySignal | null {
  if (data.bars.length < 50) return null;

  // Relative-strength approach: compare long-term trend to short-term pullback
  const longTermPrice = data.bars[data.bars.length - 50].c;
  const shortTermPrice = data.bars[data.bars.length - 20].c;
  const currentPrice = data.price;

  const longReturn = (currentPrice - longTermPrice) / longTermPrice;
  const shortReturn = (currentPrice - shortTermPrice) / shortTermPrice;

  // Intraday 1-min bars: 0.02% long trend with any short pullback
  let side: number;
  if (longReturn > 0.0002 && shortReturn < -0.0001) {
    side = 0; // Buy: dip in uptrend
  } else if (longReturn < -0.0002 && shortReturn > 0.0001) {
    side = 1; // Sell: rally in downtrend
  } else {
    return null;
  }

  // Scale: 0.02% → 0.4 (Moderate), 0.04% → 0.8 (Strong)
  const conf = Math.min(Math.abs(longReturn) * 2000, 0.8);
  const strengthTag = conf >= 0.7 ? 0 : conf >= 0.4 ? 1 : 2;

  return {
    strategy: 1,
    symbol: data.symbol,
    side,
    strength: { TAG: strengthTag, _0: conf },
    target_price: shortTermPrice,
    max_position_pct: regime === 3 ? 0.03 : 0.06,
    timestamp: Date.now(),
  };
}

const sectorRotation: StrategyModule = {
  id: 1,
  name: 'Sector_rotation',
  minBars: 50,
  generate,
};

export default sectorRotation;
