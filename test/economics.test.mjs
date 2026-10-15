// Every plan keeps at least half its fee after what its try-ons cost to make, at the plan's full use. When keeping the
// shopper's own face raised a portrait from about Rs.5.5 to Rs.15 (15 October 2026), Mirror and Flagship would have
// kept 35% and 28%; this holds the line for any later change of price or cost.
import test from "node:test";
import assert from "node:assert/strict";
import { RETAIL_PLANS, COST, USD_TO_PKR, PILOT, EXTRAS, MEMBER_TIERS } from "../lib/plans.mjs";

const costOf = (plan) => (plan.liveMinutes * 60 * COST.liveUsdPerSecond + plan.portraits * COST.portraitUsd) * USD_TO_PKR;

test("every plan keeps at least half its fee after try-on costs, used to the full", () => {
  for (const plan of Object.values(RETAIL_PLANS)) {
    const kept = 1 - costOf(plan) / plan.monthly;
    assert.ok(kept >= 0.5, `${plan.name}: ${Math.round(kept * 100)}% of Rs.${plan.monthly} kept after Rs.${Math.round(costOf(plan))} of try-ons`);
    if (plan.monthlyFromTenth) assert.ok(1 - costOf(plan) / plan.monthlyFromTenth >= 0.5, `${plan.name} from the tenth store`);
  }
});

test("the pilot, extra portraits and a member's free portraits are priced above what they cost", () => {
  const assist = RETAIL_PLANS[PILOT.plan];
  const pilotCost = (costOf(assist) * PILOT.days) / 30;
  assert.ok(PILOT.feePkr > pilotCost * 1.5, `the pilot's fee covers its portraits with room: Rs.${PILOT.feePkr} against Rs.${Math.round(pilotCost)}`);
  assert.ok(EXTRAS.portraitBlockPkr / EXTRAS.portraitBlock >= COST.portraitUsd * USD_TO_PKR * 1.8, "extra portraits are sold at about twice what they cost");
  assert.ok(MEMBER_TIERS.member.portraitsPerMonth * COST.portraitUsd * USD_TO_PKR < 100, "a free member costs under Rs.100 a month in portraits");
});
