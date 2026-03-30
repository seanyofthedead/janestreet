'use client';

import { useStrategies } from '@/lib/hooks/use-trading-data';
import type { StrategyMetrics } from '@/lib/api';

function HealthDot({ healthy }: { healthy: boolean }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${healthy ? 'bg-green-400' : 'bg-red-400'}`}
      title={healthy ? 'Healthy' : 'Unhealthy'}
    />
  );
}

function StrategyCard({ strategy }: { strategy: StrategyMetrics }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HealthDot healthy={strategy.healthy} />
          <h3 className="font-medium text-white text-sm">{strategy.name}</h3>
        </div>
        <span className="text-xs text-gray-500 capitalize">{strategy.maturity}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-gray-500">Sharpe</p>
          <p className="font-semibold text-white">{strategy.sharpe.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-gray-500">Win Rate</p>
          <p className="font-semibold text-white">{(strategy.win_rate * 100).toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-gray-500">Signals</p>
          <p className="font-semibold text-white">{strategy.signal_count}</p>
        </div>
        <div>
          <p className="text-gray-500">PnL</p>
          <p className={`font-semibold ${strategy.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {strategy.pnl >= 0 ? '+' : ''}${strategy.pnl.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-gray-500">Allocation</p>
          <p className="font-semibold text-white">{strategy.allocation_pct.toFixed(1)}%</p>
        </div>
      </div>
    </div>
  );
}

export function StrategyPanel() {
  const { data: strategies, isLoading, error } = useStrategies();

  if (isLoading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Strategies</h2>
        <div className="animate-pulse grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-800 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !strategies) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Strategies</h2>
        <p className="text-gray-500 text-sm">Unable to load strategy data</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h2 className="text-sm font-medium text-gray-400 mb-4">
        Strategies
        <span className="ml-2 text-gray-600">({strategies.length})</span>
      </h2>
      {strategies.length === 0 ? (
        <p className="text-gray-500 text-sm">No strategies registered</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {strategies.map((s) => (
            <StrategyCard key={s.id} strategy={s} />
          ))}
        </div>
      )}
    </div>
  );
}
