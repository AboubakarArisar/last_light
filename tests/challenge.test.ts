import test from "node:test";
import assert from "node:assert/strict";
import { levels, daily, challengeURL, decodeChallenge, challengeTarget, challengeOutcome } from "../src/levels.ts";

test("friend links preserve the scenario and target, including daily seeds", () => {
  for (const level of [levels[0], levels[63], daily("2026-09-10")]) {
    const url = new URL(challengeURL(level, "https://game.example/?target=99#old", 72));
    const restored = decodeChallenge(url.searchParams.get("challenge"))!;
    assert.equal(restored.id, level.id);
    assert.equal(restored.seed, level.seed);
    assert.deepEqual(restored.attackers, level.attackers);
    assert.equal(challengeTarget(url.searchParams.get("target")), 72);
    assert.equal(url.hash, "");
  }
  const legacy = new URL(challengeURL(levels[0], "https://game.example/"));
  assert.ok(decodeChallenge(legacy.searchParams.get("challenge")));
  assert.equal(challengeTarget(legacy.searchParams.get("target")), null);
  for (const value of ["", "-1", "101", "NaN", "1.5", "<script>"])
    assert.equal(challengeTarget(value), null);
  assert.equal(challengeTarget("0"), 0);
  assert.equal(challengeTarget("100"), 100);
  assert.equal(challengeOutcome(73, 72), "YOU BEAT YOUR FRIEND!");
  assert.equal(challengeOutcome(72, 72), "IT’S A TIE!");
  assert.equal(challengeOutcome(71, 72), "TARGET STILL STANDS");
  assert.equal(challengeOutcome(null, 0), "CHALLENGE NOT BEATEN");
  assert.equal(challengeOutcome(0, null), "CHALLENGE COMPLETE");
});
