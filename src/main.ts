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
const ui = document.querySelector<HTMLElement>("#ui")!,
  toast = document.querySelector<HTMLElement>("#toast")!;
let save: Save;
let persistence = true;
let hadSave = false;
try {
  const raw = localStorage.getItem(KEY);
  hadSave = raw !== null;
  save = parseSave(raw);
} catch {
  save = fresh();
  persistence = false;
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
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    persistence = false;
    notify("Device storage is unavailable. Progress is kept for this session.");
  }
}
function notify(message: string) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2900);
}
function header(active = "") {
  return `<header><button class="wordmark" data-action="home" aria-label="LAST LIGHT home">LAST<span>LIGHT</span><i>™</i></button><nav aria-label="Main navigation">${button("career", t.career, active === "career" ? "active" : "")}${button("daily", t.daily, active === "daily" ? "active" : "")}${button("customize", t.customize, active === "customize" ? "active" : "")}</nav><div class="profile-chip"><span class="crest">N<span>★</span></span><div><b>${escape(save.profile.name)}</b><small>NORTHSTAR FC · #${save.profile.number}</small></div>${button("settings", "⚙", "icon-button", 'aria-label="Settings"')}</div></header>`;
}
function screen(name: string) {
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
  ui.innerHTML = `${header()}<section class="page-content settings-page"><div class="eyebrow">YOUR GAME. YOUR WAY.</div><h1>SETTINGS.</h1><form id="settings-form">${(["volume", "music", "crowd"] as const).map((k, i) => `<label class="slider-label">${["Master volume", "Menu music", "Stadium ambience"][i]}<output>${Math.round(s[k] * 100)}%</output><input name="${k}" aria-label="${["Master volume", "Menu music", "Stadium ambience"][i]}" type="range" min="0" max="1" step=".05" value="${s[k]}"></label>`).join("")}<label>Graphics<select name="graphics">${["auto", "low", "medium", "high"].map((v) => `<option ${s.graphics === v ? "selected" : ""}>${v}</option>`).join("")}</select></label><label class="toggle">Reduced camera motion<input name="reducedMotion" type="checkbox" ${s.reducedMotion ? "checked" : ""}></label><label class="toggle">Haptic feedback<input name="vibration" type="checkbox" ${s.vibration ? "checked" : ""}></label><p class="muted">Mouse, touch or pen: draw from the ball.<br>Keyboard: arrow keys aim, Enter shoots, L switches lift, Escape pauses, R retries.</p></form><div class="settings-footer">${button("home", "← Back to home", "text-button")}${button("reset", "Reset progress", "danger")}</div><small class="muted">${persistence ? t.saved : "Device storage unavailable"}. No account needed.</small></section>`;
}
function start(level: Level, newMode = "career", retry = false) {
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
  ui.innerHTML = `<div class="hud-top"><div class="scorebug"><div class="clock">${l.minute}</div><b>NST</b><strong>${sim.state === "goal" ? "2 — 1" : l.score}</strong><b>${l.rival}</b><div class="score-competition">${chapters[l.chapter].competition}</div></div><div class="hud-actions">${button("retry", "↻", "icon-button", 'aria-label="Restart moment"')}${button("pause", icons.pause, "icon-button", 'aria-label="Pause match"')}</div></div><div class="moment-info"><span class="eyebrow">${levelLabel(l)}</span><h2>${l.title}</h2><p>${l.brief}</p></div><div class="draw-hint"><span class="hint-symbol">⌁</span><div><b>${sim.passes < l.requiredPasses ? `${t.first} (${l.requiredPasses - sim.passes} to go)` : t.shoot}</b><small>${sim.passes < l.requiredPasses ? "Lead the runner. Open up the game." : "Straight for power. Curve for finesse."}</small></div></div><div class="hud-bottom"><span class="attempt-label">ATTEMPT <b>${String(attempt).padStart(2, "0")}</b></span><div class="kick-toggle" aria-label="Ball flight">${button("driven", t.driven, !loft ? "selected" : "")}${button("loft", t.lift, loft ? "selected" : "")}</div><div class="move-status"><span>${sim.passes} PASSES</span><b>${sim.state === "execution" ? "BALL IN PLAY" : "YOUR MOMENT"}</b></div></div>`;
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
  sim.act(k);
  drawing.enabled = false;
  k.shot ? save.stats.shots++ : save.stats.passes++;
  hud();
}
function endResult() {
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
}
function results() {
  drawing.enabled = false;
  const r = sim.result,
    l = sim.level;
  const won = sim.state === "goal";
  ui.innerHTML = `<section class="result-panel" role="status"><div class="eyebrow">${levelLabel(l)} · ${won ? t.results : "TRY AGAIN"}</div><h1>${won ? r!.label : t.failure}</h1>${won ? `<div class="result-stars">${stars(r!.stars)}</div><p>${l.title} · ${r!.finish}</p><div class="result-stats"><div><small>GOAL QUALITY</small><b>${r!.quality}<i>/100</i></b></div><div><small>DISTANCE</small><b>${r!.distance.toFixed(1)}<i>m</i></b></div><div><small>PASSES</small><b>${r!.passes}</b></div></div><ul class="objectives">${l.stars.map((label, i) => `<li class="${i === 0 || (i === 1 && r!.passes >= Math.max(1, l.requiredPasses)) || (i === 2 && r!.quality >= (l.chapter < 2 ? 40 : 65)) ? "done" : ""}">${label}</li>`).join("")}</ul>` : `<p>${sim.reason}. ${sim.reason.includes("keeper") ? "Aim wider, add curve, or try a lifted finish." : sim.reason.includes("intercept") ? "Try leading the runner or lifting your pass." : "Adjust your line and go again."}</p>`}<div class="result-actions">${button(won && mode === "career" && l.id < 63 ? "next" : "retry", won && mode === "career" && l.id < 63 ? `${t.next} ↗` : `${t.retry} ↻`, "primary")}${button("replay", t.replay, "secondary")}${won ? button("share", t.share + " ↗", "text-button") : ""}${button("home", "Back to home", "text-button")}</div>${won && l.id === 63 ? `<div class="trophy">✦ ${mode === "career" ? "CONTINENTAL CHAMPIONS" : "CHAMPIONSHIP MOMENT"} ✦<p>${mode === "career" ? "Your story is written. Make every moment a three-star moment." : "Two passes. One unforgettable finish."}</p></div>` : ""}</section>`;
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
    const action = el.dataset.action!;
    try {
      await sound.start();
    } catch {
      notify("Audio is unavailable. You can still play.");
    }
    sound.play("ui");
    if (
      ["home", "career", "daily", "customize", "stats", "settings"].includes(
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
        `<div class="modal-backdrop"><section class="modal"><div class="eyebrow">THREE THINGS. ENDLESS POSSIBILITIES.</div><h2>READ. DRAW. BELIEVE.</h2><ol><li>Start at the ball. Draw toward a teammate to pass.</li><li>Lead their run, then draw into the goal to shoot.</li><li>Bend your line for curl. Choose Lifted for a chip or cross.</li></ol><p>Earn stars for scoring, completing passes and goal quality. Retry freely.</p>${button("continue", "Let’s play ↗", "primary")}${button("close-modal", "Back", "text-button")}</section></div>`,
      );
    } else if (action === "close-modal")
      ui.querySelector(".modal-backdrop")?.remove();
    else if (action === "reset") {
      ui.insertAdjacentHTML(
        "beforeend",
        `<div class="modal-backdrop"><section class="modal"><h2>Start a new story?</h2><p>This deletes career stars, daily results, statistics and your player identity from this device.</p>${button("confirm-reset", "Delete progress", "danger")}${button("close-modal", "Keep my progress", "primary")}</section></div>`,
      );
    } else if (action === "confirm-reset") {
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
  "submit",
  (e) => {
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
    if (event.persisted) return;
    view.renderer.setAnimationLoop(null);
    drawing.dispose();
    sound.dispose();
    view.dispose();
    abort.abort();
    clearTimeout(toastTimer);
  },
  { signal: abort.signal },
);
const challenge = decodeChallenge(
  new URL(location.href).searchParams.get("challenge"),
);
if (challenge) {
  start(challenge, "friend");
  notify("Your friend scored this. Can you?");
} else screen("home");
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
