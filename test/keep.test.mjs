// Her own face, hair and shoes, laid back from the cloud's outlines (src/keep.js): the arithmetic, on small grids.
import test from "node:test";
import assert from "node:assert/strict";
import { decodeRLE, resample, grow, herAlpha, figureAlpha, centre } from "../src/keep.js";

const W = 40, H = 60;
const box = (x0, y0, x1, y1) => {
  const m = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 1;
  return m;
};
const or = (...ms) => ms.reduce((a, b) => a.map((v, i) => (v || b[i] ? 1 : 0)));
const at = (a, x, y) => a[y * W + x];
// a figure standing in the middle: head at the top, shoes at the foot
const her = () => ({ herFace: box(17, 6, 23, 13), herHair: box(15, 3, 25, 9), herPerson: box(12, 3, 28, 58), herFeet: or(box(14, 54, 18, 58), box(22, 54, 26, 58)) });
const drawn = (dx = 0, dy = 0) => ({ drawnFace: box(17 + dx, 6 + dy, 23 + dx, 13 + dy), drawnHair: box(13 + dx, 2 + dy, 27 + dx, 9 + dy), drawnFeet: or(box(14, 54, 18, 58), box(22, 54, 26, 58)), drawnPerson: box(11, 2, 29, 58) });

test("fal's run-length outlines read row by row, start and length, and join when there are several", () => {
  const m = decodeRLE("3 2 10 1", 4, 4);
  assert.deepEqual([...m], [0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual([...decodeRLE(["0 1", "15 1"], 4, 4)].filter(Boolean).length, 2, "two shoes, two outlines, one mask");
  assert.equal(decodeRLE("", 4, 4).some(Boolean), false, "nothing found is an empty mask");
  assert.equal(decodeRLE("14 99", 4, 4).filter(Boolean).length, 2, "a run past the end is cut at the end");
  const half = resample(decodeRLE("0 2 4 2", 4, 4), 4, 4, 2, 2);
  assert.deepEqual([...half], [1, 0, 0, 0]);
});

test("her face and hair go back where the engine left the head, with her wall round a bigger drawn head", () => {
  const { alpha, how, filled } = herAlpha({ ...her(), ...drawn() }, W, H);
  assert.equal(at(filled, 11, 5), 1, "her own wall goes back where the drawn hair spills past hers");
  assert.equal(how, "kept");
  assert.equal(at(alpha, 20, 9), 255, "the middle of her face is hers");
  assert.equal(at(alpha, 20, 4), 255, "and her hair");
  assert.ok(at(alpha, 11, 5) > 60, "the drawn hair past hers, over her wall, is her wall again (a thin strip, softened)");
  assert.equal(at(alpha, 20, 30), 0, "the new garment is the engine's");
  assert.ok(at(alpha, 20, 16) < 60, "her neck and collar are never laid back");
});

test("a head the engine moved, or a face that cannot be found, is left as it came", () => {
  assert.equal(herAlpha({ ...her(), ...drawn(8, 0) }, W, H).how, "moved");
  assert.equal(herAlpha({ ...her(), ...drawn(), drawnFace: box(14, 3, 26, 16) }, W, H).how, "moved", "a face drawn much larger is not hers to cover");
  assert.equal(herAlpha({ ...her(), herFace: new Uint8Array(W * H), ...drawn() }, W, H).how, "noface");
  assert.equal(herAlpha({ ...her(), ...drawn(), drawnFace: new Uint8Array(W * H) }, W, H).how, "moved");
});

test("her shoes go back both or neither: never her own slide beside a bare foot", () => {
  // the portrait shows a shoe by her right foot only (the other hidden under a hem): both of hers still go back
  const one = herAlpha({ ...her(), ...drawn(), drawnFeet: box(22, 54, 26, 58) }, W, H);
  assert.equal(one.feet, true);
  assert.ok(at(one.alpha, 16, 56) > 100, "the left as well as");
  assert.ok(at(one.alpha, 24, 56) > 100, "the right");
  // no shoes anywhere near hers (a floor-length hem): none go back
  const none = herAlpha({ ...her(), ...drawn(), drawnFeet: new Uint8Array(W * H) }, W, H);
  assert.equal(none.feet, false);
  assert.equal(at(none.alpha, 16, 56), 0);
});

test("on a studio wall the figure is cut out without the patch of her old room laid round a bigger drawn head", () => {
  const m = { ...her(), ...drawn() };
  const { filled } = herAlpha(m, W, H);
  assert.equal(at(filled, 11, 5), 1, "that corner was her old wall");
  const fig = figureAlpha(m, W, H, filled);
  assert.ok(at(fig, 20, 30) > 200, "the figure is kept");
  assert.ok(at(fig, 11, 5) < 80, "the old wall round the drawn hair is not");
  assert.ok(at(fig, 0, 30) === 0, "nor the room beside her");
});

test("grow and centre do what the laying needs", () => {
  const g = grow(box(10, 10, 11, 11), W, H, 2);
  assert.equal(g.filter(Boolean).length, 25);
  const c = centre(box(10, 10, 12, 12), W);
  assert.deepEqual([c.x, c.y, c.n], [10.5, 10.5, 4]);
});
