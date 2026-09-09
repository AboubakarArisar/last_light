import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const digest = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));

Deno.serve(async (request: Request) => {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  };
  const response = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
  if (!allowed.length || (origin && !allowed.includes(origin))) return response(403, { ok: false });
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return response(405, { ok: false });
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return response(503, { ok: false });
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    // Never log bodies: they contain passwords or bearer recovery tickets.
    const raw = await request.text();
    if (encoder.encode(raw).length > 4096) return response(413, { ok: false });
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { return response(400, { ok: false }); }
    if (!body || typeof body !== "object") return response(400, { ok: false });

    if (body.action === "issue") {
      const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) return response(401, { ok: false });
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) return response(401, { ok: false });
      const limited = await admin.rpc("allow_recovery", { p_bucket: `issue:${data.user.id}` });
      if (limited.error) return response(503, { ok: false, code: "RECOVERY_UNAVAILABLE" });
      if (!limited.data) return response(429, { ok: false, code: "RATE_LIMITED" });
      const secret = hex(crypto.getRandomValues(new Uint8Array(24)));
      const ticket = `LL-${secret.match(/.{8}/g)!.join("-").toUpperCase()}`;
      const { error: saveError } = await admin.from("recovery_tickets").upsert({
        user_id: data.user.id, ticket_hash: await digest(secret), created_at: new Date().toISOString(),
      });
      if (saveError) return response(503, { ok: false });
      return response(200, { ok: true, ticket });
    }

    if (body.action !== "reset" || typeof body.ticket !== "string" || typeof body.password !== "string")
      return response(400, { ok: false });
    const password = body.password;
    if (password.length < 10 || encoder.encode(password).length > 72) return response(400, { ok: false });
    const secret = body.ticket.trim().replace(/^LL-/i, "").replace(/[-\s]/g, "").toLowerCase();
    if (!/^[0-9a-f]{48}$/.test(secret)) return response(400, { ok: false });
    const hash = await digest(secret);
    // Network limits supplement the 192-bit ticket; identity never depends on an IP header.
    const network = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ?? "unknown";
    for (const bucket of [`network:${await digest(network)}`, `ticket:${hash}`]) {
      const limited = await admin.rpc("allow_recovery", { p_bucket: bucket });
      if (limited.error) return response(503, { ok: false, code: "RECOVERY_UNAVAILABLE" });
      if (!limited.data) return response(429, { ok: false, code: "RATE_LIMITED" });
    }
    // Atomic consume: concurrent requests cannot redeem the same ticket twice.
    const { data: userId, error } = await admin.rpc("claim_recovery", { p_hash: hash });
    if (error || !userId) return response(400, { ok: false });
    const { error: resetError } = await admin.auth.admin.updateUserById(userId, { password });
    if (resetError) {
      // Restore only after an explicit rejection. An uncertain network result may have
      // changed the password; re-enabling that ticket would permit another reset.
      if (resetError.status && resetError.status >= 400 && resetError.status < 500) {
        const restore = await admin.from("recovery_tickets").upsert(
          { user_id: userId, ticket_hash: hash }, { onConflict: "user_id", ignoreDuplicates: true },
        );
        if (restore.error) return response(503, { ok: false });
      }
      return response(503, { ok: false });
    }
    return response(200, { ok: true });
  } catch {
    return response(503, { ok: false });
  } finally {
    await admin.auth.dispose();
  }
});
