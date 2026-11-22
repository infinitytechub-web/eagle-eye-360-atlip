import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

/**
 * Load data with `loader`, then reload whenever any of `tables` changes (Supabase Realtime).
 * RLS applies to both the query and the change feed.
 */
export function useLive<T>(loader: () => PromiseLike<T>, tables: string[], deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    try { setData(await loaderRef.current()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => {
    reload();
    if (!tables.length) return;
    const ch = supabase.channel('live:' + tables.join(',') + ':' + Math.random().toString(36).slice(2));
    tables.forEach((t) => ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(reload, 350);
    }));
    ch.subscribe();
    return () => { window.clearTimeout(timer.current); supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(','), ...deps]);

  return { data, error, reload };
}

/** Throw on Supabase errors so useLive surfaces them. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}
