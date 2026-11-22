import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, audit } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useData } from '../lib/data';
import { useLive, must } from '../lib/hooks';
import { perms } from '../lib/roles';
import { compass } from '../lib/geo';
import { fmtClock, errMsg } from '../lib/util';
import { speak, stopSpeaking, speechAvailable, webVoices } from '../lib/speech';
import { watchLocation, keepAwake, locationPermission, type PermissionStatus } from '../lib/location';
import { ProximityEngine, DEFAULT_VOICE, type Fix, type Signal, type VoiceSettings } from '../lib/voiceAlerts';
import { StateChip } from '../components/ui';

async function loadSignals(): Promise<Signal[]> {
  const all: Signal[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const page = must(await supabase.from('traffic_signals').select('id, lat, lon, name, intersection_id').order('id').range(from, from + 999)) as Signal[];
    all.push(...page); if (page.length < 1000) break;
  }
  return all;
}

export default function VoiceAlerts() {
  const { profile, refreshProfile } = useAuth();
  const { intersections } = useData();
  const saved = ((profile?.prefs as { voice?: Partial<VoiceSettings> })?.voice) || {};
  const [s, setS] = useState<VoiceSettings>({ ...DEFAULT_VOICE, ...saved });
  const { data: signals, reload: reloadSignals } = useLive(loadSignals, ['traffic_signals']);
  const [perm, setPerm] = useState<PermissionStatus>('prompt');
  const [on, setOn] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [fix, setFix] = useState<Fix | null>(null);
  const [log, setLog] = useState<{ t: number; text: string }[]>([]);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const engine = useRef<ProximityEngine | null>(null);
  const stopFns = useRef<(() => void)[]>([]);
  const [, tick] = useState(0);

  const stateOf = useMemo(() => { const m = new Map(intersections.map((i) => [i.id, i.current_state])); return (id: string) => m.get(id); }, [intersections]);
  const ixName = useMemo(() => { const m = new Map(intersections.map((i) => [i.id, i.name])); return (id: string) => m.get(id); }, [intersections]);

  useEffect(() => { locationPermission().then(setPerm); const v = () => setVoices(webVoices().filter((x) => x.lang.startsWith('en'))); v(); if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = v; }, []);
  useEffect(() => { engine.current?.update(s); }, [s]);
  useEffect(() => { if (signals) engine.current?.setSignals(signals); }, [signals]);
  useEffect(() => () => { stopFns.current.forEach((f) => f()); stopSpeaking(); }, []);

  async function start() {
    setErr(''); setMsg('');
    if (!speechAvailable()) return setErr('Voice output is not available on this device.');
    if (!signals?.length) return setErr('No traffic-light locations loaded yet.');
    try {
      engine.current = new ProximityEngine(signals, s, stateOf, ixName);
      const stopWatch = await watchLocation((f) => {
        setFix(f);
        const a = engine.current!.push(f); tick((n) => n + 1);
        if (a) { setLog((l) => [{ t: Date.now(), text: a.text }, ...l].slice(0, 30)); speak(a.text, s).catch((e) => setErr(errMsg(e))); }
      }, (m) => { setErr(m); if (/denied/i.test(m)) { stop(); setPerm('denied'); } });
      const release = await keepAwake(true);
      stopFns.current = [stopWatch, release];
      setOn(true); setPerm('granted');
      speak('Voice alerts on. I will tell you when a traffic light is ahead.', s).catch(() => {});
      await audit('Voice traffic-light alerts started', null, 'detection'); // no location is recorded
    } catch (e) { setErr(errMsg(e)); locationPermission().then(setPerm); }
  }
  function stop() {
    stopFns.current.forEach((f) => f()); stopFns.current = []; stopSpeaking(); engine.current = null;
    setOn(false); setFix(null); setMsg('Voice alerts stopped. Location tracking is off.');
  }
  async function save() {
    const { error } = await supabase.from('profiles').update({ prefs: { ...(profile!.prefs || {}), voice: s } }).eq('id', profile!.id);
    if (error) setErr(error.message); else { setMsg('Settings saved to your account.'); refreshProfile(); }
  }
  async function addHere() {
    if (!fix) return setErr('Start voice alerts first so your position is known.');
    if (fix.accuracy > 25) return setErr(`GPS accuracy is ±${Math.round(fix.accuracy)} m — move to open sky and try again (needs ±25 m or better).`);
    const name = prompt('Name for this traffic light (e.g. “Achimota Mall junction”)')?.trim(); if (!name) return;
    const { error } = await supabase.from('traffic_signals').insert({ lat: fix.lat, lon: fix.lon, name: name.slice(0, 120), source: 'manual', created_by: profile!.id });
    if (error) setErr(error.message); else { setMsg('Traffic light added for everyone.'); reloadSignals(); await audit('Traffic light location added', name, 'detection'); }
  }

  const n = engine.current?.nearest;
  const distStr = (d: number) => (d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m');
  const nIx = n?.signal.intersection_id ? intersections.find((i) => i.id === n.signal.intersection_id) : null;

  return (
    <>
      <div className="notice warn"><strong>Driving safety:</strong> voice alerts are <strong>advisory only</strong> and may be late or missing (GPS accuracy, unmapped signals). Always obey the physical signal and road rules. Set up before you drive — do not operate the phone while driving.</div>
      <div className="grid g2" style={{ marginTop: '1rem' }}>
        <div className="card"><h3>Voice traffic-light alerts</h3>
          <div className="sig"><div className={'lamp ' + (on ? 'GREEN' : 'UNKNOWN')} style={{ fontSize: '.6rem' }}>{on ? 'ON' : 'OFF'}</div>
            <div><strong style={{ fontSize: '1.15rem' }}>{on ? 'Listening for traffic lights ahead' : 'Alerts are off'}</strong><br /><span className="muted small">{signals ? `${signals.length.toLocaleString()} traffic-light locations loaded` : 'Loading locations…'} · location permission: {perm}</span></div></div>
          <div className="pillrow" style={{ marginTop: '.8rem' }}>
            {!on ? <button className="btn primary" onClick={start} disabled={!signals}>▶ Start voice alerts</button> : <button className="btn danger" onClick={stop}>■ Stop</button>}
            <button className="btn" onClick={() => speak('Traffic light ahead in 300 metres, Circle interchange. Last observed: red. Prepare to stop.', s).catch((e) => setErr(errMsg(e)))}>🔊 Test voice</button>
            {perms.registerCamera(profile?.role) && on && <button className="btn" onClick={addHere}>📍 Add traffic light here</button>}
          </div>
          {perm === 'denied' && <p className="small" style={{ color: '#FF8A84' }}>Location is blocked for this site. Enable it in your browser or phone settings (Settings → Privacy → Location), then try again.</p>}
          {err && <p className="small" style={{ color: '#FF8A84' }}>{err}</p>}{msg && <p className="small" style={{ color: 'var(--lime)' }}>{msg}</p>}
          {on && <table style={{ marginTop: '.7rem' }}><tbody>
            <tr><td className="muted">GPS accuracy</td><td><strong>{fix ? `±${Math.round(fix.accuracy)} m` : 'waiting for first fix…'}</strong>{fix && fix.accuracy > 60 && <span className="chip a" style={{ marginLeft: '.4rem' }}>too imprecise — alerts paused</span>}</td></tr>
            <tr><td className="muted">Speed / heading</td><td><strong>{engine.current ? `${Math.round(engine.current.speedKmh)} km/h` : '—'}</strong>{engine.current?.heading != null ? ` · heading ${compass(engine.current.heading)}` : ''}{engine.current && engine.current.speedKmh < s.minSpeedKmh && <span className="small muted"> (quiet below {s.minSpeedKmh} km/h)</span>}</td></tr>
            <tr><td className="muted">Nearest traffic light</td><td><strong>{n ? `${distStr(n.distance)} ${n.ahead ? 'ahead' : '(not ahead)'}` : 'none within 1.2 km'}</strong>{n && <><br /><span className="small">{nIx?.name || n.signal.name || 'Unnamed signal'} {nIx && <StateChip s={nIx.current_state} />}</span></>}</td></tr>
          </tbody></table>}
          <h3 style={{ marginTop: '1rem' }}>Spoken alerts (this session)</h3>
          <div className="small" style={{ display: 'grid', gap: '.35rem', maxHeight: 200, overflow: 'auto' }}>
            {log.length ? log.map((l) => <div key={l.t} className="card" style={{ padding: '.4rem .6rem' }}>{fmtClock(l.t)} — {l.text}</div>) : <span className="muted">No alerts yet.</span>}
          </div>
        </div>
        <div className="card"><h3>Alert settings</h3>
          <label>Announce at</label>
          <select value={s.distances.join(',')} onChange={(e) => setS({ ...s, distances: e.target.value.split(',').map(Number) })}>
            <option value="300,100">300 m and 100 m (recommended in town)</option>
            <option value="500,200">500 m and 200 m (highways)</option>
            <option value="200">200 m only</option>
            <option value="150">150 m only</option>
          </select>
          <label>Stay quiet below</label>
          <select value={s.minSpeedKmh} onChange={(e) => setS({ ...s, minSpeedKmh: +e.target.value })}><option value={0}>Always announce</option><option value={5}>5 km/h</option><option value={10}>10 km/h (recommended)</option><option value={20}>20 km/h</option></select>
          <label>Count a light as “ahead” within</label>
          <select value={s.headingTolerance} onChange={(e) => setS({ ...s, headingTolerance: +e.target.value })}><option value={30}>±30° of travel direction (strict)</option><option value={45}>±45° (recommended)</option><option value={60}>±60° (winding roads)</option></select>
          <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto' }} checked={s.announceState} onChange={(e) => setS({ ...s, announceState: e.target.checked })} /> Include the AI-observed signal state at monitored intersections</label>
          {voices.length > 0 && <><label>Voice</label><select value={s.voiceURI || ''} onChange={(e) => { const v = voices.find((x) => x.voiceURI === e.target.value); setS({ ...s, voiceURI: e.target.value || undefined, lang: v?.lang || s.lang }); }}><option value="">Automatic (English)</option>{voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}</select></>}
          <label>Speaking rate: {s.rate.toFixed(1)}×</label><input type="range" min={0.7} max={1.4} step={0.1} value={s.rate} onChange={(e) => setS({ ...s, rate: +e.target.value })} />
          <label>Volume: {Math.round(s.volume * 100)}%</label><input type="range" min={0.3} max={1} step={0.1} value={s.volume} onChange={(e) => setS({ ...s, volume: +e.target.value })} />
          <button className="btn primary" style={{ marginTop: '.6rem' }} onClick={save}>Save settings</button>
          <h3 style={{ marginTop: '1rem' }}>Privacy</h3>
          <ul className="small muted" style={{ paddingLeft: '1.1rem' }}>
            <li>Your location is processed <strong>only on this device</strong>, in memory. It is never sent to the server or stored.</li>
            <li>The whole list of traffic-light locations is downloaded at once, so the server cannot tell where you are.</li>
            <li>Location tracking runs only while alerts are on, and stops when you press Stop or leave this page.</li>
            <li>Only “alerts started” is recorded in the audit log — no coordinates. Speech is generated on the device.</li>
          </ul>
          <p className="small muted">Locations come from monitored intersections, OpenStreetMap (where available) and operators' additions. Browsers cannot speak in the background, so keep the app open (the screen is kept on automatically).</p>
        </div>
      </div>
    </>
  );
}
