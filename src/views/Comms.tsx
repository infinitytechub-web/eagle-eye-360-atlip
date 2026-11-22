import { useEffect, useState } from 'react';
import { supabase, uploadAttachment, openAttachment } from '../lib/supabase';
import { useLive, must } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { perms, ROLE_LABEL } from '../lib/roles';
import { fmtT, kb, errMsg } from '../lib/util';
import type { CommMessage, CommReceipt } from '../lib/types';

export const CHANNELS = [
  { id: 'announce', name: 'Announcements — All Staff (broadcast)' }, { id: 'accra', name: 'Accra Command' },
  { id: 'kumasi', name: 'Kumasi Command' }, { id: 'security', name: 'Security Operations' }, { id: 'itsupport', name: 'IT Support Channel' },
];

export default function Comms() {
  const { profile } = useAuth();
  const { directory } = useData();
  const me = profile!;
  const { data } = useLive(async () => {
    const m = must(await supabase.from('comm_messages').select('*').order('created_at', { ascending: false }).limit(200)) as CommMessage[];
    const r = m.length ? must(await supabase.from('comm_receipts').select('*').in('message_id', m.map((x) => x.id))) as CommReceipt[] : [];
    return { m, r };
  }, ['comm_messages', 'comm_receipts']);
  const [ch, setCh] = useState('accra'); const [prio, setPrio] = useState('Normal'); const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [q, setQ] = useState(''); const [cf, setCf] = useState('all');
  const activeUsers = directory.filter((d) => d.active).length;

  // read receipts: record when messages are displayed to me
  useEffect(() => {
    if (!data) return;
    const mine = new Set(data.r.filter((r) => r.user_id === me.id).map((r) => r.message_id));
    const rows = data.m.filter((m) => !mine.has(m.id)).map((m) => ({ message_id: m.id, user_id: me.id }));
    if (rows.length) supabase.from('comm_receipts').upsert(rows, { ignoreDuplicates: true }).then(() => {});
  }, [data, me.id]);

  async function post() {
    setErr('');
    if (!text.trim()) return setErr('Write a message first.');
    if ((ch === 'announce' || prio === 'Emergency') && !perms.broadcast(me.role)) return setErr('Broadcast announcements and Emergency priority are restricted to administrators and supervisors.');
    setBusy(true);
    try {
      const att = file ? await uploadAttachment(me.id, file) : {};
      const { error } = await supabase.from('comm_messages').insert({ channel: ch, sender_id: me.id, sender_name: me.full_name || me.email, body: text.trim(), priority: prio, ...att });
      if (error) throw error;
      setText(''); setFile(null);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  async function ack(id: number) {
    await supabase.from('comm_receipts').upsert({ message_id: id, user_id: me.id, acked_at: new Date().toISOString() });
  }
  const list = (data?.m || []).filter((m) => (cf === 'all' || m.channel === cf) && (!q || m.body.toLowerCase().includes(q.toLowerCase())));
  const canWrite = perms.write(me.role);

  return (
    <>
      <div className="notice">Messages, read receipts, acknowledgements and attachments are stored on the secure backend. Broadcasts and Emergency posts are restricted and audit-logged by the database, and raise notifications for every user.</div>
      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <div className="card"><h3>Post a message</h3>
          <label>Channel</label><select value={ch} onChange={(e) => setCh(e.target.value)} disabled={!canWrite}>{CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <label>Priority</label><select value={prio} onChange={(e) => setPrio(e.target.value)} disabled={!canWrite}><option>Normal</option><option>Priority</option><option>Emergency</option></select>
          <label>Message</label><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={canWrite ? 'Write to the channel…' : 'Read-only role'} disabled={!canWrite} maxLength={4000} />
          <label>Attach a file (max 10 MB)</label>
          <div className="pillrow"><label className="btn small" style={{ cursor: 'pointer', margin: 0 }}>Choose file<input type="file" style={{ display: 'none' }} disabled={!canWrite} onChange={(e) => { setFile(e.target.files?.[0] || null); e.target.value = ''; }} /></label>{file && <span className="small muted">{file.name} ({kb(file.size)})</span>}</div>
          {err && <p className="small" style={{ color: '#FF8A84' }}>{err}</p>}
          <button className="btn primary" style={{ marginTop: '.6rem' }} onClick={post} disabled={!canWrite || busy}>Post message</button>
          <h3 style={{ marginTop: '1rem' }}>How permissions work</h3>
          <p className="small muted">Every active user except Read-only Auditors can post to departmental channels and acknowledge messages. Read receipts are recorded when a message is displayed to you; acknowledgements are explicit and tracked per user. Private one-to-one conversations live in the Live Chat widget.</p>
        </div>
        <div className="card"><h3>Channels &amp; conversation history</h3>
          <div className="pillrow"><input placeholder="Search messages…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 150 }} />
            <select value={cf} onChange={(e) => setCf(e.target.value)} style={{ maxWidth: 230 }}><option value="all">All channels</option>{CHANNELS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div style={{ display: 'grid', gap: '.55rem', marginTop: '.7rem', maxHeight: 600, overflow: 'auto' }}>
            {list.length ? list.map((m) => {
              const rc = (data?.r || []).filter((r) => r.message_id === m.id);
              const acked = rc.some((r) => r.user_id === me.id && r.acked_at); const mine = m.sender_id === me.id;
              const u = directory.find((d) => d.id === m.sender_id);
              return (
                <div key={m.id} className="card" style={{ padding: '.65rem .8rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}><strong>{CHANNELS.find((c) => c.id === m.channel)?.name}</strong>
                    {m.priority === 'Emergency' ? <span className="chip r">EMERGENCY</span> : m.priority === 'Priority' ? <span className="chip a">PRIORITY</span> : null}</div>
                  <div className="small muted">{m.sender_name}{u ? ' · ' + ROLE_LABEL[u.role] : ''} · {fmtT(m.created_at)}</div>
                  <div style={{ margin: '.3rem 0', whiteSpace: 'pre-wrap' }}>{m.body}</div>
                  {m.file_path && <button className="chip" style={{ cursor: 'pointer', background: 'none', color: 'inherit' }} onClick={() => openAttachment(m.file_path!)}>▤ {m.file_name} · {kb(m.file_size)}</button>}
                  <div className="small muted" style={{ marginTop: '.4rem' }}>Read by {rc.length}/{activeUsers} users · Acknowledged by {rc.filter((r) => r.acked_at).length}
                    {mine ? ' · your message' : acked ? <> · <strong>you acknowledged</strong></> : <> · <button className="btn small" onClick={() => ack(m.id)}>Acknowledge</button></>}</div>
                </div>);
            }) : <p className="muted small">No messages yet.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
