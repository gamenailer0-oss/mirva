// The Model shot on the server: the studio-backdrop pass, who may ask for it, what it costs, and what happens when the
// engine is busy. The app runs in this process on a throwaway database and Decart is a stub, so nothing here spends money.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../lib/app.mjs";
import { openDb } from "../lib/db.mjs";
import { memoryLimiter } from "../lib/auth.mjs";
import { MEMBER_TIERS } from "../lib/plans.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const brand = JSON.parse(readFileSync(join(ROOT, "brands/sapphire/brand.json"), "utf8"));
const catalogue = JSON.parse(readFileSync(join(ROOT, "brands/sapphire/catalogue.json"), "utf8"));
const product = catalogue.products[0];

// A picture the server will accept: the right type and more than 2000 bytes.
const picture = (name = "x.jpg") => new File([new Uint8Array(3000).fill(7)], name, { type: "image/jpeg" });
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

const realFetch = globalThis.fetch;
let outbound = []; // every call the server made to Decart
let engine = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.decart.ai")) {
    outbound.push({ url: String(url), form: init.body });
    return engine(init);
  }
  return realFetch(url, init);
};

const dirs = [];
const kept = new Map();
async function makeApp(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mirva-portrait-test-"));
  dirs.push(dir);
  const db = openDb(dir);
  const app = await createApp({
    env: {
      key: "dct_test_key", hasKey: true, origin: "http://localhost:4999", origins: new Set(), openMirror: false, payments: "test", kdf: "scrypt",
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

let counter = 0;
async function member(app, label) {
  const res = await app.fetch(
    new Request("http://localhost:4999/api/auth/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `Tester ${label}`, email: `${label}-${++counter}@example.com`, password: "a long enough phrase", agree: true }),
    }),
    { ip: `10.1.0.${counter}` },
  );
  assert.equal(res.status, 200);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const who = await app.platform.identify(new Request("http://localhost:4999/api/me", { headers: { cookie } }));
  assert.equal(who.kind, "member");
  return { cookie, who };
}

// One call to /api/model-shot. `fields` become form fields; a File goes in as a file.
async function shot(app, { cookie = "", ip = "10.2.0.1", fields = {} } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, v);
  const res = await app.fetch(new Request("http://localhost:4999/api/model-shot", { method: "POST", body: form, headers: cookie ? { cookie } : {} }), { ip });
  const type = res.headers.get("content-type") || "";
  return { status: res.status, headers: res.headers, body: type.includes("json") ? await res.json() : new Uint8Array(await res.arrayBuffer()) };
}
const portraitFields = (extra = {}) => ({ person: picture("person.jpg"), reference: picture("garment.jpg"), brand: "sapphire", product: product.id, mode: "portrait", ...extra });
const backdropFields = (extra = {}) => ({ person: picture("portrait.png"), brand: "sapphire", product: product.id, mode: "backdrop", ...extra });
const kinds = (db, who) => db.all("SELECT kind FROM usage WHERE user = ? ORDER BY id", who.user.id).then((rows) => rows.map((r) => r.kind));

before(() => {
  outbound = [];
});
after(() => {
  globalThis.fetch = realFetch;
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
});

// --- who may ask -----------------------------------------------------------------

test("a member's studio backdrop is allowed once for each portrait of the month, and never on its own", async () => {
  const { app, db } = await makeApp();
  const { who } = await member(app, "rule");
  const ask = () => app.platform.grant(who, "backdrop");
  const refused = await ask();
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 402);
  assert.equal(refused.limit, "backdrop");
  assert.match(refused.error, /comes with each portrait/);

  await app.platform.meter(who, "portrait", "sapphire", 0, 0.02);
  assert.equal((await ask()).ok, true, "one portrait, no backdrop yet");
  await app.platform.meter(who, "backdrop", "sapphire", 0, 0.02);
  assert.equal((await ask()).ok, false, "the backdrop for that portrait is used");

  await app.platform.meter(who, "portrait", "sapphire", 0, 0.02);
  assert.equal((await ask()).ok, true, "a second portrait brings a second backdrop");
  assert.deepEqual(await kinds(db, who), ["portrait", "backdrop", "portrait"]);
});

test("a backdrop does not draw on the monthly portraits", async () => {
  const { app } = await makeApp();
  const { who, cookie } = await member(app, "allowance");
  const left = MEMBER_TIERS.member.portraitsPerMonth;
  for (let i = 0; i < left - 1; i++) {
    await app.platform.meter(who, "portrait", "sapphire", 0, 0.02);
    await app.platform.meter(who, "backdrop", "sapphire", 0, 0.02);
  }
  const me = await (await app.fetch(new Request("http://localhost:4999/api/me", { headers: { cookie } }))).json();
  assert.equal(me.usage.portraits, left - 1, "only portraits are counted");
  assert.equal((await app.platform.grant(who, "portrait")).ok, true, "one portrait left");
  await app.platform.meter(who, "portrait", "sapphire", 0, 0.02);
  const none = await app.platform.grant(who, "portrait");
  assert.equal(none.ok, false);
  assert.equal(none.limit, "portraits");
  assert.equal((await app.platform.grant(who, "backdrop")).ok, true, "the last portrait still has its backdrop to come");
});

test("a store mirror and an open mirror have no backdrop allowance to run out of", async () => {
  const { app } = await makeApp();
  for (const who of [{ kind: "open" }, { kind: "device", device: { id: "d1" } }, { kind: "staff", user: { id: "s1" } }]) assert.equal((await app.platform.grant(who, "backdrop")).ok, true, who.kind);
  assert.equal((await app.platform.grant({ kind: "none" }, "backdrop")).status, 401);
});

// --- the route: refusals and their order -------------------------------------------

test("the route refuses by who is asking before it looks at the pictures", async () => {
  const { app } = await makeApp();
  const nobody = await shot(app, { fields: backdropFields() });
  assert.equal(nobody.status, 401);

  const { cookie, who } = await member(app, "order");
  const noPortraitYet = await shot(app, { cookie, fields: { mode: "backdrop" } }); // not even a picture: refused on the allowance first
  assert.equal(noPortraitYet.status, 402);
  assert.equal(noPortraitYet.body.limit, "backdrop");
  assert.equal(outbound.length, 0, "nothing was sent to the engine");

  await app.platform.meter(who, "portrait", "sapphire", 0, 0.02);
  const noPicture = await shot(app, { cookie, fields: { mode: "backdrop", brand: "sapphire", product: product.id } });
  assert.equal(noPicture.status, 400, "past the allowance, the missing picture is what is wrong");
  assert.match(noPicture.body.error, /picture of you/);
  const noPiece = await shot(app, { cookie, fields: backdropFields({ product: "nope" }) });
  assert.equal(noPiece.status, 404);
  assert.equal(outbound.length, 0);
});

test("a backdrop needs no garment picture, and the old name 'relight' means the same", async () => {
  const { app } = await makeApp({ openMirror: true });
  outbound = [];
  const a = await shot(app, { fields: backdropFields() });
  assert.equal(a.status, 200);
  const b = await shot(app, { fields: backdropFields({ mode: "relight", reference: picture("ignored.jpg") }), ip: "10.2.0.2" });
  assert.equal(b.status, 200);
  assert.equal(outbound.length, 2);
  for (const call of outbound) {
    assert.match(call.url, /lucy-image-2$/);
    assert.match(call.form.get("prompt"), /^Change only the background/);
    assert.equal(call.form.get("reference_image"), null, "a backdrop never carries a garment picture");
    assert.ok(call.form.get("data"));
  }
});

// --- the portrait, with and without a garment picture ------------------------------

// Drawn from its description a piece would be a garment of that kind in colours and embroidery of the engine's own
// choosing. A store cannot have that shown as its piece, so without the garment's picture nothing is asked or spent.
test("a portrait is made from the garment's own picture or not at all", async () => {
  const { app } = await makeApp({ openMirror: true });
  outbound = [];
  const withIt = await shot(app, { fields: portraitFields() });
  const without = await shot(app, { fields: portraitFields({ reference: undefined }), ip: "10.2.0.3" });
  assert.equal(withIt.status, 200);
  assert.deepEqual([without.status, without.body?.limit], [422, "photo-only"]);
  assert.equal(outbound.length, 1, "the engine was asked once, for the portrait that had a picture");
  const [one] = outbound;
  assert.ok(one.form.get("reference_image"));
  assert.match(one.form.get("prompt"), /exactly as shown in the reference image: the same colours, the same print or pattern, the same embroidery, in the same places/);
  assert.match(one.form.get("prompt"), /Edit only the clothes[\s\S]*Do not re-pose the person/);
});

// --- what a member keeps ------------------------------------------------------------

test("a member's backdrop takes the place of the portrait it was made from, and is metered as its own kind", async () => {
  const { app, db } = await makeApp();
  const { cookie, who } = await member(app, "keeps");
  outbound = [];
  const first = await shot(app, { cookie, fields: portraitFields() });
  assert.equal(first.status, 200);
  const oldId = first.headers.get("x-mirva-portrait");
  assert.ok(oldId && kept.has(oldId), "the portrait is kept for a member");
  // she keeps the look with that portrait
  await db.run("INSERT INTO looks (id, user, brand, product, name, price, currency, image, url, size, portrait, source, created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", "look1", who.user.id, "sapphire", product.id, product.name, product.price, "Rs.", product.image, "", "", oldId, "home", Date.now());

  const second = await shot(app, { cookie, fields: backdropFields({ replaces: oldId }) });
  assert.equal(second.status, 200);
  const newId = second.headers.get("x-mirva-portrait");
  assert.ok(newId && newId !== oldId);
  assert.ok(kept.has(newId));
  assert.equal(kept.has(oldId), false, "the old picture is gone");
  assert.equal(await db.get("SELECT 1 AS n FROM portraits WHERE id = ?", oldId), undefined);
  assert.equal((await db.get("SELECT portrait FROM looks WHERE id = 'look1'")).portrait, newId, "the kept look now holds the new picture");
  assert.deepEqual(await kinds(db, who), ["portrait", "backdrop"]);
  const usd = await db.all("SELECT kind, usd FROM usage WHERE user = ?", who.user.id);
  assert.deepEqual(usd.map((r) => r.usd), [0.02, 0.02], "a backdrop costs the same as a portrait");

  const third = await shot(app, { cookie, fields: backdropFields({ replaces: newId }) });
  assert.equal(third.status, 402, "one backdrop for that portrait");
  assert.equal(outbound.length, 2, "and the refusal never reached the engine");
});

test("a member cannot replace somebody else's portrait", async () => {
  const { app, db } = await makeApp();
  const a = await member(app, "owner");
  const b = await member(app, "other");
  const mine = await shot(app, { cookie: a.cookie, fields: portraitFields() });
  const theirs = mine.headers.get("x-mirva-portrait");
  await app.platform.meter(b.who, "portrait", "sapphire", 0, 0.02);
  const res = await shot(app, { cookie: b.cookie, fields: backdropFields({ replaces: theirs }) });
  assert.equal(res.status, 200);
  assert.ok(kept.has(theirs), "the other member's picture is untouched");
  assert.ok(await db.get("SELECT 1 AS n FROM portraits WHERE id = ?", theirs));
});

// --- ceilings and failures ----------------------------------------------------------

test("the hourly limit counts portraits and backdrops together", async () => {
  const { app } = await makeApp({ openMirror: true, shotsPerHour: 2 });
  assert.equal((await shot(app, { fields: portraitFields() })).status, 200);
  assert.equal((await shot(app, { fields: backdropFields() })).status, 200);
  const third = await shot(app, { fields: backdropFields() });
  assert.equal(third.status, 429);
  assert.match(third.body.error, /a lot of portraits/);
});

test("the daily ceiling holds for a backdrop as for a portrait", async () => {
  const { app } = await makeApp({ dailyUsd: 0.03 });
  const { cookie } = await member(app, "daily");
  assert.equal((await shot(app, { cookie, fields: portraitFields() })).status, 200); // 0.02 spent
  assert.equal((await shot(app, { cookie, fields: backdropFields() })).status, 200); // under 0.03 when asked; 0.04 now
  const next = await shot(app, { cookie, fields: portraitFields() });
  assert.equal(next.status, 503);
  assert.match(next.body.error, /resting for today/);
  assert.equal(next.body.busy, undefined, "that is not 'busy', so the browser does not retry it");
});

test("a busy engine answers 'busy' and costs nothing", async () => {
  const { app, db } = await makeApp();
  const { cookie, who } = await member(app, "busy");
  const html = "<html><head><title>504 Gateway Time-out</title></head></html>";
  const failures = [() => new Response(html, { status: 504 }), () => new Response("busy", { status: 503 }), () => new Response("slow down", { status: 429 }), () => { throw new TypeError("fetch failed"); }];
  for (const f of failures) {
    engine = f;
    const res = await shot(app, { cookie, fields: portraitFields(), ip: "10.2.0.9" });
    assert.equal(res.status, 503);
    assert.equal(res.body.busy, true);
    assert.match(res.body.error, /studio is busy/);
  }
  assert.deepEqual(await kinds(db, who), [], "nothing was metered");
  assert.equal(await db.get("SELECT 1 AS n FROM portraits WHERE user = ?", who.user.id), undefined, "and nothing was kept");
  engine = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  assert.equal((await shot(app, { cookie, fields: portraitFields(), ip: "10.2.0.9" })).status, 200);
  assert.deepEqual(await kinds(db, who), ["portrait"], "the call that worked was metered once");
});

test("a refused key is told plainly, an empty account is 'resting', and neither costs anything", async () => {
  const { app, db } = await makeApp({ openMirror: true });
  engine = () => new Response("nope", { status: 401 });
  const refused = await shot(app, { fields: portraitFields() });
  assert.equal(refused.status, 502);
  assert.match(refused.body.error, /refused the key/);
  // The shopper is not told about the account; the founder is (see safeguards.test.mjs).
  engine = () => new Response("pay up", { status: 402 });
  const broke = await shot(app, { fields: portraitFields(), ip: "10.2.0.4" });
  assert.equal(broke.status, 503);
  assert.equal(broke.body.limit, "resting");
  assert.match(broke.body.error, /resting just now/);
  assert.equal(broke.body.busy, undefined, "not 'busy', so the browser does not retry it");
  engine = () => new Response("no", { status: 400 });
  assert.equal((await shot(app, { fields: portraitFields(), ip: "10.2.0.5" })).status, 502);
  assert.equal((await db.get("SELECT COUNT(*) AS n FROM usage")).n, 0);
  engine = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
});

// --- the finished portrait: the shopper's own head, laid back by the mirror (src/restore.js) ---------------------------

const JPEG = (() => {
  const b = new Uint8Array(3000).fill(9);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
})();
async function finish(app, id, { cookie = "", bytes = JPEG, type = "image/jpeg", headers = {} } = {}) {
  const res = await app.fetch(
    new Request(`http://localhost:4999/api/portrait/${id}`, { method: "POST", body: bytes, headers: { "content-type": type, ...(cookie ? { cookie } : {}), ...headers } }),
    { ip: "10.3.0.1" },
  );
  return { status: res.status, body: await res.json() };
}

test("a member's finished portrait takes the place of the one the engine drew, under the same id", async () => {
  const { app, db } = await makeApp();
  const { cookie } = await member(app, "finish");
  const made = await shot(app, { cookie, fields: portraitFields() });
  const id = made.headers.get("x-mirva-portrait");
  assert.ok(id);
  const done = await finish(app, id, { cookie });
  assert.equal(done.status, 200);
  assert.deepEqual([...kept.get(id).slice(0, 3)], [0xff, 0xd8, 0xff]);
  assert.equal((await db.get("SELECT type FROM portraits WHERE id = ?", id)).type, "image/jpeg");
  const back = await app.fetch(new Request(`http://localhost:4999/api/portrait/${id}`, { headers: { cookie } }));
  assert.equal(back.status, 200);
  assert.equal(back.headers.get("content-type"), "image/jpeg");
});

test("only the member whose portrait it is can finish it, only with a picture, and only while it is fresh", async () => {
  const { app, db } = await makeApp();
  const { cookie } = await member(app, "owner");
  const other = await member(app, "other");
  const made = await shot(app, { cookie, fields: portraitFields() });
  const id = made.headers.get("x-mirva-portrait");
  const before = kept.get(id);

  assert.equal((await finish(app, id)).status, 401); // signed out
  assert.equal((await finish(app, id, { cookie: other.cookie })).status, 404); // somebody else's
  assert.equal((await finish(app, id, { cookie, type: "text/html" })).status, 415);
  assert.equal((await finish(app, id, { cookie, bytes: new Uint8Array(3000).fill(60) })).status, 400); // says JPEG, is not one
  assert.equal((await finish(app, id, { cookie, type: "image/png" })).status, 400); // says PNG, is a JPEG
  assert.equal((await finish(app, id, { cookie, headers: { "content-length": String(4 * 1024 * 1024) } })).status, 413);
  assert.equal(kept.get(id), before, "a refused picture changes nothing");

  await db.run("UPDATE portraits SET created = created - ? WHERE id = ?", 16 * 60e3, id);
  assert.equal((await finish(app, id, { cookie })).status, 404); // no longer fresh
  assert.equal(kept.get(id), before);
});

test("the list of stores carries what the store picker shows: a line about each, and three pictures from its rails", async () => {
  const { app } = await makeApp();
  const res = await app.fetch(new Request("http://localhost:4999/api/brands"));
  const [store] = await res.json();
  assert.equal(store.id, "sapphire");
  assert.equal(typeof store.tagline, "string");
  assert.ok(store.tagline.length > 0, "Sapphire has a line of its own");
  assert.equal(store.cover.length, 3);
  for (const url of store.cover) assert.match(url, /^https:\/\//);
  assert.equal(new Set(store.cover).size, 3);
});
