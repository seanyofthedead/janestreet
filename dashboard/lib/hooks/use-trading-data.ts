'use client';

import { useQuery } from '@tanstack/react-query';
import {
  fetchAccount,
  fetchPositions,
  fetchOrders,
  fetchStrategies,
  fetchWatchdogStatus,
  type Account,
  type Position,
  type Order,
  type StrategyMetrics,
  type WatchdogStatus,
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
    staleTime: 5000,
    refetchInterval: 10000,
  });
}
