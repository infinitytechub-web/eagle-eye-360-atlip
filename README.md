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

```bash
npm install
cp .env.example .env.local   # or use .env.production values
npm run dev                  # http://localhost:5173
npm run build                # type-check + production bundle in dist/
```

## Database

Migrations are in `supabase/migrations/` (already applied to the live project, in order):

1. `0001_core_schema.sql` — tables, roles, RLS, triggers
2. `0002_seed_storage_realtime.sql` — reference data, labelled seed history, storage buckets, realtime
3. `0003_harden_functions.sql` — RLS helpers moved to a private `app` schema
4. `0004_stats_rpc.sql` — `detection_stats()` aggregate RPC
5. `0005_realtime_profiles_audit.sql` — live directory and audit feed

Edge function source: `supabase/functions/admin-users/index.ts`.

## Deployment (GitHub → Hostinger)

1. Push to `main`.
2. GitHub Actions (`.github/workflows/deploy.yml`) runs `npm ci && npm run build` and force-pushes `dist/` to the `deploy` branch.
3. Hostinger's Git auto-deploy pulls the `deploy` branch into `atlip.infinitytechub.com/public_html`.

`public/.htaccess` provides HTTPS redirect, SPA fallback, HSTS, CSP and caching headers.

## Honest status

Live: authentication + MFA, RBAC/RLS, all dashboards on real database data, realtime feeds/presence, chat, comms,
tickets, branding, evidence hashing, audit, mobile on-device heuristic detector.
**Not yet built:** trained YOLO detection model, RTSP video gateway, native iOS/Android/desktop packaging.
Alerts are advisory only — always obey the physical signal and road rules.

© Infinity Techub Intelligence · Eagle-eye productions
