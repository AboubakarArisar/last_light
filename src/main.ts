import "./style.css";
import { replayFrame } from "./replay";
import {
  chapters,
  levels,
  venues,
  daily,
  decodeChallenge,
  challengeURL,
  type Level,
} from "./levels";
import {
  KEY,
  fresh,
  parseSave,
  unlocked,
  totalStars,
  award,
  type Save,
} from "./save";
import { Simulation, STEP, type Frame, type Kick } from "./simulation";
import { Stadium } from "./rendering";
import { Drawing } from "./input";
import { Sound } from "./audio";
import { en as t } from "./strings";
import { Account, accountClient } from "./account";
import { heartStatus } from "./hearts";
const ui = document.querySelector<HTMLElement>("#ui")!,
  toast = document.querySelector<HTMLElement>("#toast")!;
let save: Save;
let hadSave = false;
try {
  const raw = localStorage.getItem(KEY);
  hadSave = raw !== null;
  save = parseSave(raw);
} catch {
  save = fresh();
}
if (!hadSave && matchMedia("(prefers-reduced-motion: reduce)").matches)
  save.settings.reducedMotion = true;
let sim = new Simulation(levels[0]);
let page = "home",
  mode = "career",
  paused = false,
  loft = false,
  attempt = 1,
  resultTime = 0,
  recordedResult = false,
  replayTime = 0,
  replaySpeed = 1,
  replayPaused = false,
  replayReturn = "result";
let previousState = sim.state;
let accumulator = 0;
let previous = 0;
let toastTimer = 0;
const abort = new AbortController();
const sound = new Sound(save.settings);
let view: Stadium;
try {
  view = new Stadium(document.querySelector("#stadium")!, levels[5], save);
} catch (error) {
  ui.innerHTML =
    '<section class="fallback"><h1>THE PITCH<br>IS WAITING.</h1><p>This game needs WebGL 2. Enable hardware acceleration in your browser and reload.</p><button onclick="location.reload()">Reload game</button></section>';
  throw error;
}
const drawing = new Drawing(
  document.querySelector("#ink")!,
  view,
  () => sim,
  act,
  notify,
);
const icons = {
  arrow: "↗",
  play: "▶",
  back: "←",
  close: "×",
  pause: "Ⅱ",
  star: "★",
  sound: "◖))",
};
const escape = (x: string) =>
  x.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const button = (action: string, label: string, cls = "", extra = "") =>
  `<button data-action="${action}" class="${cls}" ${extra}>${label}</button>`;
const stars = (n: number) =>
  `<span class="stars" aria-label="${n} stars">${"★".repeat(n)}<span class="empty">${"☆".repeat(3 - n)}</span></span>`;
let authMode: "login" | "signup" | "forgot" = "login";
let authBusy = false;
let recoveryTicket: string | null = null;
let recoveryStep = false;
let recoveryError = "";
let accountNotice = "";
let authEmail = "";
let authUsername = "";
let ticketDownloadURL: string | null = null;
let ticketDownloadTimer = 0;
let accountSetupError = "";
let client: ReturnType<typeof accountClient> = null;
try { client = accountClient(); }
catch (error) { accountSetupError = error instanceof Error ? error.message : "Accounts could not be configured."; }
// Access storage lazily so blocked browser storage produces a visible error.
const account = new Account(client, {
  get length() { return localStorage.length; },
  clear: () => localStorage.clear(),
  key: (index) => localStorage.key(index),
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
}, (value, switched) => {
  save = value;
  view.settings = save;
  sound.update(save.settings);
  view.quality();
  if (switched) {
    recoveryTicket = null;
    recoveryStep = false;
    recoveryError = "";
    sim = new Simulation(levels[unlocked(save)]);
    previousState = sim.state;
    if (["play", "result", "replay"].includes(page)) screen("home");
  }
  if (!authBusy && !recoveryStep && !["play", "result", "replay"].includes(page)) screen(page);
}, () => {
  document.querySelectorAll<HTMLElement>("[data-save-status]").forEach((el) => {
    el.textContent = account.error || account.status;
    el.classList.toggle("save-error", !!account.error);
  });
  const syncButton = ui.querySelector<HTMLButtonElement>('[data-action="sync-account"]');
  if (syncButton) buttonLoading(syncButton, account.syncing, "Saving…");
  ui.querySelectorAll<HTMLElement>("[data-account-stat]").forEach((el) => {
    el.textContent = account.progressReady
      ? String(el.dataset.accountStat === "levels" ? save.stars.filter(Boolean).length : el.dataset.accountStat === "stars" ? totalStars(save) : save.stats.goals)
      : "—";
  });
});
function buttonLoading(el: HTMLButtonElement, loading: boolean, label = "Please wait…") {
  if (loading) {
    if (!el.hasAttribute("data-idle-content")) el.dataset.idleContent = el.innerHTML;
    el.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${escape(label)}</span>`;
    el.disabled = true;
    el.setAttribute("aria-busy", "true");
  } else if (el.hasAttribute("data-idle-content")) {
    el.innerHTML = el.dataset.idleContent!;
    delete el.dataset.idleContent;
    el.disabled = false;
    el.removeAttribute("aria-busy");
  }
}
function accountName() {
  const name = account.user?.user_metadata.username;
  return typeof name === "string" && name.trim() ? name : account.user?.email?.split("@")[0] || "My account";
}
function persist() {
  account.save(save);
}
function heartsMarkup() {
  return account.user ? '<div class="heart-meter" data-hearts aria-live="off"></div>' : "";
}
let heartDisplay = "";
let heartLostUntil = 0;
let heartDisplaySecond = -1;
function updateHearts() {
  const second = Math.floor(Date.now() / 1000);
  if (second === heartDisplaySecond && !ui.querySelector("[data-hearts]:empty")) return;
  heartDisplaySecond = second;
  const { segments, nextIn } = heartStatus(save.hearts);
  const seconds = Math.ceil(nextIn / 1000);
  const ready = account.ready && account.progressReady;
  const label = ready ? `${segments}/25 · ${seconds ? `+1 in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "Full"}` : "Loading hearts…";
  const content = `<span class="heart-shapes" aria-hidden="true">${Array.from({ length: 5 }, (_, heart) => `<span class="segmented-heart">${Array.from({ length: 5 }, (_, part) => `<i class="${heart * 5 + part < segments && ready ? "filled" : ""}"></i>`).join("")}</span>`).join("")}</span><small>${label}</small>`;
  ui.querySelectorAll<HTMLElement>("[data-hearts]").forEach((el) => {
    if (heartDisplay !== content || !el.firstChild) {
      el.innerHTML = content;
      el.setAttribute("aria-label", ready ? `${segments} of 25 heart segments. ${seconds ? `Next segment in ${seconds} seconds.` : "Hearts full."}` : label);
    }
    el.classList.toggle("heart-lost", Date.now() < heartLostUntil);
  });
  heartDisplay = content;
}
function finishCareerAttempt(won = false) {
  if (account.finishCareerAttempt(won)) {
    heartLostUntil = Date.now() + 1200;
    notify("−1 heart segment. One segment returns every 3 minutes.");
  }
}
function emptyHearts() {
  screen("career");
  ui.insertAdjacentHTML("beforeend", `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="Hearts refilling"><h2>HEARTS REFILLING.</h2>${heartsMarkup()}<p>One segment returns every 3 minutes, even while you’re away. Daily Shot and friend challenges are free.</p>${button("continue", "Try career again", "primary")}${button("daily", "Play Daily Shot", "secondary")}${button("close-modal", "Back", "text-button")}</section></div>`);
  updateHearts();
}
function notify(message: string) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2900);
}
function header(active = "") {
  const identity = !account.ready ? '<span class="guest-label">Checking sign-in…</span>' : account.user
    ? button("account", `<span class="account-avatar" aria-hidden="true">${escape(accountName().slice(0, 1).toUpperCase())}</span><span><b>${escape(accountName())}</b><small>✓ Signed in</small></span>`, "account-identity-button", `aria-label="Account for ${escape(accountName())}, signed in"`)
    : `<span class="guest-label">Guest</span>${button("account", "Sign in", "account-link")}${button("auth-signup", "Join the club ↗", "account-join")}`;
  return `<header><button class="wordmark" data-action="home" aria-label="LAST LIGHT home">LAST<span>LIGHT</span><i>™</i></button><nav aria-label="Main navigation">${button("career", t.career, active === "career" ? "active" : "")}${button("daily", t.daily, active === "daily" ? "active" : "")}${button("customize", t.customize, active === "customize" ? "active" : "")}</nav><div class="profile-chip">${heartsMarkup()}${identity}${button("settings", "⚙", "icon-button", 'aria-label="Settings"')}</div></header>`;
}
function screen(name: string) {
  if (page === "play" && name !== "play") finishCareerAttempt(sim.state === "goal");
  if (name !== "account") { recoveryTicket = null; recoveryStep = false; recoveryError = ""; }
  page = name;
  paused = false;
  drawing.enabled = false;
  drawing.cancel();
  sound.menu(name !== "play" && name !== "replay");
  document.body.dataset.page = name;
  if (name === "home") home();
  else if (name === "career") career();
  else if (name === "daily") dailyScreen();
  else if (name === "customize") customize();
  else if (name === "stats") stats();
  else if (name === "settings") settings();
  else if (name === "account") accountScreen();
  else if (name === "play") hud();
  else if (name === "result") results();
  else if (name === "replay") replayUI();
  ui.scrollTop = 0;
}
function home() {
  const id = unlocked(save),
    chapter = chapters[Math.floor(id / 8)];
  ui.innerHTML = `${header()}<section class="home-hero"><div class="eyebrow"><span class="live-dot"></span> THE BEAUTIFUL GAME. IN YOUR HANDS.</div><h1>ONE MOVE.<br>EVERY<span>THING.</span></h1><p>Find the pass. Bend the shot.<br>Make the moment they remember.</p><div class="hero-actions">${button("continue", `${save.stats.attempts ? t.continue : t.play}<span>↗</span>`, "primary")}${button("how", "How to play <span>↗</span>", "text-button")}</div><div class="career-note"><span class="thin-line"></span><span>CHAPTER ${String(Math.floor(id / 8) + 1).padStart(2, "0")}<b>${chapter.name}</b></span></div></section><aside class="match-caption"><span class="live-dot"></span> NORTHSTAR FC <span class="caption-line"></span><small>${venues[view.level.stadium].toUpperCase()}<br>THE NEXT MOMENT IS YOURS.</small></aside><section class="home-bottom"><button data-action="daily" class="daily-promo"><span class="eyebrow">A NEW CHALLENGE. EVERY DAY.</span><strong>THE DAILY SHOT <span>↗</span></strong><small>${daily().brief}</small></button><button data-action="career" class="journey-promo"><span class="eyebrow">FROM FIRST TOUCH TO FINAL WHISTLE</span><strong>64 MOMENTS. ONE LEGACY.</strong><div class="progress"><i style="width:${(save.stars.filter(Boolean).length / 64) * 100}%"></i></div><small>${save.stars.filter(Boolean).length} / 64 COMPLETED <span>${totalStars(save)} ★</span></small></button><div class="home-footer"><span>DRAW YOUR OWN LEGACY.</span>${button("stats", "Your record ↗", "text-button")}<small>© LAST LIGHT ${new Date().getFullYear()}</small></div></section><div class="vignette"></div>`;
}
function career() {
  const id = unlocked(save);
  ui.innerHTML = `${header("career")}<section class="page-content career-page"><div class="page-heading"><div class="eyebrow">NORTHSTAR FC / THE CAREER</div><h1>YOUR STORY.<br><em>STILL UNWRITTEN.</em></h1><p>${save.stars.filter(Boolean).length} of 64 moments complete <span class="accent">${totalStars(save)} / 192 ★</span></p></div><div class="chapter-list">${chapters
    .map(
      (c, i) =>
        `<section class="chapter"><div class="chapter-heading"><span class="chapter-number">0${i + 1}</span><div><small>${c.competition}</small><h2>${c.name}</h2><p>${c.tagline}</p></div><span class="chapter-stars">${save.stars.slice(i * 8, i * 8 + 8).reduce((a, b) => a + b, 0)} / 24 ★</span></div><div class="level-grid">${levels
          .slice(i * 8, i * 8 + 8)
          .map((l) =>
            button(
              `level:${l.id}`,
              `<span class="level-no">${String(l.id + 1).padStart(2, "0")}</span><b>${l.title}</b><small>${l.specialty}</small>${l.id <= id ? stars(save.stars[l.id]) : '<span class="locked-label">LOCKED</span>'}`,
              `level ${l.id === id ? "current" : ""}`,
              l.id > id ? "disabled" : "",
            ),
          )
          .join("")}</div></section>`,
    )
    .join("")}</div></section>`;
}
function dailyScreen() {
  const l = daily(),
    date = new Date().toISOString().slice(0, 10),
    done = save.daily.date === date;
  ui.innerHTML = `${header("daily")}<section class="feature-page"><div class="eyebrow">${date} · SAME SHOT. EVERYONE.</div><h1>THE DAILY<br><em>SHOT.</em></h1><p>${l.brief}</p><div class="daily-details"><div><small>THE OCCASION</small><b>${l.specialty}</b></div><div><small>THE GROUND</small><b>${venues[l.stadium]}</b></div><div><small>YOUR STREAK</small><b>${save.daily.streak} ${save.daily.streak === 1 ? "day" : "days"}</b></div></div>${done ? `<p>${stars(save.daily.stars)} Best goal quality: ${save.daily.best}</p>` : ""}${button("start-daily", `${done ? "Play it again" : "Take your shot"} <span>↗</span>`, "primary")}<small class="footnote">Unlimited attempts. Resets at 00:00 UTC. Results saved on this device.</small></section>`;
}
function customize() {
  const total = totalStars(save);
  const p = save.profile;
  ui.innerHTML = `${header("customize")}<section class="page-content customize-page"><div class="page-heading"><div class="eyebrow">NORTHSTAR FC / PLAYER IDENTITY</div><h1>MAKE IT<br><em>YOUR OWN.</em></h1></div><form id="profile-form"><div class="form-row"><label>Player name<input name="name" maxlength="24" value="${escape(p.name)}" required></label><label>Shirt number<input name="number" type="number" min="1" max="99" value="${p.number}" required></label></div><label>Skin tone<select name="skin">${[
    ["#bd8765", "Warm"],
    ["#e1b796", "Light"],
    ["#82593e", "Deep"],
    ["#5d3e2d", "Dark"],
  ]
    .map(
      ([v, n]) =>
        `<option value="${v}" ${p.skin === v ? "selected" : ""}>${n}</option>`,
    )
    .join(
      "",
    )}</select></label><label>Hair<select name="hair"><option value="short" ${p.hair === "short" ? "selected" : ""}>Short crop</option><option value="shaved" ${p.hair === "shaved" ? "selected" : ""}>Shaved</option></select></label><div class="form-row"><label>Match kit<select name="kit">${[
    ["#dae8c6", "Northstar home", 0],
    ["#d5a46c", "Heritage gold", 12],
    ["#9abacc", "Away blue", 30],
    ["#dbc9d0", "Final edition", 75],
  ]
    .map(
      ([v, n, min]) =>
        `<option value="${v}" ${p.kit === v ? "selected" : ""} ${total < Number(min) ? "disabled" : ""}>${n}${total < Number(min) ? ` · ${min} ★` : ""}</option>`,
    )
    .join("")}</select></label><label>Boots<select name="boots">${[
    ["#e3ff6c", "Volt", 0],
    ["#f0eee2", "Chalk", 6],
    ["#d37b48", "Copper", 20],
  ]
    .map(
      ([v, n, min]) =>
        `<option value="${v}" ${p.boots === v ? "selected" : ""} ${total < Number(min) ? "disabled" : ""}>${n}${total < Number(min) ? ` · ${min} ★` : ""}</option>`,
    )
    .join(
      "",
    )}</select></label></div><label>Goal celebration<select name="celebration">${[
    ["arms", "Arms wide", 0],
    ["fist", "To the crowd", 9],
    ["slide", "Knee slide", 24],
  ]
    .map(
      ([v, n, min]) =>
        `<option value="${v}" ${p.celebration === v ? "selected" : ""} ${total < Number(min) ? "disabled" : ""}>${n}${total < Number(min) ? ` · ${min} ★` : ""}</option>`,
    )
    .join(
      "",
    )}</select></label><button class="primary" type="submit">Save identity <span>↗</span></button><p class="muted">Earn stars to unlock kits, boots and celebrations. Every unlock is cosmetic.</p></form></section>`;
}
function stats() {
  const s = save.stats;
  const accuracy = (n: number, d: number) =>
    d ? Math.round((n / d) * 100) + "%" : "—";
  ui.innerHTML = `${header()}<section class="page-content"><div class="eyebrow">THE NUMBERS BEHIND THE MOMENTS</div><h1>YOUR<br><em>RECORD.</em></h1><div class="stats-grid">${[
    ["Goals", s.goals],
    ["Shot conversion", accuracy(s.goals, s.shots)],
    ["Pass accuracy", accuracy(s.completedPasses, s.passes)],
    ["Completed passes", s.completedPasses],
    ["Longest goal", s.longest.toFixed(1) + " m"],
    ["Curled goals", s.curved],
    ["Headers", s.headers],
    ["Volleys", s.volleys],
    ["Free kicks", s.freeKicks],
    ["Perfect moments", save.stars.filter((x) => x === 3).length],
    ["Career stars", totalStars(save)],
    ["Daily streak", save.daily.streak],
  ]
    .map(
      ([label, n]) => `<div><strong>${n}</strong><span>${label}</span></div>`,
    )
    .join(
      "",
    )}</div>${button("home", "← Back to home", "text-button")}</section>`;
}
function settings() {
  const s = save.settings;
  ui.innerHTML = `${header()}<section class="page-content settings-page"><div class="eyebrow">YOUR GAME. YOUR WAY.</div><h1>SETTINGS.</h1><form id="settings-form">${(["volume", "music", "crowd"] as const).map((k, i) => `<label class="slider-label">${["Master volume", "Menu music", "Stadium ambience"][i]}<output>${Math.round(s[k] * 100)}%</output><input name="${k}" aria-label="${["Master volume", "Menu music", "Stadium ambience"][i]}" type="range" min="0" max="1" step=".05" value="${s[k]}"></label>`).join("")}<label>Graphics<select name="graphics">${["auto", "low", "medium", "high"].map((v) => `<option ${s.graphics === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><label class="toggle">Reduced camera motion<input name="reducedMotion" type="checkbox" ${s.reducedMotion ? "checked" : ""}></label><label class="toggle">Haptic feedback<input name="vibration" type="checkbox" ${s.vibration ? "checked" : ""}></label><p class="muted">Mouse, touch or pen: draw from the ball.<br>Keyboard: arrow keys aim, Enter shoots, L switches lift, Escape pauses, R retries.</p></form><div class="settings-footer">${button("home", "← Back to home", "text-button")}${!account.user ? button("reset", "Reset guest progress", "danger") : button("account", "Manage account ↗", "text-button")}</div><small class="muted">${escape(account.error || account.status)}. ${account.user ? "Your account keeps your progress across devices." : "Sign in to back up progress to your account."}</small></section>`;
}
function start(level: Level, newMode = "career", retry = false) {
  if (!account.canPlay) {
    notify(account.ready ? "This account is open in another tab. Close that tab and reload here." : "Checking your sign-in. Please try again in a moment.");
    return;
  }
  finishCareerAttempt(sim.state === "goal");
  if (newMode === "career") {
    if (!account.progressReady) {
      notify("Load your account’s saved progress before playing career. Daily Shot is available while you wait.");
      return;
    }
    if (!heartStatus(save.hearts).segments) { emptyHearts(); return; }
  }
  mode = newMode;
  if (!retry) attempt = 1;
  sim = new Simulation(level);
  previousState = "decision";
  resultTime = 0;
  recordedResult = false;
  loft = false;
  drawing.loft = false;
  accumulator = 0;
  view.configure(level);
  view.mode = "play";
  save.stats.attempts++;
  persist();
  screen("play");
  sound.play("whistle");
}
function levelLabel(l: Level) {
  return mode === "daily" ? "DAILY SHOT" : mode === "friend" ? "FRIEND CHALLENGE" : `LEVEL ${String(l.id + 1).padStart(2, "0")} / ${levels.length}`;
}
function hud() {
  drawing.enabled = !paused && sim.state === "decision";
  const l = sim.level;
  ui.innerHTML = `<div class="hud-top"><div class="scorebug"><div class="clock">${l.minute}</div><b>NST</b><strong>${sim.state === "goal" ? "2 — 1" : l.score}</strong><b>${l.rival}</b><div class="score-competition">${chapters[l.chapter].competition}</div></div><div class="hud-actions">${heartsMarkup()}${button("retry", "↻", "icon-button", 'aria-label="Restart moment"')}${button("pause", icons.pause, "icon-button", 'aria-label="Pause match"')}</div></div><div class="moment-info"><span class="eyebrow">${levelLabel(l)}</span><h2>${l.title}</h2><p>${l.brief}</p></div><div class="draw-hint"><span class="hint-symbol">⌁</span><div><b>${sim.passes < l.requiredPasses ? `${t.first} (${l.requiredPasses - sim.passes} to go)` : t.shoot}</b><small>${sim.passes < l.requiredPasses ? "Lead the runner. Open up the game." : "Straight for power. Curve for finesse."}</small></div></div><div class="hud-bottom"><span class="attempt-label">ATTEMPT <b>${String(attempt).padStart(2, "0")}</b></span><div class="kick-toggle" aria-label="Ball flight">${button("driven", t.driven, !loft ? "selected" : "")}${button("loft", t.lift, loft ? "selected" : "")}</div><div class="move-status"><span>${sim.passes} PASSES</span><b>${sim.state === "execution" ? "BALL IN PLAY" : "YOUR MOMENT"}</b></div></div>`;
  if (sim.state === "execution") {
    const h = ui.querySelector(".draw-hint");
    if (h)
      h.innerHTML = '<span class="execution-label">LET IT PLAY OUT.</span>';
  }
}
function act(k: Kick) {
  void sound
    .start()
    .catch(() => notify("Audio is unavailable on this device."));
  if (page !== "play" || paused || sim.state !== "decision") return;
  if (mode === "career" && !heartStatus(save.hearts).segments) { emptyHearts(); return; }
  sim.act(k);
  if (mode === "career") account.beginCareerAttempt();
  drawing.enabled = false;
  k.shot ? save.stats.shots++ : save.stats.passes++;
  persist();
  hud();
}
function endResult() {
  finishCareerAttempt(sim.state === "goal");
  if (sim.state === "goal" && !recordedResult) {
    recordedResult = true;
    const r = sim.result!;
    save.stats.goals++;
    save.stats.longest = Math.max(save.stats.longest, r.distance);
    if (r.curve > 0.3) save.stats.curved++;
    if (r.finish === "Header") save.stats.headers++;
    if (r.finish === "Volley") save.stats.volleys++;
    if (sim.level.specialty === "Free kick") save.stats.freeKicks++;
    award(save, sim.level.id, r.stars, r.quality, mode);
    persist();
  }
  if (sim.state === "failure") persist();
}

function accountScreen() {
  let content: string;
  if (!account.client) {
    content = `<h1>YOUR<br><em>ACCOUNT.</em></h1><p>${escape(accountSetupError || "Accounts are not available yet. You can keep playing as a guest on this browser.")}</p>`;
  } else if (account.user && recoveryStep) {
    content = `<div class="auth-steps"><span>✓ Account created</span><span aria-current="step">2 · Keep access</span></div><h1>YOUR WAY<br><em>BACK IN.</em></h1><p>You're signed in as <strong>${escape(accountName())}</strong>. One last thing: save your recovery code.</p>${recoveryPanel(true)}`;
  } else if (account.user) {
    const guest = account.guestProgress();
    content = `<h1>YOUR<br><em>CLUBHOUSE.</em></h1><p class="account-identity"><span class="signed-in-label">✓ Signed in</span><b>${escape(accountName())}</b><br>${escape(account.user.email ?? "")}</p>
      <div class="account-save-card"><h2>YOUR PROGRESS</h2><p data-save-status role="status" class="${account.error ? "save-error" : ""}">${escape(account.error || account.status)}</p>
      <div class="account-summary"><span><b data-account-stat="levels">${account.progressReady ? save.stars.filter(Boolean).length : "—"}</b> / 64 levels</span><span><b data-account-stat="stars">${account.progressReady ? totalStars(save) : "—"}</b> stars</span><span><b data-account-stat="goals">${account.progressReady ? save.stats.goals : "—"}</b> goals</span></div>
      ${button("sync-account", "Check saved progress ↗", "secondary")}</div>
      ${guest ? `<div class="account-section"><h2>KEEP YOUR LOCAL RUN.</h2><p>You played ${guest.stars.filter(Boolean).length} levels as a guest here. Add that progress to your account without losing your existing results.</p>${button("import-guest", "Keep my guest progress ↗", "secondary")}</div>` : ""}
      <div class="account-section"><h2>FORGOT YOUR PASSWORD?</h2>${recoveryPanel(false)}</div><div class="account-actions">${button("logout", "Log out", "text-button")}</div>`;
  } else {
    const signup = authMode === "signup", forgot = authMode === "forgot";
    content = `${signup ? '<div class="auth-steps"><span aria-current="step">1 · Your account</span><span>2 · Keep access</span></div>' : ""}<h1>${signup ? "JOIN THE<br><em>CLUB.</em>" : forgot ? "BACK IN<br><em>THE GAME.</em>" : "WELCOME<br><em>BACK.</em>"}</h1>
      <p>${signup ? "Keep your levels, goals and best moments in one place." : forgot ? "Enter the recovery code you saved when joining. Then choose a new password." : "Sign in with your email to pick up where you left off."}</p>
      ${accountNotice ? `<p class="account-notice" role="status">${escape(accountNotice)}</p>` : ""}
      <form id="auth-form"><fieldset ${authBusy ? "disabled" : ""}>
      ${signup ? `<label>What should we call you?<input name="username" autocomplete="nickname" value="${escape(authUsername)}" minlength="3" maxlength="24" pattern="[A-Za-z0-9_]{3,24}" title="3–24 letters, numbers or underscores" required><small class="field-hint">3–24 letters, numbers or underscores.</small></label>` : ""}
      ${forgot ? '<label>Your recovery code<input name="ticket" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="LL-XXXXXXXX-…" required><small class="field-hint">Paste the full code, including all six groups.</small></label>' : `<label>Email address<input name="email" type="email" autocomplete="email" value="${escape(authEmail)}" maxlength="254" required></label>`}
      <label for="auth-password">${forgot ? "New password" : "Password"}</label><div class="password-field"><input id="auth-password" name="password" type="password" autocomplete="${signup || forgot ? "new-password" : "current-password"}" ${signup || forgot ? 'minlength="10" aria-describedby="password-hint"' : ""} required>${button("toggle-password", "Show", "password-toggle", 'type="button" aria-label="Show password" aria-pressed="false"')}</div>
      ${signup || forgot ? '<p id="password-hint" class="field-hint">At least 10 characters. A short phrase is easy to remember.</p><label>Confirm password<input name="confirm" type="password" autocomplete="new-password" minlength="10" required></label>' : `<div class="forgot-link">${button("auth-forgot", "Forgot password?", "text-button", 'type="button"')}</div>`}
      <p id="auth-message" role="alert" tabindex="-1"></p><button type="submit" class="primary">${signup ? "Create my account ↗" : forgot ? "Set new password ↗" : "Sign in ↗"}</button>
      ${signup ? '<p class="muted">Next, we’ll give you a private recovery code to save. No verification email or OTP.</p>' : ""}</fieldset></form>
      <div class="account-actions"><span>${signup ? "Already a member?" : forgot ? "Remember your password?" : "New here?"}</span>${button(signup || forgot ? "auth-login" : "auth-signup", signup || forgot ? "Sign in" : "Create an account", "text-button")}</div>`;
  }
  ui.innerHTML = `${header()}<section class="page-content account-page"><div class="eyebrow">NORTHSTAR FC / YOUR ACCOUNT</div>${content}${!recoveryStep ? button("home", account.user ? "← Back to game" : "Continue as a guest →", "text-button") : ""}</section>`;
  const syncButton = ui.querySelector<HTMLButtonElement>('[data-action="sync-account"]');
  if (syncButton) buttonLoading(syncButton, account.syncing, "Saving…");
}

function recoveryPanel(onboarding: boolean) {
  return `<div class="recovery-card"><p>Your recovery code is your spare key. Use it if you forget your password—no email needed. Keep it private.</p>
    ${recoveryTicket ? `<div class="ticket-label">LAST LIGHT · YOUR RECOVERY CODE</div><code id="recovery-ticket">${escape(recoveryTicket)}</code><div class="account-actions">${button("copy-ticket", "Copy code", "secondary")}${button("download-ticket", "Download a copy ↓", "text-button")}</div><p class="field-hint">Keep a copy in your password manager or somewhere safe. We can’t show this code again after you leave.</p>${onboarding ? '<label class="ticket-confirm"><input id="ticket-saved" type="checkbox"> I’ve saved my recovery code somewhere safe.</label>' + button("finish-signup", "Let’s play ↗", "primary", "disabled") : ""}`
    : `<p>${onboarding ? "Your account is created. Let's prepare your code before you play." : "Create a code now, or replace one you've lost. Creating a new code makes the previous one stop working."}</p>${button("issue-ticket", recoveryError ? "Try again ↗" : "Prepare my recovery code ↗", "primary")}`}
    <p id="recovery-message" role="alert" class="save-error">${escape(recoveryError)}</p>
    ${onboarding && !recoveryTicket ? button("skip-recovery", "I’ll do this later", "text-button") + '<p class="field-hint">You won’t be able to reset a forgotten password until you save a recovery code.</p>' : ""}</div>`;
}

async function prepareRecovery(el: HTMLButtonElement) {
  authBusy = true;
  recoveryError = "";
  buttonLoading(el, true, "Preparing your code…");
  try { recoveryTicket = await account.recovery("issue"); }
  catch (error) { recoveryError = error instanceof Error ? error.message : "Your code couldn't be prepared. Please try again."; }
  finally {
    authBusy = false;
    buttonLoading(el, false);
    accountScreen();
  }
}

async function submitAuth(form: HTMLFormElement) {
  if (authBusy) return;
  const values = new FormData(form);
  const password = String(values.get("password") ?? "");
  const formMode = authMode;
  authEmail = String(values.get("email") ?? authEmail).trim();
  authUsername = String(values.get("username") ?? authUsername).trim();
  const message = form.querySelector<HTMLElement>("#auth-message")!;
  if (formMode !== "login" && password !== values.get("confirm")) {
    message.textContent = "The passwords do not match.";
    form.querySelector<HTMLInputElement>('[name="confirm"]')?.focus(); return;
  }
  authBusy = true;
  const fieldset = form.querySelector("fieldset")!;
  fieldset.disabled = true;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  buttonLoading(submit, true, formMode === "signup" ? "Creating your account…" : formMode === "login" ? "Signing in…" : "Updating your password…");
  message.textContent = "";
  accountNotice = "";
  try {
    if (formMode === "signup") {
      await account.signUp(authUsername, authEmail, password);
      form.reset();
      recoveryStep = true;
      authBusy = false;
      screen("account");
      await prepareRecovery(ui.querySelector<HTMLButtonElement>('[data-action="issue-ticket"]')!);
      return;
    } else if (formMode === "login") {
      await account.signIn(authEmail, password);
    } else {
      await account.recovery("reset", { ticket: String(values.get("ticket") ?? ""), password });
      authMode = "login";
      accountNotice = "Your password is updated. Sign in with the new password, then save a new recovery code.";
    }
    form.reset();
    authBusy = false;
    accountScreen();
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "Could not complete the request. Please retry.";
    message.focus();
  } finally {
    authBusy = false;
    fieldset.disabled = false;
    buttonLoading(submit, false);
  }
}
function results() {
  drawing.enabled = false;
  const r = sim.result,
    l = sim.level;
  const won = sim.state === "goal";
  ui.innerHTML = `<section class="result-panel" role="status">${heartsMarkup()}<div class="eyebrow">${levelLabel(l)} · ${won ? t.results : "TRY AGAIN"}</div><h1>${won ? r!.label : t.failure}</h1>${won ? `<div class="result-stars">${stars(r!.stars)}</div><p>${l.title} · ${r!.finish}</p><div class="result-stats"><div><small>GOAL QUALITY</small><b>${r!.quality}<i>/100</i></b></div><div><small>DISTANCE</small><b>${r!.distance.toFixed(1)}<i>m</i></b></div><div><small>PASSES</small><b>${r!.passes}</b></div></div><ul class="objectives">${l.stars.map((label, i) => `<li class="${i === 0 || (i === 1 && r!.passes >= Math.max(1, l.requiredPasses)) || (i === 2 && r!.quality >= (l.chapter < 2 ? 40 : 65)) ? "done" : ""}">${label}</li>`).join("")}</ul>` : `<p>${sim.reason}. ${sim.reason.includes("keeper") ? "Aim wider, add curve, or try a lifted finish." : sim.reason.includes("intercept") ? "Try leading the runner or lifting your pass." : "Adjust your line and go again."}</p>`}<div class="result-actions">${button(won && mode === "career" && l.id < 63 ? "next" : "retry", won && mode === "career" && l.id < 63 ? `${t.next} ↗` : `${t.retry} ↻`, "primary")}${button("replay", t.replay, "secondary")}${won ? button("share", t.share + " ↗", "text-button") : ""}${button("home", "Back to home", "text-button")}</div>${won && l.id === 63 ? `<div class="trophy">✦ ${mode === "career" ? "CONTINENTAL CHAMPIONS" : "CHAMPIONSHIP MOMENT"} ✦<p>${mode === "career" ? "Your story is written. Make every moment a three-star moment." : "Two passes. One unforgettable finish."}</p></div>` : ""}</section>`;
}
function pause() {
  if (page !== "play") return;
  paused = true;
  drawing.enabled = false;
  drawing.cancel();
  ui.insertAdjacentHTML(
    "beforeend",
    `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><div class="eyebrow">${levelLabel(sim.level)} · ${sim.level.title}</div><h1>HALF<br><em>A MOMENT.</em></h1>${button("resume", t.resume + " ↗", "primary")}${button("retry", "Restart moment", "secondary")}${button("home", "Back to home", "text-button")}</section></div>`,
  );
  sound.suspend();
}
function replayUI() {
  drawing.enabled = false;
  ui.innerHTML = `<div class="replay-top"><span class="eyebrow"><span class="live-dot"></span> ACTION REPLAY</span>${button("exit-replay", "×", "icon-button", 'aria-label="Exit replay"')}</div><div class="replay-bottom">${button("replay-pause", replayPaused ? "▶" : "Ⅱ", "icon-button", 'aria-label="Pause or play replay"')}<input id="replay-seek" aria-label="Replay position" type="range" min="0" max="${Math.max(0.1, sim.recorded.at(-1)!.time)}" step=".01" value="${replayTime}">${button("replay-speed", `${replaySpeed}×`, "secondary")}<span class="wordmark">LAST<span>LIGHT</span></span></div>`;
}
function share() {
  const url = challengeURL(sim.level, location.href);
  ui.insertAdjacentHTML(
    "beforeend",
    `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="Challenge a friend"><div class="eyebrow">I SCORED THIS. CAN YOU?</div><h2>PASS IT ON.</h2><p>Your friend gets this exact scenario. No account needed.</p><input id="challenge-link" readonly value="${escape(url)}" aria-label="Challenge URL">${button("copy-link", "Copy challenge link ↗", "primary")}${typeof navigator.share === "function" ? button("native-share", "Share…", "secondary") : ""}${button("close-modal", "Done", "text-button")}</section></div>`,
  );
  ui.querySelector<HTMLInputElement>("#challenge-link")?.focus();
}

ui.addEventListener(
  "click",
  async (event) => {
    const el = (event.target as HTMLElement).closest<HTMLButtonElement>(
      "[data-action]",
    );
    if (!el || el.disabled) return;
    if (authBusy) return;
    const action = el.dataset.action!;
    if (action === "toggle-password") {
      const password = ui.querySelector<HTMLInputElement>("#auth-password")!;
      const show = password.type === "password";
      password.type = show ? "text" : "password";
      el.textContent = show ? "Hide" : "Show";
      el.setAttribute("aria-label", show ? "Hide password" : "Show password");
      el.setAttribute("aria-pressed", String(show));
      return;
    }
    if (action === "finish-signup") {
      if (recoveryTicket && ui.querySelector<HTMLInputElement>("#ticket-saved")?.checked) screen("home");
      return;
    }
    if (action === "skip-recovery") { screen("home"); return; }
    if (action === "issue-ticket") { await prepareRecovery(el); return; }
    if (action === "download-ticket" && recoveryTicket) {
      if (ticketDownloadURL) URL.revokeObjectURL(ticketDownloadURL);
      clearTimeout(ticketDownloadTimer);
      ticketDownloadURL = URL.createObjectURL(new Blob([
        `LAST LIGHT — RECOVERY CODE\n\n${recoveryTicket}\n\nKeep this private. Use it on Forgot password to reset your password. It works once.\n`,
      ], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = ticketDownloadURL;
      link.download = "last-light-recovery-code.txt";
      link.click();
      ticketDownloadTimer = window.setTimeout(() => {
        if (ticketDownloadURL) URL.revokeObjectURL(ticketDownloadURL);
        ticketDownloadURL = null;
      }, 1000);
      el.textContent = "Downloaded ✓";
      return;
    }
    if (action.startsWith("auth-")) {
      const email = ui.querySelector<HTMLInputElement>('[name="email"]');
      if (email) authEmail = email.value.trim();
      const username = ui.querySelector<HTMLInputElement>('[name="username"]');
      if (username) authUsername = username.value.trim();
      recoveryTicket = null;
      accountNotice = "";
      authMode = action === "auth-signup" ? "signup" : action === "auth-forgot" ? "forgot" : "login";
      screen("account");
      return;
    }
    if (["logout", "sync-account", "import-guest", "copy-ticket"].includes(action)) {
      authBusy = true;
      buttonLoading(el, true, action === "logout" ? "Logging out…" : action === "import-guest" ? "Keeping your progress…" : action === "copy-ticket" ? "Copying…" : "Checking…");
      try {
        if (action === "logout") {
          const unsynced = !!account.cache.pending || !!account.error;
          await account.signOut();
          if (unsynced) notify("Logged out. Pending progress stays on this browser until you sign in again.");
        } else if (action === "sync-account") await account.sync();
        else if (action === "import-guest") await account.importGuest();
        else if (recoveryTicket) {
          try { await navigator.clipboard.writeText(recoveryTicket); buttonLoading(el, false); el.textContent = "Copied ✓"; }
          catch {
            const code = ui.querySelector("#recovery-ticket");
            if (code) { const range = document.createRange(); range.selectNodeContents(code); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range); }
            notify("Select and copy your recovery ticket.");
          }
          return;
        }
        authBusy = false;
        screen("account");
      } catch (error) { notify(error instanceof Error ? error.message : "Could not complete the request. Please retry."); }
      finally { authBusy = false; buttonLoading(el, false); }
      return;
    }
    try {
      await sound.start();
    } catch {
      notify("Audio is unavailable. You can still play.");
    }
    sound.play("ui");
    if (
      ["home", "career", "daily", "customize", "stats", "settings", "account"].includes(
        action,
      )
    )
      screen(action);
    else if (action === "continue") start(levels[unlocked(save)]);
    else if (action.startsWith("level:")) {
      const id = Number(action.split(":")[1]);
      if (id <= unlocked(save)) start(levels[id]);
    } else if (action === "start-daily") start(daily(), "daily");
    else if (action === "retry") {
      attempt++;
      start(sim.level, mode, true);
    } else if (action === "next") start(levels[Math.min(63, sim.level.id + 1)]);
    else if (action === "pause") pause();
    else if (action === "resume") {
      paused = false;
      hud();
    } else if (action === "driven" || action === "loft") {
      loft = action === "loft";
      drawing.loft = loft;
      hud();
    } else if (action === "replay") {
      replayTime = 0;
      replayPaused = false;
      replayReturn = page;
      screen("replay");
      sound.menu(false);
    } else if (action === "exit-replay") screen(replayReturn);
    else if (action === "replay-pause") {
      replayPaused = !replayPaused;
      replayUI();
    } else if (action === "replay-speed") {
      replaySpeed = replaySpeed === 1 ? 0.5 : replaySpeed === 0.5 ? 2 : 1;
      replayUI();
    } else if (action === "share") share();
    else if (action === "copy-link") {
      try {
        await navigator.clipboard.writeText(
          challengeURL(sim.level, location.href),
        );
        notify("Challenge link copied.");
      } catch {
        const field = ui.querySelector<HTMLInputElement>("#challenge-link");
        field?.focus();
        field?.select();
        notify("Select and copy the link above.");
      }
    } else if (action === "native-share") {
      try {
        await navigator.share({
          title: "LAST LIGHT",
          text: "I scored this. Can you beat it?",
          url: challengeURL(sim.level, location.href),
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          notify("Use Copy challenge link to share this moment.");
      }
    } else if (action === "how") {
      ui.insertAdjacentHTML(
        "beforeend",
        `<div class="modal-backdrop"><section class="modal"><div class="eyebrow">THREE THINGS. ENDLESS POSSIBILITIES.</div><h2>READ. DRAW. BELIEVE.</h2><ol><li>Start at the ball. Draw toward a teammate to pass.</li><li>Lead their run, then draw into the goal to shoot.</li><li>Bend your line for curl. Choose Lifted for a chip or cross.</li></ol><p>Earn stars for scoring, completing passes and goal quality. Career has 25 heart segments: a failed attempt or leaving after a kick costs one. One segment returns every 3 minutes. Daily Shot and friend challenges are free.</p>${button("continue", "Let’s play ↗", "primary")}${button("close-modal", "Back", "text-button")}</section></div>`,
      );
    } else if (action === "close-modal")
      ui.querySelector(".modal-backdrop")?.remove();
    else if (action === "reset") {
      ui.insertAdjacentHTML(
        "beforeend",
        `<div class="modal-backdrop"><section class="modal"><h2>Start a new story?</h2><p>This deletes career stars, daily results, statistics and your player identity from this device.</p>${button("confirm-reset", "Delete progress", "danger")}${button("close-modal", "Keep my progress", "primary")}</section></div>`,
      );
    } else if (action === "confirm-reset") {
      if (account.user) return;
      save = fresh();
      view.settings = save;
      sound.update(save.settings);
      persist();
      screen("home");
    }
  },
  { signal: abort.signal },
);
ui.addEventListener(
  "change",
  (event) => {
    const input = event.target as HTMLInputElement;
    if (input.id === "ticket-saved") {
      const proceed = ui.querySelector<HTMLButtonElement>('[data-action="finish-signup"]');
      if (proceed) proceed.disabled = !input.checked;
    }
  },
  { signal: abort.signal },
);
ui.addEventListener(
  "submit",
  (e) => {
    if ((e.target as HTMLElement).id === "auth-form") {
      e.preventDefault();
      void submitAuth(e.target as HTMLFormElement);
      return;
    }
    if ((e.target as HTMLElement).id !== "profile-form") return;
    e.preventDefault();
    const data = new FormData(e.target as HTMLFormElement);
    save.profile = {
      name: String(data.get("name")).trim().slice(0, 24) || "Northstar",
      number: Math.max(1, Math.min(99, Number(data.get("number")))),
      skin: String(data.get("skin")),
      kit: String(data.get("kit")),
      boots: String(data.get("boots")),
      hair: String(data.get("hair")),
      celebration: String(data.get("celebration")),
    };
    persist();
    notify("Player identity saved. See your new look on the pitch.");
    screen("customize");
  },
  { signal: abort.signal },
);
ui.addEventListener(
  "input",
  (e) => {
    const input = e.target as HTMLInputElement;
    if (input.id === "replay-seek") {
      replayTime = Number(input.value);
      return;
    }
    if (!input.closest("#settings-form")) return;
    const form = ui.querySelector<HTMLFormElement>("#settings-form")!;
    const data = new FormData(form);
    save.settings = {
      volume: Number(data.get("volume")),
      music: Number(data.get("music")),
      crowd: Number(data.get("crowd")),
      graphics: String(data.get("graphics")),
      vibration: data.has("vibration"),
      reducedMotion: data.has("reducedMotion"),
    };
    sound.update(save.settings);
    view.quality();
    input.previousElementSibling?.tagName === "OUTPUT" &&
      (input.previousElementSibling.textContent =
        Math.round(Number(input.value) * 100) + "%");
    persist();
  },
  { signal: abort.signal },
);
window.addEventListener(
  "keydown",
  (e) => {
    const modal = ui.querySelector<HTMLElement>(".modal");
    if (modal && e.key === "Tab") {
      const focusable = [
        ...modal.querySelectorAll<HTMLElement>(
          "button,input,select,[tabindex]",
        ),
      ];
      const first = focusable[0],
        last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    if ((e.target as HTMLElement).matches("input,select,textarea")) return;
    if (page === "play") {
      if (e.key === "Escape") {
        e.preventDefault();
        if (paused) {
          paused = false;
          void sound.start();
          hud();
        } else pause();
      }
      if (e.key.toLowerCase() === "r") {
        attempt++;
        start(sim.level, mode, true);
      }
      if (e.key.toLowerCase() === "l" && !paused && sim.state === "decision") {
        loft = !loft;
        drawing.loft = loft;
        hud();
      }
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(
          e.key,
        ) &&
        !paused
      ) {
        e.preventDefault();
        drawing.keyboardAim(e.key);
      }
    }
  },
  { signal: abort.signal },
);
window.addEventListener(
  "resize",
  () => {
    view.resize();
    drawing.resize();
  },
  { signal: abort.signal },
);
document.addEventListener(
  "visibilitychange",
  () => {
    if (document.hidden) {
      if (page === "play" && !paused) pause();
      replayPaused = true;
      sound.suspend();
    }
    previous = 0;
  },
  { signal: abort.signal },
);
const menuSim = new Simulation(levels[3]);
function frame(time: number) {
  updateHearts();
  const dt = previous ? Math.min((time - previous) / 1000, 0.05) : 1 / 60;
  previous = time;
  let displayed: Frame;
  if (page === "play" && !paused) {
    accumulator += dt;
    while (accumulator >= STEP) {
      sim.step();
      accumulator -= STEP;
    }
    for (const ev of sim.events.splice(0)) {
      sound.play(ev);
      if (ev === "receive") {
        save.stats.completedPasses++;
        persist();
      }
    }
    if (sim.state !== previousState) {
      previousState = sim.state;
      if (sim.state === "decision") hud();
      else if (sim.state === "goal" || sim.state === "failure") {
        drawing.enabled = false;
        endResult();
        resultTime = 0;
        ui.innerHTML =
          sim.state === "goal"
            ? `<div class="goal-flash"><span>${sim.level.minute} / NORTHSTAR FC</span><h1>${sim.result!.label}</h1><p>THAT ONE IS YOURS.</p></div>`
            : "";
      }
    }
    if (sim.state === "goal" || sim.state === "failure") {
      resultTime += dt;
      if (resultTime > (sim.state === "goal" ? 2.6 : 0.85)) screen("result");
    }
  }
  if (page === "replay") {
    if (!replayPaused) replayTime += dt * replaySpeed;
    const end = sim.recorded.at(-1)!.time;
    if (replayTime > end + 0.8) replayTime = 0;
    displayed = replayFrame(sim.recorded, replayTime);
    const seek = ui.querySelector<HTMLInputElement>("#replay-seek");
    if (seek && document.activeElement !== seek)
      seek.value = String(replayTime);
  } else if (["play", "result"].includes(page))
    displayed = {
      players: sim.players,
      ball: sim.ball,
      state: sim.state,
      time: sim.time,
      carrier: sim.carrier,
      net: sim.net,
    };
  else
    displayed = {
      players: menuSim.players,
      ball: menuSim.ball,
      state: menuSim.state,
      time: 0,
      carrier: 0,
      net: 0,
    };
  view.update(
    displayed,
    dt,
    ["play", "result", "replay"].includes(page) ? "play" : "menu",
    resultTime,
  );
  const hint = ui.querySelector<HTMLElement>(".draw-hint");
  if (hint && page === "play") {
    const ball = view.project(sim.ball);
    const rect = hint.getBoundingClientRect();
    const restingBottom = innerHeight - (innerWidth <= 600 ? 92 : 105);
    hint.classList.toggle("avoid-ball",
      ball.x > rect.left - 45 && ball.x < rect.right + 45 &&
      ball.y > restingBottom - rect.height - 50 && ball.y < restingBottom + 40);
  }
  drawing.draw();
}
view.renderer.setAnimationLoop(frame);
window.addEventListener(
  "pageshow",
  (e) => {
    if (e.persisted) location.reload();
  },
  { signal: abort.signal },
);
window.addEventListener(
  "pagehide",
  (event) => {
    finishCareerAttempt(sim.state === "goal");
    if (event.persisted) return;
    view.renderer.setAnimationLoop(null);
    drawing.dispose();
    sound.dispose();
    view.dispose();
    abort.abort();
    clearTimeout(toastTimer);
    clearTimeout(ticketDownloadTimer);
    if (ticketDownloadURL) URL.revokeObjectURL(ticketDownloadURL);
    void account.dispose().catch(() => console.error("Account cleanup failed."));
  },
  { signal: abort.signal },
);
const challenge = decodeChallenge(
  new URL(location.href).searchParams.get("challenge"),
);
screen("home");
void account.initialize().then(() => {
  if (challenge && account.canPlay) {
    start(challenge, "friend");
    notify("Your friend scored this. Can you?");
  } else if (challenge) {
    notify("Your challenge is ready. Close any other game tab, then reload this link.");
  }
}).catch(() => notify("Account initialization failed. Please reload and try again."));
// Read-only development diagnostics; no production debug UI or mutation shortcuts.
if (import.meta.env.DEV)
  Object.defineProperty(window, "lastLight", {
    get: () => ({
      state: sim.state,
      level: sim.level.id,
      ball: { ...sim.ball },
      players: sim.players.map((p) => ({ ...p })),
      fps: view.fps,
      drawCalls: view.renderer.info.render.calls,
      triangles: view.renderer.info.render.triangles,
      geometries: view.renderer.info.memory.geometries,
      project: (p: { x: number; y?: number; z: number }) => view.project(p),
      save: structuredClone(save),
    }),
  });
