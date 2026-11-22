# Development and deployment workflow

```
VS Code  ──commit & Sync──▶  GitHub (main)  ──Actions: build──▶  deploy branch  ──Hostinger Auto-Deployment──▶  live site
                                                                                    └─ Actions: verify live ─▶ version record (Supabase)
```

| Step | Who does it | What happens |
|---|---|---|
| 1. Change code | You, in VS Code | Edit, run `pnpm run dev`, commit, **Sync Changes** (pull + push to `main`). |
| 2. Build | GitHub Actions — *Build & publish* | `pnpm install --frozen-lockfile` and `pnpm run build`, then one fast-forward commit of the static site to the `deploy` branch. |
| 3. Deploy | **Hostinger's native GitHub Auto-Deployment** | Hostinger follows `deploy` and publishes it to `atlip.infinitytechub.com`, usually within about 60 seconds. |
| 4. Verify & version | GitHub Actions — *verify* job | It waits until this exact build is live, smoke-tests the site, then the Supabase `deployments` service re-checks the live site and assigns the version. |

**Why Actions is involved at all.** Hostinger's static auto-deployment copies files; it cannot compile a Vite/TypeScript app or report that a deployment succeeded. Actions only builds and verifies. It never uploads to the server, so there is a single deployment path: Hostinger's.

**Never push to `deploy` by hand.** It is written only by the pipeline, and VS Code warns you if you try.

## Version identifier — `VDDMMYYYYNNNN`

- **How it works:** the identifier is assigned automatically after a deployment is verified live, for example `V221120260001` for the first deployment on 22 Nov 2026.
- **Format:**
  - `DDMMYYYY` is the deployment date in Africa/Accra time (GMT).
  - `NNNN` is a counter that starts at `0001` each day.
- **Where it is stored:** in the Supabase table `deployments`, which is append-only and written only by the `deployments` edge function.
- **Who can write it:** the function accepts only a GitHub OIDC token from this repository's `main` branch, the exact workflow and the same run. No passwords or keys are stored for this.
- **Duplicate prevention:**
  - Assignment is serialised with a database lock.
  - Unique constraints back up the lock.
  - A retried or repeated deployment always gets back its original identifier.
- **What the app displays:** the app reads `/version.json` to find which build is actually live, then shows that build's identifier from the record. So the displayed version always matches the record:
  - **Sign-in screen and app footer:** "Version V…".
  - **Deploy page:** the full release history.
- **Failed or cancelled deployments:** they are never recorded, so the live identifier does not change. Between a deployment going live and being verified (about 1–2 minutes), the badge reads "Version pending verification".
- **Counter tests:** they run in the *Deployment counter test* workflow. It covers concurrency, duplicates, retries, the daily reset and the date boundary, using test-only records.

## Setting up VS Code (once per computer)

1. Install **Node.js 22 LTS** (from nodejs.org) and **Git**. Then enable pnpm, which comes with Node.js through Corepack:
   ```bash
   corepack enable pnpm        # Windows: run in a terminal opened "as Administrator"
   ```
2. In VS Code, run **Git: Clone** (Ctrl/Cmd+Shift+P), enter `https://github.com/infinitytechub-web/eagle-eye-360-atlip.git`, then sign in to GitHub when prompted.
3. Open the folder and accept the **recommended extensions**. The shared settings in `.vscode/` make VS Code use pnpm, LF line endings and rebase-on-sync.
4. Install dependencies with **Terminal → Run Task… → "pnpm: install (frozen lockfile)"**, or:
   ```bash
   pnpm install --frozen-lockfile
   ```
5. Start developing with `pnpm run dev` (http://localhost:5173). Build with `pnpm run build` (Ctrl/Cmd+Shift+B).

**Already have an older local copy?**
- Commit or stash your work, then run **Git: Pull (Rebase)**.
- If the copy predates the pnpm switch, delete `node_modules` and any `package-lock.json`, then run `pnpm install --frozen-lockfile`.

## Rules

- **pnpm only.** Use `pnpm add`, `pnpm remove`, `pnpm run` and `pnpm exec`. Never use npm, Yarn or Bun, and never commit their lockfiles; CI rejects them.
- **Lockfiles:** commit `package.json` and `pnpm-lock.yaml` together.
- **Native projects:** after changing dependencies, run `pnpm run cap:sync`.
- **Database:** keep using the existing Supabase database. Migrations go in `supabase/migrations/`.
- **No framework or ORM changes:** no Next.js or Prisma without explicit approval.

## Checking a deployment

- **GitHub → Actions → Build & publish:** the run summary shows `Deployed V…`.
- **Live build:** https://atlip.infinitytechub.com/version.json shows the build being served.
- **Inside the app:** the version appears on the sign-in screen, in the footer, and in Deploy → *Production releases*.
- **Rolling back:** revert the change on `main` and push. That creates a new verified release. The `deploy` branch keeps a commit for every release, for reference.

## Verification record — pipeline restored 22 Nov 2026

| Check | Result |
|---|---|
| Hostinger GitHub installation and auto-deploy settings | Active; follows `infinitytechub-web/eagle-eye-360-atlip`, branch `deploy`, into the site root |
| `deploy` branch | Fast-forward history (force-push and rebuilt history removed) |
| GitHub push to live (Hostinger clone of the new commit) | About 12–20 s after publish |
| First verified release | `V221120260001`: record, live `/version.json` build and the sign-in screen all match |
| Counter tests (20 parallel, 10 duplicate, retry, 23:59:59 / 00:00:00, isolation, cleanup) | 10/10 |
| Database-level counter tests (sequence, retry, reset, append-only, constraints, permissions, RLS) | 13/13 |
| Unauthenticated or forged calls to the deployments service | All rejected (401) |
