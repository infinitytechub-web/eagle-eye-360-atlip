import { supabase } from '../lib/supabase';
import { useLive, must } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { perms } from '../lib/roles';
import { useEffect, useState } from 'react';
import { useModal } from '../components/ui';
import { loadManifest, type Manifest } from '../ai/detector';
import type { AiModel } from '../lib/types';

const PIPE = ['Capture image / video frame', 'Validate input & image quality', 'Detect traffic signal objects', 'Identify illuminated signal regions', 'Classify colours & directional arrows', 'Apply temporal consistency checks', 'Calculate confidence score', 'Assign VERIFIED state or UNKNOWN', 'Generate timestamped detection event (Africa/Accra)', 'Forward authorised results to dashboard'];

export default function AiEngine() {
  const { profile } = useAuth();
  const modal = useModal();
  const { data: models, reload } = useLive(async () => must(await supabase.from('ai_models').select('*').order('id')) as AiModel[], []);
  const can = perms.designateModel(profile?.role);
  const [mf, setMf] = useState<Manifest | null>(null);
  useEffect(() => { loadManifest().then(setMf).catch(() => {}); }, []);
  const pct = (v: unknown) => (typeof v === 'number' ? Math.round(v * 1000) / 10 + '%' : '—');
  function designate(m: AiModel) {
    modal({ title: 'Change designated model', ok: 'Designate', body: <>Designate <strong>{m.version}</strong> as the production version (rollback / roll-forward)? The change is recorded in the audit log. Deployment to the inference service happens once that service is connected.</>,
      cb: async () => { const { error } = await supabase.rpc('designate_model', { p_id: m.id }); if (error) modal({ title: 'Not changed', body: error.message, ok: 'Close' }); reload(); } });
  }
  return (
    <>
      {mf && <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--gold)' }}>
        <h3>Deployed AI pipeline — {mf.pipeline} <span className="chip g">LIVE on-device</span></h3>
        <p className="small muted">Measured {mf.evaluated}. Operating point: detector confidence ≥ {mf.operating_point.detector_conf}, state confidence ≥ {mf.operating_point.state_conf}, {mf.operating_point.temporal_frames} agreeing frames. Inference runs in the browser (WebAssembly); frames never leave the device.</p>
        <div className="grid g2">
          <div><h3>Stage 1 — traffic-light detector</h3>
            <div className="tablewrap"><table><thead><tr><th>Model</th><th>Recall (lights ≥ 25 px)</th><th>Precision*</th><th>CPU / frame</th></tr></thead><tbody>
              {mf.detectors.map((d) => <tr key={d.id}><td>{d.label}</td><td>{pct(d.eval.recall_lights_ge_25px)}</td><td>{pct(d.eval.precision_ge_25px_conf_0_25)}</td><td>{String(d.eval.cpu_ms_single_thread)} ms</td></tr>)}
            </tbody></table></div>
            <p className="small muted">Test set: {String(mf.detectors[0].eval.dataset)}. *{String(mf.detectors[0].eval.note)} Licence: {mf.detectors[0].licence}.</p></div>
          <div><h3>Stage 2 — ATLIP signal-state classifier</h3>
            <div className="tablewrap"><table><tbody>
              <tr><td>In-domain test accuracy</td><td><strong>{pct(mf.state_classifier.eval_in_domain.accuracy)}</strong></td></tr>
              <tr><td>Lights classified at operating point</td><td>{pct((mf.state_classifier.eval_in_domain.at_conf_0_7 as Record<string, number>).lights_classified)}</td></tr>
              <tr><td>Unseen German crops — precision of colour claims</td><td><strong>{pct((mf.state_classifier.eval_cross_dataset.at_conf_0_7 as Record<string, number>).precision_of_colour_claims)}</strong></td></tr>
              <tr><td>Unseen German crops — coverage (rest → UNKNOWN)</td><td>{pct((mf.state_classifier.eval_cross_dataset.at_conf_0_7 as Record<string, number>).coverage)}</td></tr>
            </tbody></table></div>
            <p className="small muted">Trained on: {mf.state_classifier.trained_on}.</p></div>
        </div>
        <h3>Known limitations</h3><ul className="small">{mf.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
      </div>}
      <div className="card"><h3>10-step inference pipeline</h3><ol style={{ margin: 0, paddingLeft: '1.2rem' }}>{PIPE.map((s, i) => <li key={s} style={{ padding: '.3rem 0', borderBottom: '1px solid var(--line)' }}><strong>Step {i + 1}.</strong> {s}</li>)}</ol></div>
      <div className="card" style={{ marginTop: '1rem' }}><h3>AI model registry</h3>
        <div className="tablewrap"><table><thead><tr><th>Version</th><th>Dataset ref</th><th>Evaluation</th><th>Status</th><th></th></tr></thead><tbody>
          {(models || []).map((m) => <tr key={m.id}><td className="mono">{m.version}</td><td className="small">{m.dataset_ref}</td><td className="small">{m.evaluation}</td>
            <td><span className={'chip ' + (m.status === 'PRODUCTION' ? 'g' : '')}>{m.status === 'PRODUCTION' ? 'PRODUCTION (designated)' : m.status}</span></td>
            <td>{m.status !== 'PRODUCTION' && m.status !== 'DEMO ONLY' && can && <button className="btn small" onClick={() => designate(m)}>Designate / Rollback</button>}</td></tr>)}
        </tbody></table></div>
        <p className="small muted">No model is trained on unverified surveillance footage. The production pipeline runs on-device in Mobile Camera Detection and in the AI Traffic Light Detection page. Only Super/System Administrators and Supervisors can change the designated version (enforced in the database).</p>
      </div>
    </>
  );
}
