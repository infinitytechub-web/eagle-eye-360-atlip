import { useState } from 'react';
import { supabase, audit } from '../lib/supabase';
import { useLive, must } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useData, statusOf } from '../lib/data';
import { perms, ROLE_CAN, ROLE_LABEL, ROLES } from '../lib/roles';
import { downloadBlob, fmtT, strongPassword, errMsg } from '../lib/util';
import { useModal } from '../components/ui';
import type { AuditLog, Role } from '../lib/types';

async function callAdmin(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return data;
}

export default function Admin() {
  const { profile } = useAuth();
  const { directory, presence, reloadDirectory, cameras, intersections } = useData();
  const modal = useModal();
  const me = profile!;
  const manage = perms.manageUsers(me.role);
  const { data: log } = useLive(async () => must(await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(150)) as AuditLog[], ['audit_logs']);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [n, setN] = useState({ email: '', full_name: '', role: 'operator' as Role, command: '' });
  const [aq, setAq] = useState('');

  const pending = directory.filter((d) => !d.active);
  const active = directory.filter((d) => d.active);

  async function update(id: string, patch: Record<string, unknown>, label: string) {
    setErr(''); setMsg('');
    try { await callAdmin({ action: 'update', id, ...patch }); setMsg(label); reloadDirectory(); } catch (e) { setErr(errMsg(e)); }
  }
  async function create() {
    setErr(''); setMsg('');
    if (!n.email.trim()) return setErr('Email is required.');
    const pw = strongPassword(16);
    try {
      await callAdmin({ action: 'create', ...n, password: pw });
      reloadDirectory();
      modal({ title: 'Account created', ok: 'I have recorded it securely', body: <>
        <p><strong>{n.email}</strong> — {ROLE_LABEL[n.role]}</p>
        <p>Temporary password (shown once — pass it to the user through a secure channel; they should change it via “Forgot password?” on first sign-in):</p>
        <p className="mono" style={{ fontSize: '1rem', userSelect: 'all' }}>{pw}</p></> });
      setN({ email: '', full_name: '', role: 'operator', command: '' });
    } catch (e) { setErr(errMsg(e)); }
  }
  async function backup() {
    const tables = ['intersections', 'cameras', 'ai_models', 'alerts', 'evidence_records', 'tickets', 'comm_messages'] as const;
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), exported_by: me.email, note: 'Configuration & records export (RLS-scoped). No video, no credentials.' };
    for (const t of tables) { const { data } = await supabase.from(t).select('*').limit(5000); out[t] = data || []; }
    downloadBlob(`atlip-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out, null, 2), 'application/json');
    await audit('Data export downloaded (JSON)', null, 'admin');
    setMsg('Export downloaded. Full database backups and point-in-time recovery are handled by Supabase.');
  }
  const filteredLog = (log || []).filter((a) => !aq || (a.actor_name + a.action + (a.target || '') + a.category).toLowerCase().includes(aq.toLowerCase()));

  return (
    <>
      {manage && pending.length > 0 && <div className="card" style={{ borderColor: 'var(--gold)', marginBottom: '1rem' }}><h3>Access requests awaiting approval ({pending.length})</h3>
        <div className="tablewrap"><table><thead><tr><th>User</th><th>Requested</th><th>Assign role</th><th></th></tr></thead><tbody>
          {pending.map((p) => <PendingRow key={p.id} p={p} canSuper={me.role === 'super_admin'} onApprove={(role) => update(p.id, { role, active: true }, `${p.email} approved as ${ROLE_LABEL[role]}.`)} />)}
        </tbody></table></div></div>}
      <div className="grid g2">
        <div className="card"><h3>Users &amp; RBAC — 7 roles</h3>
          <div className="tablewrap"><table><thead><tr><th>User</th><th>Role</th><th>Status</th>{manage && <th></th>}</tr></thead><tbody>
            {active.map((u) => { const st = statusOf(u, presence); return (
              <tr key={u.id}><td><strong>{u.full_name || '—'}</strong><br /><span className="small muted">{u.email}{u.command ? ' · ' + u.command : ''}</span></td>
                <td>{manage && u.id !== me.id && (u.role !== 'super_admin' || me.role === 'super_admin')
                  ? <select value={u.role} onChange={(e) => update(u.id, { role: e.target.value }, `Role changed for ${u.email}.`)} style={{ minWidth: 170 }}>{ROLES.filter((r) => r !== 'super_admin' || me.role === 'super_admin').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                  : ROLE_LABEL[u.role]}</td>
                <td><span className={'chip ' + (st === 'online' ? 'g' : st === 'idle' ? 'a' : 'grey')}>{st}</span></td>
                {manage && <td>{u.id !== me.id && (u.role !== 'super_admin' || me.role === 'super_admin') && <button className="btn small danger" onClick={() => modal({ title: 'Deactivate account', body: `Deactivate ${u.email}? They lose all access immediately.`, ok: 'Deactivate', cb: () => update(u.id, { active: false }, `${u.email} deactivated.`) })}>Deactivate</button>}</td>}
              </tr>); })}
          </tbody></table></div>
          <h3 style={{ marginTop: '1rem' }}>Role permissions</h3>
          <div className="tablewrap"><table><tbody>{ROLES.map((r) => <tr key={r}><td>{ROLE_LABEL[r]}</td><td className="small">{ROLE_CAN[r]}</td></tr>)}</tbody></table></div>
          <p className="small muted">Your role: <strong>{ROLE_LABEL[me.role]}</strong>. Every permission shown here is enforced by Row-Level Security in the database.</p>
          {msg && <p className="small" style={{ color: 'var(--lime)' }}>{msg}</p>}{err && <p className="small" style={{ color: '#FF8A84' }}>{err}</p>}
        </div>
        <div>
          {manage && <div className="card"><h3>Create user account</h3>
            <label>Email</label><input type="email" value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} />
            <label>Full name</label><input value={n.full_name} onChange={(e) => setN({ ...n, full_name: e.target.value })} maxLength={120} />
            <label>Role</label><select value={n.role} onChange={(e) => setN({ ...n, role: e.target.value as Role })}>{ROLES.filter((r) => r !== 'super_admin' || me.role === 'super_admin').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
            <label>Command / unit</label><input value={n.command} onChange={(e) => setN({ ...n, command: e.target.value })} placeholder="e.g. Accra Command" maxLength={120} />
            <button className="btn primary" style={{ marginTop: '.6rem' }} onClick={create}>Create account</button>
            <p className="small muted">A strong temporary password is generated in your browser and shown once. Accounts are created by a server-side function that verifies your role first.</p>
          </div>}
          <div className="card" style={{ marginTop: manage ? '1rem' : 0 }}><h3>Data export &amp; system</h3>
            <div className="pillrow"><button className="btn" onClick={backup}>Download data export (JSON)</button></div>
            <p className="small">Records: {cameras.length} cameras · {intersections.length} intersections · {directory.length} accounts.</p>
            <p className="small">App version <strong>ATLIP 2.0.0 (production)</strong> · Backend: Supabase (eu-west-1) · Region: Ghana (Africa/Accra) · Signal standard: GH 3-aspect + arrows · Sessions expire after 30 min inactivity.</p>
          </div>
        </div>
      </div>
      <div className="card" style={{ marginTop: '1rem' }}><h3>Audit log</h3>
        <input placeholder="Filter the audit log…" value={aq} onChange={(e) => setAq(e.target.value)} style={{ maxWidth: 320 }} />
        <div className="small" style={{ display: 'grid', gap: '.35rem', maxHeight: 320, overflow: 'auto', marginTop: '.5rem' }}>
          {filteredLog.length ? filteredLog.map((a) => <div key={a.id} className="card" style={{ padding: '.45rem .7rem' }}>{fmtT(a.created_at)} — <span className="chip">{a.category}</span> {a.actor_name}: {a.action}{a.target ? ` (${a.target})` : ''}</div>) : <span className="muted">No entries visible to your role yet.</span>}
        </div>
      </div>
    </>
  );
}

function PendingRow({ p, canSuper, onApprove }: { p: { id: string; email: string; full_name: string; created_at: string }; canSuper: boolean; onApprove: (r: Role) => void }) {
  const [role, setRole] = useState<Role>('auditor');
  return (
    <tr><td><strong>{p.full_name || '—'}</strong><br /><span className="small muted">{p.email}</span></td><td className="small">{fmtT(p.created_at)}</td>
      <td><select value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLES.filter((r) => r !== 'super_admin' || canSuper).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></td>
      <td><button className="btn small primary" onClick={() => onApprove(role)}>Approve</button></td></tr>
  );
}
