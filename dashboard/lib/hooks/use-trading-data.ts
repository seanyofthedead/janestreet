'use client';

import { useQuery } from '@tanstack/react-query';
import {
  fetchAccount,
  fetchPositions,
  fetchOrders,
  fetchStrategies,
  fetchWatchdogStatus,
  fetchBars,
  fetchSignals,
  type Account,
  type Position,
  type Order,
  type StrategyMetrics,
  type WatchdogStatus,
  type CandleData,
  type SignalRecord,
} from '@/lib/api';

export function useAccount() {
  return useQuery<Account>({
    queryKey: ['account'],
    queryFn: fetchAccount,
    staleTime: 5000,
    refetchInterval: 10000,
  });
}

export function usePositions() {
  return useQuery<Position[]>({
    queryKey: ['positions'],
    queryFn: fetchPositions,
    staleTime: 5000,
    refetchInterval: 10000,
  });
}

export function useOrders() {
  return useQuery<Order[]>({
    queryKey: ['orders'],
    queryFn: fetchOrders,
    staleTime: 5000,
    refetchInterval: 10000,
  });
}

export function useStrategies() {
  return useQuery<StrategyMetrics[]>({
    queryKey: ['strategies'],
    queryFn: fetchStrategies,
    staleTime: 5000,
    refetchInterval: 15000,
  });
}

export function useWatchdogStatus() {
  return useQuery<WatchdogStatus>({
    queryKey: ['watchdog'],
    queryFn: fetchWatchdogStatus,
    staleTime: 1000,
    refetchInterval: 2000,
  });
}

export function useBars(symbol: string, timeframe = '5Min') {
  return useQuery<CandleData[]>({
    queryKey: ['bars', symbol, timeframe],
    queryFn: () => fetchBars(symbol, timeframe),
    staleTime: 30000,
    refetchInterval: 60000,
  });
}

export function useSignals(
  symbol: string,
  options?: { since?: number; until?: number; strategy?: string },
) {
  return useQuery<SignalRecord[]>({
    queryKey: ['signals', symbol, options?.since, options?.strategy],
    queryFn: () => fetchSignals(symbol, options),
    staleTime: 10000,
    refetchInterval: 30000,
  });
}
