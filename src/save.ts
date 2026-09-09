import type { Hearts } from "./hearts.ts";
export type Settings = {
  volume: number;
  music: number;
  crowd: number;
  graphics: string;
  vibration: boolean;
  reducedMotion: boolean;
};
export type Save = {
  version: 1;
  hearts: Hearts;
  stars: number[];
  best: number[];
  profile: {
    name: string;
    number: number;
    skin: string;
    kit: string;
    boots: string;
    hair: string;
    celebration: string;
  };
  settings: Settings;
  stats: {
    goals: number;
    shots: number;
    passes: number;
    completedPasses: number;
    attempts: number;
    curved: number;
    headers: number;
    volleys: number;
    freeKicks: number;
    longest: number;
  };
  daily: { date: string; stars: number; best: number; streak: number };
};
export const KEY = "lastlight.save.v1";
export function fresh(): Save {
  return {
    version: 1,
    hearts: { spent: 0, fullAt: 0 },
    stars: Array(64).fill(0),
    best: Array(64).fill(0),
    profile: {
      name: "Alex Vale",
      number: 10,
      skin: "#bd8765",
      kit: "#dae8c6",
      boots: "#e3ff6c",
      hair: "short",
      celebration: "arms",
    },
    settings: {
      volume: 0.65,
      music: 0.3,
      crowd: 0.6,
      graphics: "auto",
      vibration: true,
      reducedMotion: false,
    },
    stats: {
      goals: 0,
      shots: 0,
      passes: 0,
      completedPasses: 0,
      attempts: 0,
      curved: 0,
      headers: 0,
      volleys: 0,
      freeKicks: 0,
      longest: 0,
    },
    daily: { date: "", stars: 0, best: 0, streak: 0 },
  };
}
export function parseSave(raw: string | null): Save {
  const base = fresh();
  if (!raw) return base;
  try {
    const s = JSON.parse(raw);
    if (s?.version !== 1) return base;
    if (s.hearts !== undefined) {
      if (!Number.isSafeInteger(s.hearts?.spent) || s.hearts.spent < 0 ||
          !Number.isSafeInteger(s.hearts?.fullAt) || s.hearts.fullAt < 0)
        throw new Error("Invalid hearts");
      base.hearts = { spent: s.hearts.spent, fullAt: s.hearts.fullAt };
    }
    for (const k of ["stars", "best"] as const)
      if (Array.isArray(s[k]))
        base[k] = Array.from({ length: 64 }, (_, i) =>
          Number.isFinite(s[k][i])
            ? Math.max(
                0,
                Math.min(k === "stars" ? 3 : 100, Math.floor(s[k][i])),
              )
            : 0,
        );
    if (s.profile) {
      for (const k of [
        "name",
        "skin",
        "kit",
        "boots",
        "hair",
        "celebration",
      ] as const)
        if (typeof s.profile[k] === "string")
          base.profile[k] = s.profile[k].slice(0, k === "name" ? 24 : 20);
      if (Number.isInteger(s.profile.number))
        base.profile.number = Math.max(1, Math.min(99, s.profile.number));
    }
    for (const k of ["skin", "kit", "boots"] as const)
      if (!/^#[0-9a-f]{6}$/i.test(base.profile[k]))
        base.profile[k] = fresh().profile[k];
    if (s.settings) {
      for (const k of ["volume", "music", "crowd"] as const)
        if (Number.isFinite(s.settings[k]))
          base.settings[k] = Math.max(0, Math.min(1, s.settings[k]));
      for (const k of ["vibration", "reducedMotion"] as const)
        if (typeof s.settings[k] === "boolean")
          base.settings[k] = s.settings[k];
      if (["auto", "low", "medium", "high"].includes(s.settings.graphics))
        base.settings.graphics = s.settings.graphics;
    }
    if (s.stats)
      for (const k of Object.keys(base.stats) as (keyof Save["stats"])[])
        if (Number.isFinite(s.stats[k]))
          base.stats[k] = Math.max(0, s.stats[k]);
    if (s.daily && /^\d{4}-\d{2}-\d{2}$/.test(s.daily.date))
      base.daily = {
        date: s.daily.date,
        stars: Math.max(0, Math.min(3, Number(s.daily.stars) || 0)),
        best: Math.max(0, Math.min(100, Number(s.daily.best) || 0)),
        streak: Math.max(0, Math.min(99999, Number(s.daily.streak) || 0)),
      };
    return base;
  } catch {
    return base;
  }
}
export function unlocked(s: Save) {
  const i = s.stars.findIndex((x) => x === 0);
  return i < 0 ? 63 : i;
}
export function totalStars(s: Save) {
  return s.stars.reduce((a, b) => a + b, 0);
}
export function award(
  s: Save,
  id: number,
  stars: number,
  quality: number,
  mode: string,
  date = new Date().toISOString().slice(0, 10),
) {
  if (mode === "career") {
    s.stars[id] = Math.max(s.stars[id], stars);
    s.best[id] = Math.max(s.best[id], quality);
  }
  if (mode === "daily") {
    const yesterday = new Date(Date.parse(date) - 86400000)
      .toISOString()
      .slice(0, 10);
    const same = s.daily.date === date;
    s.daily = {
      date,
      stars: Math.max(same ? s.daily.stars : 0, stars),
      best: Math.max(same ? s.daily.best : 0, quality),
      streak: same
        ? s.daily.streak
        : s.daily.date === yesterday
          ? s.daily.streak + 1
          : 1,
    };
  }
}
