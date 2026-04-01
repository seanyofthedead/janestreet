'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

type EngineEventType =
  | 'tick'
  | 'signal'
  | 'order-submitted'
  | 'order-filled'
  | 'risk-alert'
  | 'circuit-breaker'
  | 'state-transition'
  | 'warmup-complete'
  | 'heartbeat'
  | 'config-change'
  | 'order-canceled'
  | 'position-closed'
  | 'halt-acknowledged'
  | 'strategy-toggled';

const ALL_EVENT_TYPES: EngineEventType[] = [
  'tick',
  'signal',
  'order-submitted',
  'order-filled',
  'risk-alert',
  'circuit-breaker',
  'state-transition',
  'warmup-complete',
  'heartbeat',
  'config-change',
  'order-canceled',
  'position-closed',
  'halt-acknowledged',
  'strategy-toggled',
];

interface EngineEvent {
  type: EngineEventType;
  data: Record<string, unknown>;
  timestamp: string;
}

const SSE_URL = '/api/events';
const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;
const POLL_INTERVAL_MS = 5000;

export function useEngineEvents() {
  const queryClient = useQueryClient();
  const retryDelay = useRef(INITIAL_RETRY_MS);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sseFailedRef = useRef(false);

  const handleEvent = useCallback(
    (event: EngineEvent) => {
      switch (event.type) {
        case 'tick':
          queryClient.setQueryData(['account'], (old: unknown) =>
            old ? { ...(old as object), ...event.data } : event.data
          );
          break;
        case 'signal':
          queryClient.invalidateQueries({ queryKey: ['strategies'] });
          break;
        case 'order-submitted':
        case 'order-filled':
          queryClient.invalidateQueries({ queryKey: ['orders'] });
          queryClient.invalidateQueries({ queryKey: ['positions'] });
          break;
        case 'risk-alert':
        case 'circuit-breaker':
          queryClient.invalidateQueries({ queryKey: ['watchdog'] });
          break;
        case 'state-transition':
          queryClient.invalidateQueries({ queryKey: ['account'] });
          queryClient.invalidateQueries({ queryKey: ['strategies'] });
          break;
        case 'order-canceled':
        case 'position-closed':
          queryClient.invalidateQueries({ queryKey: ['orders'] });
          queryClient.invalidateQueries({ queryKey: ['positions'] });
          break;
        case 'halt-acknowledged':
          queryClient.invalidateQueries({ queryKey: ['account'] });
          break;
        case 'strategy-toggled':
        case 'config-change':
          queryClient.invalidateQueries({ queryKey: ['strategies'] });
          break;
        case 'warmup-complete':
          queryClient.invalidateQueries({ queryKey: ['account'] });
          queryClient.invalidateQueries({ queryKey: ['strategies'] });
          break;
        case 'heartbeat':
          // SSE keepalive, no action needed
          break;
      }
    },
    [queryClient]
  );

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['account'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['strategies'] });
      queryClient.invalidateQueries({ queryKey: ['watchdog'] });
    }, POLL_INTERVAL_MS);
  }, [queryClient]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const connectSSE = useCallback(() => {
    if (typeof window === 'undefined') return;

    const es = new EventSource(SSE_URL);
    eventSourceRef.current = es;

    es.onopen = () => {
      retryDelay.current = INITIAL_RETRY_MS;
      sseFailedRef.current = false;
      stopPolling();
    };

    // Handle unnamed events (e.g. initial "connected" message from engine)
    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data.type === 'connected') {
          // Connection confirmed, no query action needed
        }
      } catch {
        // ignore malformed messages
      }
    };

    // Listen for each named event type the engine sends
    for (const eventType of ALL_EVENT_TYPES) {
      es.addEventListener(eventType, (msg) => {
        try {
          const data = JSON.parse(msg.data);
          handleEvent({ type: eventType, data, timestamp: new Date().toISOString() });
        } catch {
          // ignore malformed messages
        }
      });
    }

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;

      if (!sseFailedRef.current) {
        // Try reconnecting with backoff
        const delay = retryDelay.current;
        retryDelay.current = Math.min(delay * 2, MAX_RETRY_MS);
        setTimeout(connectSSE, delay);
      }

      // After first error, start polling as fallback
      if (retryDelay.current >= MAX_RETRY_MS) {
        sseFailedRef.current = true;
        startPolling();
      }
    };
  }, [handleEvent, startPolling, stopPolling]);

  useEffect(() => {
    connectSSE();

    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      stopPolling();
    };
  }, [connectSSE, stopPolling]);
}
