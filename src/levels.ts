export type Point = { x: number; z: number };
export type Formation = { x: number; z: number; route: Point[] };
export type Level = {
  id: number;
  seed: number;
  chapter: number;
  title: string;
  brief: string;
  stadium: number;
  minute: string;
  score: string;
  rival: string;
  difficulty: number;
  requiredPasses: number;
  specialty: string;
  attackers: Formation[];
  defenders: Point[];
  ballHeight: number;
  stars: [string, string, string];
};
export const chapters = [
  {
    name: "First touch",
    tagline: "Every legend starts somewhere.",
    competition: "District League",
  },
  {
    name: "Breakthrough",
    tagline: "See the space before it opens.",
    competition: "National League",
  },
  {
    name: "Under pressure",
    tagline: "Less time. More instinct.",
    competition: "National League",
  },
  {
    name: "Bend the game",
    tagline: "The shortest route is not always straight.",
    competition: "Founders Cup",
  },
  {
    name: "Air time",
    tagline: "Some moments belong in the air.",
    competition: "Founders Cup",
  },
  {
    name: "Big nights",
    tagline: "Under these lights, everything matters.",
    competition: "Continental Cup",
  },
  {
    name: "The run-in",
    tagline: "A season comes down to seconds.",
    competition: "Premier Division",
  },
  {
    name: "Last light",
    tagline: "Leave something they will remember.",
    competition: "Continental Final",
  },
];
export const venues = [
  "Willow Park",
  "Northbank Ground",
  "The Meridian",
  "Harbour after dark",
  "Crown Arena",
];
export const rivals = ["RIV", "ASH", "MRD", "VLT", "NTH", "CRW", "EST", "OLM"];
const templateNames = [
  "The opener",
  "Between the lines",
  "The overlap",
  "Cutback",
  "Top corner",
  "The wall",
  "The chip",
  "Back post",
  "Counter rush",
  "One-two",
  "The volley",
  "Stoppage time",
  "Ten men",
  "Long way home",
  "Corner call",
  "The final",
];
const descriptions = [
  "Find your forward. Then find the net.",
  "Thread a pass between the lines.",
  "Lead the wide runner into space.",
  "Work it wide. Cut it back. Finish.",
  "Pick a corner and commit.",
  "Bend the ball around the wall.",
  "Lift the ball over the advancing keeper.",
  "Cross to the far-post runner.",
  "Break quickly before the defence recovers.",
  "Play the give-and-go.",
  "Deliver a lifted cross for a first-time finish.",
  "One attack. Make it count.",
  "Fewer options. A bigger moment.",
  "Let fly from distance.",
  "Deliver from the corner. Attack the ball.",
  "Build the move that wins it all.",
];
const layouts: number[][][] = [
  [
    [-5, 27],
    [3, 16],
    [-13, 18],
    [14, 23],
  ],
  [
    [-7, 33],
    [1, 23],
    [14, 18],
    [-17, 15],
  ],
  [
    [-4, 31],
    [18, 24],
    [3, 17],
    [-11, 22],
  ],
  [
    [18, 20],
    [17, 7],
    [2, 13],
    [-7, 10],
  ],
  [
    [-9, 24],
    [7, 16],
    [-18, 12],
    [15, 25],
  ],
  [
    [-6, 25],
    [13, 15],
    [-16, 17],
    [3, 31],
  ],
  [
    [3, 20],
    [-9, 13],
    [12, 10],
    [-16, 25],
  ],
  [
    [-20, 13],
    [6, 9],
    [0, 17],
    [15, 21],
  ],
  [
    [0, 39],
    [-15, 27],
    [14, 25],
    [2, 17],
  ],
  [
    [-8, 27],
    [3, 20],
    [-5, 15],
    [15, 12],
  ],
  [
    [19, 15],
    [-3, 9],
    [6, 14],
    [-14, 19],
  ],
  [
    [4, 26],
    [-12, 18],
    [13, 12],
    [0, 10],
  ],
  [
    [-11, 30],
    [5, 20],
    [17, 16],
  ],
  [
    [5, 32],
    [-12, 18],
    [13, 13],
    [-4, 24],
  ],
  [
    [-33, 1],
    [-3, 8],
    [5, 11],
    [1, 17],
  ],
  [
    [-6, 37],
    [17, 26],
    [10, 14],
    [-5, 10],
  ],
];
export function random(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function makeLevel(id: number, seed = 1407 + id * 997): Level {
  id = Math.max(0, Math.min(63, Math.floor(id)));
  const chapter = Math.floor(id / 8),
    slot = id % 8,
    type =
      id === 63
        ? 15
        : chapter === 0
          ? [0, 1, 2, 4, 3, 6, 9, 11][slot]
          : chapter === 3
            ? [5, 4, 13, 5, 6, 4, 13, 11][slot]
            : chapter === 4
              ? [7, 10, 14, 7, 10, 14, 3, 15][slot]
              : (slot + chapter * 3) % 16;
  const rng = random(seed),
    mirror = chapter > 0 && slot % 2 === 1 ? -1 : 1;
  const attackers = layouts[type].map(([x, z], i) => ({
    x: x * mirror,
    z: z + (chapter > 0 ? (rng() - 0.5) * 3 : 0),
    route:
      i === 0
        ? []
        : [
            {
              x: (x + (i % 2 ? 2 : -2)) * mirror,
              z: Math.max(5, z - 3.5 - chapter * 0.25),
            },
          ],
  }));
  const defenders: Point[] = [];
  if (type === 5)
    for (let i = 0; i < 4; i++)
      defenders.push({ x: (-5 + i * 0.85) * mirror, z: 17 });
  else
    for (
      let i = 0;
      i < Math.min(6, 1 + Math.floor(chapter * 0.65) + (slot % 3));
      i++
    )
      defenders.push({
        x: ((i % 2 ? 1 : -1) * (6 + i * 2.2) + (rng() - 0.5) * 2) * mirror,
        z: 8 + i * 3.2,
      });
  if (id === 0) defenders[0] = { x: -10, z: 12 };
  const requiredPasses = [4, 5, 6, 13].includes(type)
    ? 0
    : [3, 9, 15].includes(type)
      ? 2
      : 1;
  return {
    id,
    seed,
    chapter,
    title: templateNames[type],
    brief: descriptions[type],
    stadium: Math.min(4, Math.floor(chapter * 0.65)),
    minute:
      chapter > 5 ? "90+3′" : `${[67, 74, 82, 88, 71, 89, 86, 90][slot]}′`,
    score: id === 63 ? "2 — 2" : slot % 3 === 0 ? "1 — 1" : "0 — 1",
    rival: rivals[(chapter + slot) % 8],
    difficulty: Math.min(0.93, 0.12 + chapter * 0.1 + slot * 0.017),
    requiredPasses,
    specialty:
      type === 5
        ? "Free kick"
        : type === 14
          ? "Header"
          : type === 10
            ? "Volley"
            : type === 6
              ? "Chip"
              : type === 7
                ? "Cross"
                : "Open play",
    attackers,
    defenders,
    ballHeight: 0.11,
    stars: [
      "Score a goal",
      `Complete ${requiredPasses || 1} ${requiredPasses === 1 ? "pass" : "passes"}`,
      chapter < 2 ? "Goal quality 40+" : "Goal quality 65+",
    ],
  };
}
export const levels = Array.from({ length: 64 }, (_, i) => makeLevel(i));
export function daily(date = new Date().toISOString().slice(0, 10)) {
  const seed = Number(date.replaceAll("-", ""));
  return { ...makeLevel(24 + (seed % 32), seed), title: "Shot of the day" };
}
export function challengeURL(level: Level, base: string, quality?: number) {
  const url = new URL(base);
  url.search = "";
  url.hash = "";
  url.searchParams.set("challenge", `${level.id}.${level.seed}`);
  if (quality !== undefined && Number.isInteger(quality) && quality >= 0 && quality <= 100)
    url.searchParams.set("target", String(quality));
  return url.href;
}
export function challengeTarget(value: string | null): number | null {
  return value !== null && /^(?:\d{1,2}|100)$/.test(value) ? Number(value) : null;
}
export function challengeOutcome(quality: number | null, target: number | null) {
  if (quality === null) return "CHALLENGE NOT BEATEN";
  if (target === null) return "CHALLENGE COMPLETE";
  return quality > target ? "YOU BEAT YOUR FRIEND!" : quality === target ? "IT’S A TIE!" : "TARGET STILL STANDS";
}
export function decodeChallenge(value: string | null): Level | null {
  if (!value || !/^\d{1,2}\.\d{1,10}$/.test(value)) return null;
  const [id, seed] = value.split(".").map(Number);
  return id < 64 && seed <= 0xffffffff ? makeLevel(id, seed) : null;
}
