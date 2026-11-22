// Eagle Eye 360 · ATLIP — admin-users edge function
// Lets Super/System Administrators create accounts, change roles and activate/deactivate users.
// The service-role key never leaves the server; the caller's own JWT is checked first.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ROLES = ["super_admin", "system_admin", "supervisor", "analyst", "operator", "support_officer", "auditor"];
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json(401, { error: "Not signed in" });

  const { data: me } = await admin.from("profiles").select("id, role, active, full_name, email").eq("id", who.user.id).single();
  if (!me?.active || !["super_admin", "system_admin"].includes(me.role)) return json(403, { error: "Administrators only" });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON" }); }
  const action = String(body.action || "");
  const audit = (action: string, target: string) =>
    admin.from("audit_logs").insert({ actor_id: me.id, actor_name: me.full_name || me.email, category: "admin", action, target });

  if (action === "create") {
    const email = String(body.email || "").trim().toLowerCase();
    const full_name = String(body.full_name || "").trim().slice(0, 120);
    const role = String(body.role || "auditor");
    const command = String(body.command || "").slice(0, 120);
    const password = String(body.password || "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: "Valid email required" });
    if (!ROLES.includes(role)) return json(400, { error: "Unknown role" });
    if (role === "super_admin" && me.role !== "super_admin") return json(403, { error: "Only a super administrator can create super administrators" });
    if (password.length < 12) return json(400, { error: "Temporary password must be at least 12 characters" });
    const { data: created, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name },
    });
    if (error || !created.user) return json(400, { error: error?.message || "Could not create user" });
    await admin.from("profiles").update({ role, active: true, command, full_name }).eq("id", created.user.id);
    await audit("User created (" + role + ")", email);
    return json(200, { ok: true, id: created.user.id });
  }

  if (action === "update") {
    const id = String(body.id || "");
    const patch: Record<string, unknown> = {};
    if (body.role !== undefined) {
      if (!ROLES.includes(String(body.role))) return json(400, { error: "Unknown role" });
      if (body.role === "super_admin" && me.role !== "super_admin") return json(403, { error: "Only a super administrator can grant super administrator" });
      patch.role = body.role;
    }
    if (body.active !== undefined) patch.active = !!body.active;
    if (body.command !== undefined) patch.command = String(body.command).slice(0, 120);
    if (id === me.id && (patch.active === false || (patch.role && patch.role !== me.role)))
      return json(400, { error: "You cannot demote or deactivate your own account" });
    const { data: target } = await admin.from("profiles").select("role,email").eq("id", id).single();
    if (!target) return json(404, { error: "User not found" });
    if (target.role === "super_admin" && me.role !== "super_admin") return json(403, { error: "Only a super administrator can change a super administrator" });
    const { error } = await admin.from("profiles").update(patch).eq("id", id);
    if (error) return json(400, { error: error.message });
    await audit("User updated: " + JSON.stringify(patch), target.email);
    return json(200, { ok: true });
  }

  return json(400, { error: "Unknown action" });
});
