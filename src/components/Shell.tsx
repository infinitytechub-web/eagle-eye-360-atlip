import { lazy, Suspense, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useBranding } from '../lib/branding';
import { supabase } from '../lib/supabase';
import { perms, ROLE_LABEL } from '../lib/roles';
import { useNow } from '../lib/hooks';
import { Logo, Loading } from './ui';
import { NotificationBell } from './Notifications';
import { ChatWidget } from './ChatWidget';
import type { Role } from '../lib/types';

const V = {
  dashboard: lazy(() => import('../views/Dashboard')),
  detect: lazy(() => import('../views/Detect')),
  mobile: lazy(() => import('../views/Mobile')),
  cctv: lazy(() => import('../views/Cctv')),
  voice: lazy(() => import('../views/VoiceAlerts')),
  mysecurity: lazy(() => import('../views/MySecurity')),
  analytics: lazy(() => import('../views/Analytics')),
  geo: lazy(() => import('../views/Geo')),
  alerts: lazy(() => import('../views/Alerts')),
  reports: lazy(() => import('../views/Reports')),
  comms: lazy(() => import('../views/Comms')),
  support: lazy(() => import('../views/Support')),
  aiengine: lazy(() => import('../views/AiEngine')),
  security: lazy(() => import('../views/Security')),
  admin: lazy(() => import('../views/Admin')),
  branding: lazy(() => import('../views/BrandingView')),
  schema: lazy(() => import('../views/Schema')),
  arch: lazy(() => import('../views/Arch')),
  deploy: lazy(() => import('../views/Deploy')),
};
type ViewKey = keyof typeof V;

const NAV: { sec?: string; key?: ViewKey; icon?: string; label?: string; title?: string; sub?: string; show?: (r: Role) => boolean }[] = [
  { sec: 'Operations' },
  { key: 'dashboard', icon: '◎', label: 'Command Dashboard', title: 'Command & Intelligence Dashboard', sub: 'Real-time overview · live event feed · Africa/Accra' },
  { key: 'detect', icon: '◉', label: 'AI Traffic Light Detection', title: 'AI Traffic Light Detection', sub: 'Verification pipeline — housing, region, position, context, temporal checks' },
  { key: 'mobile', icon: '▣', label: 'Mobile Camera Detection', title: 'Mobile Camera Detection', sub: 'On-device heuristic detector — not a trained YOLO model' },
  { key: 'cctv', icon: '▤', label: 'CCTV Surveillance Centre', title: 'CCTV Surveillance Centre', sub: 'Authorised cameras only · masked gateway references' },
  { key: 'voice', icon: '🔊', label: 'Voice Traffic Alerts', title: 'Voice Traffic-Light Alerts', sub: 'Location-aware spoken alerts · processed on your device only' },
  { sec: 'Intelligence' },
  { key: 'analytics', icon: '▦', label: 'Analytics & Intelligence', title: 'Traffic Intelligence & Analytics', sub: 'Observed states ≠ violations · confidence & camera performance' },
  { key: 'geo', icon: '⬢', label: 'GPS & Geospatial', title: 'GPS & Geospatial Intelligence', sub: 'Manual camera-to-intersection assignment · GPS never auto-assigns' },
  { key: 'alerts', icon: '⚠', label: 'Alerts & Notifications', title: 'Alerts & Notifications', sub: 'Advisory only — not guaranteed driving instructions' },
  { key: 'reports', icon: '▧', label: 'Reports & Evidence', title: 'Reports & Evidence Management', sub: 'Exports, SHA-256 integrity hashes, retention & access audit' },
  { sec: 'Communications' },
  { key: 'comms', icon: '✉', label: 'Communication Centre', title: 'Communication Centre', sub: 'Channels · broadcasts · read receipts & acknowledgements' },
  { key: 'support', icon: '✚', label: 'IT Help & Support Centre', title: 'IT Help & Support Centre', sub: 'Tickets · SLA tracking · assignment, escalation & resolution history' },
  { sec: 'Platform' },
  { key: 'mysecurity', icon: '🔐', label: 'My Account Security', title: 'My Account Security', sub: 'Passkeys · password · authenticator app' },
  { key: 'aiengine', icon: '⬣', label: 'AI Engine & Model Registry', title: 'AI Engine & Model Registry', sub: '10-step pipeline · versions, evaluation, rollback' },
  { key: 'security', icon: '⛉', label: 'Security Monitoring Centre', title: 'Security Monitoring Centre', sub: 'OWASP-aligned controls · incidents · audit' },
  { key: 'admin', icon: '⚙', label: 'System Administration', title: 'System Administration', sub: 'Users & RBAC (7 roles) · approvals · backup · audit', show: (r) => perms.viewAdmin(r) },
  { key: 'branding', icon: '✦', label: 'System Branding & Configuration', title: 'System Branding & Configuration', sub: 'Super Administrator only · identity, logos, colours, theme defaults & versions', show: (r) => perms.branding(r) },
  { key: 'schema', icon: '⛁', label: 'Database Schema & APIs', title: 'Database Schema & APIs', sub: 'Live Supabase schema · RLS · RPC & realtime events' },
  { key: 'arch', icon: '⬡', label: 'System Architecture & Roadmap', title: 'System Architecture & Roadmap', sub: 'Service separation · key decisions · development priorities' },
  { key: 'deploy', icon: '⬈', label: 'Deployment, Tests & Acceptance', title: 'Deployment, Tests & Acceptance', sub: 'Honest status: what is live — and what is not yet' },
];

function viewFromHash(): ViewKey { const h = window.location.hash.replace('#/', '') as ViewKey; return h in V ? h : 'dashboard'; }

export function Shell() {
  const { profile, signOut } = useAuth();
  const { branding, theme, setTheme } = useBranding();
  const [view, setView] = useState<ViewKey>(viewFromHash);
  const [online, setOnline] = useState(navigator.onLine);
  const [menuOpen, setMenuOpen] = useState(false); // phones / native apps: collapsible navigation
  const now = useNow();
  const role = profile!.role;

  useEffect(() => { const f = () => setView(viewFromHash()); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  useEffect(() => { const on = () => setOnline(true), off = () => setOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, []);
  // per-account theme
  useEffect(() => { if (profile?.theme) setTheme(profile.theme); /* eslint-disable-next-line */ }, [profile?.id]);

  const item = NAV.find((n) => n.key === view)!;
  const allowed = !item.show || item.show(role);
  const View = V[allowed ? view : 'dashboard'];
  const go = (k: ViewKey) => { window.location.hash = '#/' + k; setMenuOpen(false); window.scrollTo({ top: 0 }); };
  useEffect(() => { if (!menuOpen) return; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [menuOpen]);
  const toggleTheme = async () => { const t = theme === 'light' ? 'dark' : 'light'; setTheme(t); await supabase.from('profiles').update({ theme: t }).eq('id', profile!.id); };
  const dark = theme !== 'light';

  return (
    <div id="app" style={{ display: 'block' }}>
      <div className="shell">
        <aside className={menuOpen ? 'open' : ''} style={{ background: `linear-gradient(180deg,#06162B,${branding.primary})` }}>
          <div className="brandrow">
            <div className="brand"><Logo src={branding.logo} size={46} /><div><strong>{branding.sysName}</strong><br /><span className="small" style={{ color: '#B9C9DE' }}>ATLIP Command</span></div></div>
            <button type="button" className="btn small menu-toggle" aria-expanded={menuOpen} aria-controls="mainnav" onClick={() => setMenuOpen((o) => !o)}>
              {menuOpen ? '✕ Close' : '☰ Menu'}
            </button>
          </div>
          <div className="aside-body" id="mainnav">
          <div className="small" style={{ padding: '0 .5rem .6rem', color: '#B9C9DE' }}>Signed in as<br /><strong style={{ color: '#fff' }}>{profile!.full_name || profile!.email}</strong><br />{ROLE_LABEL[role]} · {profile!.email}</div>
          <nav aria-label="Main">
            {NAV.map((n, i) => n.sec ? <div key={i} className="sec">{n.sec}</div>
              : (!n.show || n.show(role)) && <button key={n.key} data-label={n.label} className={view === n.key ? 'active' : ''} aria-current={view === n.key ? 'page' : undefined} onClick={() => go(n.key!)}>{n.icon} {n.label}</button>)}
          </nav>
          <div style={{ marginTop: '1rem', display: 'grid', gap: '.5rem' }}><button className="btn small" onClick={() => signOut()}>Sign out</button></div>
          </div>
        </aside>
        <main>
          <div className="topbar">
            <div><h1>{allowed ? item.title : 'Command & Intelligence Dashboard'}</h1><p>{allowed ? item.sub : ''}</p></div>
            <div className="pillrow">
              <span className="chip g">{new Date(now).toLocaleString('en-GB', { timeZone: 'Africa/Accra', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: 'short' })} GMT (Accra)</span>
              <button className="btn" id="themeToggle" onClick={toggleTheme} aria-pressed={dark} aria-label={dark ? 'Theme: Night — switch to Day mode' : 'Theme: Day — switch to Night mode'}>
                {dark ? <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" /></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" /><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7" /></svg>}
                <span>{dark ? 'Night' : 'Day'}</span>
              </button>
              <span className={'chip ' + (online ? 'g' : 'r')}>● {online ? 'ONLINE · backend connected' : 'OFFLINE'}</span>
              <NotificationBell />
            </div>
          </div>
          <Suspense fallback={<Loading what="module" />}><section className="view active"><View /></section></Suspense>
          <footer>{branding.footer}</footer>
        </main>
      </div>
      <ChatWidget />
    </div>
  );
}
