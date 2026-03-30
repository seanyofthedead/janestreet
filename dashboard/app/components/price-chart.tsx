'use client';

import { useEffect, useRef } from 'react';

interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface TradeMarker {
  time: string;
  position: 'aboveBar' | 'belowBar';
  color: string;
  shape: 'arrowDown' | 'arrowUp';
  text: string;
}

interface PriceChartProps {
  symbol: string;
  candles?: CandleData[];
  trades?: TradeMarker[];
}

export function PriceChart({ symbol, candles = [], trades = [] }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof import('lightweight-charts').createChart> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let mounted = true;

    // Dynamic import for SSR safety
    import('lightweight-charts').then(({ createChart, ColorType }) => {
      if (!mounted || !containerRef.current) return;

      // Clean up previous chart
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }

      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: '#111827' },
          textColor: '#9CA3AF',
        },
        grid: {
          vertLines: { color: '#1F2937' },
          horzLines: { color: '#1F2937' },
        },
        width: containerRef.current.clientWidth,
        height: 300,
        crosshair: {
          mode: 0,
        },
        timeScale: {
          borderColor: '#374151',
          timeVisible: true,
        },
        rightPriceScale: {
          borderColor: '#374151',
        },
      });

      chartRef.current = chart;

      const candleSeries = chart.addCandlestickSeries({
        upColor: '#22C55E',
        downColor: '#EF4444',
        borderDownColor: '#EF4444',
        borderUpColor: '#22C55E',
        wickDownColor: '#EF4444',
        wickUpColor: '#22C55E',
      });

      if (candles.length > 0) {
        candleSeries.setData(candles as Parameters<typeof candleSeries.setData>[0]);
      }

      if (trades.length > 0) {
        candleSeries.setMarkers(trades as Parameters<typeof candleSeries.setMarkers>[0]);
      }

      chart.timeScale().fitContent();

      // Resize observer
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width } = entry.contentRect;
          chart.applyOptions({ width });
        }
      });
      ro.observe(containerRef.current);

      return () => {
        ro.disconnect();
      };
    });

    return () => {
      mounted = false;
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [candles, trades]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h2 className="text-sm font-medium text-gray-400 mb-4">{symbol} Price Chart</h2>
      <div ref={containerRef} className="w-full" />
      {candles.length === 0 && (
        <div className="flex items-center justify-center h-[300px] text-gray-600 text-sm">
          No chart data available
        </div>
      )}
    </div>
  );
}
