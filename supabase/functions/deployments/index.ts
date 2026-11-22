// Eagle Eye 360 · ATLIP — deployment record service.
//
// Called ONLY by GitHub Actions, authenticated with a short-lived GitHub OIDC token (no stored secrets):
//   record           — after the verification job has seen the new build live on Hostinger. This function checks the live
//                      site again itself, then assigns the next version identifier (V + DDMMYYYY + NNNN) atomically.
//   selftest-record  — counter tests from .github/workflows/deploy-counter-test.yml; writes environment 'test' only.
//   selftest-cleanup — deletes environment 'test' rows after the tests.
// The OIDC token must be issued for this repository, the main branch, the exact workflow file and the same run.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5";

const REPO = "infinitytechub-web/eagle-eye-360-atlip";
const AUDIENCE = "atlip-deployments";
const LIVE = "https://atlip.infinitytechub.com";
const DEPLOY_WORKFLOW = `${REPO}/.github/workflows/deploy.yml@refs/heads/main`;
const TEST_WORKFLOW = `${REPO}/.github/workflows/deploy-counter-test.yml@refs/heads/main`;
const JWKS = createRemoteJWKSet(new URL("https://token.actions.githubusercontent.com/.well-known/jwks"));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

type Claims = { repository?: string; ref?: string; workflow_ref?: string; run_id?: string; run_attempt?: string; event_name?: string; sha?: string };

async function githubIdentity(req: Request): Promise<Claims> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("missing token");
  const { payload } = await jwtVerify(token, JWKS, { issuer: "https://token.actions.githubusercontent.com", audience: AUDIENCE });
  const c = payload as Claims;
  if (c.repository !== REPO) throw new Error("wrong repository");
  if (c.ref !== "refs/heads/main") throw new Error("only the main branch may record deployments");
  return c;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  let claims: Claims;
  try { claims = await githubIdentity(req); }
  catch (e) { return json(401, { error: "Unauthorised: " + (e as Error).message }); }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON" }); }
  const action = String(body.action || "");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const runUrl = `https://github.com/${REPO}/actions/runs/${claims.run_id}`;

  // ---------- production: record a verified deployment ----------
  if (action === "record") {
    if (claims.workflow_ref !== DEPLOY_WORKFLOW) return json(403, { error: "Only the production deploy workflow may record deployments" });
    const buildId = `${claims.run_id}-${claims.run_attempt}`;            // bound to the calling run — cannot be spoofed
    const commit = String(claims.sha || "").toLowerCase();
    if (String(body.build_id || "") !== buildId) return json(400, { error: "build_id does not match the calling workflow run" });

    // Independent check from Supabase's network: the build must actually be live and the site must serve its entry page.
    try {
      const v = await fetch(`${LIVE}/version.json?verify=${Date.now()}`, { headers: { "Cache-Control": "no-cache", "User-Agent": "ATLIP-deploy-verifier/1.0" } });
      const live = v.ok ? await v.json() : null;
      if (!live || live.build_id !== buildId || !commit.startsWith(String(live.commit || "-"))) {
        return json(409, { error: "Build is not live yet", live_build: live?.build_id ?? null, http: v.status });
      }
      // Entry page must be served. Hostinger's CDN may answer automated clients with its 403 browser check (server: hcdn);
      // that is not a site failure, and version.json above already proved the new build is live, so it is accepted.
      const home = await fetch(`${LIVE}/?verify=${Date.now()}`, { headers: { "User-Agent": "ATLIP-deploy-verifier/1.0" } });
      const html = await home.text();
      const cdnCheck = home.status === 403 && (home.headers.get("server") || "").includes("hcdn");
      if (!(home.ok && html.includes('<div id="root">')) && !cdnCheck) return json(409, { error: `Home page check failed (HTTP ${home.status})` });
    } catch (e) {
      return json(502, { error: "Live verification failed: " + (e as Error).message });
    }

    const { data, error } = await admin.rpc("record_deployment", { p_environment: "production", p_build_id: buildId, p_commit: commit, p_run_url: runUrl });
    if (error) return json(500, { error: error.message });
    const row = Array.isArray(data) ? data[0] : data;
    return json(200, { environment: "production", build_id: buildId, commit: commit.slice(0, 7), ...row });
  }

  // ---------- counter tests (environment 'test' only) ----------
  if (action === "selftest-record" || action === "selftest-cleanup") {
    if (claims.workflow_ref !== TEST_WORKFLOW) return json(403, { error: "Only the counter-test workflow may use test actions" });
    if (action === "selftest-cleanup") {
      const { error, count } = await admin.from("deployments").delete({ count: "exact" }).eq("environment", "test");
      return error ? json(500, { error: error.message }) : json(200, { deleted: count });
    }
    const buildId = String(body.build_id || "");
    if (!/^test-[A-Za-z0-9_-]{1,60}$/.test(buildId)) return json(400, { error: "test build_id must start with test-" });
    const at = String(body.at || new Date().toISOString());
    const { data, error } = await admin.rpc("record_deployment", {
      p_environment: "test", p_build_id: buildId, p_commit: String(body.commit || "abcdef1"), p_run_url: runUrl, p_at: at,
    });
    if (error) return json(500, { error: error.message });
    return json(200, Array.isArray(data) ? data[0] : data);
  }

  return json(400, { error: "Unknown action" });
});
