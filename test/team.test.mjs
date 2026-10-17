// The team's demo allowance (decided 2026-10-17): 100 portraits and 2 live minutes a month each, not held to the
// shoppers' daily ceilings, and six teammates at most about US$47 a month.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tierOf, TEAM, COST } from "../lib/plans.mjs";

test("a teammate demos from their own month, not the shoppers' day", () => {
  const t = tierOf({ tier: "team" });
  assert.equal(t.id, "team");
  assert.equal(t.unlimited, true, "not stopped by the public's daily ceiling");
  assert.equal(t.portraitsPerMonth, 100);
  assert.equal(t.liveSecondsPerMonth, 120);
  assert.equal(tierOf({ tier: "member" }).id, "member");
});

test("six teammates stay inside the demo budget", () => {
  const portraitUsd = 0.055, liveUsdPerSecond = COST?.liveUsdPerSecond ?? 0.02;
  const month = 6 * (TEAM.portraitsPerMonth * portraitUsd + TEAM.liveSecondsPerMonth * liveUsdPerSecond);
  assert.ok(month <= 50, `six teammates could spend $${month.toFixed(2)} a month`);
});
