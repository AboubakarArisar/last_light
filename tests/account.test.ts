import { test } from "node:test";
import assert from "node:assert/strict";
import { Account, CloudSaveError, validatePassword } from "../src/account.ts";
import { KEY, fresh, type Save } from "../src/save.ts";
import { mergeProgress, newCache, readCache } from "../src/progress.ts";

class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(i: number) { return [...this.values.keys()][i] ?? null; }
  clear() { this.values.clear(); }
  getItem(k: string) { return this.values.get(k) ?? null; }
  setItem(k: string, v: string) { this.values.set(k, v); }
  removeItem(k: string) { this.values.delete(k); }
}

function fixture(storage = new MemoryStorage()) {
  Object.assign(globalThis, { window: new EventTarget() });
  let user: { id: string; email: string; user_metadata: object } | null = null;
  let listener: (event: string, session: unknown) => void = () => {};
  const rows = new Map<string, Save>();
  const operations = new Set<string>();
  let loseResponse = false;
  let fetchError = false;
  let holdFetch: (() => Promise<void>) | null = null;
  const client = {
    auth: {
      onAuthStateChange(callback: typeof listener) { listener = callback; return { data: { subscription: { unsubscribe() { listener = () => {}; } } } }; },
      getSession: async () => ({ data: { session: user ? { user } : null }, error: null }),
      async signInWithPassword({ email, password }: { email: string; password: string }) {
        if (password !== "correct-password") return { data: { user: null }, error: new Error("Invalid") };
        user = { id: email, email, user_metadata: {} };
        listener("SIGNED_IN", { user });
        return { data: { user }, error: null };
      },
      async signOut() { user = null; listener("SIGNED_OUT", null); return { error: null }; },
      async dispose() {},
    },
    from() {
      let id = "";
      const query = {
        select() { return query; }, eq(_key: string, value: string) { id = value; return query; },
        abortSignal() { return query; },
        async maybeSingle() {
          if (holdFetch) await holdFetch();
          return { data: rows.has(id) ? { data: structuredClone(rows.get(id)) } : null, error: fetchError ? new Error("Offline") : null };
        },
      };
      return query;
    },
    rpc(_name: string, input: { p_operation: string; p_base: Save; p_save: Save }) {
      return { async abortSignal() {
        const id = user!.id;
        const key = `${id}:${input.p_operation}`;
        if (!operations.has(key)) {
          rows.set(id, mergeProgress(rows.get(id) ?? input.p_base, input.p_base, input.p_save));
          operations.add(key);
        }
        return { data: structuredClone(rows.get(id)), error: loseResponse ? new Error("Response lost") : null };
      } };
    },
  };
  let displayed = fresh();
  const account = new Account(client as any, storage, (save) => { displayed = save; }, () => {});
  return {
    account, storage, rows, operations,
    get displayed() { return displayed; },
    set loseResponse(value: boolean) { loseResponse = value; },
    set fetchError(value: boolean) { fetchError = value; },
    set holdFetch(value: (() => Promise<void>) | null) { holdFetch = value; },
  };
}

test("merging keeps completed levels and adds only newly played statistics", () => {
  const base = fresh(); base.stats.goals = 5; base.stars[0] = 1;
  const local = structuredClone(base); local.stats.goals = 7; local.stars[0] = 3;
  const remote = structuredClone(base); remote.stats.goals = 8; remote.stars[1] = 2;
  remote.profile.name = "Cloud player";
  local.settings.volume = 0.2;
  const merged = mergeProgress(remote, base, local);
  assert.equal(merged.stats.goals, 10);
  assert.deepEqual(merged.stars.slice(0, 2), [3, 2]);
  assert.equal(merged.profile.name, "Cloud player");
  assert.equal(merged.settings.volume, 0.2);
  assert.deepEqual(mergeProgress(merged, merged, merged), merged);
  assert.throws(() => readCache('{"version":2}'));
  assert.deepEqual(readCache(JSON.stringify(newCache())), newCache());
});

test("lost save responses retry the same operation after reload without doubling goals", async () => {
  const f = fixture();
  let reloaded: Account | undefined;
  try {
    await f.account.initialize();
    await f.account.signIn("alice", "correct-password");
    await f.account.sync();
    const save = fresh(); save.stats.goals = 4; save.stars[39] = 3;
    f.account.save(save);
    f.loseResponse = true;
    await f.account.sync();
    assert.equal(f.rows.get("alice")!.stats.goals, 4);
    const pending = f.account.cache.pending!.id;
    assert.equal(readCache(f.storage.getItem(`${KEY}.account.alice`)!).pending!.id, pending);
    await f.account.dispose();
    reloaded = new Account(f.account.client, f.storage, () => {}, () => {});
    await reloaded.initialize();
    assert.equal(reloaded.cache.pending!.id, pending);
    f.loseResponse = false;
    await reloaded.sync();
    assert.equal(f.rows.get("alice")!.stats.goals, 4);
    assert.equal(reloaded.cache.pending, null);
    assert.equal(f.operations.size, 1);
  } finally { await f.account.dispose(); await reloaded?.dispose(); }
});

test("a late response from the previous account cannot change the current player's save", async () => {
  const f = fixture();
  const alice = fresh(); alice.stats.goals = 40;
  f.rows.set("alice", alice);
  try {
    await f.account.initialize();
    await f.account.signIn("alice", "correct-password");
    let release!: () => void;
    f.holdFetch = () => new Promise<void>((resolve) => { release = resolve; });
    const oldRequest = f.account.sync();
    await f.account.signIn("bob", "correct-password");
    f.holdFetch = null;
    await f.account.sync();
    release();
    await oldRequest;
    assert.equal(f.account.user!.id, "bob");
    assert.equal(f.displayed.stats.goals, 0);
  } finally { await f.account.dispose(); }
});

test("login restores cloud progress; logout and switching accounts isolate saves", async () => {
  const f = fixture();
  const cloud = fresh(); cloud.stars.fill(3, 0, 40); cloud.stats.goals = 40;
  f.rows.set("alice", cloud);
  try {
    await f.account.initialize();
    await assert.rejects(f.account.signIn("alice", "wrong"));
    assert.equal(f.account.user, null);
    await f.account.signIn("alice", "correct-password");
    assert.equal(f.account.progressReady, false);
    await f.account.sync();
    assert.equal(f.displayed.stars.filter(Boolean).length, 40);
    await f.account.signOut();
    assert.equal(f.displayed.stats.goals, 0);
    await f.account.signIn("bob", "correct-password");
    await f.account.sync();
    assert.equal(f.displayed.stats.goals, 0);
    assert.equal(f.rows.get("alice")!.stats.goals, 40);
  } finally { await f.account.dispose(); }
});

test("offline writes stay queued; failed reads never overwrite better cloud progress", async () => {
  const f = fixture();
  const cloud = fresh(); cloud.stats.goals = 40; cloud.stars[39] = 3;
  f.rows.set("alice", cloud);
  try {
    await f.account.initialize();
    f.fetchError = true;
    await f.account.signIn("alice", "correct-password");
    await f.account.sync();
    assert.equal(f.account.progressReady, false);
    assert.equal(f.operations.size, 0);
    f.fetchError = false;
    await f.account.sync();
    const local = structuredClone(f.displayed); local.stats.goals++;
    f.account.save(local);
    f.fetchError = true;
    await f.account.sync();
    assert.equal(f.rows.get("alice")!.stats.goals, 40);
    assert.equal(readCache(f.storage.getItem(`${KEY}.account.alice`)!).save.stats.goals, 41);
    f.fetchError = false;
    await f.account.sync();
    assert.equal(f.rows.get("alice")!.stats.goals, 41);
  } finally { await f.account.dispose(); }
});

test("guest import is explicit, adds once, and retains the original backup", async () => {
  const f = fixture();
  const guest = fresh(); guest.stats.attempts = 7; guest.stats.goals = 5; guest.stars[3] = 3;
  f.storage.setItem(KEY, JSON.stringify(guest));
  const cloud = fresh(); cloud.stats.goals = 10; cloud.stars[10] = 3;
  f.rows.set("alice", cloud);
  try {
    await f.account.initialize();
    await f.account.signIn("alice", "correct-password");
    await f.account.sync();
    assert.equal(f.displayed.stats.goals, 10);
    await f.account.importGuest();
    assert.equal(f.displayed.stats.goals, 15);
    assert.equal(f.displayed.stars[3], 3);
    assert.equal(f.displayed.stars[10], 3);
    await f.account.importGuest();
    assert.equal(f.displayed.stats.goals, 15);
    assert.equal(JSON.parse(f.storage.getItem(KEY)!).stats.goals, 5);
  } finally { await f.account.dispose(); }
});

test("a new signed-in device can play before cloud sync and later merge without losing online levels", async () => {
  const f = fixture();
  const cloud = fresh(); cloud.stars.fill(3, 0, 40); cloud.stats.goals = 40;
  f.rows.set("alice", cloud);
  try {
    assert.equal(f.account.canPlay, false);
    await f.account.initialize();
    f.fetchError = true;
    await f.account.signIn("alice", "correct-password");
    await f.account.sync();
    assert.equal(f.account.progressReady, false);
    assert.equal(f.account.canPlay, true, "cloud availability must not block playing");
    const local = fresh(); local.stats.attempts = 1; local.stats.goals = 1; local.stars[0] = 2;
    f.account.save(local);
    await f.account.sync();
    const saved = readCache(f.storage.getItem(`${KEY}.account.alice`)!);
    assert.equal(saved.save.stats.goals, 1);
    assert.equal(f.rows.get("alice")!.stats.goals, 40);
    f.fetchError = false;
    await f.account.sync();
    assert.equal(f.displayed.stats.goals, 41);
    assert.equal(f.displayed.stars.filter(Boolean).length, 40);
    assert.equal(f.displayed.stars[0], 3);
  } finally { await f.account.dispose(); }
});

test("edits made while a cloud fetch is in flight are preserved", async () => {
  const f = fixture();
  try {
    await f.account.initialize();
    await f.account.signIn("alice", "correct-password");
    let release!: () => void;
    f.holdFetch = () => new Promise<void>((resolve) => { release = resolve; });
    const request = f.account.sync();
    const local = fresh(); local.stats.goals = 1;
    f.account.save(local);
    release();
    await request;
    assert.equal(f.displayed.stats.goals, 1);
    assert.equal(f.rows.get("alice")!.stats.goals, 1);
  } finally { await f.account.dispose(); }
});

test("password checks account for bcrypt's byte limit", () => {
  assert.throws(() => validatePassword("short"));
  assert.throws(() => validatePassword("🔐".repeat(19)));
  assert.doesNotThrow(() => validatePassword("long-unique-passphrase"));
});

test("missing backend setup is distinguished from retryable connectivity failures", () => {
  for (const code of ["PGRST205", "PGRST202", "42P01", "42501"]) {
    const error = new CloudSaveError({ code });
    assert.equal(error.retryable, false);
    assert.match(error.message, /aren't available yet/);
    assert.doesNotMatch(error.message, /SQL|Supabase|PGRST|database/i);
  }
  assert.equal(new CloudSaveError({ code: "PGRST301" }).retryable, false);
  assert.equal(new CloudSaveError({}).retryable, true);
});

test("recovery never reports success without a complete code, and explains rate limits", async () => {
  const f = fixture();
  const client = f.account.client!;
  const original = client.functions;
  try {
    Object.defineProperty(client, "functions", { configurable: true, value: {
      invoke: async () => ({ data: { ok: true, ticket: null }, error: null }),
    } });
    await assert.rejects(f.account.recovery("issue"), /wasn't returned correctly/);
    Object.defineProperty(client, "functions", { configurable: true, value: {
      invoke: async () => ({ data: null, error: { context: new Response(null, { status: 429 }) } }),
    } });
    await assert.rejects(f.account.recovery("issue"), /Wait 10 minutes/);
    Object.defineProperty(client, "functions", { configurable: true, value: {
      invoke: async () => ({ data: null, error: { context: new Response(null, { status: 404 }) } }),
    } });
    await assert.rejects(f.account.recovery("issue"), /Your account is ready/);
  } finally {
    Object.defineProperty(client, "functions", { configurable: true, value: original });
    await f.account.dispose();
  }
});
