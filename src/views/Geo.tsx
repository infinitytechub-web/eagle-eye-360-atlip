import { useState } from 'react';
import { useData } from '../lib/data';
import { StateChip } from '../components/ui';

const fill = (s: string) => (s === 'RED' ? '#FF3B30' : s === 'CAUTION' ? '#FFB340' : s === 'GREEN' ? '#2EFF7A' : '#777');

/** Haversine distance in metres. */
function dist(a: [number, number], b: [number, number]) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function Geo() {
  const { intersections, cameras, stats } = useData();
  const [sel, setSel] = useState('IX-01');
  const [gps, setGps] = useState<{ lat: number; lon: number; acc: number } | null>(null);
  const [gpsErr, setGpsErr] = useState('');
  const ix = intersections.find((i) => i.id === sel);

  function readGps() {
    setGpsErr('');
    if (!navigator.geolocation) return setGpsErr('Geolocation not supported.');
    navigator.geolocation.getCurrentPosition((p) => setGps({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => setGpsErr('Permission denied or unavailable: ' + e.message), { enableHighAccuracy: true, timeout: 15000 });
  }
  const nearest = gps ? [...intersections].map((i) => ({ i, d: dist([gps.lat, gps.lon], [i.lat, i.lon]) })).sort((a, b) => a.d - b.d)[0] : null;

  return (
    <div className="grid g2">
      <div className="card"><h3>Accra &amp; Kumasi — intersection map (schematic)</h3>
        <svg viewBox="0 0 480 240" style={{ width: '100%', background: '#0A2342', border: '1px solid var(--line)', borderRadius: 12 }} role="img" aria-label="Schematic intersection map">
          <g stroke="#2E5E8F"><path d="M0 120 H480 M120 0 V240 M300 0 V240 M0 60 H480 M0 190 H480" strokeWidth="1" /></g>
          <path d="M40 210 Q200 150 300 110 T460 60" fill="none" stroke="#D4AF37" strokeWidth="5" />
          <text x="14" y="228" fill="#B9C9DE" fontSize="11">Tema →</text><text x="14" y="22" fill="#B9C9DE" fontSize="11">← Kumasi (schematic, off-scale)</text>
          {intersections.map((i) => (
            <g key={i.id} style={{ cursor: 'pointer' }} onClick={() => setSel(i.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSel(i.id); }} role="button" aria-label={i.name}>
              <circle cx={i.map_x} cy={i.map_y} r={13} fill="none" stroke="#D4AF37" opacity={sel === i.id ? 1 : 0.6} strokeWidth={sel === i.id ? 3 : 1} />
              <circle cx={i.map_x} cy={i.map_y} r={6} fill={fill(i.current_state)} />
              <text x={i.map_x + 16} y={i.map_y + 4} fill="#FFFFFF" fontSize="11" fontWeight="700">{i.name.split('/')[0].split('—')[0].trim().slice(0, 26)}</text>
            </g>))}
        </svg>
        <p className="small muted">Schematic monitoring map, not to navigation scale. Select a node for details. GPS gives the device/camera position — it does <strong>not</strong> by itself identify which signal is observed; assignment is manual and verified.</p>
      </div>
      <div className="card"><h3>Intersection detail</h3>
        {ix ? <><p><strong>{ix.name}</strong> — {ix.city}</p>
          <p className="small">GPS: <span className="mono">{ix.lat.toFixed(4)}, {ix.lon.toFixed(4)}</span><br />Currently observed: <StateChip s={ix.current_state} /><br />
            Assigned cameras: {cameras.filter((c) => c.intersection_id === ix.id).map((c) => `${c.id} ${c.name}`).join('; ') || 'None'}<br />
            Detections (7 days): {stats?.by_intersection_7d?.[ix.id] ?? 0}</p>
          <p className="small muted">Assignment is manual and verified by an operator — GPS proximity alone never assigns a signal.</p></> : <p className="muted">Select a node on the map.</p>}
        <h3 style={{ marginTop: '1rem' }}>Location verification</h3>
        <p className="small">Device GPS (if you allow it) is shown for comparison only — it never auto-assigns a camera to an intersection.</p>
        <button className="btn" onClick={readGps}>Read my device GPS</button>
        {gps && <p className="small mono">{gps.lat.toFixed(5)}, {gps.lon.toFixed(5)} (±{Math.round(gps.acc)} m)</p>}
        {nearest && <p className="small">Nearest registered intersection: <strong>{nearest.i.name}</strong> — {nearest.d < 1000 ? Math.round(nearest.d) + ' m' : (nearest.d / 1000).toFixed(1) + ' km'} away (comparison only).</p>}
        {gpsErr && <p className="small" style={{ color: '#FF8A84' }}>{gpsErr}</p>}
      </div>
    </div>
  );
}
