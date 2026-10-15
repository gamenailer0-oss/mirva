// The cloth of a store's photo, from the cloud's outlines (src/cloth.js): the figure, less the catalogue model's head,
// neck and skin, from just below her chin; the picture cut to the figure with a little room.
import test from "node:test";
import assert from "node:assert/strict";
import { clothAlpha } from "../src/cloth.js";

const W = 100, H = 200;
// A run-length outline of a rectangle, as fal's SAM 3 sends it ("start length …", row-major).
const box = (x0, y0, x1, y1) => {
  const runs = [];
  for (let y = y0; y < y1; y++) runs.push(y * W + x0, x1 - x0);
  return runs.join(" ");
};

test("the cloth starts below the model's chin, and her hair and hands are left out", () => {
  const masks = { person: box(30, 10, 70, 190), face: box(40, 12, 60, 40), hair: box(36, 8, 64, 60), skin: box(30, 120, 36, 130), neck: box(45, 40, 55, 48) };
  const cut = clothAlpha(masks, W, H);
  assert.ok(cut.top >= 40 && cut.top <= 44, `starts just below the chin (row ${cut.top})`);
  const { box: b } = cut;
  const at = (x, y) => (x < b.x || y < b.y || x >= b.x + b.width || y >= b.y + b.height ? 0 : cut.alpha[(y - b.y) * b.width + (x - b.x)]);
  assert.equal(at(50, 30), 0, "no face");
  assert.equal(at(38, 55), 0, "no hair on the shoulders");
  assert.equal(at(32, 125), 0, "no hand");
  assert.equal(at(50, 100), 255, "the cloth itself");
  assert.equal(at(10, 100), 0, "nothing of the room");
  assert.ok(cut.box.y >= cut.top - 15 && cut.box.y + cut.box.height <= H, "the picture is the figure from the chin down");
  assert.ok(cut.box.width >= cut.box.height * 0.45, "never narrower than the old cut");
});

test("a flat product shot (no face) is cut from the top, and a photo with no figure gives nothing", () => {
  assert.equal(clothAlpha({ person: box(20, 20, 80, 180) }, W, H).top, 0);
  assert.equal(clothAlpha({ person: "" }, W, H), null);
});

test("growing an outline by r reaches r cells in every direction, and no further", async () => {
  const { spread } = await import("../src/cloth.js");
  const m = new Uint8Array(W * H);
  m[100 * W + 50] = 1;
  const g = spread(m, W, H, 3);
  assert.equal(g[97 * W + 47], 1);
  assert.equal(g[103 * W + 53], 1);
  assert.equal(g[96 * W + 50], 0);
  assert.equal(g[100 * W + 54], 0);
  assert.equal(g.reduce((s, v) => s + v, 0), 49);
});
