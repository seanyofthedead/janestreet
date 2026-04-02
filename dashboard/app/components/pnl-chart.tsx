'use client';

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Area,
  AreaChart,
} from 'recharts';

interface EquityPoint {
  time: string;
  equity: number;
}

interface PnlChartProps {
  data?: EquityPoint[];
  startingBalance?: number;
}

export function PnlChart({ data = [], startingBalance = 1000 }: PnlChartProps) {
  const chartData = data.map((point) => ({
    ...point,
    pnl: point.equity - startingBalance,
  }));

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
      <h2 className="text-sm font-medium text-gray-400 mb-4">Equity Curve</h2>
      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-[250px] text-gray-600 text-sm">
          PnL history will appear after the first completed trade
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <defs>
              <linearGradient id="pnlGradientPos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22C55E" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#22C55E" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="pnlGradientNeg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#EF4444" stopOpacity={0} />
                <stop offset="100%" stopColor="#EF4444" stopOpacity={0.3} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
            <XAxis
              dataKey="time"
              tick={{ fill: '#6B7280', fontSize: 10 }}
              tickLine={{ stroke: '#374151' }}
              axisLine={{ stroke: '#374151' }}
            />
            <YAxis
              tick={{ fill: '#6B7280', fontSize: 10 }}
              tickLine={{ stroke: '#374151' }}
              axisLine={{ stroke: '#374151' }}
              tickFormatter={(v: number) => `$${v.toFixed(0)}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1F2937',
                border: '1px solid #374151',
                borderRadius: '0.5rem',
                color: '#E5E7EB',
                fontSize: '12px',
              }}
              formatter={(value: number) => [`$${value.toFixed(2)}`, 'Equity']}
            />
            <ReferenceLine
              y={startingBalance}
              stroke="#6B7280"
              strokeDasharray="3 3"
              label={{ value: 'Start', fill: '#6B7280', fontSize: 10 }}
            />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="#22C55E"
              fill="url(#pnlGradientPos)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, fill: '#22C55E' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
