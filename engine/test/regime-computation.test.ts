import { describe, it, expect } from 'vitest';
import { aggregateToDailyCloses, annualizedRealizedVol, trendStrength } from '../src/regime-helpers.js';

describe('regime-helpers', () => {
  describe('aggregateToDailyCloses', () => {
    it('extracts last close from each barsPerDay-sized chunk', () => {
      // 780 bars with barsPerDay=390 → 2 daily closes
      const bars = Array.from({ length: 780 }, (_, i) => ({ c: 100 + i * 0.01 }));
      const daily = aggregateToDailyCloses(bars, 390);
      expect(daily).toHaveLength(2);
      expect(daily[0]).toBeCloseTo(bars[389].c);
      expect(daily[1]).toBeCloseTo(bars[779].c);
    });

    it('returns 1 close for exactly 390 bars', () => {
      const bars = Array.from({ length: 390 }, (_, i) => ({ c: 100 + i * 0.01 }));
      const daily = aggregateToDailyCloses(bars, 390);
      expect(daily).toHaveLength(1);
      expect(daily[0]).toBeCloseTo(bars[389].c);
    });

    it('returns empty for fewer than barsPerDay bars', () => {
      const bars = Array.from({ length: 100 }, () => ({ c: 100 }));
      const daily = aggregateToDailyCloses(bars, 390);
      expect(daily).toHaveLength(0);
    });

    it('ignores incomplete trailing chunk', () => {
      // 500 bars: 1 full chunk of 390, trailing 110 bars ignored
      const bars = Array.from({ length: 500 }, (_, i) => ({ c: 100 + i * 0.01 }));
      const daily = aggregateToDailyCloses(bars, 390);
      expect(daily).toHaveLength(1);
    });
  });

  describe('annualizedRealizedVol', () => {
    it('returns 0 for fewer than 2 closes', () => {
      expect(annualizedRealizedVol([])).toBe(0);
      expect(annualizedRealizedVol([100])).toBe(0);
    });

    it('returns 0 for constant prices', () => {
      const closes = Array.from({ length: 21 }, () => 100);
      expect(annualizedRealizedVol(closes)).toBe(0);
    });

    it('computes expected vol for known sequence', () => {
      // Alternating 1% up/down daily returns
      const closes = [100];
      for (let i = 1; i <= 20; i++) {
        closes.push(closes[i - 1] * (i % 2 === 0 ? 1.01 : 0.99));
      }
      const vol = annualizedRealizedVol(closes);
      // log(1.01) ≈ 0.00995, log(0.99) ≈ -0.01005
      // daily std ≈ 0.01, annualized ≈ 0.01 * sqrt(252) ≈ 0.159
      expect(vol).toBeGreaterThan(0.1);
      expect(vol).toBeLessThan(0.25);
    });

    it('high-vol sequence produces vol > 0.30', () => {
      // 5% daily swings
      const closes = [100];
      for (let i = 1; i <= 20; i++) {
        closes.push(closes[i - 1] * (i % 2 === 0 ? 1.05 : 0.95));
      }
      const vol = annualizedRealizedVol(closes);
      expect(vol).toBeGreaterThan(0.30);
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
      // Steady 1% daily increase
      const closes = [100];
      for (let i = 1; i <= 20; i++) {
        closes.push(closes[i - 1] * 1.01);
      }
      const trend = trendStrength(closes);
      expect(trend).toBeGreaterThan(1.0);
    });

    it('choppy sideways has low trend strength', () => {
      // Alternating up/down with no net direction
      const closes = [100];
      for (let i = 1; i <= 20; i++) {
        closes.push(closes[i - 1] * (i % 2 === 0 ? 1.02 : 0.98));
      }
      const trend = trendStrength(closes);
      expect(trend).toBeLessThan(0.5);
    });
  });
});
