import { useEffect, useState } from 'react';
import { supabase, audit } from '../lib/supabase';
import { useLive, must } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useBranding, DEFAULT_BRANDING } from '../lib/branding';
import { perms } from '../lib/roles';
import { fmtT, errMsg } from '../lib/util';
import { Logo, useModal } from '../components/ui';
import type { Branding } from '../lib/types';

interface Version { id: number; data: Branding; published_by_name: string; note: string | null; created_at: string }

export default function BrandingView() {
  const { profile } = useAuth();
  const { branding, reload, setTheme } = useBranding();
  const modal = useModal();
  const [f, setF] = useState<Branding>(branding);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const { data: versions, reload: reloadV } = useLive(async () => must(await supabase.from('branding_versions').select('*').order('created_at', { ascending: false }).limit(20)) as Version[], []);
  useEffect(() => setF(branding), [branding]);

  if (!perms.branding(profile?.role)) return <div className="card"><h3>Restricted — Super Administrators only</h3><p className="muted">System branding and configuration require the Super Administrator role (enforced by the database).</p></div>;

  const set = (k: keyof Branding, v: string | null) => setF({ ...f, [k]: v });

  async function upload(file: File) {
    setErr('');
    if (file.size > 1024 * 1024) return setErr('Logo must be 1 MB or smaller.');
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return setErr('Use a PNG, JPEG, WebP or SVG image.');
    const path = `logo-${Date.now()}.${file.name.split('.').pop()?.toLowerCase() || 'png'}`;
    const { error } = await supabase.storage.from('branding').upload(path, file, { upsert: false, contentType: file.type });
    if (error) return setErr(error.message);
    set('logo', supabase.storage.from('branding').getPublicUrl(path).data.publicUrl);
  }
  async function publish(data: Branding, note: string) {
    setBusy(true); setErr(''); setMsg('');
    try {
      const { error } = await supabase.from('branding').update({ data, updated_by: profile!.id, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) throw error;
      const { error: e2 } = await supabase.from('branding_versions').insert({ data, published_by: profile!.id, published_by_name: profile!.full_name || profile!.email, note });
      if (e2) throw e2;
      await audit('Branding ' + note, data.sysName, 'branding');
      await reload(); reloadV();
      setMsg(`Branding ${note} — applied for every user on every device (login, sidebar, header, footer, favicon).`);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="notice">Super Administrator only. Branding is stored on the server and pushed live to every connected client — web, mobile and desktop see the same identity.</div>
      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <div className="card"><h3>Identity &amp; appearance</h3>
          <label>System name</label><input value={f.sysName} onChange={(e) => set('sysName', e.target.value)} maxLength={60} />
          <label>Organisation identity</label><input value={f.org} onChange={(e) => set('org', e.target.value)} maxLength={80} />
          <label>Platform title (login tagline)</label><input value={f.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={120} />
          <label>Login welcome message</label><input value={f.welcome} onChange={(e) => set('welcome', e.target.value)} maxLength={160} />
          <label>Footer information</label><textarea rows={2} value={f.footer} onChange={(e) => set('footer', e.target.value)} maxLength={300} />
          <label>Accent colour (gold)</label><div className="colorrow"><input type="color" value={f.accent} onChange={(e) => set('accent', e.target.value)} /><span className="small muted">Buttons, highlights, active states</span></div>
          <label>Secondary accent</label><div className="colorrow"><input type="color" value={f.accent2} onChange={(e) => set('accent2', e.target.value)} /><span className="small muted">Gradient partner for the accent</span></div>
          <label>Primary / sidebar colour (deep blue)</label><div className="colorrow"><input type="color" value={f.primary} onChange={(e) => set('primary', e.target.value)} /><span className="small muted">Sidebar base and primary surfaces</span></div>
          <label>Default theme for new sessions</label><select value={f.themeDefault} onChange={(e) => set('themeDefault', e.target.value)}><option value="dark">Night — Dark, Deep Blue &amp; Gold</option><option value="light">Day — Light</option></select>
          <label>System logo (also used as app icon / favicon)</label>
          <div className="pillrow"><Logo src={f.logo} size={40} /><label className="btn small" style={{ cursor: 'pointer', margin: 0 }}>Upload logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: 'none' }} onChange={(e) => { const x = e.target.files?.[0]; if (x) upload(x); e.target.value = ''; }} /></label><button className="btn small" onClick={() => set('logo', null)}>Use original EE360 logo</button></div>
          {msg && <p className="small" style={{ color: 'var(--lime)' }}>{msg}</p>}{err && <p className="small" style={{ color: '#FF8A84' }}>{err}</p>}
          <div className="pillrow" style={{ marginTop: '.6rem' }}>
            <button className="btn primary" disabled={busy} onClick={() => publish(f, 'published')}>Publish branding</button>
            <button className="btn danger" disabled={busy} onClick={() => modal({ title: 'Reset branding to defaults', body: 'Restore the original Eagle Eye 360 identity — gold / deep blue / white, the original logo and default texts? The current settings stay in version history.', ok: 'Reset to defaults', cb: () => { setTheme('dark'); publish(DEFAULT_BRANDING, 'reset to defaults'); } })}>Reset to defaults</button>
          </div>
        </div>
        <div>
          <div className="card"><h3>Live preview (not yet published)</h3>
            <div style={{ border: '1px solid var(--line2)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '.8rem', color: '#fff', display: 'flex', gap: '.6rem', alignItems: 'center', background: `linear-gradient(180deg,#06162B,${f.primary})` }}><Logo src={f.logo} size={40} /><div><strong>{f.sysName}</strong><br /><span className="small" style={{ color: '#B9C9DE' }}>{f.org}</span></div></div>
              <div style={{ padding: '.8rem' }}><div className="small muted">{f.tagline}</div><div style={{ margin: '.4rem 0' }}>{f.welcome}</div>
                <button className="btn primary small" style={{ background: f.accent, borderColor: f.accent2 }}>Sample action button</button> <span className="chip g">Sample chip</span>
                <div className="small muted" style={{ marginTop: '.6rem', borderTop: '1px solid var(--line)', paddingTop: '.5rem' }}>{f.footer}</div></div>
            </div>
          </div>
          <div className="card" style={{ marginTop: '1rem' }}><h3>Branding version history</h3>
            <div style={{ display: 'grid', gap: '.45rem' }}>
              {(versions || []).length ? versions!.map((v) => <div key={v.id} className="card" style={{ padding: '.5rem .7rem', display: 'flex', justifyContent: 'space-between', gap: '.5rem', alignItems: 'center' }}>
                <span className="small">{fmtT(v.created_at)} · {v.published_by_name} · {v.note} · “{v.data.sysName}”</span>
                <button className="btn small" onClick={() => publish(v.data, 'restored from ' + fmtT(v.created_at))}>Restore</button></div>)
                : <p className="muted small">No published versions yet — the factory defaults are active.</p>}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
