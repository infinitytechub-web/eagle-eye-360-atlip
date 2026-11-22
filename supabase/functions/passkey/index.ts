// Eagle Eye 360 · ATLIP — passkey (WebAuthn / FIDO2) authentication + native-app PKCE handoff.
//
// Actions (POST JSON { action, ... }):
//   register-options   [Bearer]  → WebAuthn creation options for the signed-in, fully active user
//   register-verify    [Bearer]  { response, name } → stores the passkey
//   login-options               → discoverable-credential request options + challengeId
//   login-verify                { challengeId, response } → { token_hash } (client exchanges via auth.verifyOtp)
//   handoff-create     [Bearer]  { code_challenge } → { code }   (web session → native app, PKCE S256)
//   handoff-redeem              { code, code_verifier } → { token_hash }
//
// Security: user verification (biometric/PIN) required; single-use 5-minute challenges; signature counter checked;
// origin + RP ID pinned to an allowlist; accounts must be active and not in a credential-reset flow.
// Super Administrators still complete TOTP after a passkey sign-in (MFA gate in the app).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "npm:@simplewebauthn/server@13";
import { isoBase64URL, isoUint8Array } from "npm:@simplewebauthn/server@13/helpers";

const RP_NAME = "Eagle Eye 360 — ATLIP";
// origin → RP ID. Passkeys are bound to the RP ID (the domain) and cannot be used on any other site.
const ORIGINS: Record<string, string> = {
  "https://atlip.infinitytechub.com": "atlip.infinitytechub.com",
};
// The iOS (capacitor://localhost) and Android (https://localhost) apps may call handoff-redeem only — they have no RP ID,
// so WebAuthn ceremonies from them are rejected; the hand-off code is useless without the app's PKCE verifier.
const APP_ORIGINS = new Set(["capacitor://localhost", "https://localhost"]);
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && (ORIGINS[origin] || APP_ORIGINS.has(origin)) ? origin : "https://atlip.infinitytechub.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

async function sha256b64url(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return isoBase64URL.fromBuffer(d);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON" }); }
  const action = String(body.action || "");

  const audit = (actor: string, name: string, action: string, target: string | null = null) =>
    admin.from("audit_logs").insert({ actor_id: actor, actor_name: name, category: "auth", action, target });

  async function signedInUser() {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data } = await admin.auth.getUser(token);
    if (!data?.user) return null;
    const { data: p } = await admin.from("profiles").select("id, email, full_name, role, active, password_change_required, mfa_reenroll_required").eq("id", data.user.id).single();
    return p;
  }
  const usable = (p: { active: boolean; role: string; password_change_required: boolean; mfa_reenroll_required: boolean } | null) =>
    !!p && p.active && p.role !== "gateway" && !p.password_change_required && !p.mfa_reenroll_required;

  async function sessionTokenFor(email: string) {
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !data?.properties?.hashed_token) throw new Error(error?.message || "Could not create session");
    return data.properties.hashed_token;
  }

  try {
    // ---------- passkey registration (signed-in users) ----------
    if (action === "register-options" || action === "register-verify") {
      const rpID = origin ? ORIGINS[origin] : undefined;
      if (!rpID) return json(403, { error: "Passkeys are only available on the official ATLIP site" });
      const me = await signedInUser();
      if (!usable(me)) return json(403, { error: "Sign in with an active account first" });
      const { data: existing } = await admin.from("user_passkeys").select("credential_id, transports").eq("user_id", me!.id);

      if (action === "register-options") {
        if ((existing || []).length >= 10) return json(400, { error: "Maximum of 10 passkeys per account" });
        const options = await generateRegistrationOptions({
          rpName: RP_NAME, rpID, userID: isoUint8Array.fromUTF8String(me!.id), userName: me!.email, userDisplayName: me!.full_name || me!.email,
          attestationType: "none", timeout: 120000,
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
          excludeCredentials: (existing || []).map((c) => ({ id: c.credential_id, transports: c.transports as AuthenticatorTransport[] })),
          supportedAlgorithmIDs: [-7, -257],
        });
        await admin.from("webauthn_challenges").delete().eq("user_id", me!.id).eq("kind", "register");
        await admin.from("webauthn_challenges").insert({ user_id: me!.id, challenge: options.challenge, kind: "register" });
        return json(200, options);
      }

      const { data: ch } = await admin.from("webauthn_challenges").select("*").eq("user_id", me!.id).eq("kind", "register").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!ch) return json(400, { error: "Registration expired — try again" });
      await admin.from("webauthn_challenges").delete().eq("id", ch.id); // single use
      const v = await verifyRegistrationResponse({
        response: body.response as never, expectedChallenge: ch.challenge, expectedOrigin: origin!, expectedRPID: rpID, requireUserVerification: true,
      });
      if (!v.verified || !v.registrationInfo) return json(400, { error: "Passkey could not be verified" });
      const { credential, credentialDeviceType, credentialBackedUp } = v.registrationInfo;
      const name = String(body.name || "Passkey").slice(0, 60);
      const { error } = await admin.from("user_passkeys").insert({
        user_id: me!.id, credential_id: credential.id, public_key: isoBase64URL.fromBuffer(credential.publicKey), counter: credential.counter,
        transports: credential.transports || [], device_type: credentialDeviceType, backed_up: credentialBackedUp, name,
      });
      if (error) return json(400, { error: error.message.includes("duplicate") ? "This passkey is already registered" : error.message });
      await audit(me!.id, me!.full_name || me!.email, "Passkey registered", name);
      return json(200, { ok: true });
    }

    // ---------- passkey sign-in ----------
    if (action === "login-options") {
      const rpID = origin ? ORIGINS[origin] : undefined;
      if (!rpID) return json(403, { error: "Passkeys are only available on the official ATLIP site" });
      const options = await generateAuthenticationOptions({ rpID, userVerification: "required", timeout: 120000 });
      const { data: ch } = await admin.from("webauthn_challenges").insert({ challenge: options.challenge, kind: "login" }).select("id").single();
      await admin.from("webauthn_challenges").delete().lt("expires_at", new Date().toISOString()); // housekeeping
      return json(200, { options, challengeId: ch!.id });
    }

    if (action === "login-verify") {
      const rpID = origin ? ORIGINS[origin] : undefined;
      if (!rpID) return json(403, { error: "Passkeys are only available on the official ATLIP site" });
      const fail = () => json(401, { error: "Passkey sign-in failed" });
      const { data: ch } = await admin.from("webauthn_challenges").select("*").eq("id", String(body.challengeId || "")).eq("kind", "login").maybeSingle();
      if (!ch) return fail();
      await admin.from("webauthn_challenges").delete().eq("id", ch.id); // single use, even on failure
      if (new Date(ch.expires_at) < new Date()) return json(401, { error: "Sign-in expired — try again" });
      const resp = body.response as { id?: string };
      const { data: pk } = await admin.from("user_passkeys").select("*").eq("credential_id", String(resp?.id || "")).maybeSingle();
      if (!pk) return json(401, { error: "This passkey is not registered (it may have been revoked)" });
      const v = await verifyAuthenticationResponse({
        response: body.response as never, expectedChallenge: ch.challenge, expectedOrigin: origin!, expectedRPID: rpID, requireUserVerification: true,
        credential: { id: pk.credential_id, publicKey: isoBase64URL.toBuffer(pk.public_key), counter: Number(pk.counter), transports: pk.transports },
      });
      if (!v.verified) return fail();
      const { data: p } = await admin.from("profiles").select("id, email, full_name, role, active, password_change_required, mfa_reenroll_required").eq("id", pk.user_id).single();
      if (!usable(p)) return json(403, { error: "This account is not active" });
      await admin.from("user_passkeys").update({ counter: v.authenticationInfo.newCounter, last_used_at: new Date().toISOString() }).eq("id", pk.id);
      const token_hash = await sessionTokenFor(p!.email);
      await audit(p!.id, p!.full_name || p!.email, "Signed in with passkey", pk.name);
      return json(200, { token_hash });
    }

    // ---------- native app handoff (PKCE S256) ----------
    if (action === "handoff-create") {
      const me = await signedInUser();
      if (!usable(me)) return json(403, { error: "Sign in with an active account first" });
      const cc = String(body.code_challenge || "");
      if (!/^[A-Za-z0-9_-]{43}$/.test(cc)) return json(400, { error: "Invalid code challenge" });
      const code = isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(32)));
      await admin.from("webauthn_challenges").insert({ user_id: me!.id, kind: "login", challenge: `handoff:${await sha256b64url(code)}:${cc}`, expires_at: new Date(Date.now() + 60_000).toISOString() });
      await audit(me!.id, me!.full_name || me!.email, "Native app sign-in approved in browser");
      return json(200, { code });
    }
    if (action === "handoff-redeem") {
      const code = String(body.code || ""), verifier = String(body.code_verifier || "");
      if (!code || verifier.length < 43) return json(400, { error: "Invalid request" });
      const prefix = `handoff:${await sha256b64url(code)}:`;
      const { data: ch } = await admin.from("webauthn_challenges").select("*").like("challenge", prefix.replace(/[\\%_]/g, (c) => "\\" + c) + "%").maybeSingle(); // exact prefix: escape LIKE wildcards
      if (!ch) return json(401, { error: "Sign-in code invalid or already used" });
      await admin.from("webauthn_challenges").delete().eq("id", ch.id);
      if (new Date(ch.expires_at) < new Date()) return json(401, { error: "Sign-in code expired" });
      if (ch.challenge.slice(prefix.length) !== await sha256b64url(verifier)) return json(401, { error: "Sign-in code does not belong to this app" });
      const { data: p } = await admin.from("profiles").select("id, email, full_name, role, active, password_change_required, mfa_reenroll_required").eq("id", ch.user_id).single();
      if (!usable(p)) return json(403, { error: "This account is not active" });
      return json(200, { token_hash: await sessionTokenFor(p!.email) });
    }

    return json(400, { error: "Unknown action" });
  } catch (e) {
    return json(400, { error: (e as Error).message || "Passkey error" });
  }
});
