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

// Asked to change only the wall, the engine still redraws the garment (a bottle green suit came back emerald). The
// first picture is the one made from the store's photo, so its figure goes back over the second.
test("after the backdrop pass the garment is the one first drawn, and then her head over it", () => {
  assert.match(helper, /options\?\.tight \? await mod\.restoreFigure\(person, portrait\) : null/);
  assert.match(helper, /mod\.restoreHead\(person, figure\?\.blob \|\| portrait, options\)/, "the head is laid over the picture whose garment has been put back");
  const restore = read("src/restore.js");
  assert.match(restore, /export async function restoreFigure/);
  assert.match(restore, /if \(!either \|\| shared \/ either < SAME\) return asItCame\("moved"/, "a figure the engine has moved is left as it came");
});

test("no portrait is drawn from words alone: without the garment's picture she is shown the store's photo", () => {
  const at = modelShot.indexOf("const ref = await reference(p);");
  assert.ok(at > 0);
  const after = modelShot.slice(at, at + 900);
  assert.match(after, /if \(!ref\) \{[\s\S]*?caption\(PHOTO_ONLY_LINE\), openPhoto\(p\);[\s\S]*?return;/);
  assert.ok(after.indexOf("return;") < after.indexOf("pass.requestShot"), "and nothing is asked of the engine");
  assert.doesNotMatch(main, /drawn from the description/);
});

test("a garment picture is cut down to the figure, and a speck does not widen it", async () => {
  const { figureBox } = await import("../src/reference.js");
  const W = 100, H = 100, CLOTHES = 4;
  const labels = new Uint8Array(W * H);
  for (let y = 20; y < 95; y++) for (let x = 40; x < 60; x++) labels[y * W + x] = CLOTHES;
  labels[50 * W + 5] = CLOTHES; // one pixel the model mistook for cloth
  const box = figureBox(labels, W, H, 20);
  assert.ok(box.x >= 30 && box.x + box.width <= 70, "the box hugs the figure: " + JSON.stringify(box));
  assert.ok(box.x <= 40 && box.x + box.width >= 60 && box.y === 20 && box.y + box.height >= 95, "and holds all of it");
  assert.ok(box.width >= box.height * 0.44, "never a sliver");
  assert.equal(figureBox(new Uint8Array(W * H).fill(CLOTHES), W, H, 0), null, "a figure that fills the photo is left whole");
  assert.equal(figureBox(new Uint8Array(W * H), W, H, 0), null, "and so is a photo with no figure found");
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
