'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchQuotes, type Quote } from '@/lib/api';

const POLL_INTERVAL_MS = 5000;

/**
 * Polls for latest quotes and updates TanStack Query cache.
 * Can be upgraded to WebSocket streaming in the future.
 */
export function useAlpacaStream(symbols: string[]) {
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (symbols.length === 0) return;

    const poll = async () => {
      try {
        const quotes = await fetchQuotes(symbols);
        // Update cache per symbol
        for (const quote of quotes) {
          queryClient.setQueryData<Quote>(['quote', quote.symbol], quote);
        }
        // Also update the full quotes list
        queryClient.setQueryData<Quote[]>(['quotes'], quotes);
      } catch {
        // Silently ignore polling failures; TanStack Query hooks handle errors
      }
    };

    // Initial fetch
    poll();

    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [symbols.join(','), queryClient]); // eslint-disable-line react-hooks/exhaustive-deps
}
