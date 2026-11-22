import { useState } from 'react';
import { supabase, uploadAttachment, openAttachment } from '../lib/supabase';
import { useLive, must, useNow } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { perms, ROLE_LABEL } from '../lib/roles';
import { fmtT, kb, errMsg } from '../lib/util';
import { Bars } from '../components/ui';
import type { Ticket, TicketEvent } from '../lib/types';

const SLA_H: Record<string, number> = { Critical: 4, High: 8, Medium: 24, Low: 72 };
const PRIO = ['Low', 'Medium', 'High', 'Critical'];
const STATUSES = ['Open', 'Assigned', 'In Progress', 'Pending', 'Resolved', 'Closed'];
const done = (s: string) => s === 'Resolved' || s === 'Closed';
const due = (t: Ticket) => new Date(t.created_at).getTime() + SLA_H[t.priority] * 3600000;

function SlaChip({ t, now }: { t: Ticket; now: number }) {
  if (done(t.status)) return <span className="chip g">Resolved / closed</span>;
  const left = due(t) - now;
  if (left < 0) return <span className="chip r">SLA BREACHED</span>;
  if (left < 4 * 3600000) return <span className="chip a">SLA risk — {Math.max(1, Math.round(left / 60000))} min left</span>;
  return <span className="chip">Within SLA — due {fmtT(due(t))}</span>;
}

export default function Support() {
  const { profile } = useAuth();
  const { directory } = useData();
  const me = profile!;
  const now = useNow(30000);
  const { data: tickets } = useLive(async () => must(await supabase.from('tickets').select('*').order('created_at', { ascending: false }).limit(500)) as Ticket[], ['tickets']);
  const [active, setActive] = useState<number | null>(null);
  const { data: events } = useLive(async () => active ? must(await supabase.from('ticket_events').select('*').eq('ticket_id', active).order('created_at')) as TicketEvent[] : [], ['ticket_events'], [active]);

  const [title, setTitle] = useState(''); const [cat, setCat] = useState('Technical Support'); const [prio, setPrio] = useState('Medium');
  const [dept, setDept] = useState('IT Operations'); const [desc, setDesc] = useState(''); const [err, setErr] = useState('');
  const [q, setQ] = useState(''); const [sf, setSf] = useState('all');
  const ts = tickets || [];
  const staff = perms.handleTickets(me.role); const ro = !perms.write(me.role);
  const officers = ['Unassigned', ...directory.filter((d) => d.active && ['support_officer', 'system_admin', 'super_admin', 'supervisor'].includes(d.role)).map((d) => `${d.full_name || d.email} — ${ROLE_LABEL[d.role]}`)];

  async function create() {
    setErr('');
    if (title.trim().length < 4 || !desc.trim()) return setErr('Title (4+ characters) and description are required.');
    const { data, error } = await supabase.from('tickets').insert({ title: title.trim(), category: cat, priority: prio, department: dept, requester_id: me.id, requester_name: me.full_name || me.email }).select('id').single();
    if (error) return setErr(error.message.includes('tickets_open_title_uniq') ? 'An open ticket with this title already exists — duplicates are prevented. Open it from the list instead.' : error.message);
    await supabase.from('ticket_events').insert({ ticket_id: data.id, author_id: me.id, author_name: me.full_name || me.email, body: desc.trim() });
    setTitle(''); setDesc(''); setActive(data.id);
  }

  const open = ts.filter((t) => !done(t.status));
  const breached = open.filter((t) => now > due(t)).length;
  const res = ts.filter((t) => t.resolved_at);
  const avg = res.length ? (res.reduce((a, t) => a + (new Date(t.resolved_at!).getTime() - new Date(t.created_at).getTime()), 0) / res.length / 3600000).toFixed(1) : null;
  const list = ts.filter((t) => (sf === 'all' || t.status === sf) && (!q || (t.title + t.ref + t.category + t.requester_name).toLowerCase().includes(q.toLowerCase())));
  const cur = ts.find((t) => t.id === active);

  return (
    <>
      <div className="notice">Tickets, SLA clocks, notes and attachments are stored on the secure backend. The database prevents duplicate open tickets, restricts status/assignment changes to support staff, hides internal notes from requesters, and notifies the requester on every status change.</div>
      <div className="grid g4" style={{ marginTop: '1rem' }}>
        {[['Open tickets', open.length, 'Awaiting work or assignment'], ['Active (assigned / in progress / pending)', ts.filter((t) => ['Assigned', 'In Progress', 'Pending'].includes(t.status)).length, 'Across all departments'], ['SLA breached', breached, 'Open tickets past their target'], ['Avg resolution time', avg ? avg + ' h' : '—', 'Resolved tickets on record']].map((s) =>
          <div key={String(s[0])} className="card stat"><span>{s[0]}</span><b>{s[1]}</b><span className="muted">{s[2]}</span></div>)}
      </div>
      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <div className="card"><h3>Raise a support ticket</h3>
          <label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary of the problem" maxLength={160} disabled={ro} />
          <label>Category</label><select value={cat} onChange={(e) => setCat(e.target.value)} disabled={ro}>{['Technical Support', 'Account Access', 'System Errors', 'Security Incidents', 'General Enquiries'].map((c) => <option key={c}>{c}</option>)}</select>
          <label>Priority</label><select value={prio} onChange={(e) => setPrio(e.target.value)} disabled={ro}>{PRIO.map((p) => <option key={p}>{p}</option>)}</select>
          <label>Responsible department</label><select value={dept} onChange={(e) => setDept(e.target.value)} disabled={ro}>{['IT Operations', 'Security Operations', 'Network & CCTV', 'Access Management'].map((d) => <option key={d}>{d}</option>)}</select>
          <label>Description</label><textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What happened, where, and what you already tried…" maxLength={4000} disabled={ro} />
          {err && <p className="small" style={{ color: '#FF8A84' }}>{err}</p>}
          <button className="btn primary" style={{ marginTop: '.6rem' }} onClick={create} disabled={ro}>Create ticket</button>
          <p className="small muted">You receive a unique reference (EE-SUP-####). SLA targets: Critical 4h · High 8h · Medium 24h · Low 72h.</p>
          <h3 style={{ marginTop: '1rem' }}>Support performance</h3>
          <p className="small muted" style={{ margin: '.2rem 0' }}>By status</p><Bars data={STATUSES.map((s) => ({ l: s, v: ts.filter((t) => t.status === s).length }))} />
          <p className="small muted" style={{ margin: '.6rem 0 .2rem' }}>By priority</p><Bars data={['Critical', 'High', 'Medium', 'Low'].map((s) => ({ l: s, v: ts.filter((t) => t.priority === s).length }))} />
        </div>
        <div className="card"><h3>Tickets</h3>
          <div className="pillrow"><input placeholder="Search tickets…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 150 }} />
            <select value={sf} onChange={(e) => setSf(e.target.value)} style={{ maxWidth: 190 }}><option value="all">All statuses</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
          <div style={{ display: 'grid', gap: '.55rem', marginTop: '.7rem', maxHeight: 560, overflow: 'auto' }}>
            {list.length ? list.map((t) => (
              <div key={t.id} className="card" style={{ padding: '.6rem .8rem', cursor: 'pointer', borderColor: active === t.id ? 'var(--lime)' : undefined }} onClick={() => setActive(t.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setActive(t.id); }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem' }}><strong>{t.title}</strong><span className={'prio ' + t.priority}>{t.priority.toUpperCase()}</span></div>
                <span className="small muted">{t.ref} · {t.category} · <strong>{t.status}</strong> · {t.department}<br />Assignee: {t.assignee} · Raised by {t.requester_name} · Updated {fmtT(t.updated_at)}</span><br /><SlaChip t={t} now={now} />
              </div>)) : <p className="muted small">No tickets yet.</p>}
          </div>
        </div>
      </div>
      <div className="card" style={{ marginTop: '1rem' }}><h3>Ticket detail &amp; resolution history</h3>
        {cur ? <TicketDetail key={cur.id} t={cur} events={events || []} staff={staff} ro={ro} officers={officers} now={now} /> : <p className="muted">Select a ticket from the list to view its full history, respond, reassign, escalate or close it.</p>}
      </div>
    </>
  );
}

function TicketDetail({ t, events, staff, ro, officers, now }: { t: Ticket; events: TicketEvent[]; staff: boolean; ro: boolean; officers: string[]; now: number }) {
  const { profile } = useAuth();
  const me = profile!;
  const [status, setStatus] = useState(t.status); const [assignee, setAssignee] = useState(t.assignee);
  const [reply, setReply] = useState(''); const [err, setErr] = useState('');
  const author = me.full_name || me.email;
  const opts = officers.includes(t.assignee) ? officers : [...officers, t.assignee];

  async function note(body: string, internal = false, att = {}) {
    const { error } = await supabase.from('ticket_events').insert({ ticket_id: t.id, author_id: me.id, author_name: author, body, internal, ...att });
    if (error) throw error;
  }
  async function save() {
    setErr('');
    const ch: string[] = []; if (status !== t.status) ch.push(`status ${t.status} → ${status}`); if (assignee !== t.assignee) ch.push(`assignee → ${assignee}`);
    if (!ch.length) return;
    const { error } = await supabase.from('tickets').update({ status, assignee }).eq('id', t.id);
    if (error) return setErr(error.message);
    try { await note('Updated: ' + ch.join('; ') + '.'); } catch (e) { setErr(errMsg(e)); }
  }
  async function escalate() {
    const i = PRIO.indexOf(t.priority); if (i >= PRIO.length - 1) return;
    const p = PRIO[i + 1];
    const { error } = await supabase.from('tickets').update({ priority: p }).eq('id', t.id);
    if (error) return setErr(error.message);
    await note(`Priority ESCALATED to ${p}. SLA target is now ${SLA_H[p]}h from creation.`);
  }
  async function respond(internal: boolean) {
    if (!reply.trim()) return; setErr('');
    try { await note(reply.trim(), internal); setReply(''); } catch (e) { setErr(errMsg(e)); }
  }
  async function attach(f: File) {
    setErr('');
    try { const att = await uploadAttachment(me.id, f); await note('Attached ' + f.name, false, att); } catch (e) { setErr(errMsg(e)); }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', flexWrap: 'wrap' }}><strong style={{ fontSize: '1.05rem' }}>{t.title}</strong><span className={'prio ' + t.priority}>{t.priority.toUpperCase()}</span></div>
      <p className="small muted">{t.ref} · {t.category} · {t.department} · Raised by {t.requester_name} on {fmtT(t.created_at)} · Last updated {fmtT(t.updated_at)} <SlaChip t={t} now={now} /></p>
      <div className="grid g2">
        <div><label>Status</label><select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!staff}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div><label>Assigned support officer</label><select value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={!staff}>{opts.map((o) => <option key={o}>{o}</option>)}</select></div>
      </div>
      <div className="pillrow" style={{ marginTop: '.6rem' }}>
        <button className="btn primary small" onClick={save} disabled={!staff}>Save status &amp; assignment</button>
        <button className="btn small" onClick={escalate} disabled={!staff || t.priority === 'Critical'}>Escalate priority</button>
        <label className="btn small" style={{ cursor: 'pointer', margin: 0, ...(ro ? { opacity: 0.45, pointerEvents: 'none' } : {}) }}>Attach file<input type="file" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) attach(f); e.target.value = ''; }} /></label>
      </div>
      {!staff && <p className="small muted">Status, assignment and escalation are restricted to support staff, supervisors and administrators{ro ? ' — your Auditor role is read-only' : ''}.</p>}
      <label>Add a response (visible to the requester)</label>
      <textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} disabled={ro} placeholder={ro ? 'Read-only role — responses disabled' : 'Write an update…'} maxLength={4000} />
      <div className="pillrow" style={{ marginTop: '.5rem' }}><button className="btn small" onClick={() => respond(false)} disabled={ro}>Add response</button>{staff && <button className="btn small" onClick={() => respond(true)}>Add internal note</button>}</div>
      {err && <p className="small" style={{ color: '#FF8A84' }}>{err}</p>}
      <h3 style={{ marginTop: '1rem' }}>History &amp; resolution record</h3>
      <div style={{ display: 'grid', gap: '.45rem' }}>
        {events.map((h) => <div key={h.id} className="card" style={{ padding: '.5rem .7rem' }}><span className="small muted">{fmtT(h.created_at)} · {h.author_name} {h.internal && <span className="chip a">INTERNAL NOTE</span>}</span><br /><span style={{ whiteSpace: 'pre-wrap' }}>{h.body}</span>
          {h.file_path && <><br /><button className="chip" style={{ cursor: 'pointer', background: 'none', color: 'inherit', marginTop: '.3rem' }} onClick={() => openAttachment(h.file_path!)}>▤ {h.file_name} · {kb(h.file_size)}</button></>}</div>)}
      </div>
    </>
  );
}
