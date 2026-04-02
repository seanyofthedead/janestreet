'use client';

import { usePositions } from '@/lib/hooks/use-trading-data';
import { Tooltip } from '@/app/components/ui/tooltip';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value);
}

export function PositionTable() {
  const { data: positions, isLoading, error } = usePositions();

  if (isLoading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Positions</h2>
        <div className="animate-pulse space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-8 bg-gray-800 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !positions) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Positions</h2>
        <p className="text-gray-500 text-sm">Unable to load positions</p>
      </div>
    );
  }

  const sorted = [...positions].sort((a, b) => b.unrealized_pnl - a.unrealized_pnl);

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h2 className="text-sm font-medium text-gray-400 mb-4">
        Positions
        <span className="ml-2 text-gray-600">({positions.length})</span>
      </h2>
      {positions.length === 0 ? (
        <p className="text-gray-500 text-sm">No open positions. Strategies will open positions when market opportunities are identified.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs uppercase tracking-wide border-b border-gray-800">
                <th className="text-left pb-2 pr-4"><Tooltip hint="Ticker symbol of the held security">Symbol</Tooltip></th>
                <th className="text-right pb-2 pr-4"><Tooltip hint="Number of shares held">Qty</Tooltip></th>
                <th className="text-right pb-2 pr-4"><Tooltip hint="Average price paid per share">Avg Entry</Tooltip></th>
                <th className="text-right pb-2 pr-4"><Tooltip hint="Latest market price per share">Current</Tooltip></th>
                <th className="text-right pb-2 pr-4"><Tooltip hint="Unrealized profit/loss on this position">Unrealized PnL</Tooltip></th>
                <th className="text-right pb-2"><Tooltip hint="Position value as percentage of total portfolio">% Portfolio</Tooltip></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((pos) => (
                <tr key={pos.symbol} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-2 pr-4 font-medium text-white">{pos.symbol}</td>
                  <td className="py-2 pr-4 text-right">{pos.qty}</td>
                  <td className="py-2 pr-4 text-right">{formatCurrency(pos.avg_entry_price)}</td>
                  <td className="py-2 pr-4 text-right">{formatCurrency(pos.current_price)}</td>
                  <td className={`py-2 pr-4 text-right font-medium ${pos.unrealized_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {pos.unrealized_pnl >= 0 ? '+' : ''}{formatCurrency(pos.unrealized_pnl)}
                  </td>
                  <td className="py-2 text-right text-gray-400">
                    {pos.pct_of_portfolio.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
