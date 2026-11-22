import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import type { Branding } from './types';

export const DEFAULT_BRANDING: Branding = {
  sysName: 'Eagle Eye 360', org: 'Eagle-eye productions',
  tagline: 'ATLIP — AI Traffic Light Detector & Intelligence Platform',
  welcome: 'Enterprise AI · Computer Vision · Traffic Surveillance · Security Intelligence',
  footer: 'Eagle Eye 360 · ATLIP — AI Traffic Light Detector & Intelligence Platform · © Eagle-eye productions',
  accent: '#D4AF37', accent2: '#EAC65A', primary: '#0A2342', themeDefault: 'dark', logo: null,
};
export const DEFAULT_LOGO = '/logo-256.jpg';

interface BrandCtx { branding: Branding; reload: () => Promise<void>; theme: 'dark' | 'light'; setTheme: (t: 'dark' | 'light') => void }
const Ctx = createContext<BrandCtx>(null as unknown as BrandCtx);
export const useBranding = () => useContext(Ctx);

export function applyBrandingVars(b: Branding) {
  const r = document.documentElement.style;
  r.setProperty('--gold', b.accent); r.setProperty('--gold2', b.accent2); r.setProperty('--deep', b.primary);
  document.title = `${b.sysName} — ATLIP`;
  const fav = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (fav) fav.href = b.logo || '/favicon.png';
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const [theme, setThemeState] = useState<'dark' | 'light'>(() => {
    try { const t = localStorage.getItem('ee360-theme'); if (t === 'light' || t === 'dark') return t; } catch { /* ignore */ }
    return 'dark';
  });

  const reload = useCallback(async () => {
    const { data } = await supabase.from('branding').select('data').eq('id', 1).maybeSingle();
    const b = { ...DEFAULT_BRANDING, ...((data?.data as Partial<Branding>) || {}) };
    setBranding(b); applyBrandingVars(b);
    try { if (!localStorage.getItem('ee360-theme')) setThemeState(b.themeDefault); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    reload();
    const ch = supabase.channel('branding-live').on('postgres_changes', { event: '*', schema: 'public', table: 'branding' }, reload).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload]);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const setTheme = (t: 'dark' | 'light') => { setThemeState(t); try { localStorage.setItem('ee360-theme', t); } catch { /* ignore */ } };

  return <Ctx.Provider value={{ branding, reload, theme, setTheme }}>{children}</Ctx.Provider>;
}
