import { test } from "node:test";
import { replayFrame } from "../src/replay.ts";
import { solve } from "./routes.ts";
import assert from "node:assert/strict";
import {
  levels,
  daily,
  challengeURL,
  decodeChallenge,
  makeLevel,
} from "../src/levels.ts";
import {
  Simulation,
  launch,
  integrate,
  STEP,
  type Kick,
} from "../src/simulation.ts";
import { fresh, parseSave, unlocked, award, totalStars } from "../src/save.ts";
const shoot = (s: Simulation, x = 3, y = 1.8, curve = 0): Kick => ({
  shot: true,
  target: { x, y, z: -0.08 },
  receiver: -1,
  power: 0.75,
  curve,
  loft: false,
});
function execute(s: Simulation, k: Kick) {
  s.act(k);
  for (let i = 0; i < 900 && s.state === "execution"; i++) s.step();
  return s;
}
test("64 reproducible career scenarios span eight chapters and distinct situations", () => {
  assert.equal(levels.length, 64);
  assert.equal(new Set(levels.map((l) => l.title)).size, 16);
  assert.equal(new Set(levels.map((l) => l.chapter)).size, 8);
  for (const l of levels) assert.deepEqual(l, makeLevel(l.id));
});
test("challenge links preserve scenario and reject malformed input", () => {
  for (const l of levels) {
    const u = new URL(challengeURL(l, "https://game.example/play?old=1#bad"));
    assert.deepEqual(decodeChallenge(u.searchParams.get("challenge")), l);
  }
  for (const v of ["-1.3", "64.3", "1.NaN", "1.9999999999", "<script>", null])
    assert.equal(decodeChallenge(v), null);
});
test("daily is stable and changes with the UTC date", () => {
  assert.deepEqual(daily("2026-09-07"), daily("2026-09-07"));
  assert.notEqual(daily("2026-09-07").seed, daily("2026-09-08").seed);
});
test("corrupt and partial saves recover safely", () => {
  for (const raw of ["broken", "null", "{}", '{"version":99}'])
    assert.deepEqual(parseSave(raw), fresh());
  const s = parseSave(
    '{"version":1,"stars":[99,-4,"bad"],"settings":{"volume":12},"profile":{"kit":"bad"}}',
  );
  assert.deepEqual(s.stars.slice(0, 3), [3, 0, 0]);
  assert.equal(s.settings.volume, 1);
  assert.equal(s.profile.kit, fresh().profile.kit);
  assert.deepEqual(parseSave(JSON.stringify(fresh())), fresh());
});
test("awards are monotonic, unlock the next moment, and daily does not advance career", () => {
  const s = fresh();
  award(s, 0, 3, 90, "career");
  award(s, 0, 1, 30, "career");
  assert.equal(totalStars(s), 3);
  assert.equal(unlocked(s), 1);
  award(s, 10, 3, 99, "daily", "2026-09-07");
  assert.equal(s.stars[10], 0);
  assert.equal(s.daily.streak, 1);
  award(s, 10, 2, 90, "daily", "2026-09-07");
  assert.equal(s.daily.streak, 1);
  award(s, 10, 3, 99, "daily", "2026-09-08");
  assert.equal(s.daily.streak, 2);
});
test("pass reception creates a second decision and a placed shot scores", () => {
  const s = new Simulation(levels[0]);
  execute(s, {
    shot: false,
    target: { x: 3, y: 0.11, z: 15.2 },
    receiver: 1,
    power: 0.5,
    curve: 0,
    loft: false,
  });
  assert.equal(s.state, "decision");
  assert.equal(s.carrier, 1);
  assert.equal(s.passes, 1);
  execute(s, shoot(s));
  assert.equal(s.state, "goal");
  assert.ok(s.result!.quality > 40);
  assert.equal(s.result!.stars, 3);
});
test("keeper saves central shots; poor shots miss; restart is clean", () => {
  const l = {
    ...levels[0],
    attackers: [{ x: 0, z: 16, route: [] }],
    defenders: [],
  };
  const s = execute(new Simulation(l), {
    ...shoot(new Simulation(l), 0, 0.6),
    power: 0.3,
  });
  assert.equal(s.state, "failure");
  assert.match(s.reason, /keeper/i);
  const missed = execute(new Simulation(l), shoot(new Simulation(l), 5, 1));
  assert.equal(missed.state, "failure");
  assert.equal(missed.reason, "Just wide");
  assert.equal(new Simulation(l).state, "decision");
});
test("defenders intercept and frame collisions rebound", () => {
  const l = { ...levels[0], defenders: [{ x: -1, z: 21 }] };
  const s = execute(new Simulation(l), {
    shot: false,
    target: { x: 3, y: 0.11, z: 15 },
    receiver: 1,
    power: 0.4,
    curve: 0,
    loft: false,
  });
  assert.equal(s.state, "failure");
  const l2 = { ...levels[0], requiredPasses: 0, defenders: [] };
  const inside = execute(new Simulation(l2), shoot(new Simulation(l2), 3.6, 1));
  assert.equal(inside.state, "goal");
  assert.ok(inside.post);
  const outside = execute(
    new Simulation(l2),
    shoot(new Simulation(l2), 3.78, 1),
  );
  assert.equal(outside.state, "decision");
  assert.ok(outside.post);
  assert.ok(outside.events.includes("rebound"));
  outside.act(shoot(outside));
  outside.step();
  assert.equal(
    outside.state,
    "execution",
    "a recovered rebound can be kicked again",
  );
});
test("spin changes trajectory; gravity, bounce and friction remain finite", () => {
  const s = new Simulation(levels[0]);
  const a = launch(s.ball, shoot(s, 3, 1.8, 0)),
    b = launch(s.ball, shoot(s, 3, 1.8, 0.8));
  for (let i = 0; i < 50; i++) {
    integrate(a, STEP);
    integrate(b, STEP);
  }
  assert.ok(Math.abs(a.x - b.x) > 0.3);
  for (let i = 0; i < 10000; i++) integrate(b, STEP);
  assert.equal(b.y, 0.11);
  assert.ok(Math.hypot(b.vx, b.vz) < 0.1);
});
test("identical commands produce identical replay frames", () => {
  const a = new Simulation(levels[27]),
    b = new Simulation(levels[27]);
  execute(a, shoot(a));
  execute(b, shoot(b));
  assert.deepEqual(a.recorded, b.recorded);
});
test("all 64 scenarios have a verified multi-phase solution", () => {
  for (const l of levels) {
    const result = solve(l.id);
    assert.ok(result, `Scenario ${l.id + 1} has no tested scoring route`);
    assert.equal(result.path.length, l.requiredPasses + 1);
  }
});
test("scoring before completing the move fails the objective", () => {
  const s = new Simulation(levels[0]);
  execute(s, shoot(s));
  assert.equal(s.state, "failure");
  assert.match(s.reason, /passes needed/);
});
test("replays interpolate positions and preserve terminal state", () => {
  const sim = new Simulation({
    ...levels[0],
    requiredPasses: 0,
    defenders: [],
  });
  execute(sim, shoot(sim));
  for (let i = 0; i < 320; i++) sim.step();
  const last = sim.recorded.at(-1)!;
  assert.deepEqual(replayFrame(sim.recorded, last.time).ball, last.ball);
  assert.equal(replayFrame(sim.recorded, last.time).state, "goal");
  const a = sim.recorded[1],
    b = sim.recorded[2];
  const middle = replayFrame(sim.recorded, (a.time + b.time) / 2);
  assert.ok(Math.abs(middle.ball.x - (a.ball.x + b.ball.x) / 2) < 1e-8);
  assert.ok(last.ball.z < 0 && last.ball.z > -2, "net retains the goal ball");
});
