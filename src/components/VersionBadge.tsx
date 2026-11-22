import { useLiveVersion, fmtAccra } from '../lib/version';

declare const __APP_VERSION__: string;

/** Shows the live production version identifier, exactly as stored in the deployment record. */
export function VersionBadge() {
  const v = useLiveVersion();
  if (v.status === 'loading') return null;
  if (v.status === 'verified') {
    return (
      <span className="mono" data-testid="live-version" title={`Deployed ${fmtAccra(v.deployedAt!)} · commit ${v.commit} · build ${v.buildId}`}>
        Version {v.versionId}
      </span>
    );
  }
  if (v.status === 'pending') return <span data-testid="live-version" title={`Build ${v.buildId}`}>Version pending verification</span>;
  if (v.status === 'app') return <span data-testid="live-version">Mobile app {__APP_VERSION__}</span>;
  if (v.status === 'dev') return <span data-testid="live-version">Development build</span>;
  return <span data-testid="live-version">Version unavailable</span>;
}
