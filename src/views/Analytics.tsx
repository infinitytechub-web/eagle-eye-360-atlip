import { useData } from '../lib/data';
import { Bars } from '../components/ui';

export default function Analytics() {
  const { stats, cameras, intersections } = useData();
  const s7 = stats?.by_state_7d || {};
  const bands = stats?.conf_bands_7d || {};
  const worst = [...cameras].sort((a, b) => b.obstruction_count - a.obstruction_count)[0];
  return (
    <>
      <div className="grid g3">
        <div className="card"><h3>Red / Amber / Green frequency (7 days)</h3><Bars data={['RED', 'CAUTION', 'GREEN', 'UNKNOWN'].map((l) => ({ l, v: Number(s7[l] || 0) }))} /></div>
        <div className="card"><h3>Confidence distribution (7 days)</h3><Bars data={Object.entries(bands).map(([l, v]) => ({ l, v: Number(v) }))} />
          <p className="small">Share of events by confidence band. Calibration against a trained model is <strong>not yet done</strong>.</p></div>
        <div className="card"><h3>Camera performance</h3><div className="tablewrap"><table><thead><tr><th>Camera</th><th>Events</th><th>Obstructed</th><th>Status</th></tr></thead><tbody>
          {cameras.map((c) => <tr key={c.id}><td>{c.id}</td><td>{c.events_count}</td><td>{c.obstruction_count}</td><td><span className={'chip ' + (c.status === 'Online' ? 'g' : c.status === 'Obstructed' ? 'a' : 'r')}>{c.status}</span></td></tr>)}
        </tbody></table></div></div>
      </div>
      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <div className="card"><h3>Trends by location (7 days)</h3>
          <Bars data={intersections.map((ix) => ({ l: ix.name.split(/[ /]/)[0], v: Number(stats?.by_intersection_7d?.[ix.id] || 0) }))} />
          <p className="small">Event sources over 7 days: {Object.entries(stats?.by_source_7d || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}.</p></div>
        <div className="card"><h3>False-positive / false-negative analysis</h3>
          <p>Events flagged for analyst review in the last 7 days (UNKNOWN or confidence below 0.70): <strong>{stats?.review_flagged_7d ?? '—'}</strong></p>
          <p className="small">True FP/FN rates require a labelled ground-truth set evaluated against the trained YOLO model. That evaluation has <strong>not</strong> been run — no accuracy figure is claimed here. Observed signal states are never presented as traffic violations.</p>
          <h3>Visibility &amp; obstruction</h3>
          <p className="small">{worst ? `${worst.id} (${worst.name}) reports the highest obstruction count (${worst.obstruction_count} events). Field verification is required before any maintenance claim.` : '—'}</p></div>
      </div>
    </>
  );
}
