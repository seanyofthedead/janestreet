import { describe, it, expect } from 'vitest';
import {
  annualizedRealizedVol,
  trendStrength,
  PERIODS_PER_YEAR_1MIN,
  PERIODS_PER_YEAR_DAILY,
} from '../src/regime-helpers.js';

describe('regime-helpers', () => {
  describe('annualizedRealizedVol', () => {
    it('returns 0 for fewer than 2 closes', () => {
      expect(annualizedRealizedVol([])).toBe(0);
      expect(annualizedRealizedVol([100])).toBe(0);
    });

    it('returns 0 for constant prices', () => {
      const closes = Array.from({ length: 21 }, () => 100);
      expect(annualizedRealizedVol(closes)).toBe(0);
    });

    it('scale invariance: 1-min and daily annualization produce similar vol', () => {
      // Generate 21 daily closes with ~1% daily moves
      const dailyCloses = [100];
      for (let i = 1; i <= 20; i++) {
        dailyCloses.push(dailyCloses[i - 1] * (i % 2 === 0 ? 1.01 : 0.99));
      }
      const dailyVol = annualizedRealizedVol(dailyCloses, PERIODS_PER_YEAR_DAILY);

      // Same data interpreted as 1-min bars (not realistic but tests the math)
      const minuteVol = annualizedRealizedVol(dailyCloses, PERIODS_PER_YEAR_1MIN);

      // 1-min annualization is sqrt(390) times larger for the same return series
      const ratio = minuteVol / dailyVol;
      expect(ratio).toBeCloseTo(Math.sqrt(390), 1);
    });

    it('1-min bars: alternating small moves produce moderate vol', () => {
      // Simulate 1-min bars with ~0.05% moves (typical intraday)
      const closes = [100];
      for (let i = 1; i <= 20; i++) {
        closes.push(closes[i - 1] * (i % 2 === 0 ? 1.0005 : 0.9995));
      }
      const vol = annualizedRealizedVol(closes); // default: 1-min periods
      // ~0.05% per minute * sqrt(98280) ≈ ~15.7% annualized
      expect(vol).toBeGreaterThan(0.10);
      expect(vol).toBeLessThan(0.25);
    });

    it('1-min bars: large moves produce high vol', () => {
      // Simulate 1-min bars with ~0.15% moves (volatile intraday)
      const closes = [100];
      for (let i = 1; i <= 20; i++) {
        closes.push(closes[i - 1] * (i % 2 === 0 ? 1.0015 : 0.9985));
      }
      const vol = annualizedRealizedVol(closes); // default: 1-min periods
      expect(vol).toBeGreaterThan(0.30);
    });

    it('defaults to PERIODS_PER_YEAR_1MIN', () => {
      const closes = [100, 101, 100, 101, 100];
      const defaultVol = annualizedRealizedVol(closes);
      const explicitVol = annualizedRealizedVol(closes, PERIODS_PER_YEAR_1MIN);
      expect(defaultVol).toBe(explicitVol);
    });
  });

  describe('trendStrength', () => {
    it('returns 0 for fewer than 2 closes', () => {
      expect(trendStrength([])).toBe(0);
      expect(trendStrength([100])).toBe(0);
    });

    it('returns 0 for constant prices (zero vol)', () => {
      const closes = Array.from({ length: 21 }, () => 100);
      expect(trendStrength(closes)).toBe(0);
    });

    it('strong uptrend has high trend strength', () => {
      // Steady increase — directional move dominates vol
      const closes = [100];
      for (let i = 1; i <= 20; i++) {
        closes.push(closes[i - 1] * 1.001);
      }
      const trend = trendStrength(closes);
      expect(trend).toBeGreaterThan(1.0);
    });

    it('choppy sideways has low trend strength', () => {
      // Alternating up/down with no net direction
      const closes = [100];
      for (let i = 1; i <= 20; i++) {
        closes.push(closes[i - 1] * (i % 2 === 0 ? 1.001 : 0.999));
      }
      const trend = trendStrength(closes);
      expect(trend).toBeLessThan(0.5);
    });

    it('defaults to PERIODS_PER_YEAR_1MIN', () => {
      const closes = [100, 101, 102, 103, 104];
      const defaultTrend = trendStrength(closes);
      const explicitTrend = trendStrength(closes, PERIODS_PER_YEAR_1MIN);
      expect(defaultTrend).toBe(explicitTrend);
    });
  });
});
