// No live project, network access or real credentials are used by this test.
// Run: deno test --allow-env tests/recovery.edge.ts
const assert = {
  equal(actual: unknown, expected: unknown, message = "Values differ") {
    if (actual !== expected) throw new Error(message);
  },
  notEqual(actual: unknown, expected: unknown) {
    if (actual === expected) throw new Error("Values must differ");
  },
  match(value: string, pattern: RegExp) {
    if (!pattern.test(value)) throw new Error("Unexpected value format");
  },
  deepEqual(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Values differ");
  },
};

Deno.test("recovery requires authentication to issue, hashes tickets, and consumes each once", async () => {
  const originalFetch = globalThis.fetch;
  const originalServe = Deno.serve;
  const keys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ALLOWED_ORIGINS"];
  const oldEnv = keys.map((key) => Deno.env.get(key));
  let handler!: (request: Request) => Promise<Response>;
  Deno.serve = ((callback: typeof handler) => { handler = callback; return {}; }) as unknown as typeof Deno.serve;
  Deno.env.set("SUPABASE_URL", "https://project.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
  Deno.env.set("ALLOWED_ORIGINS", "https://game.test");
  const tickets = new Map<string, string>();
  const passwords: string[] = [];
  let rejectPassword = false;
  let rateLimit = false;
  let missingSetup = false;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const options = init as { body?: string; headers?: HeadersInit } | undefined;
    const body = typeof options?.body === "string" ? JSON.parse(options.body) : {};
    if (url.pathname === "/auth/v1/user") {
      const headers = new Headers(options?.headers);
      return headers.get("authorization") === "Bearer valid-user-token"
        ? json({ id: "11111111-1111-4111-8111-111111111111", email: "user@test.invalid" }) : json({ message: "Invalid token" }, 401);
    }
    if (url.pathname === "/rest/v1/rpc/allow_recovery") return missingSetup ? json({ code: "PGRST202" }, 404) : json(!rateLimit);
    if (url.pathname === "/rest/v1/recovery_tickets") {
      for (const [hash, id] of tickets) if (id === body.user_id) tickets.delete(hash);
      tickets.set(body.ticket_hash, body.user_id);
      return json(null, 201);
    }
    if (url.pathname === "/rest/v1/rpc/claim_recovery") {
      const uid = tickets.get(body.p_hash) ?? null;
      tickets.delete(body.p_hash);
      return json(uid);
    }
    if (url.pathname === "/auth/v1/admin/users/11111111-1111-4111-8111-111111111111") {
      if (rejectPassword) return json({ message: "Password rejected" }, 422);
      passwords.push(body.password);
      return json({ id: "11111111-1111-4111-8111-111111111111", email: "user@test.invalid" });
    }
    throw new Error(`Unexpected test request: ${url.pathname}`);
  };
  try {
    await import("../supabase/functions/recovery-ticket/index.ts");
    const call = (body: object, token?: string, origin = "https://game.test") => handler(new Request("https://project.test/functions/v1/recovery-ticket", {
      method: "POST", headers: { origin, "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    }));
    assert.equal((await call({ action: "issue" })).status, 401);
    assert.equal((await call({ action: "issue" }, "wrong-token")).status, 401);
    assert.equal((await call({ action: "issue" }, "valid-user-token", "https://other.test")).status, 403);
    const issued = await call({ action: "issue", user_id: "attacker-chosen-user" }, "valid-user-token");
    const ticket = (await issued.json()).ticket;
    assert.match(ticket, /^LL-(?:[0-9A-F]{8}-){5}[0-9A-F]{8}$/);
    assert.equal(tickets.size, 1);
    assert.equal([...tickets.values()][0], "11111111-1111-4111-8111-111111111111");
    assert.match([...tickets.keys()][0], /^[0-9a-f]{64}$/);
    assert.notEqual([...tickets.keys()][0], ticket);
    assert.equal((await call({ action: "reset", ticket: "Messi", password: "new-password-123" })).status, 400);
    assert.equal((await call({ action: "reset", ticket, password: "short" })).status, 400);
    rejectPassword = true;
    assert.equal((await call({ action: "reset", ticket, password: "new-password-123" })).status, 503);
    assert.equal(tickets.size, 1, "definite password rejection restores the ticket");
    rejectPassword = false;
    const concurrent = await Promise.all([
      call({ action: "reset", ticket, password: "new-password-123" }),
      call({ action: "reset", ticket, password: "other-password-123" }),
    ]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 400]);
    assert.equal(passwords.length, 1);
    assert.equal(tickets.size, 0);
    assert.equal((await call({ action: "reset", ticket, password: "another-password" })).status, 400);
    rateLimit = true;
    assert.equal((await call({ action: "issue" }, "valid-user-token")).status, 429);
    missingSetup = true;
    assert.equal((await call({ action: "issue" }, "valid-user-token")).status, 503);
  } finally {
    globalThis.fetch = originalFetch;
    Deno.serve = originalServe;
    keys.forEach((key, i) => oldEnv[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, oldEnv[i]!));
  }
});
