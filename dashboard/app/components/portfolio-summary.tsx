'use client';

import { useAccount } from '@/lib/hooks/use-trading-data';
import { Tooltip } from '@/app/components/ui/tooltip';
import { PORTFOLIO_HINTS } from '@/lib/constants';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value);
}

function PnlText({ value }: { value: number }) {
  const color = value >= 0 ? 'text-green-400' : 'text-red-400';
  const sign = value >= 0 ? '+' : '';
  return (
    <span className={color}>
      {sign}{formatCurrency(value)}
    </span>
  );
}

export function PortfolioSummary() {
  const { data: account, isLoading, error } = useAccount();

  if (isLoading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Portfolio Summary</h2>
        <div className="animate-pulse space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-6 bg-gray-800 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Portfolio Summary</h2>
        <p className="text-gray-500 text-sm">Unable to load account data</p>
      </div>
    );
  }

  const cards = [
    { label: 'Total Equity', value: formatCurrency(account.equity) },
    { label: 'Cash', value: formatCurrency(account.cash) },
    { label: 'Buying Power', value: formatCurrency(account.buying_power) },
    { label: 'Daily PnL', value: <PnlText value={account.daily_pnl} /> },
    { label: 'Total PnL', value: <PnlText value={account.total_pnl} /> },
    { label: 'Account Phase', value: <span className="text-blue-400">{account.phase}</span> },
  ];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h2 className="text-sm font-medium text-gray-400 mb-4">Portfolio Summary</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="space-y-1">
            <Tooltip hint={PORTFOLIO_HINTS[card.label] ?? card.label}>
              <p className="text-xs text-gray-500 uppercase tracking-wide">{card.label}</p>
            </Tooltip>
            <p className="text-lg font-semibold">{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
