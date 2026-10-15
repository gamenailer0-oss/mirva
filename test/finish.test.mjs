// The cloud's finish of a portrait (lib/finish.mjs in lib/app.mjs): the outlines that keep her face, the second engine,
// what each costs, and what an old mirror still gets. Decart and fal are stubs: nothing here spends money.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../lib/app.mjs";
import { openDb } from "../lib/db.mjs";
import { memoryLimiter } from "../lib/auth.mjs";
import { SHOT_TYPE, unpackShot, packShot } from "../lib/shot.mjs";
import { fashnCategory } from "../lib/finish.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const brand = JSON.parse(readFileSync(join(ROOT, "brands/sapphire/brand.json"), "utf8"));
const catalogue = JSON.parse(readFileSync(join(ROOT, "brands/sapphire/catalogue.json"), "utf8"));
const product = catalogue.products[0];
const picture = (name = "x.jpg") => new File([new Uint8Array(3000).fill(7)], name, { type: "image/jpeg" });
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(3000).fill(1)]);

const realFetch = globalThis.fetch;
let decart = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
let sam = (prompt) => Response.json({ rle: `${prompt.length} 3` });
let fashnAnswer = () => Response.json({ images: [{ url: "https://v3b.fal.media/files/try.jpg" }] });
let calls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://api.decart.ai")) return calls.push("decart"), decart(init);
  if (u === "https://fal.run/fal-ai/sam-3/image-rle") {
    const body = JSON.parse(init.body);
    calls.push("sam:" + body.prompt + (body.return_multiple_masks ? "*" : ""));
    return sam(body.prompt);
  }
  if (u === "https://fal.run/fal-ai/fashn/tryon/v1.6") return calls.push("fashn:" + JSON.parse(init.body).category), fashnAnswer();
  if (u.startsWith("https://v3b.fal.media/")) return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
  return realFetch(url, init);
};

const dirs = [];
const kept = new Map();
async function makeApp(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mirva-finish-test-"));
  dirs.push(dir);
  const db = openDb(dir);
  const app = await createApp({
    env: {
      key: "dct_test_key", hasKey: true, falKey: "fal_test_key", origin: "http://localhost:4999", origins: new Set(), openMirror: true, payments: "test", kdf: "scrypt",
      config: { live: true, model: "test", sessionSeconds: 180, idleSeconds: 75, ratePerSecond: 0.02, shotPrice: 0.02, usdToPkr: 277 },
      shotsPerHour: 100, tokensPerHour: 100, debugShots: false, dailyUsd: 0, setupKey: "", hsts: false, ...env,
    },
    db,
    limiter: memoryLimiter(),
    files: { put: async (id, bytes) => kept.set(id, bytes), get: async (id) => (kept.has(id) ? { bytes: kept.get(id), type: "image/png" } : null), del: async (id) => kept.delete(id) },
    brands: new Map([["sapphire", { brand, catalogue }]]),
    saveBrandEntry: async () => {},
    assets: async () => null,
    imageCache: { get: async () => null, put: async () => {} },
    reachable: async () => false,
  });
  return { app, db };
}
after(() => {
  globalThis.fetch = realFetch;
  for (const d of dirs) try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
});

let ip = 0;
async function shot(app, fields = {}, cookie = "") {
  const form = new FormData();
  const all = { person: picture("person.jpg"), reference: picture("garment.jpg"), brand: "sapphire", product: product.id, mode: "portrait", finish: "cloud", ...fields };
  for (const [k, v] of Object.entries(all)) if (v !== undefined) form.append(k, v);
  const res = await app.fetch(new Request("http://localhost:4999/api/model-shot", { method: "POST", body: form, headers: cookie ? { cookie } : {} }), { ip: `10.7.0.${++ip}` });
  const type = res.headers.get("content-type") || "";
  const body = await res.arrayBuffer();
  return { status: res.status, headers: res.headers, type, ...(type.startsWith(SHOT_TYPE) ? unpackShot(body) : type.includes("json") ? { json: JSON.parse(new TextDecoder().decode(body)) } : { bytes: new Uint8Array(body) }) };
}
const spent = (db) => db.all("SELECT kind, usd FROM usage ORDER BY id").then((rows) => rows.map((r) => [r.kind, Math.round(r.usd * 1000) / 1000]));

test("the answer's two parts, what happened and the picture, come apart as they went in", () => {
  const { meta, picture } = unpackShot(packShot({ face: "cloud", n: 1 }, PNG).buffer);
  assert.deepEqual(meta, { face: "cloud", n: 1 });
  assert.deepEqual([...picture], [...PNG]);
});

test("a new mirror's portrait comes with her outlines and the portrait's, found while the engine works, and costs what was spent", async () => {
  const { app, db } = await makeApp();
  calls = [];
  const r = await shot(app);
  assert.equal(r.status, 200);
  assert.ok(r.type.startsWith(SHOT_TYPE));
  assert.deepEqual([r.meta.face, r.meta.engine, r.meta.type], ["cloud", "decart", "image/png"]);
  assert.deepEqual(Object.keys(r.meta.her).sort(), ["face", "feet", "hair", "person"]);
  assert.deepEqual(Object.keys(r.meta.drawn).sort(), ["face", "feet", "hair"]);
  assert.equal(r.meta.her.face, "4 3", "the outline as fal sent it");
  assert.deepEqual([...r.picture], [...PNG], "the picture is the engine's own bytes");
  assert.equal(calls.filter((c) => c.startsWith("sam:")).length, 7);
  assert.ok(calls.includes("sam:footwear*"), "two shoes are two things: every match is asked for");
  assert.deepEqual(await spent(db), [["portrait", 0.055]], "Decart 0.02 and seven outlines at 0.005");
});

test("a second portrait from the same photo asks only for the portrait's outlines; a busy wall adds the figure's", async () => {
  const { app, db } = await makeApp();
  calls = [];
  const again = await shot(app, { her: "known" });
  assert.equal(again.meta.face, "cloud");
  assert.equal(again.meta.her, undefined);
  assert.equal(calls.filter((c) => c.startsWith("sam:")).length, 3);
  const busy = await shot(app, { her: "known", studio: "1" });
  assert.deepEqual(Object.keys(busy.meta.drawn).sort(), ["face", "feet", "hair", "person"]);
  assert.deepEqual(await spent(db), [["portrait", 0.035], ["portrait", 0.04]]);
});

test("with fal out of credit the portrait still comes, the phone keeps her face the old way, and the founder is told once", async () => {
  const { app, db } = await makeApp();
  sam = () => new Response(JSON.stringify({ detail: "User is locked. Reason: TOP_UP." }), { status: 403 });
  const a = await shot(app);
  const b = await shot(app);
  sam = (prompt) => Response.json({ rle: `${prompt.length} 3` });
  assert.deepEqual([a.status, a.meta.face, a.meta.engine], [200, "device", "decart"]);
  assert.equal(a.meta.drawn, undefined);
  assert.equal(b.meta.face, "device");
  assert.deepEqual(await spent(db), [["portrait", 0.02], ["portrait", 0.02]], "only Decart was spent");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(Number((await db.get("SELECT COUNT(*) n FROM flags WHERE key = 'fal-credit-told'")).n), 1, "the founder is told, once a day");
});

test("Decart out of credit or down: the second engine makes the portrait, and keeps her face itself", async () => {
  const { app, db } = await makeApp();
  calls = [];
  decart = () => new Response("pay up", { status: 402 });
  const broke = await shot(app);
  decart = () => new Response("busy", { status: 503 });
  const down = await shot(app);
  decart = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  for (const r of [broke, down]) {
    assert.equal(r.status, 200);
    assert.deepEqual([r.meta.face, r.meta.engine, r.meta.type], ["engine", "fashn", "image/jpeg"]);
    assert.deepEqual([...r.picture], [...JPEG]);
  }
  assert.ok(calls.includes("fashn:auto"), "an eastern suit is shown whole");
  assert.deepEqual(await spent(db), [["portrait", 0.075], ["portrait", 0.075]]);
  assert.equal((await db.get("SELECT value FROM flags WHERE key = 'tryon-credit'"))?.value, "out", "Decart's empty account is still on the founder's Today page");
});

test("if both engines fail, she is told plainly, as before, and nothing is spent", async () => {
  const { app, db } = await makeApp();
  decart = () => new Response("busy", { status: 503 });
  fashnAnswer = () => new Response("stalled", { status: 504 });
  const r = await shot(app);
  decart = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  fashnAnswer = () => Response.json({ images: [{ url: "https://v3b.fal.media/files/try.jpg" }] });
  assert.equal(r.status, 503);
  assert.equal(r.json.busy, true);
  assert.deepEqual(await spent(db), []);
});

test("a mirror that has not reloaded gets the picture exactly as before", async () => {
  const { app, db } = await makeApp();
  calls = [];
  const r = await shot(app, { finish: undefined });
  assert.equal(r.status, 200);
  assert.equal(r.type, "image/png");
  assert.deepEqual([...r.bytes], [...PNG]);
  assert.deepEqual(calls, ["decart"], "no outlines asked for");
  assert.deepEqual(await spent(db), [["portrait", 0.02]]);
});

test("a retake (the second engine, when Decart moved her head) comes with a portrait, once, and takes its place", async () => {
  const { app, db } = await makeApp({ openMirror: false });
  const join = await app.fetch(
    new Request("http://localhost:4999/api/auth/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Retake Tester", email: `retake-${Date.now()}@example.com`, password: "a long enough phrase", agree: true }) }),
    { ip: "10.7.9.1" },
  );
  const cookie = join.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const first = await shot(app, {}, cookie);
  const id = first.headers.get("x-mirva-portrait");
  assert.ok(id);
  const retake = await shot(app, { mode: "retake", replaces: id }, cookie);
  assert.equal(retake.status, 200);
  assert.deepEqual([retake.meta.face, retake.meta.engine], ["engine", "fashn"]);
  const newId = retake.headers.get("x-mirva-portrait");
  assert.ok(newId && newId !== id && kept.has(newId) && !kept.has(id), "the retake takes the first portrait's place");
  assert.equal((await shot(app, { mode: "retake", replaces: newId }, cookie)).status, 402, "one retake for each portrait");
  assert.deepEqual((await spent(db)).map((r) => r[0]), ["portrait", "retake"]);
  const me = await (await app.fetch(new Request("http://localhost:4999/api/me", { headers: { cookie } }))).json();
  assert.equal(me.usage.portraits, 1, "a retake never draws on her month's portraits");
});

test("without a fal key a retake is refused plainly, and a new mirror still gets Decart's portrait", async () => {
  const { app } = await makeApp({ falKey: "" });
  const r = await shot(app, { mode: "retake" });
  assert.equal(r.status, 503);
  assert.equal(r.json.limit, "no-retake");
  const p = await shot(app);
  assert.equal(p.type, "image/png", "no key: the old answer, and the phone keeps her face the old way");
});

test("FASHN is told what kind of piece it is: a western top keeps her own trousers", () => {
  assert.equal(fashnCategory({ tradition: "west", name: "Embroidered Quarter-Zip Sweatshirt", cut: "relaxed" }), "tops");
  assert.equal(fashnCategory({ tradition: "west", name: "Straight Fit Jeans" }), "bottoms");
  assert.equal(fashnCategory({ tradition: "west", name: "Linen Co-ord Set" }), "auto");
  assert.equal(fashnCategory({ tradition: "east", name: "3 Piece - Printed Khaddar Suit" }), "auto");
});
