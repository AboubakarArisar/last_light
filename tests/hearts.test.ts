import { test } from "node:test";
import assert from "node:assert/strict";
import { HEART_REFILL_MS as interval, heartStatus, spendHeart, mergeHearts } from "../src/hearts.ts";
import { fresh, parseSave } from "../src/save.ts";
import { readSave } from "../src/progress.ts";

test("first segment starts three-minute recovery; later misses retain the countdown", () => {
  const hearts = fresh().hearts;
  const now = 1_000_000;
  assert.deepEqual(heartStatus(hearts, now), { segments: 25, nextIn: 0 });
  assert.equal(spendHeart(hearts, now), true);
  assert.deepEqual(heartStatus(hearts, now), { segments: 24, nextIn: interval });
  spendHeart(hearts, now + 60_000);
  assert.deepEqual(heartStatus(hearts, now + 60_000), { segments: 23, nextIn: 120_000 });
  assert.deepEqual(heartStatus(hearts, now + interval), { segments: 24, nextIn: interval });
  assert.deepEqual(heartStatus(hearts, now + 2 * interval), { segments: 25, nextIn: 0 });
  spendHeart(hearts, now + 10 * interval);
  assert.equal(heartStatus(hearts, now + 10 * interval).nextIn, interval);
});

test("25 failures exhaust hearts; reload and elapsed time restore the correct segments", () => {
  const save = fresh();
  const now = 1_000_000;
  for (let i = 0; i < 25; i++) assert.equal(spendHeart(save.hearts, now), true);
  assert.equal(spendHeart(save.hearts, now), false);
  const restored = parseSave(JSON.stringify(save));
  assert.deepEqual(restored.hearts, save.hearts);
  assert.equal(heartStatus(restored.hearts, now).segments, 0);
  assert.equal(heartStatus(restored.hearts, now + interval).segments, 1);
  assert.equal(heartStatus(restored.hearts, now + 25 * interval).segments, 25);
  const legacy = { ...save } as Partial<typeof save>; delete legacy.hearts;
  assert.deepEqual(readSave(legacy).hearts, fresh().hearts);
  assert.throws(() => readSave({ ...save, hearts: { spent: -1, fullAt: 0 } }));
});

test("concurrent devices merge deductions and acknowledged saves do not repeat them", () => {
  const base = fresh().hearts;
  const alicePhone = { ...base }, aliceLaptop = { ...base };
  const now = 1_000_000;
  spendHeart(alicePhone, now);
  spendHeart(aliceLaptop, now + 60_000);
  const merged = mergeHearts(alicePhone, base, aliceLaptop);
  assert.equal(merged.spent, 2);
  assert.equal(heartStatus(merged, now + 60_000).segments, 23);
  assert.deepEqual(mergeHearts(merged, aliceLaptop, aliceLaptop), merged);
  spendHeart(aliceLaptop, now + 90_000);
  const later = mergeHearts(merged, { spent: 1, fullAt: now + 60_000 + interval }, aliceLaptop);
  assert.equal(later.spent, 3);
  const depleted = { spent: 25, fullAt: now + 25 * interval };
  const capped = mergeHearts(depleted, base, depleted, now);
  assert.equal(heartStatus(capped, now).segments, 0);
  assert.equal(heartStatus(capped, now + interval).segments, 1);
});
