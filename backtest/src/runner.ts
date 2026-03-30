/**
 * Core backtest runner.
 * Feeds bars one-at-a-time through Melange-compiled signal modules,
 * runs signals through OCaml risk engine, simulates fills at next bar's open.
 * No look-ahead bias: only past/current bars are available to signal generators.
 */

import type { Bar } from './data-loader.js';
import type { Trade } from './metrics.js';
import { computeMetrics, type MetricsSummary } from './metrics.js';
import {
  type Phase,
  type Strategy,
  determinePhase,
  isStrategyEnabled,
  getMaxPositions,
} from './phase-simulator.js';
import {
  type PdtTracker,
  createPdtTracker,
  addDayTrade,
  updateEquity,
  toOCaml,
  canDayTrade,
} from './pdt-tracker.js';

// Melange-compiled modules
// @ts-expect-error Melange-compiled JS has no type declarations
import { evaluate as riskEvaluate } from '../../trading-core-js/trading-core/lib/risk.js';
// @ts-expect-error Melange-compiled JS has no type declarations
import { default_for_phase } from '../../trading-core-js/trading-core/lib/risk_config.js';
// @ts-expect-error Melange-compiled JS has no type declarations
import { generate as momentumGenerate } from '../../trading-core-js/trading-core/lib/signals/momentum.js';
// @ts-expect-error Melange-compiled JS has no type declarations
import { generate as meanRevGenerate } from '../../trading-core-js/trading-core/lib/signals/mean_reversion.js';
// @ts-expect-error Melange-compiled JS has no type declarations
import { is_actionable, compare_priority } from '../../trading-core-js/trading-core/lib/signal.js';
// @ts-expect-error Melange-compiled JS has no type declarations
import { ema, rsi, bollinger_bands, z_score, hurst_exponent, adf_statistic } from '../../trading-core-js/trading-core/lib/indicators.js';
// @ts-expect-error Melange-compiled JS has no type declarations
import { of_float as money_of_float, to_float as money_to_float } from '../../trading-core-js/trading-core/lib/money.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BacktestConfig {
  symbols: string[];
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  phase?: Phase;
  strategies: Strategy[];
  /** Commission per share (default 0) */
  commissionPerShare?: number;
  /** Slippage as fraction of price (default 0.0005) */
  slippagePct?: number;
}

export interface BacktestResult {
  equityCurve: number[];
  trades: Trade[];
  metrics: MetricsSummary;
  finalEquity: number;
}

/** Internal position tracking during backtest */
interface SimPosition {
  symbol: string;
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  strategy: Strategy;
  entryTime: number;
}

/** Pending order to fill at next bar's open */
interface PendingOrder {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  strategy: Strategy;
  signalTime: number;
}

/** Indicator state per symbol */
interface IndicatorState {
  closes: number[];
  volumes: number[];
  ema12: number;
  ema26: number;
  prevEma12: number;
  prevEma26: number;
  sma50: number;
  sma200: number;
  rsi14Gains: number;
  rsi14Losses: number;
  sma20: number;
  stdDev20: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sma(values: number[], period: number): number {
  if (values.length < period) return values[values.length - 1] ?? 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function stdDev(values: number[], period: number): number {
  if (values.length < period) return 0;
  const slice = values.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
  return Math.sqrt(variance);
}

function computeRsiComponents(
  closes: number[],
  period: number,
): { avgGain: number; avgLoss: number } {
  if (closes.length < period + 1) return { avgGain: 0, avgLoss: 0 };
  const recent = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < recent.length; i++) {
    const change = recent[i] - recent[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  return { avgGain: gains / period, avgLoss: losses / period };
}

function relativeVolume(volumes: number[], period: number): number {
  if (volumes.length < period + 1) return 1.0;
  const avg = volumes.slice(-(period + 1), -1).reduce((a, b) => a + b, 0) / period;
  return avg === 0 ? 0 : volumes[volumes.length - 1] / avg;
}

function initIndicatorState(): IndicatorState {
  return {
    closes: [],
    volumes: [],
    ema12: 0,
    ema26: 0,
    prevEma12: 0,
    prevEma26: 0,
    sma50: 0,
    sma200: 0,
    rsi14Gains: 0,
    rsi14Losses: 0,
    sma20: 0,
    stdDev20: 0,
  };
}

function updateIndicators(state: IndicatorState, bar: Bar): IndicatorState {
  const closes = [...state.closes, bar.close];
  const volumes = [...state.volumes, bar.volume];

  const prevEma12 = state.ema12;
  const prevEma26 = state.ema26;

  const ema12Val =
    closes.length === 1
      ? bar.close
      : ema(12.0, state.ema12 || bar.close, bar.close);
  const ema26Val =
    closes.length === 1
      ? bar.close
      : ema(26.0, state.ema26 || bar.close, bar.close);

  const sma50Val = sma(closes, 50);
  const sma200Val = sma(closes, 200);
  const sma20Val = sma(closes, 20);
  const std20 = stdDev(closes, 20);

  const { avgGain, avgLoss } = computeRsiComponents(closes, 14);

  return {
    closes,
    volumes,
    ema12: ema12Val,
    ema26: ema26Val,
    prevEma12,
    prevEma26,
    sma50: sma50Val,
    sma200: sma200Val,
    rsi14Gains: avgGain,
    rsi14Losses: avgLoss,
    sma20: sma20Val,
    stdDev20: std20,
  };
}

/**
 * Build a Melange-style portfolio record for passing to risk.evaluate.
 */
function buildOCamlPortfolio(
  cash: number,
  equity: number,
  positions: SimPosition[],
) {
  let positionList: unknown = 0; // empty list
  for (let i = positions.length - 1; i >= 0; i--) {
    const p = positions[i];
    positionList = {
      hd: {
        symbol: p.symbol,
        qty: p.qty,
        avg_entry_price: p.avgEntryPrice,
        current_price: p.currentPrice,
        strategy_id: p.strategy,
        opened_at: p.entryTime,
      },
      tl: positionList,
    };
  }
  return {
    positions: positionList,
    cash: money_of_float(cash),
    equity: money_of_float(equity),
    buying_power: money_of_float(cash), // simplified: buying_power = cash
    daily_pnl: money_of_float(0),
    total_pnl: money_of_float(0),
  };
}

// ---------------------------------------------------------------------------
// Main backtest loop
// ---------------------------------------------------------------------------

export function runBacktest(
  config: BacktestConfig,
  barsBySymbol: Map<string, Bar[]>,
): BacktestResult {
  const {
    initialCapital,
    strategies,
    commissionPerShare = 0,
    slippagePct = 0.0005,
  } = config;

  // State
  let cash = initialCapital;
  const positions: SimPosition[] = [];
  const completedTrades: Trade[] = [];
  const equityCurve: number[] = [initialCapital];
  let pdtTracker: PdtTracker = createPdtTracker(initialCapital);
  let peakEquity = initialCapital;
  const pendingOrders: PendingOrder[] = [];

  // Indicator state per symbol
  const indicatorStates = new Map<string, IndicatorState>();
  for (const sym of config.symbols) {
    indicatorStates.set(sym, initIndicatorState());
  }

  // Merge all bars into a single sorted timeline
  const allBars: Array<{ symbol: string; bar: Bar }> = [];
  for (const [symbol, bars] of barsBySymbol) {
    for (const bar of bars) {
      allBars.push({ symbol, bar });
    }
  }
  allBars.sort((a, b) => a.bar.timestamp - b.bar.timestamp);

  // Warmup: need at least 200 bars for SMA200
  const warmupBars = new Map<string, number>();
  for (const sym of config.symbols) {
    warmupBars.set(sym, 0);
  }

  const WARMUP_PERIOD = 200;

  for (const { symbol, bar } of allBars) {
    // 1. Fill pending orders at this bar's open price (pessimistic fill)
    fillPendingOrders(
      symbol,
      bar,
      pendingOrders,
      positions,
      completedTrades,
      () => cash,
      (v: number) => { cash = v; },
      pdtTracker,
      (t: PdtTracker) => { pdtTracker = t; },
      commissionPerShare,
      slippagePct,
    );

    // 2. Update indicators with current bar
    const prevState = indicatorStates.get(symbol) ?? initIndicatorState();
    const newState = updateIndicators(prevState, bar);
    indicatorStates.set(symbol, newState);

    // Update position prices
    for (const pos of positions) {
      if (pos.symbol === symbol) {
        pos.currentPrice = bar.close;
      }
    }

    // Track warmup
    const warmupCount = (warmupBars.get(symbol) ?? 0) + 1;
    warmupBars.set(symbol, warmupCount);
    if (warmupCount < WARMUP_PERIOD) continue;

    // 3. Compute equity
    const positionValue = positions.reduce(
      (acc, p) => acc + p.qty * p.currentPrice,
      0,
    );
    const equity = cash + positionValue;
    peakEquity = Math.max(peakEquity, equity);
    pdtTracker = updateEquity(pdtTracker, equity);

    // 4. Determine phase and risk config
    const phase = determinePhase(equity);
    const riskConfig = default_for_phase(phase);

    // 5. Generate signals (no look-ahead: only current/past data)
    const signals: unknown[] = [];

    if (strategies.includes(3 as Strategy) && isStrategyEnabled(phase, 3)) {
      // Momentum signal
      const rsi14 = rsi(newState.rsi14Gains, newState.rsi14Losses);
      const rvol = relativeVolume(newState.volumes, 20);
      const sig = momentumGenerate(
        symbol,
        newState.ema12,
        newState.ema26,
        newState.prevEma12,
        newState.prevEma26,
        newState.sma50,
        newState.sma200,
        rsi14,
        rvol,
        bar.close,
        bar.timestamp,
      );
      if (sig !== undefined) signals.push(sig);
    }

    if (strategies.includes(0 as Strategy) && isStrategyEnabled(phase, 0)) {
      // Mean reversion signal
      const zScore = newState.stdDev20 > 0
        ? z_score(bar.close, newState.sma20, newState.stdDev20)
        : 0;
      const hurstVal = newState.closes.length >= 20
        ? hurst_exponent(
            newState.closes.slice(-50).map((c: number, i: number, arr: number[]) =>
              i === 0 ? 0 : (c - arr[i - 1]) / arr[i - 1]
            ).slice(1),
          )
        : 0.5;
      const adfVal = newState.closes.length >= 20
        ? adf_statistic(newState.closes.slice(-50))
        : 0;
      const bollingerStd = newState.stdDev20;
      const sig = meanRevGenerate(
        symbol,
        bar.close,
        newState.sma20,
        bollinger_bands(newState.sma20, bollingerStd, 2.0),
        zScore,
        adfVal,
        hurstVal,
        bar.timestamp,
      );
      if (sig !== undefined) signals.push(sig);
    }

    // 6. Filter and prioritize signals
    const actionableSignals = signals.filter(s => is_actionable(s));
    actionableSignals.sort((a, b) => compare_priority(a, b));

    // 7. Run each signal through risk engine
    for (const signal of actionableSignals) {
      const sig = signal as {
        strategy: Strategy;
        symbol: string;
        side: number;
        strength: { _0: number };
        target_price: number;
        max_position_pct: number;
        timestamp: number;
      };

      const ocamlPortfolio = buildOCamlPortfolio(cash, equity, positions);
      const ocamlPdt = toOCaml(pdtTracker);

      const riskDecision = riskEvaluate(
        riskConfig,
        ocamlPortfolio,
        signal,
        ocamlPdt,
        phase,
        bar.timestamp,   // last_heartbeat = now (no heartbeat issues in backtest)
        bar.timestamp,   // current_time
        money_of_float(0), // daily_pnl simplified
        money_of_float(peakEquity),
      );

      // riskDecision: 0 = Allow, or { TAG: 1, _0: reason } = Reject, etc.
      if (riskDecision !== 0) continue; // rejected by risk engine

      // Check PDT before day trades
      const side = sig.side === 0 ? 'buy' : 'sell';
      const existingPos = positions.find(p => p.symbol === sig.symbol);
      const isDayTrade = existingPos !== undefined &&
        ((existingPos.qty > 0 && side === 'sell') ||
         (existingPos.qty < 0 && side === 'buy'));

      if (isDayTrade && !canDayTrade(pdtTracker)) continue;

      // Calculate position size: use max_position_pct * equity
      const positionValue = sig.max_position_pct * equity;
      const targetPrice = sig.target_price;
      if (targetPrice <= 0) continue;
      const qty = Math.floor(positionValue / targetPrice);
      if (qty <= 0) continue;

      // Queue order for fill at next bar's open
      pendingOrders.push({
        symbol: sig.symbol,
        side,
        qty,
        strategy: sig.strategy,
        signalTime: bar.timestamp,
      });
    }

    // Record equity at end of this bar
    const finalEquity = cash + positions.reduce(
      (acc, p) => acc + p.qty * p.currentPrice,
      0,
    );
    equityCurve.push(finalEquity);
  }

  // Close any remaining positions at last known price
  for (const pos of [...positions]) {
    const pnl = (pos.currentPrice - pos.avgEntryPrice) * pos.qty;
    cash += pos.currentPrice * pos.qty;
    completedTrades.push({
      symbol: pos.symbol,
      side: pos.qty > 0 ? 'buy' : 'sell',
      entryPrice: pos.avgEntryPrice,
      exitPrice: pos.currentPrice,
      qty: Math.abs(pos.qty),
      entryTime: pos.entryTime,
      exitTime: allBars[allBars.length - 1]?.bar.timestamp ?? 0,
      pnl,
      strategy: strategyName(pos.strategy),
    });
  }
  positions.length = 0;

  const finalEquity = cash;
  equityCurve.push(finalEquity);

  const metrics = computeMetrics(equityCurve, completedTrades);

  return {
    equityCurve,
    trades: completedTrades,
    metrics,
    finalEquity,
  };
}

// ---------------------------------------------------------------------------
// Fill pending orders
// ---------------------------------------------------------------------------

function fillPendingOrders(
  currentSymbol: string,
  bar: Bar,
  pendingOrders: PendingOrder[],
  positions: SimPosition[],
  completedTrades: Trade[],
  getCash: () => number,
  setCash: (v: number) => void,
  pdtTracker: PdtTracker,
  setPdt: (t: PdtTracker) => void,
  commissionPerShare: number,
  slippagePct: number,
): void {
  const toFill = pendingOrders.filter(o => o.symbol === currentSymbol);
  // Remove filled orders from pending
  for (let i = pendingOrders.length - 1; i >= 0; i--) {
    if (pendingOrders[i].symbol === currentSymbol) {
      pendingOrders.splice(i, 1);
    }
  }

  for (const order of toFill) {
    // Fill at bar open with slippage
    const slippage = order.side === 'buy' ? 1 + slippagePct : 1 - slippagePct;
    const fillPrice = bar.open * slippage;
    const commission = order.qty * commissionPerShare;
    const cost = fillPrice * order.qty + commission;
    let cash = getCash();

    const existingIdx = positions.findIndex(p => p.symbol === order.symbol);

    if (order.side === 'buy') {
      if (cost > cash) continue; // not enough cash

      if (existingIdx >= 0 && positions[existingIdx].qty < 0) {
        // Closing short position
        const pos = positions[existingIdx];
        const closeQty = Math.min(order.qty, Math.abs(pos.qty));
        const pnl = (pos.avgEntryPrice - fillPrice) * closeQty - commission;
        cash += pnl + pos.avgEntryPrice * closeQty;
        setCash(cash);

        completedTrades.push({
          symbol: order.symbol,
          side: 'sell',
          entryPrice: pos.avgEntryPrice,
          exitPrice: fillPrice,
          qty: closeQty,
          entryTime: pos.entryTime,
          exitTime: bar.timestamp,
          pnl,
          strategy: strategyName(pos.strategy),
        });

        // Check if this is a day trade
        if (isSameDay(pos.entryTime, bar.timestamp)) {
          setPdt(addDayTrade(pdtTracker, order.symbol, bar.timestamp));
        }

        pos.qty += closeQty;
        if (pos.qty === 0) positions.splice(existingIdx, 1);
      } else {
        // Opening or adding to long position
        cash -= cost;
        setCash(cash);

        if (existingIdx >= 0) {
          const pos = positions[existingIdx];
          const totalQty = pos.qty + order.qty;
          pos.avgEntryPrice =
            (pos.avgEntryPrice * pos.qty + fillPrice * order.qty) / totalQty;
          pos.qty = totalQty;
        } else {
          positions.push({
            symbol: order.symbol,
            qty: order.qty,
            avgEntryPrice: fillPrice,
            currentPrice: fillPrice,
            strategy: order.strategy,
            entryTime: bar.timestamp,
          });
        }
      }
    } else {
      // Sell
      if (existingIdx >= 0 && positions[existingIdx].qty > 0) {
        // Closing long position
        const pos = positions[existingIdx];
        const closeQty = Math.min(order.qty, pos.qty);
        const pnl = (fillPrice - pos.avgEntryPrice) * closeQty - commission;
        cash += fillPrice * closeQty - commission;
        setCash(cash);

        completedTrades.push({
          symbol: order.symbol,
          side: 'buy',
          entryPrice: pos.avgEntryPrice,
          exitPrice: fillPrice,
          qty: closeQty,
          entryTime: pos.entryTime,
          exitTime: bar.timestamp,
          pnl,
          strategy: strategyName(pos.strategy),
        });

        // Check if this is a day trade
        if (isSameDay(pos.entryTime, bar.timestamp)) {
          setPdt(addDayTrade(pdtTracker, order.symbol, bar.timestamp));
        }

        pos.qty -= closeQty;
        if (pos.qty === 0) positions.splice(existingIdx, 1);
      }
      // Note: opening short positions not currently supported in this backtest
    }
  }
}

function isSameDay(t1: number, t2: number): boolean {
  const d1 = new Date(t1);
  const d2 = new Date(t2);
  return (
    d1.getUTCFullYear() === d2.getUTCFullYear() &&
    d1.getUTCMonth() === d2.getUTCMonth() &&
    d1.getUTCDate() === d2.getUTCDate()
  );
}

function strategyName(s: Strategy): string {
  const names: Record<Strategy, string> = {
    0: 'mean_reversion',
    1: 'sector_rotation',
    2: 'calendar_seasonal',
    3: 'momentum',
    4: 'market_making',
  };
  return names[s];
}
