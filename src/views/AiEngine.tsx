import { supabase } from '../lib/supabase';
import { useLive, must } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { perms } from '../lib/roles';
import { useModal } from '../components/ui';
import type { AiModel } from '../lib/types';

const PIPE = ['Capture image / video frame', 'Validate input & image quality', 'Detect traffic signal objects', 'Identify illuminated signal regions', 'Classify colours & directional arrows', 'Apply temporal consistency checks', 'Calculate confidence score', 'Assign VERIFIED state or UNKNOWN', 'Generate timestamped detection event (Africa/Accra)', 'Forward authorised results to dashboard'];

export default function AiEngine() {
  const { profile } = useAuth();
  const modal = useModal();
  const { data: models, reload } = useLive(async () => must(await supabase.from('ai_models').select('*').order('id')) as AiModel[], []);
  const can = perms.designateModel(profile?.role);
  function designate(m: AiModel) {
    modal({ title: 'Change designated model', ok: 'Designate', body: <>Designate <strong>{m.version}</strong> as the production version (rollback / roll-forward)? The change is recorded in the audit log. Deployment to the inference service happens once that service is connected.</>,
      cb: async () => { const { error } = await supabase.rpc('designate_model', { p_id: m.id }); if (error) modal({ title: 'Not changed', body: error.message, ok: 'Close' }); reload(); } });
  }
  return (
    <>
      <div className="card"><h3>10-step inference pipeline</h3><ol style={{ margin: 0, paddingLeft: '1.2rem' }}>{PIPE.map((s, i) => <li key={s} style={{ padding: '.3rem 0', borderBottom: '1px solid var(--line)' }}><strong>Step {i + 1}.</strong> {s}</li>)}</ol></div>
      <div className="card" style={{ marginTop: '1rem' }}><h3>AI model registry</h3>
        <div className="tablewrap"><table><thead><tr><th>Version</th><th>Dataset ref</th><th>Evaluation</th><th>Status</th><th></th></tr></thead><tbody>
          {(models || []).map((m) => <tr key={m.id}><td className="mono">{m.version}</td><td className="small">{m.dataset_ref}</td><td className="small">{m.evaluation}</td>
            <td><span className={'chip ' + (m.status === 'PRODUCTION' ? 'g' : '')}>{m.status === 'PRODUCTION' ? 'PRODUCTION (designated)' : m.status}</span></td>
            <td>{m.status !== 'PRODUCTION' && m.status !== 'DEMO ONLY' && can && <button className="btn small" onClick={() => designate(m)}>Designate / Rollback</button>}</td></tr>)}
        </tbody></table></div>
        <p className="small muted">No model is trained or deployed on unverified surveillance footage. The only inference running in this application is the labelled on-device heuristic in Mobile Camera Detection. Only Super/System Administrators and Supervisors can change the designated version (enforced in the database).</p>
      </div>
    </>
  );
}
