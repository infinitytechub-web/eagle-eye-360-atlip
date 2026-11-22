// Location + keep-awake abstraction for the browser and the native apps.
import { isCapacitorApp } from './passkey';
import type { Fix } from './voiceAlerts';

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported';

export async function locationPermission(): Promise<PermissionStatus> {
  if (isCapacitorApp()) {
    const { Geolocation } = await import('@capacitor/geolocation');
    const p = await Geolocation.checkPermissions(); return p.location === 'granted' ? 'granted' : p.location === 'denied' ? 'denied' : 'prompt';
  }
  if (!('geolocation' in navigator)) return 'unsupported';
  try { const r = await navigator.permissions.query({ name: 'geolocation' as PermissionName }); return r.state as PermissionStatus; } catch { return 'prompt'; }
}

/** Start high-accuracy tracking; returns a stop function. */
export async function watchLocation(onFix: (f: Fix) => void, onError: (msg: string) => void): Promise<() => void> {
  if (isCapacitorApp()) {
    const { Geolocation } = await import('@capacitor/geolocation');
    const perm = await Geolocation.requestPermissions({ permissions: ['location'] });
    if (perm.location !== 'granted') throw new Error('Location permission was not granted');
    const id = await Geolocation.watchPosition({ enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }, (p, err) => {
      if (err || !p) { onError(err?.message || 'Location unavailable'); return; }
      onFix({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed ?? null, heading: p.coords.heading ?? null, t: p.timestamp });
    });
    return () => { Geolocation.clearWatch({ id }); };
  }
  if (!('geolocation' in navigator)) throw new Error('Location is not supported on this device');
  const DENIED = 'Location permission denied — allow location for this site in your browser settings.';
  const toFix = (p: GeolocationPosition): Fix => ({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading, t: p.timestamp });
  // Ask for (and wait on) the permission prompt + a first fix before reporting that alerts are running.
  const first = await new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, (e) => reject(new Error(e.code === 1 ? DENIED : e.code === 3 ? 'Could not get a location fix — check that location services are on and try again.' : e.message || 'Location unavailable')),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }));
  onFix(toFix(first));
  const id = navigator.geolocation.watchPosition(
    (p) => onFix(toFix(p)),
    (e) => onError(e.code === 1 ? DENIED : e.message || 'Location unavailable'),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  return () => navigator.geolocation.clearWatch(id);
}

/** Keep the screen on while alerts are active (the browser cannot run alerts in the background). */
export async function keepAwake(on: boolean): Promise<() => void> {
  if (isCapacitorApp()) {
    const { KeepAwake } = await import('@capacitor-community/keep-awake');
    if (on) await KeepAwake.keepAwake(); else await KeepAwake.allowSleep();
    return () => { KeepAwake.allowSleep().catch(() => {}); };
  }
  const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
  if (!on || !wl) return () => {};
  try { const lock = await wl.request('screen'); return () => { lock.release().catch(() => {}); }; } catch { return () => {}; }
}
