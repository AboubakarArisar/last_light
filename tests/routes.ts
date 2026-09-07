import { levels } from "../src/levels.ts";
import { Simulation, type Kick } from "../src/simulation.ts";
function run(id: number, path: Kick[]) {
  const s = new Simulation(levels[id]);
  for (const k of path) {
    s.act(k);
    for (let i = 0; i < 900 && s.state === "execution"; i++) s.step();
    if (s.state === "failure") break;
  }
  return s;
}
export function solve(id: number) {
  const level = levels[id];
  let paths: Kick[][] = [[]];
  for (let phase = 0; phase < level.requiredPasses; phase++) {
    const next: Kick[][] = [];
    for (const path of paths) {
      const sim = run(id, path);
      if (sim.state !== "decision") continue;
      for (const p of sim.players.filter(
        (p) => p.team === "home" && p.id !== sim.carrier,
      ))
        for (const loft of [false, true])
          for (const lead of [0, 2]) {
            const k: Kick = {
              shot: false,
              receiver: p.id,
              target: {
                x: p.x,
                y: loft && p.z < 16 ? 1.2 : 0.11,
                z: p.z - lead,
              },
              curve: 0,
              power: 0.75,
              loft,
            };
            const candidate = [...path, k];
            if (run(id, candidate).state === "decision") next.push(candidate);
          }
    }
    paths = next;
  }
  for (const path of paths) {
    for (const x of [-3.15, 3.15])
      for (const curve of [-0.65, 0, 0.65]) {
        const k: Kick = {
          shot: true,
          receiver: -1,
          target: { x, y: 1.9, z: -0.08 },
          curve,
          power: 0.85,
          loft: false,
        };
        const candidate = [...path, k];
        const s = run(id, candidate);
        if (s.state === "goal")
          return { path: candidate, quality: s.result!.quality };
      }
  }
  return null;
}
if (process.argv[1]?.endsWith("routes.ts")) {
  for (const l of levels) {
    const found = solve(l.id);
    console.log(
      l.id + 1,
      l.title,
      found ? `PASS ${found.path.length} actions` : "NO ROUTE",
    );
  }
}
