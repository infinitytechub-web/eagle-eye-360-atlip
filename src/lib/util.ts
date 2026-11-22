export const TZ = 'Africa/Accra';
export const fmtT = (ts: string | number | Date) =>
  new Date(ts).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtClock = (ts: string | number | Date) =>
  new Date(ts).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const fmtFull = (ts: string | number | Date) => new Date(ts).toLocaleString('en-GB', { timeZone: TZ });
export function relMin(ts: string | number) {
  const m = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m ago` : `${Math.floor(m / 1440)}d ago`;
}
export const kb = (n?: number | null) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '');
export const dmKey = (a: string, b: string) => 'dm:' + [a, b].sort().join(':');

export function downloadBlob(name: string, data: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export function toCSV(rows: (string | number | null | undefined)[][]) {
  // Prefix cells that start with formula characters to block CSV injection in Excel
  return rows.map((r) => r.map((c) => {
    let s = String(c ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }).join(',')).join('\r\n');
}
export async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function strongPassword(len = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*-_';
  const a = new Uint32Array(len); crypto.getRandomValues(a);
  return [...a].map((n) => chars[n % chars.length]).join('');
}
export const errMsg = (e: unknown) => (e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : String(e));
