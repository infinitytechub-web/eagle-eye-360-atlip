import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const configError = !url || !key
  ? 'Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'
  : null;

export const supabase = createClient(url || 'https://invalid.local', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'ee360-auth' },
  realtime: { params: { eventsPerSecond: 10 } },
});

export const SUPABASE_URL = url || '';

/** Append-only audit trail (server-side function checks the caller is active). */
export async function audit(action: string, target?: string | null, category = 'system') {
  await supabase.rpc('log_audit', { p_action: action, p_target: target ?? null, p_category: category });
}

/** Upload a file to the private attachments bucket under the user's own folder. */
export async function uploadAttachment(userId: string, file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Files must be 10 MB or smaller.');
  const safe = file.name.replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `${userId}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from('attachments').upload(path, file, { upsert: false });
  if (error) throw error;
  return { file_path: path, file_name: file.name.slice(0, 120), file_size: file.size };
}

export async function openAttachment(path: string) {
  const { data, error } = await supabase.storage.from('attachments').createSignedUrl(path, 120);
  if (error || !data) throw error || new Error('Could not open file');
  window.open(data.signedUrl, '_blank', 'noopener');
}
