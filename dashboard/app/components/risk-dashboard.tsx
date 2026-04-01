'use client';

import { useWatchdogStatus } from '@/lib/hooks/use-trading-data';
import { useAccount } from '@/lib/hooks/use-trading-data';

function StatusIndicator({ status }: { status: string }) {
  const colors: Record<string, string> = {
    healthy: 'bg-green-500',
    degraded: 'bg-yellow-500 animate-pulse',
    critical: 'bg-red-500 animate-pulse',
    'kill-triggered': 'bg-red-600 animate-pulse',
  };
  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded-full ${colors[status] ?? 'bg-gray-500'}`} />
      <span className="text-xs text-gray-300 capitalize">{status.replace('-', ' ')}</span>
    </div>
  );
}

function EnginePhaseIndicator({ phase }: { phase: string | null }) {
  const phaseColors: Record<string, string> = {
    Trading: 'bg-green-500',
    Off_hours: 'bg-gray-500',
    Halted: 'bg-red-500 animate-pulse',
    Cooldown: 'bg-yellow-500',
    Warming_up: 'bg-blue-500',
    Starting: 'bg-blue-500',
  };
  const label = phase ? phase.replace(/_/g, ' ') : 'Unknown';
  const color = phase ? (phaseColors[phase] ?? 'bg-gray-500') : 'bg-gray-500';
  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded-full ${color}`} />
      <span className="text-xs text-gray-300">{label}</span>
    </div>
  );
}

export function RiskDashboard() {
  const { data: status, isLoading: wdLoading, error: wdError } = useWatchdogStatus();
  const { data: account } = useAccount();

  if (wdLoading) {
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

  if (wdError || !status) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Risk Monitor</h2>
        <p className="text-gray-500 text-sm">Unable to load watchdog status</p>
      </div>
    );
  }

  const isKilled = status.status === 'kill-triggered';
  const dailyPnl = status.dailyPnl ?? account?.daily_pnl ?? 0;
  const equity = account?.equity ?? 0;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-gray-400">Risk Monitor</h2>
        {isKilled && (
          <span className="px-2 py-1 text-xs bg-red-900/80 text-red-300 border border-red-700 rounded animate-pulse">
            KILL SWITCH ACTIVE
          </span>
        )}
      </div>

      <div className="space-y-4">
        {/* Watchdog Status */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Watchdog</span>
          <StatusIndicator status={status.status} />
        </div>

        {/* Engine Phase */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Engine Phase</span>
          <EnginePhaseIndicator phase={status.enginePhase ?? null} />
        </div>

        {/* Last Check */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Last Check</span>
          <span className="text-xs text-gray-300 font-mono">
            {new Date(status.lastCheckTime).toLocaleTimeString()}
          </span>
        </div>

        {/* Missed Heartbeats */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Missed Heartbeats</span>
          <span className={`text-sm font-semibold ${status.consecutiveMisses > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
            {status.consecutiveMisses}
          </span>
        </div>

        <div className="pt-2 border-t border-gray-800" />

        {/* Daily P&L */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Daily P&L</span>
          <span className={`text-sm font-semibold font-mono ${dailyPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {dailyPnl >= 0 ? '+' : ''}${dailyPnl.toFixed(2)}
          </span>
        </div>

        {/* Equity */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Equity</span>
          <span className="text-sm font-semibold text-white font-mono">
            ${equity.toFixed(2)}
          </span>
        </div>

        {/* Order Rate */}
        {status.orderRate !== null && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Order Rate</span>
            <span className="text-sm font-semibold text-white font-mono">
              {status.orderRate.toFixed(1)}/min
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
