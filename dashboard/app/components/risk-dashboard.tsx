'use client';

import { useWatchdogStatus } from '@/lib/hooks/use-trading-data';

function ProgressBar({
  label,
  value,
  limit,
  unit = '%',
  invertColor = false,
}: {
  label: string;
  value: number;
  limit: number;
  unit?: string;
  invertColor?: boolean;
}) {
  const pct = limit > 0 ? Math.min((value / limit) * 100, 100) : 0;
  let barColor: string;
  if (invertColor) {
    // Lower is worse (e.g., cash reserve)
    barColor = pct > 50 ? 'bg-green-500' : pct > 25 ? 'bg-yellow-500' : 'bg-red-500';
  } else {
    // Higher is worse (e.g., drawdown, loss)
    barColor = pct < 50 ? 'bg-green-500' : pct < 80 ? 'bg-yellow-500' : 'bg-red-500';
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-mono">
          {value.toFixed(1)}{unit} / {limit.toFixed(1)}{unit}
        </span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function CircuitBreakerIndicator({ triggered, label }: { triggered: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-3 h-3 rounded-full ${triggered ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`}
      />
      <span className="text-xs text-gray-300">{label}</span>
    </div>
  );
}

export function RiskDashboard() {
  const { data: status, isLoading, error } = useWatchdogStatus();

  if (isLoading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Risk Monitor</h2>
        <div className="animate-pulse space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-6 bg-gray-800 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Risk Monitor</h2>
        <p className="text-gray-500 text-sm">Unable to load watchdog status</p>
      </div>
    );
  }

  const cb = status.circuit_breakers;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-gray-400">Risk Monitor</h2>
        {status.kill_switch_active && (
          <span className="px-2 py-1 text-xs bg-red-900/80 text-red-300 border border-red-700 rounded animate-pulse">
            KILL SWITCH ACTIVE
          </span>
        )}
      </div>

      <div className="space-y-4">
        <ProgressBar
          label="Drawdown"
          value={cb.drawdown_pct}
          limit={cb.drawdown_limit}
        />
        <ProgressBar
          label="Daily Loss"
          value={cb.daily_loss_pct}
          limit={cb.daily_loss_limit}
        />
        <ProgressBar
          label="Exposure"
          value={cb.exposure_pct}
          limit={cb.exposure_limit}
        />
        <ProgressBar
          label="Cash Reserve"
          value={cb.cash_reserve_pct}
          limit={cb.cash_reserve_min}
          invertColor
        />

        <div className="pt-2 border-t border-gray-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">PDT Trades Remaining</span>
            <span className={`text-sm font-semibold ${cb.pdt_trades_remaining <= 1 ? 'text-red-400' : cb.pdt_trades_remaining <= 2 ? 'text-yellow-400' : 'text-green-400'}`}>
              {cb.pdt_trades_remaining}
            </span>
          </div>
        </div>

        <div className="pt-2 border-t border-gray-800 space-y-2">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Circuit Breakers</p>
          <CircuitBreakerIndicator
            triggered={cb.any_triggered}
            label={cb.any_triggered ? 'Breaker Triggered' : 'All Clear'}
          />
        </div>
      </div>
    </div>
  );
}
