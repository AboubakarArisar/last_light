import type { Level, Point } from "./levels.ts";
export type State = "decision" | "execution" | "goal" | "failure";
export type Player = Point & {
  id: number;
  team: "home" | "away" | "keeper";
  vx: number;
  vz: number;
  angle: number;
  action: string;
  anim: number;
  route: Point[];
  home: Point;
};
export type Ball = Point & {
  y: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
};
export type Kick = {
  target: Point & { y: number };
  curve: number;
  power: number;
  loft: boolean;
  shot: boolean;
  receiver: number;
};
export type Frame = {
  players: Player[];
  ball: Ball;
  state: State;
  time: number;
  carrier: number;
  net: number;
};
export type Result = {
  quality: number;
  stars: number;
  label: string;
  distance: number;
  curve: number;
  finish: string;
  passes: number;
};
export const STEP = 1 / 120;
export const clamp = (x: number, a: number, b: number) =>
  Math.min(b, Math.max(a, x));
export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
export function integrate(b: Ball, dt: number) {
  const vx = b.vx;
  const vz = b.vz;
  b.vx += (-0.075 * vx + b.spin * vz) * dt;
  b.vz += (-0.075 * vz - b.spin * vx) * dt;
  b.vy -= 9.81 * dt;
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  b.y += b.vy * dt;
  if (b.y < 0.11) {
    b.y = 0.11;
    if (b.vy < -0.7) b.vy = -b.vy * 0.48;
    else b.vy = 0;
    const f = Math.exp(-0.85 * dt);
    b.vx *= f;
    b.vz *= f;
    b.spin *= Math.exp(-1.8 * dt);
  }
}
export function launch(start: Ball, k: Kick): Ball {
  const d = dist(start, k.target),
    speed = k.shot ? 20 + k.power * 11 : 12 + k.power * 7;
  const flight = clamp(d / speed, k.shot ? 0.27 : 0.32, 2.8),
    lift = k.loft ? Math.max(flight, Math.sqrt(Math.max(0, d)) * 0.4) : flight;
  const t = k.loft ? lift : flight;
  const groundPass = !k.shot && !k.loft && start.y < 0.45;
  const b = {
    ...start,
    vx: (k.target.x - start.x) / t,
    vz: (k.target.z - start.z) / t,
    vy: groundPass ? 0 : (k.target.y - start.y + 4.905 * t * t) / t,
    spin: clamp(k.curve, -1, 1) * (k.shot ? 0.65 : 0.42),
  };
  // Numerical shooting solves a launch velocity; the live ball still collides and curves freely.
  for (let n = 0; n < 5; n++) {
    const p = { ...b };
    for (let elapsed = 0; elapsed < t - 1e-6; elapsed += STEP)
      integrate(p, Math.min(STEP, t - elapsed));
    b.vx += (k.target.x - p.x) / t;
    b.vz += (k.target.z - p.z) / t;
    if (!groundPass) b.vy += (k.target.y - p.y) / t;
  }
  return b;
}
export class Simulation {
  level: Level;
  players: Player[] = [];
  ball: Ball;
  state: State = "decision";
  carrier = 0;
  time = 0;
  actionTime = 0;
  passes = 0;
  shots = 0;
  net = 0;
  reason = "";
  kick: Kick | null = null;
  result: Result | null = null;
  post = false;
  recorded: Frame[] = [];
  events: string[] = [];
  shotStart: Point = { x: 0, z: 0 };
  finish = "Placed finish";
  sample = 0;
  keeperTarget = 0;
  keeperReaction = false;
  rebounds = 0;
  goalTime = 0;
  constructor(level: Level) {
    this.level = level;
    level.attackers.forEach((p, i) =>
      this.players.push({
        ...p,
        id: i,
        team: "home",
        vx: 0,
        vz: 0,
        angle: Math.PI,
        action: "idle",
        anim: 0,
        route: p.route.map((p) => ({ ...p })),
        home: { x: p.x, z: p.z },
      }),
    );
    level.defenders.forEach((p, i) =>
      this.players.push({
        ...p,
        id: 10 + i,
        team: "away",
        vx: 0,
        vz: 0,
        angle: 0,
        action: "idle",
        anim: 0,
        route: [],
        home: { ...p },
      }),
    );
    this.players.push({
      id: 99,
      x: 0,
      z: 1.2,
      vx: 0,
      vz: 0,
      angle: 0,
      team: "keeper",
      action: "ready",
      anim: 0,
      route: [],
      home: { x: 0, z: 1.2 },
    });
    this.ball = {
      x: level.attackers[0].x,
      z: level.attackers[0].z - 0.5,
      y: level.ballHeight,
      vx: 0,
      vy: 0,
      vz: 0,
      spin: 0,
    };
    this.capture();
  }
  act(k: Kick) {
    if (this.state !== "decision") return;
    this.rebounds = 0;
    this.reason = "";
    this.kick = k;
    this.state = "execution";
    this.actionTime = 0;
    this.keeperReaction = false;
    this.post = false;
    const p = this.players.find((p) => p.id === this.carrier)!;
    p.angle = Math.atan2(k.target.x - p.x, k.target.z - p.z);
    p.action = k.shot
      ? this.ball.y > 1.35
        ? "header"
        : this.ball.y > 0.45
          ? "volley"
          : "shot"
      : k.loft
        ? "cross"
        : "pass";
    p.anim = 0;
    if (k.shot) {
      this.shots++;
      this.shotStart = { ...this.ball };
      this.finish =
        p.action === "header"
          ? "Header"
          : p.action === "volley"
            ? "Volley"
            : k.loft
              ? "Chip"
              : Math.abs(k.curve) > 0.3
                ? "Curled finish"
                : this.level.specialty === "Free kick"
                  ? "Free kick"
                  : "Placed finish";
    }
    this.ball = launch(this.ball, k);
    this.events.push(k.shot ? "shot" : "kick");
  }
  move(p: Player, target: Point, speed: number, dt: number) {
    const d = dist(p, target);
    const v = Math.min(speed, d / Math.max(dt, 0.001));
    p.vx = d > 0.06 ? ((target.x - p.x) / d) * v : 0;
    p.vz = d > 0.06 ? ((target.z - p.z) / d) * v : 0;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    if (v > 0.2) {
      p.angle = Math.atan2(p.vx, p.vz);
      if (
        p.anim > 0.45 ||
        !["shot", "pass", "cross", "header", "volley"].includes(p.action)
      )
        p.action = v > 4 ? "run" : "jog";
    }
  }
  step(dt = STEP) {
    if (this.state === "goal") {
      if (this.goalTime > 2.6) return;
      this.goalTime += dt;
      this.time += dt;
      integrate(this.ball, dt);
      if (this.ball.z < -1.65) {
        this.ball.z = -1.65;
        this.ball.vz = Math.abs(this.ball.vz) * 0.16;
        this.ball.vx *= 0.4;
        this.net = 1;
      }
      if (this.ball.z > -0.12) {
        this.ball.z = -0.12;
        this.ball.vz = -Math.abs(this.ball.vz) * 0.2;
      }
      if (Math.abs(this.ball.x) > 3.5) {
        this.ball.x = Math.sign(this.ball.x) * 3.5;
        this.ball.vx *= -0.2;
      }
      this.net = Math.max(0, this.net - dt);
      if (++this.sample % 4 === 0) this.capture();
      return;
    }
    if (this.state !== "execution") return;
    this.time += dt;
    this.actionTime += dt;
    this.net = Math.max(0, this.net - dt);
    const b = this.ball,
      k = this.kick!;
    const prev = { ...b };
    integrate(b, dt);
    for (const p of this.players) {
      p.anim += dt;
      if (p.team === "home") {
        if (!k.shot && (p.id === k.receiver || (k.receiver === -1 && p.id !== this.carrier))) {
          this.move(p, k.receiver === -1 ? b : k.target, 6.4, dt);
        } else if (p.id !== this.carrier && p.route.length)
          this.move(p, p.route[0], 3.5, dt);
        else if (p.anim > 0.65) {
          p.action = "idle";
          p.vx = p.vz = 0;
        }
      } else if (p.team === "away") {
        const delay = 0.55 - this.level.difficulty * 0.32;
        if (this.actionTime > delay) {
          const target =
            dist(p, b) < 12
              ? { x: b.x + b.vx * 0.13, z: b.z + b.vz * 0.13 }
              : this.players
                  .filter((q) => q.team === "home")
                  .reduce((a, q) => (dist(p, q) < dist(p, a) ? q : a));
          this.move(p, target, 2.2 + this.level.difficulty * 2.7, dt);
        }
        const dx = b.x - prev.x - p.vx * dt;
        const dz = b.z - prev.z - p.vz * dt;
        const px = prev.x - (p.x - p.vx * dt);
        const pz = prev.z - (p.z - p.vz * dt);
        const fraction = clamp(-(px * dx + pz * dz) / (dx * dx + dz * dz || 1), 0, 1);
        const height = prev.y + (b.y - prev.y) * fraction;
        if (Math.hypot(px + dx * fraction, pz + dz * fraction) < 0.75 && height < 1.85) {
          p.action = height > 0.6 ? "block" : "tackle";
          p.anim = 0;
          this.events.push("contact");
          this.fail(height > 0.6 ? "Blocked by the defence" : "Pass intercepted");
          break;
        }
      } else {
        const reaction = 0.44 - this.level.difficulty * 0.23;
        if (k.shot && this.actionTime > reaction) {
          if (!this.keeperReaction) {
            const future = { ...b };
            for (let n = 0; n < 360 && future.z > 1; n++)
              integrate(future, STEP);
            this.keeperTarget = clamp(future.x, -4, 4);
            this.keeperReaction = true;
          }
          const gap = this.keeperTarget - p.x;
          if (b.z < 10 && Math.abs(gap) > 0.55) {
            if (p.action !== "dive") p.anim = 0;
            p.action = "dive";
            p.angle = gap > 0 ? -Math.PI / 2 : Math.PI / 2;
          }
          p.vx = clamp(
            gap * 4,
            -(2.2 + this.level.difficulty * 2),
            2.2 + this.level.difficulty * 2,
          );
          p.x += p.vx * dt;
        } else {
          const tx = clamp(b.x * 0.14, -2, 2);
          p.x += (tx - p.x) * dt * 1.5;
          if (this.level.specialty === "Chip") p.z += (5 - p.z) * dt;
        }
        const reach = p.action === "dive" ? 1.08 : 0.6;
        const height = p.action === "dive" ? 1.9 : 2.05;
        if (
          this.actionTime > 0.16 &&
          b.vz < 0 &&
          b.z < p.z + 0.48 &&
          prev.z >= p.z - 0.5 &&
          Math.abs(b.x - p.x) < reach &&
          b.y < height
        ) {
          p.action = Math.hypot(b.vx, b.vz) > 24 ? "parry" : "catch";
          p.anim = 0;
          this.events.push("contact");
          if (p.action === "parry") {
            b.z = p.z + 0.55;
            b.vz = Math.abs(b.vz) * 0.38;
            b.vx += b.x >= p.x ? 5 : -5;
            b.vy = 3;
            this.rebounds++;
            this.reason = "Parried away by the keeper";
          } else this.fail("Saved by the keeper");
        }
      }
    }
    if (this.state !== "execution") {
      this.capture();
      return;
    }
    // Sweep the goal plane, avoiding fast shots tunnelling through the frame.
    if (prev.z > 0 && b.z <= 0) {
      const f = prev.z / (prev.z - b.z),
        x = prev.x + (b.x - prev.x) * f,
        y = prev.y + (b.y - prev.y) * f;
      if (
        (Math.abs(Math.abs(x) - 3.66) < 0.16 && y < 2.58) ||
        (Math.abs(y - 2.44) < 0.15 && Math.abs(x) < 3.8)
      ) {
        this.post = true;
        this.rebounds++;
        this.events.push("post");
        if (Math.abs(y - 2.44) < 0.15) {
          const under = y < 2.44;
          b.y = under ? 2.26 : 2.61;
          b.vy = under ? -Math.abs(b.vy) - 2 : Math.abs(b.vy) + 2;
          b.z = under ? -0.1 : 0.14;
          b.vz *= under ? 0.64 : -0.5;
          if (under && Math.abs(x) < 3.5) this.goal();
          else this.reason = "Off the crossbar";
        } else {
          const inside = Math.abs(x) < 3.66;
          b.x = Math.sign(x) * (inside ? 3.47 : 3.84);
          b.vx = inside
            ? -Math.sign(x) * Math.max(1, Math.abs(b.vx) * 0.65)
            : Math.sign(x) * Math.max(2, Math.abs(b.vx));
          b.z = inside ? -0.1 : 0.14;
          b.vz *= inside ? 0.62 : -0.5;
          if (inside && b.y < 2.3) this.goal();
          else this.reason = "Off the post";
        }
      } else if (Math.abs(x) < 3.55 && y < 2.33) {
        this.goal();
      } else this.fail(y >= 2.33 ? "Over the bar" : "Just wide");
    }
    if (this.state === "execution" && !k.shot && this.actionTime > 0.17) {
      const receiver = this.players.find((p) =>
        p.team === "home" && p.id !== this.carrier && dist(p, b) < 0.85 && b.y < 2.15,
      );
      if (receiver) {
        this.carrier = receiver.id;
        this.passes++;
        receiver.action =
          b.y > 1.3 ? "header" : b.y > 0.45 ? "volley" : "touch";
        receiver.anim = 0;
        this.finish = receiver.action;
        this.ball.vx = this.ball.vy = this.ball.vz = 0;
        this.ball.x = receiver.x;
        this.ball.z = receiver.z - 0.4;
        this.state = "decision";
        this.events.push("receive");
      }
    }
    if (this.rebounds && this.state === "execution") {
      const next = this.players
        .filter((p) => p.team === "home")
        .find((p) => dist(p, b) < 1.2 && b.y < 2.1);
      if (next) {
        this.carrier = next.id;
        next.action = "touch";
        next.anim = 0;
        b.vx = b.vy = b.vz = 0;
        this.state = "decision";
        this.events.push("rebound");
      }
    }
    if (Math.abs(b.x) > 34.5 || b.z > 106) this.fail("Out of play");
    if (
      this.actionTime > 6 ||
      (this.actionTime > 2 && Math.hypot(b.vx, b.vz) < 0.8) ||
      (this.rebounds > 0 && this.actionTime > 3.5)
    )
      this.fail(this.reason || "The move breaks down");
    if (++this.sample % 4 === 0 || this.state !== "execution") this.capture();
  }
  fail(reason: string) {
    if (this.state !== "execution") return;
    this.reason = reason;
    this.state = "failure";
    this.events.push("miss");
  }
  goal() {
    if (this.passes < this.level.requiredPasses) {
      this.fail(
        `Build the move first: ${this.level.requiredPasses} passes needed`,
      );
      return;
    }
    this.state = "goal";
    this.net = 1.5;
    this.events.push("goal");
    const distance = dist(this.shotStart, { x: this.ball.x, z: 0 });
    const curve = Math.abs(this.kick?.curve || 0);
    const corner = Math.abs(this.ball.x) > 2.3 || this.ball.y > 1.65;
    const quality = Math.round(
      clamp(
        24 +
          distance * 1.1 +
          curve * 23 +
          (corner ? 17 : 0) +
          (this.kick?.loft ? 8 : 0) +
          this.passes * 5 +
          (this.post ? 12 : 0) +
          (["Volley", "Header"].includes(this.finish) ? 12 : 0),
        0,
        100,
      ),
    );
    const stars =
      1 +
      (this.passes >= Math.max(1, this.level.requiredPasses) ? 1 : 0) +
      (quality >= (this.level.chapter < 2 ? 40 : 65) ? 1 : 0);
    this.result = {
      quality,
      stars,
      label:
        quality >= 93
          ? "WORLDIE"
          : corner && quality >= 70
            ? "TOP BINS"
            : quality >= 75
              ? "GREAT GOAL"
              : "GET IN.",
      distance,
      curve,
      finish: this.finish,
      passes: this.passes,
    };
    this.players
      .filter((p) => p.team === "home")
      .forEach((p) => {
        p.action = "celebrate";
        p.anim = 0;
      });
    this.capture();
  }
  capture() {
    this.recorded.push({
      players: this.players.map((p) => ({ ...p })),
      ball: { ...this.ball },
      state: this.state,
      time: this.time,
      carrier: this.carrier,
      net: this.net,
    });
  }
}
