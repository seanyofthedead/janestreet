'use client';

import { useEffect, useRef } from 'react';
import { useBars } from '@/lib/hooks/use-trading-data';

interface PriceChartProps {
  symbol: string;
}

export function PriceChart({ symbol }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof import('lightweight-charts').createChart> | null>(null);
  const { data: candles, isLoading } = useBars(symbol);

  useEffect(() => {
    if (!containerRef.current || !candles || candles.length === 0) return;

    let mounted = true;

    import('lightweight-charts').then(({ createChart, ColorType }) => {
      if (!mounted || !containerRef.current) return;

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

      candleSeries.setData(candles as Parameters<typeof candleSeries.setData>[0]);
      chart.timeScale().fitContent();

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
  }, [candles]);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h2 className="text-sm font-medium text-gray-400 mb-4">{symbol} Price Chart</h2>
      <div ref={containerRef} className="w-full" />
      {isLoading && (
        <div className="flex items-center justify-center h-[300px] text-gray-600 text-sm">
          Loading chart data...
        </div>
      )}
      {!isLoading && (!candles || candles.length === 0) && (
        <div className="flex items-center justify-center h-[300px] text-gray-600 text-sm">
          Price chart will appear once market data is available
        </div>
      )}
    </div>
  );
}
