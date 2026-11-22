import { SUPABASE_URL } from '../lib/supabase';

const TABLES: [string, string, string][] = [
  ['profiles', 'User accounts, role (7), command, activation, theme, preferences', 'Self read/update (name, theme, prefs); role & activation by admins only (trigger-guarded)'],
  ['intersections', 'Monitored intersections, GPS, map position, current observed state', 'Read: active users · Write: admins & supervisors'],
  ['cameras', 'Authorised cameras with masked gateway reference + vault ID (never credentials)', 'Read: active · Register: operators, support, supervisors, admins · Delete: admins'],
  ['detection_events', 'Every observed signal state with source, confidence, verification', 'Read: active · Insert: non-auditors, own user id, sources demo-scene / mobile-heuristic'],
  ['alerts', 'Operational and security alerts with acknowledgement', 'Read: active · Raise/ack: operators, analysts, supervisors, admins'],
  ['evidence_records', 'Evidence metadata with SHA-256 computed by a database trigger', 'Read: active · Create: analysts+ · Delete: super admin & supervisors'],
  ['ai_models', 'Model registry and designated production version', 'Read: active · Designate: admins & supervisors via RPC'],
  ['audit_logs', 'Append-only audit trail', 'Insert only via log_audit() · Read: admins, supervisors, auditors (+ own entries)'],
  ['notifications / notification_reads', 'Targeted notifications (all / user / role) and per-user read state', 'Targeted read · Issue: admins & supervisors'],
  ['chat_messages', 'Live chat (Command Group + direct messages) with read receipts', 'Only conversation participants can read or write'],
  ['comm_messages / comm_receipts', 'Channel messages, read receipts, acknowledgements', 'Broadcast & Emergency restricted to admins & supervisors'],
  ['tickets / ticket_events', 'Support tickets, SLA, history, internal notes, attachments', 'Duplicate open titles blocked by unique index · Internal notes staff-only'],
  ['branding / branding_versions', 'Published identity and version history', 'Public read (login page) · Write: super admin only'],
];
const RPC: [string, string][] = [
  ['log_audit(action, target, category)', 'Append an audit entry as the signed-in user'],
  ['detection_stats()', 'Aggregated 24h / 7-day statistics (RLS applies)'],
  ['designate_model(id)', 'Change the designated production model (role-checked)'],
  ['heartbeat()', 'Update last-seen time for presence'],
  ['functions/v1/admin-users', 'Edge function: create users, change roles, activate/deactivate (admins only)'],
];

export default function Schema() {
  return (
    <>
      <div className="card"><h3>PostgreSQL / Supabase schema — live</h3>
        <p className="small">Project <span className="mono">{SUPABASE_URL.replace('https://', '')}</span> · Postgres 17 · Row-Level Security on every table · RLS helper functions live in a private <span className="mono">app</span> schema that is not exposed through the API. Full migration SQL is in the repository under <span className="mono">supabase/migrations/</span>.</p>
        <div className="tablewrap"><table><thead><tr><th>Table</th><th>Purpose</th><th>Access policy (enforced in the database)</th></tr></thead><tbody>
          {TABLES.map((t) => <tr key={t[0]}><td className="mono">{t[0]}</td><td className="small">{t[1]}</td><td className="small">{t[2]}</td></tr>)}
        </tbody></table></div>
      </div>
      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <div className="card"><h3>API — REST (PostgREST), RPC &amp; Edge Functions</h3>
          <p className="small">Every table above is available at <span className="mono">/rest/v1/&lt;table&gt;</span> with the caller’s JWT; RLS decides what each role can see or change.</p>
          <div className="tablewrap"><table><thead><tr><th>Endpoint</th><th>Purpose</th></tr></thead><tbody>{RPC.map((r) => <tr key={r[0]}><td className="mono">{r[0]}</td><td className="small">{r[1]}</td></tr>)}</tbody></table></div>
          <p className="small muted">Storage buckets: <span className="mono">branding</span> (public read, super-admin write, 1 MB images) · <span className="mono">attachments</span> (private, signed URLs, own-folder uploads, 10 MB).</p>
        </div>
        <div className="card"><h3>Realtime events (live)</h3><ul className="check">
          {['detection_events', 'alerts', 'cameras', 'notifications', 'chat_messages', 'comm_messages / comm_receipts', 'tickets / ticket_events', 'branding', 'presence:atlip (online / idle users)'].map((e) => <li key={e}><span className="mono">{e}</span><span className="chip g">live</span></li>)}
        </ul>
          <h3>Technology stack</h3><p className="small">Frontend React 18 / Vite / TypeScript PWA · Backend Supabase (Postgres 17, Auth with TOTP MFA, Realtime, Storage, Edge Functions) · Hosting Hostinger (Apache, HTTPS, CSP) · Source GitHub. Planned: AI inference service (PyTorch / Ultralytics YOLO / ONNX Runtime), video gateway (RTSP → WebRTC/HLS), Capacitor mobile and Tauri desktop packaging.</p>
        </div>
      </div>
    </>
  );
}
