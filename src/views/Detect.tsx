import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { perms } from '../lib/roles';
import { ModelAnalyse } from '../components/ModelAnalyse';

type Scene = 'RED' | 'CAUTION' | 'GREEN' | 'GREEN_ARROW_LEFT' | 'PEDESTRIAN' | 'UNKNOWN';

export default function Detect() {
  const { profile } = useAuth();
  const { intersections } = useData();
  const [frame, setFrame] = useState(1);
  const [state, setState] = useState<Scene | null>(null);
  const [conf, setConf] = useState(0);
  const [ix, setIx] = useState('IX-01');
  const [record, setRecord] = useState(false);
  const [msg, setMsg] = useState('');

  async function run(s: Scene) {
    const c = s === 'UNKNOWN' ? 0 : 0.9 + Math.random() * 0.08;
    setFrame(frame + 1); setState(s); setConf(c); setMsg('');
    if (record && perms.recordDetection(profile?.role)) {
      const main = s.startsWith('GREEN') || s === 'PEDESTRIAN' ? 'GREEN' : s;
      const { error } = await supabase.from('detection_events').insert({
        intersection_id: ix, state: main, detail: s, confidence: s === 'UNKNOWN' ? null : Number(c.toFixed(3)),
        verified: s !== 'UNKNOWN', source: 'demo-scene', user_id: profile!.id,
      });
      setMsg(error ? 'Not recorded: ' + error.message : 'Recorded to the event log as source “demo-scene”.');
    }
  }

  const obscured = state === 'UNKNOWN';
  const main = !state ? null : state.startsWith('GREEN') || state === 'PEDESTRIAN' ? 'GREEN' : state;
  const glow = (k: string) => (main === k ? '0 0 26px currentColor' : 'none');
  const checks: [string, string][] = !state ? [] : obscured
    ? [['Signal housing detected', 'PASS — housing outline found'], ['Illuminated region', 'FAIL — region obscured / glare-saturated'], ['Colour classification', 'NOT RUN — no reliable region'], ['Spatial position check', 'NOT RUN'], ['Temporal consistency (5 frames)', 'FAIL — state flickers'], ['Verdict', 'UNKNOWN — visibility insufficient. Correct safe result.']]
    : [['Signal housing detected', 'PASS — vertical 3-aspect housing'], ['Illuminated region', 'PASS — single bright region, position ' + (main === 'RED' ? 'top' : main === 'CAUTION' ? 'middle' : 'bottom')], ['Colour classification', 'PASS — hue matches ' + main + (state.includes('ARROW') ? ' + left-arrow shape' : '') + (state === 'PEDESTRIAN' ? ' · pedestrian aspect' : '')], ['Spatial position check', 'PASS — lamp order consistent with GH standard'], ['Temporal consistency (5 frames)', 'PASS — stable across frames'], ['Verdict', 'VERIFIED ' + state.replace(/_/g, ' ')]];

  return (
    <>
      <ModelAnalyse />
      <div className="grid g2">
        <div className="card"><h3>Verification pipeline walkthrough — labelled demo scene</h3>
          <div className="feed"><div className="fh"><span>DEMO SCENE — not a live camera</span><span>Frame {frame}</span></div>
            <div className="scene">
              <div style={{ position: 'absolute', left: '44%', top: '8%', width: 56, height: 150, background: '#0A2342', border: '2px solid #2E5E8F', borderRadius: 10 }} />
              <div style={{ position: 'absolute', left: 'calc(44% + 13px)', top: 18, width: 30, height: 30, borderRadius: '50%', background: '#3A0806', border: '2px solid #FF3B30', color: '#FF3B30', boxShadow: glow('RED') }} />
              <div style={{ position: 'absolute', left: 'calc(44% + 13px)', top: 62, width: 30, height: 30, borderRadius: '50%', background: '#241A04', border: '2px solid #6B5312', color: '#FFB340', boxShadow: glow('CAUTION') }} />
              <div style={{ position: 'absolute', left: 'calc(44% + 13px)', top: 106, width: 30, height: 30, borderRadius: '50%', background: '#06280F', border: '2px solid #2E5E8F', color: '#2EFF7A', boxShadow: glow('GREEN') }} />
              <div className="bbox" style={{ left: '42%', top: '4%' }}>signal_head · {obscured ? 'occluded' : conf.toFixed(2)}</div>
            </div></div>
          <label>Choose a demo scene state</label>
          <div className="pillrow">
            {(['RED', 'CAUTION', 'GREEN', 'GREEN_ARROW_LEFT', 'PEDESTRIAN', 'UNKNOWN'] as Scene[]).map((s) => <button key={s} className="btn small" onClick={() => run(s)}>{s === 'CAUTION' ? 'CAUTION (amber)' : s === 'GREEN_ARROW_LEFT' ? 'GREEN + left arrow' : s === 'PEDESTRIAN' ? 'Pedestrian signal' : s === 'UNKNOWN' ? 'Obscured → UNKNOWN' : s}</button>)}
          </div>
          {perms.recordDetection(profile?.role) && <>
            <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={record} onChange={(e) => setRecord(e.target.checked)} /> Record results to the event log (labelled “demo-scene”)</label>
            {record && <><label>Intersection</label><select value={ix} onChange={(e) => setIx(e.target.value)}>{intersections.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></>}
          </>}
          {msg && <p className="small" style={{ color: 'var(--lime)' }}>{msg}</p>}
          <p className="small muted">These scenes illustrate the verification checks step by step. For real inference, use the AI model card above or Mobile Camera Detection.</p>
        </div>
        <div className="card"><h3>Verification panel — never colour alone</h3>
          <div className="sig"><div className={'lamp ' + (obscured || !main ? 'UNKNOWN' : main)}>{obscured ? '?' : main || '—'}</div>
            <div><strong style={{ fontSize: '1.3rem' }}>{!state ? 'No frame analysed yet' : obscured ? 'UNKNOWN / UNVERIFIED' : state.replace(/_/g, ' ')}</strong><br />
              <span className="muted">{!state ? 'Run a scene to see the checks.' : obscured ? 'Confidence withheld — system refuses to guess.' : `Scene confidence ${Math.round(conf * 100)}% · temporal verification passed.`}</span></div></div>
          <table style={{ marginTop: '.7rem' }}><thead><tr><th>Check</th><th>Result</th></tr></thead><tbody>
            {checks.length ? checks.map((c) => <tr key={c[0]}><td>{c[0]}</td><td><strong>{c[1]}</strong></td></tr>) : <tr><td colSpan={2} className="muted">Awaiting frame…</td></tr>}
          </tbody></table>
          <p className="small muted">Pipeline: housing detected → illuminated region located → colour &amp; arrow classified → spatial position matches lamp order → temporal consistency across frames → confidence → VERIFIED or UNKNOWN.</p>
        </div>
      </div>
      <div className="card" style={{ marginTop: '1rem' }}><h3>Supported signal types</h3><div className="pillrow">
        <span className="chip r">● RED</span><span className="chip a">● CAUTION (amber)</span><span className="chip g">● GREEN</span><span className="chip">← Left-turn arrow</span><span className="chip">→ Right-turn arrow</span><span className="chip">↑ Straight-ahead arrow</span><span className="chip">Combined directional</span><span className="chip">Pedestrian signal</span><span className="chip grey">UNKNOWN / UNVERIFIED</span></div>
        <p className="small muted">Conditions the production engine must handle: daylight, night, rain/fog, motion blur, glare, partial obstruction, multiple lights in one frame.</p></div>
    </>
  );
}
