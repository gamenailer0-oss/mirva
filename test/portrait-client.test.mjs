// The browser's side of a Model-mode portrait: the look at the frame, and the call that tries once more when the studio is busy.
// These parts need no camera and no DOM, so they run here.
import test from "node:test";
import assert from "node:assert/strict";
import { meanLuma, wallBusyness, requestShot, DIM, BUSY } from "../src/portrait.js";

const grey = (w, h, f) => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(255, f(x, y)));
      px.set([v, v, v, 255], (y * w + x) * 4);
    }
  return px;
};
const W = 54, H = 96; // a 9:16 frame at the size the browser looks at

test("a dim frame is told from a usable one by its mean brightness", () => {
  assert.ok(meanLuma(grey(W, H, () => 38)) < DIM, "the dark test frame (38 of 255)");
  assert.ok(meanLuma(grey(W, H, () => 104)) > DIM, "the usable webcam-like frame (104 of 255)");
  assert.ok(meanLuma(grey(W, H, () => 172)) > DIM);
  assert.equal(meanLuma(new Uint8ClampedArray(0)), 0);
});

test("a plain wall is plain, even with a gradient and webcam grain", () => {
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 6;
  const wall = grey(W, H, (x, y) => 120 + y * 0.15 + noise());
  assert.ok(wallBusyness(wall, W, H) < BUSY, String(wallBusyness(wall, W, H)));
});

test("clutter beside her head is busy, on either side", () => {
  const stripes = (x) => (Math.floor(x / 2) % 2 ? 70 : 190); // a bookshelf, say
  const left = grey(W, H, (x, y) => (x < W * 0.2 && y < H * 0.3 ? stripes(x) : 130));
  const right = grey(W, H, (x, y) => (x > W * 0.8 && y < H * 0.3 ? stripes(x) : 130));
  assert.ok(wallBusyness(left, W, H) > BUSY, "clutter on the left only");
  assert.ok(wallBusyness(right, W, H) > BUSY, "clutter on the right only");
});

test("what is in the middle of the frame, where she stands, does not count against the wall", () => {
  const her = grey(W, H, (x, y) => (x > W * 0.3 && x < W * 0.7 ? (Math.floor(y / 2) % 2 ? 40 : 200) : 130));
  assert.ok(wallBusyness(her, W, H) < BUSY);
});

// --- requestShot ----------------------------------------------------------------------

const png = () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png", "x-mirva-portrait": "abc123" } });
const gateway = (status = 504) => new Response("<html>Gateway Time-out</html>", { status, headers: { "content-type": "text/html" } });
const jsonErr = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const script = (...answers) => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (!next) throw new Error("more calls than expected");
    return next instanceof Error ? Promise.reject(next) : next;
  };
  return { fetcher, calls };
};

test("a picture that comes back at once is returned with its kept id, and sent once", async () => {
  const { fetcher, calls } = script(png());
  const out = await requestShot(new FormData(), { fetcher, wait: 0, headers: { "x-mirva-device": "d.t" } });
  assert.equal(out.saved, "abc123");
  assert.equal((await out.blob.arrayBuffer()).byteLength, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/model-shot");
  assert.equal(calls[0].init.headers["x-mirva-device"], "d.t");
});

test("a gateway time-out is tried once more, after a word to the shopper", async () => {
  const { fetcher, calls } = script(gateway(504), png());
  let said = 0;
  const out = await requestShot(new FormData(), { fetcher, wait: 0, onBusy: () => said++ });
  assert.equal(calls.length, 2);
  assert.equal(said, 1);
  assert.equal(out.saved, "abc123");
});

test("the server's own 'busy' (503) and a bare 502 are tried once more too", async () => {
  for (const first of [jsonErr(503, { error: "The studio is busy. One more try.", busy: true }), gateway(502)]) {
    const { fetcher, calls } = script(first, png());
    await requestShot(new FormData(), { fetcher, wait: 0 });
    assert.equal(calls.length, 2);
  }
});

test("busy twice stops there, with the studio's own words, and never a third call", async () => {
  const { fetcher, calls } = script(gateway(504), gateway(504));
  await assert.rejects(requestShot(new FormData(), { fetcher, wait: 0 }), (e) => e.kind === "busy" && /studio is busy/.test(e.message));
  assert.equal(calls.length, 2);
});

test("answers that are not about being busy are the answer: no second call", async () => {
  const cases = [
    jsonErr(503, { error: "Try-on is resting for today. It will be back tomorrow." }), // a 503, but not a busy one
    jsonErr(402, { error: "You've had this month's 6 portraits.", limit: "portraits" }),
    jsonErr(502, { error: "The try-on engine refused the key (401)." }),
    jsonErr(400, { error: "I need a picture of you to do that." }),
    jsonErr(429, { error: "That is a lot of portraits for one hour." }),
  ];
  for (const answer of cases) {
    const { fetcher, calls } = script(answer);
    await assert.rejects(requestShot(new FormData(), { fetcher, wait: 0 }), (e) => e.kind === undefined && typeof e.status === "number");
    assert.equal(calls.length, 1, answer.status + " is not retried");
  }
  const { fetcher } = script(jsonErr(402, { error: "Out of portraits.", limit: "portraits" }));
  await assert.rejects(requestShot(new FormData(), { fetcher, wait: 0 }), (e) => e.limit === "portraits" && e.message === "Out of portraits.");
});

test("a dropped connection is not retried: the call may have gone through", async () => {
  const { fetcher, calls } = script(new TypeError("Failed to fetch"));
  await assert.rejects(requestShot(new FormData(), { fetcher, wait: 0 }), /Failed to fetch/);
  assert.equal(calls.length, 1);
});
