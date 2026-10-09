// The shopper's own head goes back on every portrait (src/restore.js). The step itself needs a browser (a canvas and
// the hair-and-skin model) and is checked by the rig in tools/portrait-lab; what is guarded here is that no portrait
// can reach the glass without it, for any store, now or later.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const main = read("src/main.js");
const modelShot = main.slice(main.indexOf("async function modelShot"), main.indexOf("// Studio: the piece on her"));
const helper = main.slice(main.indexOf("async function ownHead"), main.indexOf("const RESTORE_WAIT"));

test("a portrait is shown only after the shopper's own head has been laid back on it", () => {
  assert.ok(modelShot.length > 500 && helper.length > 200, "the portrait flow is where this test expects it");
  const restored = modelShot.indexOf("const blob = await ownHead(person, drawn, saved);");
  assert.match(main, /const RESTORE_WAIT = (\d+);/);
  assert.ok(Number(main.match(/const RESTORE_WAIT = (\d+);/)[1]) >= 30000, "the restore is given time on a slow line: a wrong face is worse than a wait");
  assert.ok(restored > 0, "the engine's picture goes through ownHead");
  assert.ok(restored < modelShot.indexOf("showPortrait(entry, p.id)"), "and only then is it shown");
  // the picture the engine drew is never the one that is kept or shown
  assert.doesNotMatch(modelShot, /createObjectURL\(drawn\)/);
});

test("the studio backdrop pass is restored too, from the finished first portrait", () => {
  assert.match(modelShot, /again\.append\("person", blob, "portrait\.png"\)/, "the backdrop is made from the finished portrait");
  assert.match(modelShot, /next\.blob = await ownHead\(blob, next\.blob, next\.saved, \{ tight: true \}\)/);
});

test("the restore does not depend on the store: one path for every brand, present and future", () => {
  assert.doesNotMatch(helper, /brand|sapphire|lawrencepur/i);
  const restore = read("src/restore.js");
  assert.doesNotMatch(restore, /S\.brand|sapphire|lawrencepur/i);
  assert.match(restore, /export async function restoreHead/);
});

test("a portrait that cannot be finished is shown as it came, never withheld", () => {
  assert.match(helper, /if \(fixed\?\.how !== "restored"\) return portrait;/);
  assert.match(helper, /catch \(e\) \{\s*console\.warn\(e\);\s*return portrait;/);
});
