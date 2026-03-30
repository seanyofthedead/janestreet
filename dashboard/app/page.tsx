'use client';

import { useEngineEvents } from '@/lib/hooks/use-engine-events';
import { useAccount } from '@/lib/hooks/use-trading-data';
import { PortfolioSummary } from './components/portfolio-summary';
import { PositionTable } from './components/position-table';
import { OrderBlotter } from './components/order-blotter';
import { StrategyPanel } from './components/strategy-panel';
import { RiskDashboard } from './components/risk-dashboard';
import { PriceChart } from './components/price-chart';
import { KillSwitchButton } from './components/kill-switch-button';
import { PnlChart } from './components/pnl-chart';

function EngineStatusBanner() {
  const { data: account, isLoading, error } = useAccount();

  let statusColor = 'bg-yellow-900/50 border-yellow-700 text-yellow-300';
  let statusText = 'Connecting...';

  if (error) {
    statusColor = 'bg-red-900/50 border-red-700 text-red-300';
    statusText = 'Engine Offline';
  } else if (account) {
    statusColor = 'bg-green-900/50 border-green-700 text-green-300';
    statusText = `Engine Online | ${account.status ?? 'Active'} | ${account.phase} Phase`;
  } else if (isLoading) {
    statusText = 'Connecting to engine...';
  }

  return (
    <div className={`px-4 py-2 rounded-lg border text-sm font-medium ${statusColor}`}>
      <div className="flex items-center gap-2">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            error ? 'bg-red-400' : account ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'
          }`}
        />
        {statusText}
      </div>
    </div>
  );
}

export default function Home() {
  // Subscribe to SSE events for real-time cache updates
  useEngineEvents();

  return (
    <main className="p-4 md:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Trading Dashboard</h1>
          <p className="text-sm text-gray-500">Jane Street Autonomous Trading Agent</p>
        </div>
        <EngineStatusBanner />
      </div>

      {/* Top row: Portfolio + Risk + Kill Switch */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PortfolioSummary />
        </div>
        <div className="space-y-6">
          <KillSwitchButton />
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PriceChart symbol="SPY" />
        <PnlChart />
      </div>

      {/* Risk + Strategies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RiskDashboard />
        <StrategyPanel />
      </div>

      {/* Positions + Orders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PositionTable />
        <OrderBlotter />
      </div>
    </main>
  );
}
