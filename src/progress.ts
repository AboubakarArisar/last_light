import { fresh, parseSave, type Save } from "./save.ts";
import { mergeHearts } from "./hearts.ts";

// Apply only changes made since the last acknowledged save to the cloud copy.
export function mergeProgress(remote: Save, base: Save, local: Save): Save {
  const result = structuredClone(remote);
  result.hearts = mergeHearts(remote.hearts, base.hearts, local.hearts);
  for (const key of ["stars", "best"] as const)
    result[key] = remote[key].map((value, i) => Math.max(value, local[key][i]));
  for (const key of Object.keys(result.stats) as (keyof Save["stats"])[])
    result.stats[key] = key === "longest"
      ? Math.max(remote.stats[key], local.stats[key])
      : remote.stats[key] + Math.max(0, local.stats[key] - base.stats[key]);
  for (const key of Object.keys(local.profile) as (keyof Save["profile"])[])
    if (local.profile[key] !== base.profile[key])
      Object.assign(result.profile, { [key]: local.profile[key] });
  for (const key of Object.keys(local.settings) as (keyof Save["settings"])[])
    if (local.settings[key] !== base.settings[key])
      Object.assign(result.settings, { [key]: local.settings[key] });
  if (local.daily.date > remote.daily.date) result.daily = { ...local.daily };
  else if (local.daily.date === remote.daily.date)
    for (const key of ["stars", "best", "streak"] as const)
      result.daily[key] = Math.max(local.daily[key], remote.daily[key]);
  return result;
}

export type PendingSave = { id: string; base: Save; save: Save };
export type ProgressCache = { version: 1; cloudLoaded: boolean; base: Save; save: Save; pending: PendingSave | null };

export function newCache(save = fresh()): ProgressCache {
  return { version: 1, cloudLoaded: false, base: fresh(), save: structuredClone(save), pending: null };
}

export function readSave(value: unknown): Save {
  const hearts = (value as Save | null)?.hearts;
  if (hearts !== undefined && (!Number.isSafeInteger(hearts?.spent) || hearts.spent < 0 ||
      !Number.isSafeInteger(hearts?.fullAt) || hearts.fullAt < 0))
    throw new Error("The saved hearts could not be read. They have been left untouched.");
  if (!value || typeof value !== "object" || (value as Save).version !== 1 ||
      !Array.isArray((value as Save).stars) || (value as Save).stars.length !== 64 ||
      !Array.isArray((value as Save).best) || (value as Save).best.length !== 64 ||
      !(value as Save).stats || !(value as Save).profile || !(value as Save).settings)
    throw new Error("The saved progress could not be read. It has been left untouched.");
  return parseSave(JSON.stringify(value));
}

export function readCache(raw: string): ProgressCache {
  const value = JSON.parse(raw) as ProgressCache;
  if (value.version !== 1) throw new Error("Unsupported progress cache version.");
  const pending = value.pending;
  if (pending && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pending.id))
    throw new Error("The pending save could not be read. It has been left untouched.");
  return {
    version: 1, cloudLoaded: value.cloudLoaded !== false, base: readSave(value.base), save: readSave(value.save),
    pending: pending ? { id: pending.id, base: readSave(pending.base), save: readSave(pending.save) } : null,
  };
}
