import type { Frame } from "./simulation";
export function replayFrame(frames: Frame[], time: number): Frame {
  let low = 0,
    high = frames.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (frames[mid].time < time) low = mid + 1;
    else high = mid;
  }
  const b = frames[low],
    a = frames[Math.max(0, low - 1)];
  const t =
    b.time === a.time
      ? 1
      : Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time)));
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    ...(t < 1 ? a : b),
    time,
    ball: {
      ...(t < 1 ? a.ball : b.ball),
      x: lerp(a.ball.x, b.ball.x),
      y: lerp(a.ball.y, b.ball.y),
      z: lerp(a.ball.z, b.ball.z),
    },
    players: a.players.map((p, i) => ({
      ...(t < 1 ? p : b.players[i]),
      x: lerp(p.x, b.players[i].x),
      z: lerp(p.z, b.players[i].z),
      anim: lerp(p.anim, b.players[i].anim),
    })),
  };
}
