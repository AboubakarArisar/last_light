import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { KEY, fresh, type Save } from "./save.ts";
import { spendHeart } from "./hearts.ts";
import { mergeProgress, newCache, readCache, readSave, type ProgressCache } from "./progress.ts";

export class CloudSaveError extends Error {
  retryable: boolean;
  constructor(error: { code?: string }, writing = false) {
    const setup = ["PGRST205", "PGRST202", "42P01", "42883", "42501"].includes(error.code ?? "");
    const session = ["PGRST301", "PGRST302", "PGRST303", "28000"].includes(error.code ?? "");
    super(setup ? "Online saves aren't available yet. Your progress on this browser is safe."
      : session ? "Please sign in again to reconnect your saved progress."
      : writing ? "Your progress is saved on this browser. We'll upload it when the connection returns."
      : "We couldn't reach your saved progress. Check your connection and try again.");
    this.retryable = !setup && !session;
  }
}

export function accountClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname))
    throw new Error("Supabase requires HTTPS.");
  if (key.startsWith("sb_secret_")) throw new Error("Use a Supabase publishable key, not a secret key.");
  return createClient(url, key);
}

export class Account {
  client: SupabaseClient | null;
  user: User | null = null;
  ready = false;
  progressReady = false;
  status = "Checking account…";
  syncing = false;
  error = "";
  cache = newCache();
  private loadedUser: string | null | undefined;
  private unsubscribe?: () => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private request: AbortController | null = null;
  private running: Promise<void> | null = null;
  private disposed = false;
  private cacheBlocked = false;
  private retryDelay = 2000;
  private generation = 0;
  private releaseLock?: () => void;
  private writable = true;
  private events = new AbortController();
  private storage: Storage;
  private onSave: (save: Save, switched: boolean) => void;
  private onStatus: () => void;
  private careerAttempt = false;

  constructor(client: SupabaseClient | null, storage: Storage,
    onSave: (save: Save, switched: boolean) => void, onStatus: () => void) {
    this.client = client;
    this.storage = storage;
    this.onSave = onSave;
    this.onStatus = onStatus;
  }

  get canPlay() { return this.ready && this.writable; }

  async initialize() {
    window.addEventListener("online", () => this.schedule(0), { signal: this.events.signal });
    window.addEventListener("focus", () => this.schedule(0), { signal: this.events.signal });
    if (!this.client) { this.switchUser(null); return; }
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      // No Supabase calls inside its auth callback: those can wait on the auth lock.
      this.switchUser(session?.user ?? null);
    });
    this.unsubscribe = () => data.subscription.unsubscribe();
    try {
      const { data: session, error } = await this.client.auth.getSession();
      if (error) throw error;
      this.switchUser(session.session?.user ?? null);
    } catch (error) {
      this.switchUser(null);
      this.report(error);
    }
  }

  private switchUser(user: User | null) {
    if (this.disposed) return;
    const id = user?.id ?? null;
    if (this.loadedUser === id) { this.user = user; this.onStatus(); return; }
    this.finishCareerAttempt(false);
    this.user = user;
    this.loadedUser = id;
    this.generation++;
    this.releaseLock?.();
    this.releaseLock = undefined;
    this.request?.abort();
    this.running = null;
    this.syncing = false;
    clearTimeout(this.timer);
    this.cacheBlocked = false;
    this.error = "";
    this.cache = newCache();
    this.progressReady = !id;
    try {
      if (id) {
        const raw = this.storage.getItem(this.key);
        if (raw) { this.cache = readCache(raw); this.progressReady = this.cache.cloudLoaded; }
      } else {
        const raw = this.storage.getItem(KEY);
        if (raw) this.cache = newCache(readSave(JSON.parse(raw)));
      }
    } catch (error) {
      this.cacheBlocked = true;
      this.report(error);
    }
    this.ready = true;
    this.writable = !(id && typeof document !== "undefined" && navigator.locks);
    this.status = id ? "Loading cloud progress…" : "Guest · saved on this browser";
    this.onSave(structuredClone(this.cache.save), true);
    this.onStatus();
    if (id && !this.writable) {
      const generation = this.generation;
      const progressReady = this.progressReady;
      this.progressReady = false;
      void navigator.locks.request(`lastlight-progress:${id}`, { ifAvailable: true }, async (lock) => {
        if (this.disposed || generation !== this.generation) return;
        if (!lock) { this.report(new Error("This account is open in another tab. Close that tab, then reload here.")); return; }
        this.writable = true;
        this.progressReady = progressReady;
        this.schedule(0);
        await new Promise<void>((resolve) => { this.releaseLock = resolve; });
      }).catch((error: unknown) => this.report(error));
    } else if (id && !this.cacheBlocked) this.schedule(0);
  }

  private get key() { return this.user ? `${KEY}.account.${this.user.id}` : KEY; }

  beginCareerAttempt() { this.careerAttempt = true; }

  finishCareerAttempt(won: boolean) {
    if (!this.careerAttempt) return false;
    this.careerAttempt = false;
    if (won || !spendHeart(this.cache.save.hearts)) return false;
    this.save(this.cache.save);
    this.onSave(structuredClone(this.cache.save), false);
    return true;
  }

  private store() {
    if (this.cacheBlocked) throw new Error("Unreadable local progress was preserved. Back it up before replacing it.");
    this.storage.setItem(this.key, JSON.stringify(this.user ? this.cache : this.cache.save));
  }

  save(value: Save) {
    if (!this.ready) return;
    if (!this.writable) { this.report(new Error("Progress is open in another tab. Close it and reload before making changes.")); return; }
    this.cache.save = structuredClone(value);
    try {
      this.store();
      this.error = "";
      this.status = this.user ? "Saved locally · cloud sync pending" : "Guest · saved on this browser";
    } catch (error) { this.report(error); }
    this.onStatus();
    if (this.user) this.schedule(600);
  }

  private report(error: unknown) {
    this.error = error instanceof Error ? error.message : "Account service unavailable. Please retry.";
    this.status = "Save needs attention";
    this.onStatus();
  }

  private schedule(delay: number) {
    clearTimeout(this.timer);
    if (!this.user || this.disposed || this.cacheBlocked) return;
    this.timer = setTimeout(() => { void this.sync(); }, delay);
  }

  sync(): Promise<void> {
    if (this.running) return this.running;
    if (!this.user || !this.client || this.disposed || this.cacheBlocked || !this.writable) return Promise.resolve();
    const generation = this.generation;
    const request = new AbortController();
    this.request = request;
    const timeout = setTimeout(() => request.abort(), 15000);
    this.running = this.synchronize(this.user.id, request.signal, generation)
      .catch((error: unknown) => {
        if (this.disposed || generation !== this.generation) return;
        this.report(error);
        if (!(error instanceof CloudSaveError) || error.retryable) {
          this.schedule(this.retryDelay);
          this.retryDelay = Math.min(60000, this.retryDelay * 2);
        }
      })
      .finally(() => {
        clearTimeout(timeout);
        if (generation === this.generation) {
          this.running = null; this.request = null; this.syncing = false; this.onStatus();
        }
      });
    return this.running;
  }

  private async synchronize(userId: string, signal: AbortSignal, generation: number) {
    const active = () => !this.disposed && generation === this.generation;
    this.syncing = true;
    this.status = "Syncing progress…";
    this.onStatus();
    // Retry the exact persisted operation first if its previous response was lost.
    if (!this.cache.pending) {
      const { data, error } = await this.client!.from("player_saves")
        .select("data").eq("user_id", userId).abortSignal(signal).maybeSingle();
      if (!active()) return;
      if (error) {
        console.warn("Cloud progress read failed", { code: error.code });
        throw new CloudSaveError(error);
      }
      const remote = data ? readSave(data.data) : fresh();
      this.cache.save = mergeProgress(remote, this.cache.base, this.cache.save);
      this.cache.base = remote;
      this.cache.cloudLoaded = true;
      this.progressReady = true;
      this.store();
      this.onSave(structuredClone(this.cache.save), false);
    }
    if (!this.cache.pending && JSON.stringify(this.cache.save) !== JSON.stringify(this.cache.base)) {
      this.cache.pending = { id: crypto.randomUUID(), base: structuredClone(this.cache.base), save: structuredClone(this.cache.save) };
      this.store();
    }
    if (this.cache.pending) {
      const pending = this.cache.pending;
      const { data, error } = await this.client!.rpc("sync_game_save_v3", {
        p_operation: pending.id, p_base: pending.base, p_save: pending.save,
      }).abortSignal(signal);
      if (!active()) return;
      if (error) {
        console.warn("Cloud progress write failed", { code: error.code });
        throw new CloudSaveError(error, true);
      }
      const remote = readSave(data);
      this.cache.save = mergeProgress(remote, pending.save, this.cache.save);
      this.cache.base = remote;
      this.cache.pending = null;
      this.cache.cloudLoaded = true;
      this.progressReady = true;
      this.store();
      this.onSave(structuredClone(this.cache.save), false);
    }
    this.error = "";
    this.retryDelay = 2000;
    const dirty = JSON.stringify(this.cache.save) !== JSON.stringify(this.cache.base);
    this.status = dirty ? "Saved locally · cloud sync pending" : "Progress saved to your account";
    this.onStatus();
    if (dirty) this.schedule(600);
  }

  guestProgress(): Save | null {
    try {
      const raw = this.storage.getItem(KEY);
      if (!raw || this.storage.getItem(`${KEY}.imported`)) return null;
      const save = readSave(JSON.parse(raw));
      return save.stats.attempts || save.stars.some(Boolean) ? save : null;
    } catch (error) { this.report(error); return null; }
  }

  async importGuest() {
    if (!this.user) throw new Error("Sign in before importing guest progress.");
    if (!this.writable) throw new Error("Close the other game tab and reload before importing.");
    await this.sync();
    if (this.error || this.cache.pending) throw new Error("Sync your account before importing guest progress.");
    const guest = this.guestProgress();
    if (!guest) return;
    // A stable operation ID also prevents duplicate imports after an interrupted request.
    const importKey = `${KEY}.import-operation`;
    const id = this.storage.getItem(importKey) ?? crypto.randomUUID();
    this.storage.setItem(importKey, id);
    const before = structuredClone(this.cache.save);
    this.cache.save = mergeProgress(before, fresh(), guest);
    this.cache.save.hearts = { ...before.hearts };
    this.cache.pending = { id, base: before, save: structuredClone(this.cache.save) };
    this.store();
    // Import is now durably queued; keep the original guest save as a backup.
    this.storage.setItem(`${KEY}.imported`, this.user.id);
    await this.sync();
  }

  async signUp(username: string, email: string, password: string) {
    if (!this.client) throw new Error("Accounts are not configured yet.");
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) throw new Error("Use 3–24 letters, numbers or underscores for your username.");
    validatePassword(password);
    const { data, error } = await this.client.auth.signUp({ email, password, options: { data: { username } } });
    if (error) throw new Error(error.message);
    if (!data.session) throw new Error("Signup needs email confirmation. The project owner must disable Confirm email in Supabase to enable immediate login.");
    this.switchUser(data.user);
  }

  async signIn(email: string, password: string) {
    if (!this.client) throw new Error("Accounts are not configured yet.");
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error("Could not sign in. Check your email and password, then try again.");
    this.switchUser(data.user);
  }

  async signOut() {
    if (!this.client) return;
    await this.sync();
    const { error } = await this.client.auth.signOut({ scope: "local" });
    if (error) throw new Error("Could not log out. Please check your connection and retry.");
    this.switchUser(null);
  }

  async recovery(action: "issue" | "reset", values: Record<string, string> = {}): Promise<string | null> {
    if (!this.client) throw new Error("Accounts are not configured yet.");
    if (action === "reset") validatePassword(values.password);
    const { data, error } = await this.client.functions.invoke("recovery-ticket", { body: { action, ...values }, timeout: 15000 });
    if (error || !data?.ok) {
      const status = error?.context instanceof Response ? error.context.status : undefined;
      console.warn("Recovery request failed", { action, status, type: error?.name });
      if (status === 429) throw new Error("Too many attempts. Wait 10 minutes before trying again.");
      if (action === "issue") throw new Error("Your account is ready, but we couldn't prepare your recovery code. Try again in a moment.");
      throw new Error(status === 400
        ? "That recovery code isn't valid or has already been used. Check all six groups and try again."
        : "We couldn't reset your password right now. Please try again shortly.");
    }
    if (action === "issue" && (typeof data.ticket !== "string" || !/^LL-(?:[0-9A-F]{8}-){5}[0-9A-F]{8}$/.test(data.ticket)))
      throw new Error("Your recovery code wasn't returned correctly. Please try again.");
    return action === "issue" ? data.ticket : null;
  }

  async dispose() {
    this.disposed = true;
    this.generation++;
    clearTimeout(this.timer);
    this.request?.abort();
    this.events.abort();
    this.releaseLock?.();
    this.unsubscribe?.();
    await this.client?.auth.dispose();
  }
}

export function validatePassword(password: string) {
  // Supabase's bcrypt input limit is measured in bytes, not characters.
  if (password.length < 10 || new TextEncoder().encode(password).length > 72)
    throw new Error("Use a password of at least 10 characters and at most 72 UTF-8 bytes.");
}
