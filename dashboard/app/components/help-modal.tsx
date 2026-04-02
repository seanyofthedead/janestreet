'use client';

import { useState } from 'react';
import { Modal } from '@/app/components/ui/modal';
import { STRATEGY_PHASES } from '@/lib/constants';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
      <div className="text-sm text-gray-300 space-y-2">{children}</div>
    </div>
  );
}

function HelpContent() {
  return (
    <div className="space-y-1">
      <Section title="System Overview">
        <p>
          This dashboard monitors an autonomous multi-strategy trading agent running on Alpaca paper trading.
          The system consists of:
        </p>
        <ul className="list-disc list-inside text-gray-400 space-y-1">
          <li><strong className="text-gray-300">Engine</strong> — Executes trading strategies, manages positions, and submits orders</li>
          <li><strong className="text-gray-300">Watchdog</strong> — Independent process monitoring engine health with kill-switch capability</li>
          <li><strong className="text-gray-300">Strategies</strong> — Five signal generators: Mean Reversion, Momentum, Sector Rotation, Calendar Seasonal, Market Making</li>
          <li><strong className="text-gray-300">Risk Management</strong> — OCaml-based risk evaluation with position limits, drawdown controls, and order rate limits</li>
        </ul>
      </Section>

      <Section title="Strategy States">
        <div className="space-y-2">
          {STRATEGY_PHASES.map((phase) => (
            <div key={phase.key} className="flex gap-2">
              <span className="font-medium text-gray-200 min-w-[100px]">{phase.label}:</span>
              <span className="text-gray-400">{phase.description}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Key Metrics">
        <dl className="space-y-2">
          <div><dt className="font-medium text-gray-200 inline">Sharpe Ratio:</dt> <dd className="inline text-gray-400">Risk-adjusted return. Above 1.0 is good, above 2.0 is excellent.</dd></div>
          <div><dt className="font-medium text-gray-200 inline">Win Rate:</dt> <dd className="inline text-gray-400">Percentage of trades that were profitable.</dd></div>
          <div><dt className="font-medium text-gray-200 inline">Allocation %:</dt> <dd className="inline text-gray-400">Portion of portfolio allocated to a strategy.</dd></div>
          <div><dt className="font-medium text-gray-200 inline">PnL:</dt> <dd className="inline text-gray-400">Profit and loss, shown per-strategy and in aggregate.</dd></div>
          <div><dt className="font-medium text-gray-200 inline">Drawdown:</dt> <dd className="inline text-gray-400">Peak-to-trough decline. Triggers position reduction at 10% and flattening at 20%.</dd></div>
        </dl>
      </Section>

      <Section title="Kill Switch">
        <p>
          The kill switch is a two-step safety mechanism. First arm it, then confirm activation.
          When triggered, the watchdog halts all trading, cancels open orders, and prevents new orders.
          The engine must be manually restarted and acknowledged to resume trading.
        </p>
      </Section>

      <Section title="Risk Monitor">
        <dl className="space-y-2">
          <div><dt className="font-medium text-gray-200 inline">Missed Heartbeats:</dt> <dd className="inline text-gray-400">Number of consecutive missed engine health checks. 0 is normal; &gt;3 triggers alerts.</dd></div>
          <div><dt className="font-medium text-gray-200 inline">Daily PnL:</dt> <dd className="inline text-gray-400">Monitored against a -5% daily loss limit that triggers automatic risk reduction.</dd></div>
          <div><dt className="font-medium text-gray-200 inline">Order Rate:</dt> <dd className="inline text-gray-400">Orders per minute. Capped at 5-20 depending on account phase.</dd></div>
        </dl>
      </Section>
    </div>
  );
}

export function HelpButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="w-8 h-8 rounded-full border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 flex items-center justify-center text-sm font-medium transition-colors"
        aria-label="Open help"
      >
        ?
      </button>
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Dashboard Help">
        <HelpContent />
      </Modal>
    </>
  );
}
