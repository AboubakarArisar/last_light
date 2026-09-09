export const HEART_CAPACITY = 25;
export const HEART_REFILL_MS = 3 * 60 * 1000;
export type Hearts = { spent: number; fullAt: number };

export function heartStatus(hearts: Hearts, now = Date.now()) {
  const missing = Math.max(0, Math.ceil((hearts.fullAt - now) / HEART_REFILL_MS));
  return {
    segments: Math.max(0, HEART_CAPACITY - missing),
    nextIn: missing ? hearts.fullAt - (missing - 1) * HEART_REFILL_MS - now : 0,
  };
}

export function spendHeart(hearts: Hearts, now = Date.now()): boolean {
  if (!heartStatus(hearts, now).segments) return false;
  hearts.spent++;
  hearts.fullAt = Math.max(now, hearts.fullAt) + HEART_REFILL_MS;
  return true;
}

// Merge only unacknowledged deductions; regeneration is derived, never uploaded.
export function mergeHearts(remote: Hearts, base: Hearts, local: Hearts, now = Date.now()): Hearts {
  const delta = Math.max(0, local.spent - base.spent);
  return delta ? {
    spent: remote.spent + delta,
    fullAt: Math.min(now + HEART_CAPACITY * HEART_REFILL_MS,
      Math.max(remote.fullAt, local.fullAt - delta * HEART_REFILL_MS) + delta * HEART_REFILL_MS),
  } : { ...remote };
}
