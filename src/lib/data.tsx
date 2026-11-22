import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { useLive, must } from './hooks';
import { useAuth } from './auth';
import type { Camera, Intersection, Profile, Stats } from './types';

export interface PresenceInfo { user_id: string; device: string; online_at: string; idle: boolean }
interface DataCtx {
  intersections: Intersection[]; cameras: Camera[]; directory: Profile[]; stats: Stats | null;
  presence: Record<string, PresenceInfo>; reloadStats: () => void; reloadDirectory: () => void;
}
const Ctx = createContext<DataCtx>(null as unknown as DataCtx);
export const useData = () => useContext(Ctx);

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} · ${os}`;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const ix = useLive(async () => must(await supabase.from('intersections').select('*').order('id')) as Intersection[], ['intersections']);
  const cams = useLive(async () => must(await supabase.from('cameras').select('*').order('id')) as Camera[], ['cameras']);
  const dir = useLive(async () => must(await supabase.from('profiles').select('*').order('full_name')) as Profile[], ['profiles']);
  const st = useLive(async () => must(await supabase.rpc('detection_stats')) as Stats, ['detection_events']);
  const [presence, setPresence] = useState<Record<string, PresenceInfo>>({});

  // Realtime presence: every signed-in client announces itself; idle after 5 minutes without input.
  useEffect(() => {
    if (!profile) return;
    const ch = supabase.channel('presence:atlip', { config: { presence: { key: profile.id } } });
    let lastAct = Date.now(); let idle = false;
    const info = (): PresenceInfo => ({ user_id: profile.id, device: deviceLabel(), online_at: new Date().toISOString(), idle });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<PresenceInfo>();
      const map: Record<string, PresenceInfo> = {};
      Object.entries(state).forEach(([k, metas]) => { if (metas[0]) map[k] = metas[0]; });
      setPresence(map);
    }).subscribe((s) => { if (s === 'SUBSCRIBED') ch.track(info()); });
    const bump = () => { lastAct = Date.now(); if (idle) { idle = false; ch.track(info()); } };
    window.addEventListener('pointerdown', bump); window.addEventListener('keydown', bump);
    const t = setInterval(() => { const nowIdle = Date.now() - lastAct > 5 * 60000; if (nowIdle !== idle) { idle = nowIdle; ch.track(info()); } }, 15000);
    return () => { clearInterval(t); window.removeEventListener('pointerdown', bump); window.removeEventListener('keydown', bump); supabase.removeChannel(ch); };
  }, [profile]);

  return (
    <Ctx.Provider value={{
      intersections: ix.data || [], cameras: cams.data || [], directory: dir.data || [], stats: st.data,
      presence, reloadStats: st.reload, reloadDirectory: dir.reload,
    }}>{children}</Ctx.Provider>
  );
}

export function statusOf(p: Profile, presence: Record<string, PresenceInfo>): 'online' | 'idle' | 'offline' {
  const pr = presence[p.id];
  if (pr) return pr.idle ? 'idle' : 'online';
  if (p.last_seen_at && Date.now() - new Date(p.last_seen_at).getTime() < 20 * 60000) return 'idle';
  return 'offline';
}
