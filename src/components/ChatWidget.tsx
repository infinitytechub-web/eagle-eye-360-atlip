import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, uploadAttachment, openAttachment } from '../lib/supabase';
import { useLive, must } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useData, statusOf } from '../lib/data';
import { ROLE_LABEL } from '../lib/roles';
import { dmKey, fmtClock, kb, errMsg } from '../lib/util';
import type { ChatMessage } from '../lib/types';

export function ChatWidget() {
  const { profile } = useAuth();
  const { directory, presence } = useData();
  const me = profile!;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [text, setText] = useState(''); const [q, setQ] = useState('');
  const [file, setFile] = useState<File | null>(null); const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);

  const { data: msgs } = useLive(async () =>
    must(await supabase.from('chat_messages').select('*').order('created_at', { ascending: true }).limit(1000)) as ChatMessage[],
  ['chat_messages'], [me.id]);

  const threads = useMemo(() => {
    const peers = directory.filter((d) => d.active && d.id !== me.id);
    return [{ key: 'group:command', name: 'Command Group', peer: null as null | typeof peers[0] },
      ...peers.map((p) => ({ key: dmKey(me.id, p.id), name: `${p.full_name || p.email} — ${ROLE_LABEL[p.role]}`, peer: p }))];
  }, [directory, me.id]);

  const unreadFor = (key: string) => (msgs || []).filter((m) => m.thread_key === key && m.sender_id !== me.id && !m.read_at && key !== 'group:command').length;
  const totalUnread = threads.reduce((a, t) => a + unreadFor(t.key), 0);
  const current = threads.find((t) => t.key === active);
  const shown = (msgs || []).filter((m) => m.thread_key === active && (!q || m.body.toLowerCase().includes(q.toLowerCase())));

  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [shown.length, active, open]);

  // read receipts for DMs when displayed
  useEffect(() => {
    if (!open || !active || active === 'group:command') return;
    const ids = (msgs || []).filter((m) => m.thread_key === active && m.sender_id !== me.id && !m.read_at).map((m) => m.id);
    if (ids.length) supabase.from('chat_messages').update({ read_at: new Date().toISOString() }).in('id', ids).then(() => {});
  }, [open, active, msgs, me.id]);

  async function send() {
    if (!active || (!text.trim() && !file)) return;
    setErr('');
    try {
      const att = file ? await uploadAttachment(me.id, file) : {};
      const { error } = await supabase.from('chat_messages').insert({ thread_key: active, sender_id: me.id, body: text.trim() || '(attachment)', ...att });
      if (error) throw error;
      setText(''); setFile(null);
    } catch (e) { setErr(errMsg(e)); }
  }
  const nameOf = (id: string) => (id === me.id ? 'You' : directory.find((d) => d.id === id)?.full_name || 'User');

  return (
    <div id="chatWidget" style={{ display: 'block' }}>
      {open && <div id="chatPanel" style={{ display: 'flex' }}>
        <div style={{ padding: '.7rem .9rem', background: 'var(--panel2)', borderBottom: '1px solid var(--line2)', display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}>
          <div><strong>Live Chat</strong><br /><span className="small muted">Server-stored messages, access-controlled per conversation.</span></div>
          <button className="btn small" onClick={() => setOpen(false)}>Close</button>
        </div>
        <div style={{ padding: '.6rem .9rem', borderBottom: '1px solid var(--line)', maxHeight: 190, overflow: 'auto' }}>
          {threads.map((t) => {
            const st = t.peer ? statusOf(t.peer, presence) : 'online'; const u = unreadFor(t.key);
            const last = [...(msgs || [])].reverse().find((m) => m.thread_key === t.key);
            return (
              <button key={t.key} className="btn small" style={{ justifyContent: 'flex-start', width: '100%', marginBottom: '.35rem', borderColor: active === t.key ? 'var(--lime)' : undefined }} onClick={() => setActive(t.key)}>
                <span className={'statusdot ' + (st === 'online' ? 'on' : st === 'idle' ? 'idle' : 'off')} />
                <span style={{ flex: 1, textAlign: 'left' }}>{t.name}<br /><span className="muted" style={{ fontWeight: 400 }}>{last ? last.body.slice(0, 42) : 'No messages yet'}</span></span>
                {u > 0 && <span className="ubadge">{u}</span>}
              </button>);
          })}
          {threads.length === 1 && <p className="small muted">Other users appear here once an administrator activates their accounts.</p>}
        </div>
        <div style={{ padding: '.45rem .9rem', fontWeight: 700, borderBottom: '1px solid var(--line)', display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{current ? current.name : 'Select a conversation'}</span>
          {current && <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 130, padding: '.3rem .5rem' }} />}
        </div>
        <div ref={box} style={{ flex: 1, overflow: 'auto', padding: '.6rem .9rem', display: 'grid', gap: '.5rem', alignContent: 'start' }}>
          {!current ? <p className="muted small">Choose a person or the Command Group to start.</p> : shown.length ? shown.map((m) => {
            const mine = m.sender_id === me.id;
            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : undefined }}>
                <div className={'msg ' + (mine ? 'me' : '')}>
                  <div className="small" style={{ fontWeight: 700 }}>{nameOf(m.sender_id)}</div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
                  {m.file_path && <button className="chip" style={{ marginTop: '.3rem', cursor: 'pointer', background: 'none', color: 'inherit' }} onClick={() => openAttachment(m.file_path!)}>▤ {m.file_name} · {kb(m.file_size)}</button>}
                  <div className="small muted" style={{ textAlign: 'right' }}>{fmtClock(m.created_at)} {mine && active !== 'group:command' ? (m.read_at ? '✓✓ read' : '✓ delivered') : ''}</div>
                </div>
              </div>);
          }) : <p className="muted small">{q ? 'No messages match your search.' : 'No messages yet.'}</p>}
        </div>
        {current && <div style={{ padding: '.6rem .9rem', borderTop: '1px solid var(--line)' }}>
          <div className="pillrow"><label className="btn small" style={{ cursor: 'pointer', margin: 0 }}>Attach file<input type="file" style={{ display: 'none' }} onChange={(e) => { setFile(e.target.files?.[0] || null); e.target.value = ''; }} /></label>
            {file && <span className="small muted">{file.name} ({kb(file.size)}) <button className="btn small" onClick={() => setFile(null)}>×</button></span>}</div>
          {err && <p className="small" style={{ color: '#FF8A84', margin: '.3rem 0' }}>{err}</p>}
          <div style={{ display: 'flex', gap: '.5rem', marginTop: '.45rem' }}>
            <input placeholder="Type a message…" value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} />
            <button className="btn primary" onClick={send}>Send</button>
          </div>
        </div>}
      </div>}
      <button className="btn primary" onClick={() => setOpen(!open)}>Live Chat {totalUnread > 0 && <span className="ubadge">{totalUnread}</span>}</button>
    </div>
  );
}
