import { useEffect, useRef, useState } from 'react';
import { supabase, audit } from '../lib/supabase';
import { useLive, must } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { perms, ROLE_LABEL, ROLES } from '../lib/roles';
import { fmtT } from '../lib/util';
import type { Notification } from '../lib/types';

export function NotificationBell() {
  const { profile } = useAuth();
  const { directory } = useData();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const { data } = useLive(async () => {
    const n = must(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(60)) as Notification[];
    const r = must(await supabase.from('notification_reads').select('notification_id').eq('user_id', profile!.id)) as { notification_id: number }[];
    return { n, read: new Set(r.map((x) => x.notification_id)) };
  }, ['notifications'], [profile?.id]);
  const [readLocal, setReadLocal] = useState<Set<number>>(new Set());
  const list = data?.n || [];
  const isRead = (id: number) => data?.read.has(id) || readLocal.has(id);
  const unread = list.filter((n) => !isRead(n.id)).length;

  useEffect(() => {
    const close = (e: MouseEvent) => { if (open && wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close);
  }, [open]);

  async function markAll() {
    const rows = list.filter((n) => !isRead(n.id)).map((n) => ({ notification_id: n.id, user_id: profile!.id }));
    if (!rows.length) return;
    setReadLocal(new Set([...readLocal, ...rows.map((r) => r.notification_id)]));
    await supabase.from('notification_reads').upsert(rows, { ignoreDuplicates: true });
  }

  // issue form
  const [to, setTo] = useState('all'); const [type, setType] = useState('announcement'); const [prio, setPrio] = useState('Medium');
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [err, setErr] = useState('');
  async function issue() {
    setErr('');
    if (!title.trim() || !body.trim()) return setErr('Title and message are required.');
    const [tt, tg] = to === 'all' ? ['all', null] : to.startsWith('role:') ? ['role', to.slice(5)] : ['user', to];
    const { error } = await supabase.from('notifications').insert({ type, priority: prio, title: title.trim(), body: body.trim(), target_type: tt, target: tg, created_by: profile!.id });
    if (error) return setErr(error.message);
    await audit('Notification issued: “' + title.trim() + '”', to, 'admin');
    setTitle(''); setBody('');
  }

  return (
    <div className="bellwrap" ref={wrap}>
      <button className="btn" id="bellBtn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Notifications, ${unread} unread`}>
        Notifications {unread > 0 && <span className="badge">{unread}</span>}
      </button>
      {open && <div className="notifpanel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.5rem' }}>
          <strong>Notifications Centre</strong><button className="btn small" onClick={markAll}>Mark all read</button>
        </div>
        <p className="small muted">Delivered live from the server with role- and user-level targeting.</p>
        <div style={{ display: 'grid', gap: '.5rem' }}>
          {list.length ? list.map((n) => (
            <div key={n.id} className={'notif ' + (isRead(n.id) ? '' : 'unread')}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}><strong>{n.title}</strong><span className={'prio ' + n.priority}>{n.priority.toUpperCase()}</span></div>
              <div className="small">{n.body}</div>
              <span className="small muted">{n.type} · {fmtT(n.created_at)} · {isRead(n.id) ? 'read' : <strong>unread</strong>}</span>
            </div>)) : <p className="muted small">No notifications for your account.</p>}
        </div>
        {perms.issueNotif(profile?.role) && <div style={{ marginTop: '.8rem', borderTop: '1px solid var(--line)', paddingTop: '.4rem' }}>
          <strong className="small">Issue a targeted notification</strong>
          <label>Send to</label>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="all">All users</option>
            {directory.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.full_name || d.email} — {ROLE_LABEL[d.role]}</option>)}
            {ROLES.map((r) => <option key={r} value={'role:' + r}>Role: {ROLE_LABEL[r]}</option>)}
          </select>
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}><option value="announcement">Administrative announcement</option><option value="system">System alert</option><option value="security">Security alert</option><option value="support">Support update</option><option value="activity">User activity</option></select>
          <label>Priority</label>
          <select value={prio} onChange={(e) => setPrio(e.target.value)}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select>
          <label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
          <label>Message</label><textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
          {err && <p className="small" style={{ color: '#FF8A84' }}>{err}</p>}
          <button className="btn primary small" style={{ marginTop: '.5rem' }} onClick={issue}>Send notification</button>
        </div>}
      </div>}
    </div>
  );
}
