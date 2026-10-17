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

// Since 15 October 2026 her face is kept by the cloud's outlines (src/keep.js), the second engine, or, when neither is
// to be had, the old restore on the phone. Whichever: nothing reaches the glass before it has been through finishPortrait.
const finisher = main.slice(main.indexOf("async function finishPortrait"), main.indexOf("/** Puts a finished version in place"));
test("a portrait is shown only after the shopper's own head has been kept", () => {
  assert.ok(modelShot.length > 500 && helper.length > 200 && finisher.length > 500, "the portrait flow is where this test expects it");
  const finished = modelShot.indexOf("await finishPortrait(person, shot,");
  assert.ok(finished > 0, "the engine's picture goes through finishPortrait");
  assert.ok(finished < modelShot.indexOf("showPortrait(entry, p.id)"), "and only then is it shown");
  assert.match(finisher, /if \(meta\?\.face === "engine"\) return done\("engine", shot\.blob\);/, "the second engine's picture kept her face itself");
  assert.match(finisher, /await keepHer\(person, shot\.blob, \{ her, drawn, drawnSize \}\)/, "Decart's picture gets her own face, hair and shoes back");
  assert.match(finisher, /fetch\("\/api\/outline", \{ method: "POST"[^}]*"x-mirva-pass": meta\.pass \}, body: small\.blob/, "the portrait's own outlines come from a small copy");
  assert.match(finisher, /mode", "retake"/, "a head the engine moved is made again by the second engine");
  assert.match(finisher, /await ownHead\(person, shot\.blob, saved, undefined, sub\)/, "and without outlines, the old restore on the phone");
  assert.ok(Number(main.match(/const RESTORE_WAIT = (\d+);/)[1]) >= 30000, "the old restore is given time on a slow line: a wrong face is worse than a wait");
  // the picture the engine drew is never the one that is kept or shown
  assert.doesNotMatch(modelShot, /createObjectURL\((drawn|shot\.blob)\)/);
});

// The founder's call, 15 October 2026: her own room stays behind her, busy or not ("it gives off the feel of natural").
// The studio wall cut her out and made her look pasted on.
test("her own room stays behind her: no studio wall, and no second drawing of the portrait", () => {
  assert.doesNotMatch(modelShot, /append\("mode", "backdrop"\)/, "no second drawing of the portrait");
  assert.doesNotMatch(modelShot, /append\("studio"/, "the figure is never asked for to cut her out");
  assert.doesNotMatch(main, /onStudio\(/);
});

// A store loaded from its website: the cloud finds the cloth in the store's own photo (no 16 MB model on the phone, and
// no scenery left: Rang Rasiya's red curtain came back as a red yoke on a navy suit).
test("a store's photo with no garment picture made ahead is cut by the cloud's outlines first", () => {
  const ref = main.slice(main.indexOf("async function reference(p)"), main.indexOf("function needMirror"));
  assert.match(ref, /fetch\(`\/api\/cloth\/\$\{S\.brand\.id\}\/\$\{encodeURIComponent\(p\.id\)\}`/);
  assert.match(ref, /clothOnly\(await photo\.blob\(\), masks\)/);
  assert.ok(ref.indexOf("/api/cloth/") < ref.indexOf("cleanReference"), "the phone's own cut only when the cloud cannot");
});

test("the fat 16 MB restore model is fetched only when the old restore is needed", () => {
  assert.doesNotMatch(main, /fetchAhead|warmRestore/);
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
  // (With a piece that completes the look the garment picture is the pair: outfitPicture, which is null without both.)
  const at = modelShot.indexOf("const [ref, worn] = await Promise.all([partner ? outfitPicture(p, partner) : reference(p)");
  assert.ok(at > 0);
  const after = modelShot.slice(at, at + 900);
  assert.match(after, /if \(!ref\) \{[\s\S]*?caption\(PHOTO_ONLY_LINE\), openPhoto\(p\);[\s\S]*?return;/);
  const ask = modelShot.indexOf("pass.requestShot", at);
  assert.ok(ask > 0 && at + after.indexOf("return;") < ask, "and nothing is asked of the engine");
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

// Shown the model's shorts under a shirt, the engine put shorts on the shopper; shown the model's top above a pair of
// jeans, it changed her top. So a western top's picture ends just below the hips and a lower piece's starts just above.
test("a western top's picture ends just below the hips, and jeans start just above them", async () => {
  const { hemBox, waistRow } = await import("../src/reference.js");
  const H = 1000, pose = { hips: true, shoulderY: 0.2, hipY: 0.6 };
  const box = { x: 100, y: 150, width: 600, height: 850 };
  const top = hemBox(pose, box, H);
  assert.equal(top.y, 150, "the top of the picture stays");
  assert.equal(top.y + top.height, 628, "and it ends 0.07 of the torso below the hips");
  assert.deepEqual(hemBox({ ...pose, hips: false }, box, H), box, "with no hips found it is left whole");
  assert.deepEqual(hemBox(pose, { ...box, height: 400 }, H), { ...box, height: 400 }, "and a picture that already ends higher is not stretched");
  assert.equal(hemBox(pose, null, H), null);
  assert.equal(waistRow(pose, 150, H), 560, "a lower piece starts 0.1 of the torso above the hips");
  assert.equal(waistRow(pose, 700, H), 700, "never above where it would start anyway");
  assert.equal(waistRow(null, 100, H), 460, "and with no pose, 40% of the way down");
  assert.equal(waistRow(pose, null, H), null, "a product shot goes whole");
});

// A line that will not carry live video still carries a portrait. It is offered in one tap, and only when Studio has
// failed: a Studio that works is never interrupted with it.
test("a portrait is offered when live video will not connect or drops, and nowhere else", () => {
  const offers = [...main.matchAll(/offerPortrait\(/g)].length;
  assert.equal(offers, 3, "the function, and its two calls");
  assert.match(main, /caption\(friendly\(e\)\);\s*syncGlass\(\);\s*if \(weakLine\(e\)\) offerPortrait\(p\);/, "after a Studio that would not start");
  assert.match(main, /if \(reason === "lost" \|\| reason === "nopicture"\) offerPortrait\(was \|\| S\.selected\);/, "and after one that dropped");
  const weak = main.slice(main.indexOf("const weakLine"), main.indexOf("function offerPortrait"));
  assert.match(weak, /!e\?\.limit/, "a refusal by the server (a ceiling, a plan) is not a weak line");
  const offer = main.slice(main.indexOf("function offerPortrait"), main.indexOf("// Why a look ended"));
  assert.match(offer, /p\.photoOnly \|\| !S\.config\.live \|\| mirror\.cameraDown \|\| fullFitting\("portrait"\)/, "never for a piece or a visit that cannot have a portrait");
});

test("the oval mirror keeps the dock off the glass and the tall-or-wide switch away", () => {
  const css = read("public/styles.css");
  assert.match(main, /S\.config\.glass === "oval" \|\| new URLSearchParams\(location\.search\)\.get\("glass"\) === "oval"/);
  assert.match(css, /\[data-glass="oval"\] \.glass \{ border-radius: 50%; \}/);
  assert.match(css, /\[data-glass="oval"\] #shapeBtn \{ display: none; \}/);
  assert.match(css, /\[data-glass="oval"\] \.dock \{\s*position: static;/, "on a wide screen too the dock sits under the oval");
});

test("the restore does not depend on the store: one path for every brand, present and future", () => {
  assert.doesNotMatch(helper, /brand|sapphire|lawrencepur/i);
  const restore = read("src/restore.js");
  assert.doesNotMatch(restore, /S\.brand|sapphire|lawrencepur/i);
  assert.match(restore, /export async function restoreHead/);
});

test("a portrait that cannot be finished is shown as it came, never withheld", () => {
  assert.match(helper, /if \(fixed\?\.how !== "restored"\) return done\(fixed\?\.how \|\| "wait", portrait\);/);
  assert.match(helper, /catch \(e\) \{\s*console\.warn\(e\);\s*return done\("error", portrait\);/);
});

// Since 15 October 2026 every portrait says on the record whether her own face went back, and if not why, with the time
// each part took: a friend's Android showed the engine's faces for a whole afternoon and nothing said why.
test("each portrait records whether her own face went back, and how long each part took", () => {
  // The note, then what the phone sent and how long the line took (up=, line=, light=1 on a slow line).
  assert.match(modelShot, /link\.track\("portrait", \{ product: p\.id, value: [^}]*meta: `\$\{shotNote\(face, shotMs\)\} up=\$\{upKb\}k line=/);
  assert.match(main, /const shotNote = \(face, shotMs\) =>\s*.face=\$\{face\.how \|\| "\?"\} eng=\$\{face\.engine \|\| "decart"\}/, "which engine made it is on the record too");
  assert.match(main, /e=\$\{\(face\.cloud\.engine \/ 1000\)\.toFixed\(1\)\} o=\$\{\(face\.cloud\.outlines \/ 1000\)/, "and how long the engine and the outlines took in the cloud");
  assert.match(read("lib/platform.mjs"), /"backdrop", \/\/ the second, studio-wall pass/);
});
