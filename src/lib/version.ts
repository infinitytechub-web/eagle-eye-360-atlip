// Live production version identifier (VDDMMYYYYNNNN).
//
// The identifier is NOT baked into the build: it is assigned by the deployment record only after Hostinger has deployed
// the build and the pipeline has verified it live. The app therefore reads /version.json (which build is actually being
// served) and looks that build up in the `deployments` record, so what is displayed always matches the record.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { isCapacitorApp } from './passkey';

export interface LiveVersion {
  status: 'loading' | 'verified' | 'pending' | 'dev' | 'app' | 'unavailable';
  versionId?: string;
  deployedAt?: string;
  commit?: string;
  buildId?: string;
}

export interface DeploymentRow { version_id: string; deploy_date: string; seq: number; build_id: string; commit_sha: string; run_url: string | null; verified_at: string }

let cache: Promise<LiveVersion> | null = null;

async function lookup(): Promise<LiveVersion> {
  if (isCapacitorApp()) return { status: 'app' };
  let build: { build_id?: string; commit?: string } | null = null;
  try {
    const r = await fetch(`/version.json?ts=${Date.now()}`, { cache: 'no-store' });
    build = r.ok ? await r.json() : null;
  } catch { build = null; }
  if (!build?.build_id) return { status: 'dev' };                       // local development or a build without a stamp
  const { data, error } = await supabase.from('deployments')
    .select('version_id, verified_at, commit_sha')
    .eq('environment', 'production').eq('build_id', build.build_id).maybeSingle();
  if (error) return { status: 'unavailable', buildId: build.build_id };
  if (!data) return { status: 'pending', buildId: build.build_id, commit: build.commit };
  return { status: 'verified', versionId: data.version_id, deployedAt: data.verified_at, commit: data.commit_sha.slice(0, 7), buildId: build.build_id };
}

/** Current live version; while a fresh deployment is still being verified, re-checks every 30 s (up to 15 minutes). */
export function useLiveVersion(): LiveVersion {
  const [v, setV] = useState<LiveVersion>({ status: 'loading' });
  useEffect(() => {
    let alive = true; let tries = 0; let timer: number | undefined;
    const run = async (fresh: boolean) => {
      if (fresh || !cache) cache = lookup();
      const res = await cache;
      if (!alive) return;
      setV(res);
      if (res.status === 'pending' && tries++ < 30) timer = window.setTimeout(() => run(true), 30_000);
    };
    void run(false);
    return () => { alive = false; if (timer) window.clearTimeout(timer); };
  }, []);
  return v;
}

export async function recentDeployments(limit = 10): Promise<DeploymentRow[]> {
  const { data } = await supabase.from('deployments')
    .select('version_id, deploy_date, seq, build_id, commit_sha, run_url, verified_at')
    .eq('environment', 'production').order('verified_at', { ascending: false }).limit(limit);
  return (data || []) as DeploymentRow[];
}

export const fmtAccra = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Accra', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' GMT';
