import type { Stadium } from "./rendering";
import type { Simulation, Kick } from "./simulation";
import { clamp } from "./simulation.ts";
type InkPoint = { x: number; y: number; t: number };
export class Drawing {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  view: Stadium;
  getSim: () => Simulation;
  onKick: (kick: Kick) => void;
  message: (s: string) => void;
  enabled = false;
  loft = false;
  pointer: number | null = null;
  points: InkPoint[] = [];
  abort = new AbortController();
  started = 0;
  keyboard: { x: number; y: number } | null = null;
  constructor(
    canvas: HTMLCanvasElement,
    view: Stadium,
    getSim: () => Simulation,
    onKick: (kick: Kick) => void,
    message: (s: string) => void,
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.view = view;
    this.getSim = getSim;
    this.onKick = onKick;
    this.message = message;
    const opts = { signal: this.abort.signal };
    canvas.addEventListener("pointerdown", (e) => this.down(e), opts);
    canvas.addEventListener("pointermove", (e) => this.move(e), opts);
    canvas.addEventListener("pointerup", (e) => this.up(e), opts);
    canvas.addEventListener("pointercancel", () => this.cancel(), opts);
    canvas.addEventListener("lostpointercapture", () => this.cancel(), opts);
    this.resize();
  }
  resize() {
    this.cancel();
    this.canvas.width = innerWidth * devicePixelRatio;
    this.canvas.height = innerHeight * devicePixelRatio;
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  down(e: PointerEvent) {
    if (
      !this.enabled ||
      this.pointer !== null ||
      this.getSim().state !== "decision" ||
      !e.isPrimary
    )
      return;
    const ball = this.view.project(this.getSim().ball);
    if (Math.hypot(e.clientX - ball.x, e.clientY - ball.y) > 65) {
      this.message("Start your line at the ball.");
      return;
    }
    e.preventDefault();
    this.pointer = e.pointerId;
    this.view.cameraFrozen = true;
    this.canvas.setPointerCapture(e.pointerId);
    this.started = performance.now();
    this.points = [{ ...ball, t: this.started }];
    this.add(e);
  }
  add(e: PointerEvent) {
    const p = this.points.at(-1);
    if (!p || Math.hypot(p.x - e.clientX, p.y - e.clientY) > 3) {
      if (this.points.length > 120)
        this.points = this.points.filter((_, i) => i % 2 === 0);
      this.points.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    }
  }
  move(e: PointerEvent) {
    if (e.pointerId === this.pointer) {
      e.preventDefault();
      this.add(e);
    }
  }
  up(e: PointerEvent) {
    if (e.pointerId !== this.pointer) return;
    this.add(e);
    const points = this.points.slice();
    this.cancel();
    if (
      points.length < 3 ||
      Math.hypot(
        points.at(-1)!.x - points[0].x,
        points.at(-1)!.y - points[0].y,
      ) < 25
    ) {
      this.message("Draw a longer line in the direction you want to kick.");
      return;
    }
    this.submit(points);
  }
  submit(points: InkPoint[]) {
    const s = this.getSim(),
      start = points[0],
      end = points.at(-1)!;
    const ground = this.view.unproject(end.x, end.y);
    const gp = this.view.unproject(end.x, end.y, true);
    const isGoal = gp && gp.y >= 0.11;
    const shot = !!isGoal;
    if (!shot && (!ground || !Number.isFinite(ground.z))) return;
    let receiver = -1;
    let target = { x: ground?.x ?? 0, y: 0.11, z: ground?.z ?? 0 };
    if (shot) {
      target = {
        x: gp!.x,
        y: gp!.y,
        z: -0.08,
      };
    } else {
      let best = Infinity;
      for (const p of s.players.filter(
        (p) => p.team === "home" && p.id !== s.carrier,
      )) {
        const screen = this.view.project(p);
        const distance = Math.hypot(screen.x - end.x, screen.y - end.y);
        if (distance < best) {
          best = distance;
          receiver = p.id;
        }
      }
      const p = s.players.find((p) => p.id === receiver);
      if (!p || best > 150 || Math.hypot(target.x - p.x, target.z - p.z) > 9)
        receiver = -1;
      if (p && receiver !== -1 && best < 34) {
        target.x = p.x;
        target.z = p.z - 0.8;
      }
      if (receiver !== -1 && this.loft && target.z < 16)
        target.y = s.level.specialty === "Header" ? 1.65 : 1.05;
    }
    const dx = end.x - start.x,
      dy = end.y - start.y,
      len = Math.hypot(dx, dy);
    let bend = 0;
    for (const p of points) {
      const side = ((p.x - start.x) * -dy + (p.y - start.y) * dx) / len;
      if (Math.abs(side) > Math.abs(bend)) bend = side;
    }
    const duration = Math.max(180, end.t - start.t);
    const power = clamp((len / duration) * 0.8, 0.2, 1);
    this.onKick({
      target,
      receiver,
      shot,
      curve: clamp(-bend / Math.max(45, len * 0.25), -1, 1),
      power,
      loft: this.loft,
    });
  }
  keyboardAim(key: string) {
    if (!this.enabled) return;
    const ball = this.view.project(this.getSim().ball);
    if (!this.keyboard)
      this.keyboard = this.view.project({ x: 2.7, y: 1.7, z: 0 });
    if (key === "Enter") {
      this.submit([
        { ...ball, t: 0 },
        {
          x: (ball.x + this.keyboard.x) / 2,
          y: (ball.y + this.keyboard.y) / 2,
          t: 350,
        },
        { ...this.keyboard, t: 700 },
      ]);
      this.keyboard = null;
    } else {
      this.keyboard.x +=
        key === "ArrowLeft" ? -10 : key === "ArrowRight" ? 10 : 0;
      this.keyboard.y += key === "ArrowUp" ? -10 : key === "ArrowDown" ? 10 : 0;
    }
  }
  draw() {
    const c = this.ctx;
    c.clearRect(0, 0, innerWidth, innerHeight);
    if (!this.enabled) return;
    const s = this.getSim();
    if (s.state === "decision" && this.pointer === null) {
      for (const p of s.players.filter(
        (p) => p.team === "home" && p.id !== s.carrier,
      )) {
        const screen = this.view.project({ x: p.x, z: p.z, y: 2.2 });
        c.font = "600 11px Arial";
        c.textAlign = "center";
        c.fillStyle = "#f0f5df";
        c.shadowColor = "#102516";
        c.shadowBlur = 5;
        c.fillText(
          String((this.view.settings.profile.number + p.id) % 100),
          screen.x,
          screen.y,
        );
        c.shadowBlur = 0;
        const route = p.route[0];
        if (route) {
          const from = this.view.project(p),
            to = this.view.project(route);
          c.setLineDash([3, 5]);
          c.strokeStyle = "rgba(230,244,208,.35)";
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(from.x, from.y);
          c.lineTo(to.x, to.y);
          c.stroke();
          c.setLineDash([]);
        }
      }
      const b = this.view.project(s.ball);
      c.strokeStyle = "rgba(228,251,181,.65)";
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(b.x, b.y, 16, 0, Math.PI * 2);
      c.stroke();
    }
    if (this.points.length > 1) {
      c.strokeStyle = "#e4ffb4";
      c.lineWidth = 2.5;
      c.lineCap = "round";
      c.lineJoin = "round";
      c.beginPath();
      c.moveTo(this.points[0].x, this.points[0].y);
      for (let i = 1; i < this.points.length - 1; i++) {
        const p = this.points[i],
          next = this.points[i + 1];
        c.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
      }
      const end = this.points.at(-1)!;
      c.lineTo(end.x, end.y);
      c.stroke();
      c.beginPath();
      c.arc(end.x, end.y, 5, 0, Math.PI * 2);
      c.fillStyle = "#e4ffb4";
      c.fill();
    }
    if (this.keyboard) {
      c.strokeStyle = "#e4ffb4";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(this.keyboard.x, this.keyboard.y, 9, 0, Math.PI * 2);
      c.stroke();
    }
  }
  cancel() {
    this.view.cameraFrozen = false;
    if (this.pointer !== null && this.canvas.hasPointerCapture(this.pointer))
      this.canvas.releasePointerCapture(this.pointer);
    this.pointer = null;
    this.points = [];
  }
  dispose() {
    this.abort.abort();
    this.cancel();
  }
}
