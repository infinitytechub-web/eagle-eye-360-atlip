# Eagle Eye 360 — ATLIP

**AI Traffic Light Detector & Intelligence Platform** · Infinity Techub Intelligence · Africa/Accra

Production web platform (installable PWA) for monitoring traffic-signal observations at Ghanaian intersections,
with a secure Supabase backend, role-based access control, realtime operations and full audit trails.

- **Live site:** https://atlip.infinitytechub.com
- **Backend:** Supabase project `qhyiicwfwbmbkdkpyrnh` (eu-west-1)

## Modules (17)

| Section | Modules |
|---|---|
| Operations | Command Dashboard · AI Traffic Light Detection · Mobile Camera Detection · CCTV Surveillance Centre |
| Intelligence | Analytics · GPS & Geospatial · Alerts · Reports & Evidence |
| Communications | Communication Centre · IT Help & Support (tickets, SLA) · Live Chat · Notifications |
| Platform | AI Engine & Model Registry · Security Monitoring · System Administration · Branding · Schema & APIs · Architecture · Deployment & Tests |

## Architecture

```
React 18 + Vite + TypeScript (PWA)  ──HTTPS/WSS──►  Supabase
  Hostinger (Apache, CSP, HSTS)                       ├─ Auth (email/password, TOTP MFA)
                                                      ├─ Postgres 17 + Row-Level Security (every table)
                                                      ├─ Realtime (postgres_changes + presence)
                                                      ├─ Storage (branding: public · attachments: private)
                                                      └─ Edge Function: admin-users (service role, server-side only)
```

## Security model

- **Accounts:** the first account registered becomes the active **Super Administrator**. Every later self-registration
  is an **inactive auditor** until an administrator approves it and assigns a role. Admins can also create accounts directly.
- **MFA:** Super Administrators must enrol a TOTP authenticator app before reaching the dashboard.
- **7 roles:** super_admin · system_admin · supervisor · analyst · operator · support_officer · auditor — enforced by RLS
  in the database (the UI mirrors it in `src/lib/roles.ts`).
- **Audit:** append-only `audit_logs`, written only through server functions/triggers.
- **CCTV:** cameras store masked gateway references only; a CHECK constraint rejects URLs and credentials.
- **Evidence:** SHA-256 computed by a database trigger.
- **Sessions:** expire after 30 minutes of inactivity.
- **Keys:** only the *publishable* key is in the frontend (`.env.production`); the service-role key exists only inside the edge function.

## Local development

**Package manager: pnpm only.** The version is pinned in `package.json` (`"packageManager": "pnpm@12.21.0"`) and installed by
Corepack (bundled with Node.js 22). Do not use npm, Yarn or Bun, and never commit `package-lock.json`, `yarn.lock` or `bun.lock`
(they are git-ignored). The web app, `desktop/` and `gateway/` are independent packages, each with its own `pnpm-lock.yaml`
and a `pnpm-workspace.yaml` that records which dependency install scripts are allowed.

```bash
corepack enable pnpm                # once per machine
pnpm install --frozen-lockfile      # exact versions from pnpm-lock.yaml
cp .env.example .env.local          # or use .env.production values
pnpm run dev                        # http://localhost:5173
pnpm run build                      # type-check + production bundle in dist/
pnpm add <pkg> / pnpm remove <pkg>  # change dependencies (commit package.json + pnpm-lock.yaml together)
```

## CCTV gateway

See [`gateway/README.md`](gateway/README.md): Node + FFmpeg service on the camera network — encrypted RTSP credential vault,
ticketed HLS streaming, server-side AI, health monitoring and viewing-session oversight. Deploys with Docker Compose + Caddy.

## AI models

See [`ml/README.md`](ml/README.md). Models are in `public/models/` and run in a Web Worker via onnxruntime-web.
Ultralytics YOLO11 weights are AGPL-3.0.

## Database

Migrations are in `supabase/migrations/` (already applied to the live project, in order):

1. `0001_core_schema.sql` — tables, roles, RLS, triggers
2. `0002_seed_storage_realtime.sql` — reference data, labelled seed history, storage buckets, realtime
3. `0003_harden_functions.sql` — RLS helpers moved to a private `app` schema
4. `0004_stats_rpc.sql` — `detection_stats()` aggregate RPC
5. `0005_realtime_profiles_audit.sql` — live directory and audit feed
6. `0006_ai_pipeline.sql` — model-sourced detections and the real model registry
7. `0007_cctv_gateway.sql` — gateways, CCTV sessions, least-privilege gateway role

Edge function source: `supabase/functions/admin-users/index.ts`.

## Deployment (VS Code → GitHub → Hostinger Auto-Deployment → live)

1. Commit and **Sync** from VS Code (push to `main`).
2. GitHub Actions (`.github/workflows/deploy.yml`) builds with pnpm and adds one fast-forward commit of `dist/` (plus `version.json`) to the `deploy` branch.
3. **Hostinger's native GitHub Auto-Deployment** publishes the `deploy` branch to `atlip.infinitytechub.com`.
4. The verify job waits for that build to be live, smoke-tests it and records the release. This assigns the version identifier `VDDMMYYYYNNNN` shown in the app.

Full guide, including VS Code setup and how versioning works: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

`public/.htaccess` provides HTTPS redirect, SPA fallback, HSTS, CSP and caching headers.

## Honest status

Live: authentication + MFA, RBAC/RLS, all dashboards on real database data, realtime feeds/presence, chat, comms,
tickets, branding, evidence hashing, audit, and the **on-device AI detection pipeline** (YOLO11 detector + ATLIP
signal-state classifier — see `ml/README.md` for measured accuracy and the Ghana fine-tuning procedure).
**CCTV gateway:** built and tested (`gateway/`) — install it on the camera network (see `gateway/README.md`).
**Not yet built:** Ghana-specific fine-tuning/field validation, native iOS/Android/desktop packaging.
Alerts are advisory only — always obey the physical signal and road rules.

© Infinity Techub Intelligence · Eagle-eye productions
