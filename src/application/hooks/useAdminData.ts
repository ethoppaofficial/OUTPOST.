/**
 * @file useAdminData.ts
 * @module application/hooks/useAdminData
 * @description Reactive data-fetching hook for OUTPOST administrator pages.
 *
 * Lifecycle Guarantees:
 * - Fetches live Supabase data on mount via the injected fetcher.
 * - Exposes `loading`, `refreshing`, `error` (typed AdminServiceError or Error), `isLive`, `lastUpdatedAt`, and `refresh()`.
 * - Prevents overlapping/stale async responses from overwriting newer refreshes (`requestIdRef`).
 * - Prevents state updates after unmount (`mountedRef`).
 * - Refreshes on throttled window visibility restoration (minimum 15s cooldown) and optionally invalidates on
 *   Supabase Realtime changes for watched PostgreSQL tables.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../infrastructure/supabase/supabaseClient';
import { AdminServiceError } from '../services/adminService';

export interface UseAdminDataOptions {
  /** Optional Supabase tables to watch via Realtime for automatic dashboard/queue invalidation */
  realtimeTables?: string[];
  /** Minimum interval in ms before tab-visibility reactivation triggers an automatic background refresh */
  visibilityThrottleMs?: number;
}

export interface UseAdminDataResult<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: AdminServiceError | Error | null;
  isLive: boolean;
  lastUpdatedAt: string | null;
  refresh: () => Promise<T | null>;
}

export function useAdminData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  options: UseAdminDataOptions = {}
): UseAdminDataResult<T> {
  const { realtimeTables = [], visibilityThrottleMs = 15000 } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<AdminServiceError | Error | null>(null);
  const [isLive, setIsLive] = useState<boolean>(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const mountedRef = useRef<boolean>(true);
  const requestIdRef = useRef<number>(0);
  const lastFetchedMsRef = useRef<number>(0);
  const hasLoadedOnceRef = useRef<boolean>(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const executeFetch = useCallback(async (): Promise<T | null> => {
    const requestId = ++requestIdRef.current;

    if (hasLoadedOnceRef.current) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const result = await fetcherRef.current();
      // Ignore stale responses superseded by a newer refresh or post-unmount
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return null;
      }

      hasLoadedOnceRef.current = true;
      lastFetchedMsRef.current = Date.now();
      setData(result);
      setError(null);
      setIsLive(true);
      setLastUpdatedAt(new Date().toISOString());
      return result;
    } catch (err: unknown) {
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return null;
      }

      const typedError =
        err instanceof AdminServiceError
          ? err
          : err instanceof Error
          ? err
          : new Error('Unable to load live administrator data.');

      setError(typedError);
      setIsLive(false);
      return null;
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Fetch on mount and when explicit dependency list changes
  useEffect(() => {
    mountedRef.current = true;
    void executeFetch();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executeFetch, ...deps]);

  // Throttled automatic refresh when administrator returns to browser tab
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchedMsRef.current < visibilityThrottleMs) return;
      void executeFetch();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [executeFetch, visibilityThrottleMs]);

  // Optional Supabase Realtime invalidation for specified tables
  const tablesKey = realtimeTables.join(',');
  useEffect(() => {
    if (!realtimeTables.length) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase.channel(`admin-live-${tablesKey}-${Math.random().toString(36).slice(2, 8)}`);

    for (const table of realtimeTables) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            if (mountedRef.current) {
              void executeFetch();
            }
          }, 400);
        }
      );
    }

    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tablesKey, executeFetch]);

  return {
    data,
    loading,
    refreshing,
    error,
    isLive,
    lastUpdatedAt,
    refresh: executeFetch,
  };
}
