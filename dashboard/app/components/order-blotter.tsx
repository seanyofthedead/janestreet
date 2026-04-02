'use client';

import { useOrders } from '@/lib/hooks/use-trading-data';
import { Tooltip } from '@/app/components/ui/tooltip';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
  filled: 'bg-green-900/50 text-green-300 border-green-700',
  cancelled: 'bg-gray-800 text-gray-400 border-gray-700',
  rejected: 'bg-red-900/50 text-red-300 border-red-700',
  partial: 'bg-blue-900/50 text-blue-300 border-blue-700',
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
  return (
    <span className={`inline-block px-2 py-0.5 text-xs rounded border ${style}`}>
      {status}
    </span>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function formatPrice(price: number | null): string {
  if (price === null || price === undefined) return '--';
  return price.toFixed(2);
}

export function OrderBlotter() {
  const { data: orders, isLoading, error } = useOrders();

  if (isLoading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Order Blotter</h2>
        <div className="animate-pulse space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-8 bg-gray-800 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !orders) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Order Blotter</h2>
        <p className="text-gray-500 text-sm">Unable to load orders</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h2 className="text-sm font-medium text-gray-400 mb-4">
        Order Blotter
        <span className="ml-2 text-gray-600">({orders.length})</span>
      </h2>
      {orders.length === 0 ? (
        <p className="text-gray-500 text-sm">No active orders. Orders appear here when strategies submit trades.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs uppercase tracking-wide border-b border-gray-800">
                <th className="text-left pb-2 pr-3"><Tooltip hint="Time the order was submitted">Time</Tooltip></th>
                <th className="text-left pb-2 pr-3"><Tooltip hint="Ticker symbol">Symbol</Tooltip></th>
                <th className="text-left pb-2 pr-3"><Tooltip hint="Buy or Sell direction">Side</Tooltip></th>
                <th className="text-right pb-2 pr-3"><Tooltip hint="Number of shares ordered">Qty</Tooltip></th>
                <th className="text-right pb-2 pr-3"><Tooltip hint="Fill price or limit price">Price</Tooltip></th>
                <th className="text-center pb-2 pr-3"><Tooltip hint="Order status: pending, filled, cancelled, or rejected">Status</Tooltip></th>
                <th className="text-left pb-2"><Tooltip hint="Strategy that generated this order">Strategy</Tooltip></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-2 pr-3 text-gray-400 text-xs font-mono">{formatTime(order.submitted_at)}</td>
                  <td className="py-2 pr-3 font-medium text-white">{order.symbol}</td>
                  <td className={`py-2 pr-3 font-medium ${order.side === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                    {order.side.toUpperCase()}
                  </td>
                  <td className="py-2 pr-3 text-right">{order.qty}</td>
                  <td className="py-2 pr-3 text-right font-mono">
                    {formatPrice(order.filled_price ?? order.price)}
                  </td>
                  <td className="py-2 pr-3 text-center">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="py-2 text-gray-400 text-xs">{order.strategy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
