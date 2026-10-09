// The spending safeguards: an honest meter for live looks, the ceilings on a store's paired mirror, what the mirror
// page is told, the store's Limits, what the founder is told, and a try-on account that runs out of credit.
// The app runs in this process on throwaway databases and Decart is a stub, so nothing here can spend money.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../lib/app.mjs";
import { openDb } from "../lib/db.mjs";
import { memoryLimiter, hashPassword, sha } from "../lib/auth.mjs";
import { MIRROR, RETAIL_PLANS, pktDayStart, monthStart } from "../lib/plans.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const brand = JSON.parse(readFileSync(join(ROOT, "brands/sapphire/brand.json"), "utf8"));
const catalogue = JSON.parse(readFileSync(join(ROOT, "brands/sapphire/catalogue.json"), "utf8"));
const product = catalogue.products[0];
const DAY = 86400e3;
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const picture = (name = "x.jpg") => new File([new Uint8Array(3000).fill(7)], name, { type: "image/jpeg" });

// --- Decart, stubbed --------------------------------------------------------------
const realFetch = globalThis.fetch;
let outbound = [];
const engine = {
  image: () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }),
  token: () => new Response(JSON.stringify({ apiKey: "ek_test", expiresAt: new Date(Date.now() + 60e3).toISOString() }), { status: 200, headers: { "content-type": "application/json" } }),
};
const reset = () => {
  outbound = [];
  engine.image = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  engine.token = () => new Response(JSON.stringify({ apiKey: "ek_test", expiresAt: new Date(Date.now() + 60e3).toISOString() }), { status: 200, headers: { "content-type": "application/json" } });
};
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.decart.ai")) {
    outbound.push(String(url));
    return String(url).includes("/client/tokens") ? engine.token() : engine.image();
  }
  return realFetch(url, init);
};

const dirs = [];
const kept = new Map();
async function makeApp(env = {}) {
  reset();
  const dir = mkdtempSync(join(tmpdir(), "mirva-safeguards-test-"));
  dirs.push(dir);
  const db = openDb(dir);
  const app = await createApp({
    env: {
      key: "dct_test_key", hasKey: true, origin: "http://localhost:4999", origins: new Set(), openMirror: false, payments: "test", kdf: "scrypt",
      config: { live: true, model: "test", sessionSeconds: 180, idleSeconds: 75, ratePerSecond: 0.02, shotPrice: 0.02, usdToPkr: 277 },
      shotsPerHour: 1000, tokensPerHour: 1000, debugShots: false, dailyUsd: 0, setupKey: "", hsts: false, ...env,
    },
    db,
    limiter: memoryLimiter(),
    files: { put: async (id, bytes) => kept.set(id, bytes), get: async (id) => (kept.has(id) ? { bytes: kept.get(id), type: "image/png" } : null), del: async (id) => kept.delete(id) },
    brands: new Map([
      ["sapphire", { brand, catalogue }],
      ["atelier", { brand: { ...brand, id: "atelier", name: "Atelier" }, catalogue }],
    ]),
    saveBrandEntry: async () => {},
    assets: async () => null,
    imageCache: { get: async () => null, put: async () => {} },
    reachable: async () => false,
  });
  return { app, db };
}
after(() => {
  globalThis.fetch = realFetch;
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
});

// --- small helpers -------------------------------------------------------------------
let counter = 0;
let ipCounter = 0;
async function call(app, method, path, { body, headers = {}, ip } = {}) {
  const res = await app.fetch(
    new Request("http://localhost:4999" + path, { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }),
    { ip: ip || `10.7.${(++ipCounter >> 8) + 1}.${ipCounter & 255}` },
  );
  const type = res.headers.get("content-type") || "";
  return { status: res.status, headers: res.headers, body: type.includes("json") ? await res.json() : null };
}
async function shot(app, { headers = {}, fields = {} } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ person: picture("person.jpg"), reference: picture("garment.jpg"), brand: "sapphire", product: product.id, mode: "portrait", ...fields })) if (v !== undefined) form.append(k, v);
  const res = await app.fetch(new Request("http://localhost:4999/api/model-shot", { method: "POST", body: form, headers }), { ip: `10.8.${(++ipCounter >> 8) + 1}.${ipCounter & 255}` });
  const type = res.headers.get("content-type") || "";
  return { status: res.status, body: type.includes("json") ? await res.json() : null };
}
// A mirror paired to a store, as the pairing route leaves it.
async function pair(db, brandId = "sapphire", name = "Front mirror") {
  const n = ++counter;
  const id = `dev${n}`;
  const secret = `secret-${n}-token`;
  await db.run("INSERT INTO devices (id, brand, name, store, token, paired, created) VALUES (?,?,?,?,?,?,?)", id, brandId, name, "Gulberg", sha(secret), Date.now(), Date.now());
  return { id, brand: brandId, header: { "x-mirva-device": `${id}.${secret}` }, who: { kind: "device", device: { id, brand: brandId } } };
}
const plan = (db, brandId, planId, stores = 1, status = "pilot", settings = {}) =>
  db.run("INSERT INTO retailers (brand, plan, stores, status, started, settings) VALUES (?,?,?,?,?,?) ON CONFLICT(brand) DO UPDATE SET plan = excluded.plan, stores = excluded.stores, status = excluded.status, settings = excluded.settings", brandId, planId, stores, status, Date.now(), JSON.stringify(settings));
const setSettings = (db, brandId, settings) => db.run("UPDATE retailers SET settings = ? WHERE brand = ?", JSON.stringify(settings), brandId);
const spend = (db, deviceId, usd, { ago = 0, sample = 0, kind = "portrait", brandId = "sapphire" } = {}) =>
  db.run("INSERT INTO usage (at, kind, brand, device, user, seconds, usd, sample) VALUES (?,?,?,?,?,?,?,?)", Date.now() - ago, kind, brandId, deviceId, null, 0, usd, sample);
// Visits that reached a try-on (or another kind of event), as a paired mirror would have reported them.
const visits = (db, deviceId, count, { brandId = "sapphire", kind = "portrait", sample = 0, ago = 0, prefix = "v" } = {}) =>
  db.batch(Array.from({ length: count }, (_, i) => ["INSERT INTO events (at, brand, device, visit, user, kind, product, value, meta, sample) VALUES (?,?,?,?,?,?,?,?,?,?)", Date.now() - ago, brandId, deviceId, `${prefix}${i}`, null, kind, null, null, null, sample]));
// Live seconds and portraits on the meter, as a paired mirror's try-ons leave them. No dollars, so the day's budget is not in the way.
const liveUsed = (db, deviceId, seconds, { ago = 0, sample = 0, brandId = "sapphire" } = {}) =>
  db.run("INSERT INTO usage (at, kind, brand, device, user, seconds, usd, sample) VALUES (?,?,?,?,?,?,?,?)", Date.now() - ago, "live", brandId, deviceId, null, seconds, 0, sample);
const portraitsUsed = (db, deviceId, count, { ago = 0, sample = 0, brandId = "sapphire", kind = "portrait" } = {}) =>
  db.batch(Array.from({ length: count }, () => ["INSERT INTO usage (at, kind, brand, device, user, seconds, usd, sample) VALUES (?,?,?,?,?,?,?,?)", Date.now() - ago, kind, brandId, deviceId, null, 0, 0, sample]));
const rows = (db, sql, ...p) => db.all(sql, ...p);
const count = async (db, table) => Number((await db.get(`SELECT COUNT(*) AS n FROM ${table}`)).n);

async function signIn(app, db, role, brandId = null) {
  const n = ++counter;
  const email = `${role}-${n}@example.com`;
  await db.run("INSERT INTO users (id, role, email, name, pass, brand, created) VALUES (?,?,?,?,?,?,?)", `user${n}`, role, email, `${role} ${n}`, await hashPassword("a long enough phrase", "scrypt"), brandId, Date.now());
  const res = await call(app, "POST", "/api/auth/signin", { body: { email, password: "a long enough phrase" } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { headers: { cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") }, id: `user${n}`, email };
}

// ===== 1. an honest meter =====================================================================

test("a live look that reports less than the clock allows is not believed, and an honest short one is", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db);
  await plan(db, "sapphire", "studio", 1, "pilot", { mirrorDailyUsd: 100 }); // room for several reservations
  const issue = async (age, headers = dev.header) => {
    const t = await call(app, "POST", "/api/token", { body: { brand: "sapphire" }, headers });
    assert.equal(t.status, 200, JSON.stringify(t.body));
    assert.equal(t.body.seconds, 180);
    await db.run("UPDATE usage SET at = at - ? WHERE id = ?", age * 1000, t.body.grant);
    return t.body.grant;
  };
  const end = (grant, value, headers = dev.header) => call(app, "POST", "/api/events", { body: { brand: "sapphire", visit: "m1", events: [{ kind: "live_end", value, grant }] }, headers });
  const row = (id) => db.get("SELECT seconds, usd FROM usage WHERE id = ?", id);
  const near = (got, want, why) => assert.ok(got >= want && got < want + 2, `${why}: ${got} is not about ${want}`);

  // Tap, ten seconds, stop: recorded at its real length.
  let g = await issue(12);
  await end(g, 10);
  assert.equal((await row(g)).seconds, 10);
  assert.ok(Math.abs((await row(g)).usd - 0.2) < 1e-9);

  // Honest and long: believed as it is.
  g = await issue(105);
  await end(g, 100);
  assert.equal((await row(g)).seconds, 100);

  // A mirror that says nothing ran, a hundred and fifty seconds after the token: the clock less twenty seconds stands.
  g = await issue(150);
  await end(g, 0);
  near((await row(g)).seconds, 130, "lied low");
  near((await row(g)).usd / 0.02, 130, "and priced to match");

  // Never above what was reserved, however long ago, and a report above the reservation changes nothing.
  g = await issue(400);
  await end(g, 5);
  assert.equal((await row(g)).seconds, 180);
  g = await issue(30);
  await end(g, 999);
  assert.equal((await row(g)).seconds, 180);

  // An abandoned look (it never connected) reported at once costs nothing.
  g = await issue(3);
  await end(g, 0);
  assert.equal((await row(g)).seconds, 0);

  // A look that was never reported stays at the full reservation, and one past the hour is left alone.
  g = await issue(100);
  const other = await pair(db);
  await end(g, 0, other.header); // another mirror cannot settle it
  assert.equal((await row(g)).seconds, 180);
  g = await issue(4000);
  await end(g, 0);
  assert.equal((await row(g)).seconds, 180);
});

test("an open mirror's live look is settled by the same rule", async () => {
  const { app, db } = await makeApp({ openMirror: true });
  const t = await call(app, "POST", "/api/token", { body: { brand: "sapphire" } });
  assert.equal(t.status, 200);
  await db.run("UPDATE usage SET at = at - 90000 WHERE id = ?", t.body.grant);
  await call(app, "POST", "/api/events", { body: { brand: "sapphire", visit: "o1", events: [{ kind: "live_end", value: 1, grant: t.body.grant }] } });
  const seconds = (await db.get("SELECT seconds FROM usage WHERE id = ?", t.body.grant)).seconds;
  assert.ok(seconds >= 70 && seconds < 72, `${seconds}`);
});

// ===== 2. ceilings for a store's mirror ======================================================

test("a mirror that has spent its day's budget is refused, and the refusal costs and sends nothing", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db);
  const other = await pair(db);
  await spend(db, dev.id, 7.99);
  await spend(db, other.id, 100); // another mirror's day is its own
  await spend(db, dev.id, 500, { sample: 1 }); // the seeded sample is not real spend
  await spend(db, dev.id, 500, { ago: 1.2 * DAY }); // and yesterday is yesterday (only after the Pakistan midnight is it gone)

  const first = await shot(app, { headers: dev.header });
  assert.equal(first.status, 200, "just under the budget");
  const usageBefore = await count(db, "usage");
  const calls = outbound.length;

  const second = await shot(app, { headers: dev.header });
  assert.equal(second.status, 429);
  assert.deepEqual(second.body, { error: "This mirror has done its try-ons for today. The stylist still works.", limit: "mirror-day" });
  const token = await call(app, "POST", "/api/token", { body: { brand: "sapphire" }, headers: dev.header });
  assert.equal(token.status, 429);
  assert.equal(token.body.limit, "mirror-day");
  assert.equal(await count(db, "usage"), usageBefore, "a refusal is never metered");
  assert.equal(outbound.length, calls, "and nothing went to the engine");
  assert.equal((await shot(app, { headers: other.header })).status, 429, "the other mirror is over too, by its own spending");
  const fresh = await pair(db);
  assert.equal((await shot(app, { headers: fresh.header })).status, 200, "a mirror with a clean day is untouched");
});

test("the daily budget is the store's to set, and a damaged setting falls back to $8", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db);
  await plan(db, "sapphire", "studio", 1, "pilot", { mirrorDailyUsd: 2 });
  await spend(db, dev.id, 1.99);
  assert.equal((await app.platform.grant(dev.who, "portrait")).ok, true);
  await spend(db, dev.id, 0.01);
  const refused = await app.platform.grant(dev.who, "portrait");
  assert.equal(refused.ok, false);
  assert.equal(refused.limit, "mirror-day");
  await setSettings(db, "sapphire", { mirrorDailyUsd: "not a number" });
  assert.equal((await app.platform.grant(dev.who, "portrait")).ok, true, "a damaged setting falls back to the default of $8");
  await setSettings(db, "sapphire", { mirrorDailyUsd: 3 });
  assert.equal((await app.platform.grant(dev.who, "portrait")).ok, true, "$2 of $3 is spent");
  await setSettings(db, "sapphire", { mirrorDailyUsd: 2 });
  assert.equal((await app.platform.grant(dev.who, "portrait")).limit, "mirror-day");
  // Staff and an open mirror have no mirror to hold to a day.
  assert.equal((await app.platform.grant({ kind: "staff", user: { id: "s1" } }, "live")).ok, true);
  assert.equal((await app.platform.grant({ kind: "open" }, "live")).ok, true);
});

test("a live look is shortened to what the day has left, and refused if that is not worth starting", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db);
  await spend(db, dev.id, 7); // $1 left: fifty seconds
  const t = await call(app, "POST", "/api/token", { body: { brand: "sapphire" }, headers: dev.header });
  assert.equal(t.status, 200);
  assert.equal(t.body.seconds, 50);
  const row = await db.get("SELECT seconds, usd FROM usage WHERE id = ?", t.body.grant);
  assert.equal(row.seconds, 50);
  assert.ok(Math.abs(row.usd - 1) < 1e-9, "the reservation is what the day had left");
  const next = await call(app, "POST", "/api/token", { body: { brand: "sapphire" }, headers: dev.header });
  assert.equal(next.status, 429, "the day is spent");

  const tight = await pair(db);
  await spend(db, tight.id, 7.8); // 20 cents is ten seconds: not a look
  const small = await call(app, "POST", "/api/token", { body: { brand: "sapphire" }, headers: tight.header });
  assert.equal(small.status, 429);
  assert.equal(small.body.limit, "mirror-day");
  const portrait = await shot(app, { headers: tight.header });
  assert.equal(portrait.status, 200, "a portrait still fits in what is left");
});

test("a store that has used its live minutes is refused live, with room for the minutes it has agreed to; portraits carry on", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db);
  const included = RETAIL_PLANS.studio.liveMinutes * 60; // 70 minutes
  await plan(db, "sapphire", "studio", 1, "pilot");
  const rm = await pair(db, "atelier"); // a mirror of a store with no plan on record

  // Sixteen seconds short of the plan, among a lot of things that are not this store's month.
  await liveUsed(db, dev.id, included - 16);
  await liveUsed(db, dev.id, 5000, { sample: 1 }); // seeded sample
  await liveUsed(db, null, 5000); // members at home: no mirror
  await liveUsed(db, dev.id, 5000, { ago: 40 * DAY }); // an earlier month
  await liveUsed(db, rm.id, 5000, { brandId: "atelier" }); // another store's mirror
  await portraitsUsed(db, dev.id, 50); // portraits are not live minutes
  const last = await app.platform.grant(dev.who, "live");
  assert.deepEqual([last.ok, last.seconds], [true, 16], "the look may run only as long as the month has left");

  await liveUsed(db, dev.id, 2);
  const refused = await app.platform.grant(dev.who, "live");
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 429);
  assert.deepEqual({ error: refused.error, limit: refused.limit }, { error: "This store has used its live minutes for the month. Here is a portrait instead.", limit: "store-live" });
  const usage = await count(db, "usage");
  const route = await call(app, "POST", "/api/token", { body: { brand: "sapphire" }, headers: dev.header });
  assert.deepEqual([route.status, route.body.limit], [429, "store-live"]);
  assert.equal(await count(db, "usage"), usage, "nothing metered");
  assert.equal(outbound.length, 0, "nothing sent to the engine");
  assert.equal((await app.platform.grant(dev.who, "portrait")).ok, true, "portraits carry on");

  // The store agrees to twenty more minutes.
  await setSettings(db, "sapphire", { extraLiveMinutes: 20 });
  assert.deepEqual([(await app.platform.grant(dev.who, "live")).ok, (await app.platform.grant(dev.who, "live")).seconds], [true, 180]);
  await liveUsed(db, dev.id, 20 * 60);
  assert.equal((await app.platform.grant(dev.who, "live")).limit, "store-live", "and those run out too");

  // A store with no plan on record is not held to a month; the other store's busy month is not its.
  await liveUsed(db, rm.id, 99999, { brandId: "atelier" });
  assert.equal((await app.platform.grant(rm.who, "live")).ok, true);
  // And staff and an open mirror are never held to it.
  assert.equal((await app.platform.grant({ kind: "staff", user: { id: "s1" } }, "live")).ok, true);
  assert.equal((await app.platform.grant({ kind: "open" }, "live")).ok, true);
});

test("an Assist store has no live Studio and is told where it is; its portraits are counted for every store it has", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db);
  const config = async () => (await call(app, "GET", "/api/config", { headers: dev.header })).body;
  assert.equal((await config()).studio, true, "no plan on record: nothing is held back");

  await plan(db, "sapphire", "assist", 1, "live");
  const live = await app.platform.grant(dev.who, "live");
  assert.deepEqual([live.ok, live.status, live.limit, live.error], [false, 402, "no-live", "Live Studio comes with a MIRVA mirror. Here is a portrait instead."]);
  assert.equal((await call(app, "POST", "/api/token", { body: { brand: "sapphire" }, headers: dev.header })).body.limit, "no-live");
  assert.equal((await config()).studio, false, "the mirror page is told, so it never has to ask");

  await portraitsUsed(db, dev.id, RETAIL_PLANS.assist.portraits - 1);
  await portraitsUsed(db, dev.id, 80, { kind: "backdrop" }); // a studio backdrop comes with its portrait
  await portraitsUsed(db, dev.id, 80, { sample: 1 });
  await portraitsUsed(db, dev.id, 80, { ago: 40 * DAY });
  assert.equal((await app.platform.grant(dev.who, "portrait")).ok, true, "599 of 600");
  await portraitsUsed(db, dev.id, 1);
  const full = await app.platform.grant(dev.who, "portrait");
  assert.deepEqual([full.status, full.limit, full.error], [429, "store-portraits", "This store has used its portraits for the month. The stylist still works."]);
  const route = await shot(app, { headers: dev.header });
  assert.deepEqual([route.status, route.body.limit], [429, "store-portraits"]);

  await plan(db, "sapphire", "assist", 2, "live");
  assert.equal((await app.platform.grant(dev.who, "portrait")).ok, true, "two stores, twice the portraits");
  await plan(db, "sapphire", "boutique", 1, "live");
  assert.equal((await app.platform.grant(dev.who, "live")).limit, "no-live", "a store signed as Boutique is on Results, which has no mirror");

  // A mirror plan has live Studio, and two stores have twice the minutes.
  await plan(db, "sapphire", "flagship", 1, "live");
  assert.equal((await config()).studio, true);
  await liveUsed(db, dev.id, RETAIL_PLANS.flagship.liveMinutes * 60);
  assert.equal((await app.platform.grant(dev.who, "live")).limit, "store-live");
  await plan(db, "sapphire", "flagship", 2, "live");
  assert.equal((await app.platform.grant(dev.who, "live")).ok, true);
});

test("one mirror may start forty try-ons in an hour, and a refusal for any other reason does not use one up", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db);
  const other = await pair(db);
  await spend(db, dev.id, 8); // over its day: every ask is refused
  for (let i = 0; i < 100; i++) assert.equal((await app.platform.grant(dev.who, "portrait")).limit, "mirror-day");
  await db.run("DELETE FROM usage");
  for (let i = 0; i < MIRROR.perHour; i++) assert.equal((await app.platform.grant(dev.who, "portrait")).ok, true, `try-on ${i + 1}`);
  const refused = await app.platform.grant(dev.who, "portrait");
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 429);
  assert.equal(refused.limit, "mirror-hour");
  assert.match(refused.error, /busy this hour.*stylist still works/);
  assert.equal((await app.platform.grant(other.who, "live")).ok, true, "another mirror has its own hour");
  const route = await shot(app, { headers: dev.header });
  assert.deepEqual([route.status, route.body.limit], [429, "mirror-hour"]);
  assert.equal(await count(db, "usage"), 0, "refusals are never metered");
});

test("a mirror's try-ons are its store's, whatever store the page was showing", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db, "sapphire");
  const t = await call(app, "POST", "/api/token", { body: { brand: "atelier" }, headers: dev.header });
  assert.equal(t.status, 200);
  assert.equal((await shot(app, { headers: dev.header, fields: { brand: "atelier" } })).status, 200);
  assert.deepEqual((await rows(db, "SELECT DISTINCT brand FROM usage")).map((r) => r.brand), ["sapphire"]);
  await call(app, "POST", "/api/events", { body: { brand: "atelier", visit: "x", events: [{ kind: "portrait" }] }, headers: dev.header });
  assert.deepEqual((await rows(db, "SELECT brand FROM events")).map((r) => r.brand), ["sapphire"], "events from a paired mirror are filed under its store");
  const open = await makeApp({ openMirror: true });
  await call(open.app, "POST", "/api/events", { body: { brand: "atelier", visit: "y", events: [{ kind: "visit" }] } });
  assert.equal((await open.db.get("SELECT brand FROM events")).brand, "atelier", "an open mirror still says which store it shows");
});

// ===== 3. what the mirror page is told ======================================================

test("a paired mirror is told how a visit is shaped; everyone else gets the config as it was, with no visit", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db);
  const plain = await call(app, "GET", "/api/config");
  assert.equal(plain.status, 200);
  assert.equal(plain.body.visit, null);
  assert.equal(plain.body.idleSeconds, 75);
  assert.deepEqual(Object.keys(plain.body).sort(), ["idleSeconds", "live", "model", "open", "ratePerSecond", "sessionSeconds", "shotPrice", "usdToPkr", "visit"]);

  const mine = await call(app, "GET", "/api/config", { headers: dev.header });
  assert.deepEqual(mine.body.visit, { liveLooks: 4, liveSeconds: 240, portraits: 8, resetSeconds: 60 });
  assert.equal(mine.body.idleSeconds, 45);
  assert.equal(mine.body.sessionSeconds, 180);
  assert.equal(mine.body.live, true);

  // A store can shape its own, within sense.
  await plan(db, "sapphire", "studio", 1, "pilot", { visit: { liveLooks: 2, liveSeconds: 99999, portraits: "lots", resetSeconds: 5, idleSeconds: 30 } });
  const own = await call(app, "GET", "/api/config", { headers: dev.header });
  assert.deepEqual(own.body.visit, { liveLooks: 2, liveSeconds: 900, portraits: 8, resetSeconds: 10 });
  assert.equal(own.body.idleSeconds, 30);
  await setSettings(db, "sapphire", { visit: "nonsense" });
  assert.deepEqual((await call(app, "GET", "/api/config", { headers: dev.header })).body.visit, { liveLooks: 4, liveSeconds: 240, portraits: 8, resetSeconds: 60 });

  // A wrong token, a shopper and a signed-in desk are not a store mirror.
  assert.equal((await call(app, "GET", "/api/config", { headers: { "x-mirva-device": `${dev.id}.wrong` } })).body.visit, null);
  const staff = await signIn(app, db, "retailer", "sapphire");
  assert.equal((await call(app, "GET", "/api/config", { headers: staff.headers })).body.visit, null);
  const joined = await call(app, "POST", "/api/auth/join", { body: { name: "A Shopper", email: "shopper@example.com", password: "a long enough phrase", agree: true } });
  const cookie = joined.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  assert.equal((await call(app, "GET", "/api/config", { headers: { cookie, ...dev.header } })).body.visit, null);
});

test("a shorter idle wait never lengthens a short one", async () => {
  const { app, db } = await makeApp({ config: { live: true, model: "test", sessionSeconds: 180, idleSeconds: 30, ratePerSecond: 0.02, shotPrice: 0.02, usdToPkr: 277 } });
  const dev = await pair(db);
  assert.equal((await call(app, "GET", "/api/config", { headers: dev.header })).body.idleSeconds, 30);
});

// ===== 4. the store's Limits =================================================================

test("a store reads and sets its limits; a retailer is held to its own store and to sensible bounds", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db, "sapphire", "Front mirror");
  const boss = await signIn(app, db, "founder");
  const shop = await signIn(app, db, "retailer", "sapphire");
  const limits = (who, brandId = "sapphire") => call(app, "GET", `/api/console/limits?brand=${brandId}`, { headers: who.headers });
  const save = (who, body) => call(app, "POST", "/api/console/limits", { body, headers: who.headers });

  const first = (await limits(shop)).body;
  assert.equal(first.mirrorDailyUsd, 8);
  assert.equal(first.mirrorDailyPkr, 2216);
  assert.equal(first.extraLiveMinutes, 0);
  assert.deepEqual([first.liveMinutePkr, first.liveBlockMinutes, first.extraLiveMax], [600, 20, 600]);
  assert.equal(first.month, null, "no plan on record, no month to count against");
  assert.deepEqual([first.minDailyUsd, first.maxDailyUsd], [1, 20]);
  assert.deepEqual(first.mirrors.map((m) => [m.name, m.spentUsd, m.hit]), [["Front mirror", 0, false]]);
  assert.equal((await limits(boss)).body.maxDailyUsd, 200);

  await spend(db, dev.id, 3.5);
  const saved = await save(shop, { brand: "sapphire", mirrorDailyUsd: "12.5", extraLiveMinutes: 40 });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual([saved.body.mirrorDailyUsd, saved.body.mirrorDailyPkr, saved.body.extraLiveMinutes], [12.5, 3463, 40]);
  assert.deepEqual(saved.body.mirrors.map((m) => m.spentUsd), [3.5]);
  assert.equal(saved.body.plan.status, "demo", "a store with no plan gets the placeholder a hidden piece makes");
  assert.equal((await limits(boss)).body.mirrorDailyUsd, 12.5, "the founder sees the same");
  assert.equal(JSON.parse((await db.get("SELECT settings FROM retailers WHERE brand = 'sapphire'")).settings).extraLiveMinutes, 40);

  // One setting at a time leaves the other alone.
  assert.equal((await save(shop, { brand: "sapphire", mirrorDailyUsd: 9 })).body.extraLiveMinutes, 40);
  assert.equal((await save(shop, { brand: "sapphire", extraLiveMinutes: 0 })).body.mirrorDailyUsd, 9);

  // Bounds: a store may not give itself a bigger day than $20, the founder may.
  for (const bad of [0.99, 20.01, 1000, "abc", "", true, null, [8], { n: 8 }, -3])
    assert.equal((await save(shop, { brand: "sapphire", mirrorDailyUsd: bad })).status, 400, `daily ${JSON.stringify(bad)}`);
  for (const bad of [-20, 10, 30, 620, 1.5, "x", "", true, null, [20]]) assert.equal((await save(shop, { brand: "sapphire", extraLiveMinutes: bad })).status, 400, `extra live ${JSON.stringify(bad)}`);
  assert.match((await save(shop, { brand: "sapphire", extraLiveMinutes: 30 })).body.error, /blocks of 20, from 0 to 600/);
  assert.match((await save(shop, { brand: "sapphire", mirrorDailyUsd: 50 })).body.error, /between \$1 and \$20/);
  assert.equal((await save(shop, { brand: "sapphire" })).status, 400);
  assert.equal((await limits(shop)).body.mirrorDailyUsd, 9, "refusals changed nothing for the store");
  assert.equal((await save(boss, { brand: "sapphire", mirrorDailyUsd: 50 })).status, 200);
  assert.equal((await save(boss, { brand: "sapphire", mirrorDailyUsd: 201 })).status, 400);
  assert.equal((await limits(shop)).body.mirrorDailyUsd, 50);

  // Another store's settings are out of reach. A retailer's own store is whatever they ask for.
  await save(shop, { brand: "atelier", mirrorDailyUsd: 15 });
  assert.equal((await limits(boss, "atelier")).body.mirrorDailyUsd, 8, "atelier is untouched");
  assert.equal((await limits(shop, "atelier")).body.brand, "sapphire");
  assert.equal((await limits(boss, "no-such-store")).status, 404);

  // It is audited, with who and what.
  const trail = await rows(db, "SELECT actor, action, target FROM audit WHERE action = 'limits-changed' ORDER BY id");
  assert.ok(trail.length >= 4);
  assert.deepEqual({ ...trail[0] }, { actor: shop.id, action: "limits-changed", target: "sapphire daily=12.5 extra-live=40" });

  // The new budget is the one a mirror is held to.
  await save(boss, { brand: "sapphire", mirrorDailyUsd: 3.5 });
  assert.equal((await app.platform.grant(dev.who, "portrait")).limit, "mirror-day");

  // Closed to people who are not staff.
  assert.equal((await call(app, "GET", "/api/console/limits")).status, 401);
  assert.equal((await call(app, "POST", "/api/console/limits", { body: { mirrorDailyUsd: 5 } })).status, 401);
  const joined = await call(app, "POST", "/api/auth/join", { body: { name: "A Shopper", email: "limits-shopper@example.com", password: "a long enough phrase", agree: true } });
  const cookie = joined.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  assert.equal((await call(app, "GET", "/api/console/limits", { headers: { cookie } })).status, 403);
  assert.equal((await call(app, "POST", "/api/console/limits", { body: { mirrorDailyUsd: 5 }, headers: { cookie } })).status, 403);
});

test("the overview shows the month: live minutes and portraits used, what the plan includes, how far past it, and what that bills", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db);
  const shop = await signIn(app, db, "retailer", "sapphire");
  const overview = async () => (await call(app, "GET", "/api/console/overview", { headers: shop.headers })).body.plan;
  assert.equal(await overview(), null, "no plan, nothing to count against");

  await plan(db, "sapphire", "assist", 2, "live");
  await portraitsUsed(db, dev.id, 10);
  await portraitsUsed(db, dev.id, 30, { sample: 1 });
  let p = await overview();
  assert.deepEqual([p.id, p.name, p.monthly, p.mirrors], ["assist", "Assist", 50000, 0]);
  assert.deepEqual(p.portraits, { used: 10, included: 1200, stopped: false });
  assert.deepEqual([p.live.included, p.live.usedMinutes, p.live.stopped], [0, 0, true], "Assist has no live Studio to use");

  await plan(db, "sapphire", "studio", 1, "live");
  await liveUsed(db, dev.id, 75 * 60);
  p = await overview();
  assert.deepEqual(p.live, { usedMinutes: 75, included: 70, extra: 0, limit: 70, over: 5, overPkr: 3000, stopped: true });
  assert.equal(p.minutePkr, 600);
  await setSettings(db, "sapphire", { extraLiveMinutes: 20 });
  p = await overview();
  assert.deepEqual([p.live.extra, p.live.limit, p.live.stopped, p.monthly, p.id], [20, 90, false, 95000, "studio"]);
  await liveUsed(db, dev.id, 7); // a part of a minute is a tenth more on the gauge and a whole minute on the bill
  assert.deepEqual([(await overview()).live.usedMinutes, (await overview()).live.over], [75.2, 6]);

  const stats = await call(app, "GET", "/api/console/limits", { headers: shop.headers });
  assert.deepEqual(stats.body.month.live, { usedMinutes: 75.2, included: 70, extra: 20, limit: 90, over: 6, overPkr: 3600, stopped: false });
  assert.deepEqual(stats.body.month.portraits, { used: 10, included: 2500, stopped: false });
});

// ===== 5. what the founder is told ============================================================

test("the founder is told about stores near or past their live minutes, with what to bill", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db);
  const boss = await signIn(app, db, "founder");
  const needs = async () => (await call(app, "GET", "/api/hq/overview", { headers: boss.headers })).body;
  assert.deepEqual((await needs()).needs, [], "a quiet system has nothing for the founder");

  await plan(db, "sapphire", "studio", 1, "pilot"); // 70 live minutes
  await liveUsed(db, dev.id, 55 * 60 + 54);
  assert.deepEqual((await needs()).needs, [], "55.9 of 70 is not yet");

  await liveUsed(db, dev.id, 6);
  let o = await needs();
  assert.deepEqual(o.needs.map((n) => n.kind), ["store-near"]);
  assert.match(o.needs[0].text, /Sapphire has used 56 of its 70 live minutes this month \(80%\)\./);
  assert.deepEqual(o.retailers[0].month.live, { usedMinutes: 56, included: 70, extra: 0, limit: 70, over: 0, overPkr: 0, stopped: false });
  assert.deepEqual([o.retailers[0].plan, o.retailers[0].planName], ["studio", "Mirror"]);

  await liveUsed(db, dev.id, 14 * 60);
  o = await needs();
  assert.deepEqual(o.needs.map((n) => n.kind), ["store-near"]);
  assert.match(o.needs[0].text, /70 of its 70.*Live Studio has stopped there until the 1st/, "at the plan's minutes with none agreed, live has stopped");

  await setSettings(db, "sapphire", { extraLiveMinutes: 40 });
  await liveUsed(db, dev.id, 10 * 60);
  o = await needs();
  assert.deepEqual(o.needs.map((n) => n.kind), ["store-over"]);
  assert.equal(o.needs[0].over, 10);
  assert.equal(o.needs[0].pkr, 6000);
  assert.match(o.needs[0].text, /Sapphire is past its plan: 80 live minutes this month against 70 included\. That is 10 live minutes to bill, Rs\.6,000 at Rs\.600 each\. It has agreed to 40 extra, so about 30 more can run\./);

  await setSettings(db, "sapphire", { extraLiveMinutes: 0 });
  assert.match((await needs()).needs[0].text, /Live Studio has stopped there until the 1st; portraits carry on\./);

  // Only paired mirrors count: the seeded sample and members at home do not push a store over. A plan with no live has nothing to be near.
  const quiet = await makeApp();
  const qd = await pair(quiet.db);
  const qboss = await signIn(quiet.app, quiet.db, "founder");
  await plan(quiet.db, "sapphire", "studio", 1, "pilot");
  await liveUsed(quiet.db, qd.id, 99999, { sample: 1 });
  await liveUsed(quiet.db, null, 99999);
  assert.deepEqual((await call(quiet.app, "GET", "/api/hq/overview", { headers: qboss.headers })).body.needs, []);
  await plan(quiet.db, "sapphire", "assist", 1, "pilot");
  await portraitsUsed(quiet.db, qd.id, 590);
  assert.deepEqual((await call(quiet.app, "GET", "/api/hq/overview", { headers: qboss.headers })).body.needs, []);
});

test("the founder is told which mirror has used its day's budget", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db, "sapphire", "Window mirror");
  const boss = await signIn(app, db, "founder");
  const needs = async () => (await call(app, "GET", "/api/hq/overview", { headers: boss.headers })).body.needs;
  const usual = (usd) => Promise.all(Array.from({ length: 7 }, (_, i) => spend(db, null, usd, { ago: Date.now() - (pktDayStart() - (i + 1) * DAY + 3600e3) }))); // so today is an ordinary day

  await usual(8);
  await spend(db, dev.id, 7.9);
  assert.deepEqual(await needs(), [], "$7.90 of $8 is not yet");
  await spend(db, dev.id, 0.1);
  const list = await needs();
  assert.deepEqual(list.map((n) => n.kind), ["mirror-day"]);
  assert.equal(list[0].device, dev.id);
  assert.equal(list[0].text, "Window mirror at Sapphire has used its try-on budget for today ($8.00 of $8). It rests until midnight, Pakistan time.");
  await plan(db, "sapphire", "studio", 1, "pilot", { mirrorDailyUsd: 20 });
  assert.deepEqual(await needs(), [], "the store's own budget is the one that counts");
  await setSettings(db, "sapphire", { mirrorDailyUsd: 8 });
  await db.run("DELETE FROM devices WHERE id = ?", dev.id);
  assert.deepEqual(await needs(), [], "a mirror that has been removed is not reported");
});

test("a day's spend is flagged when it is over $3 and more than twice the week before", async () => {
  const { app, db } = await makeApp();
  const boss = await signIn(app, db, "founder");
  const read = async () => (await call(app, "GET", "/api/hq/overview", { headers: boss.headers })).body.needs.filter((n) => n.kind === "spend");
  const earlier = (days, usd, sample = 0) => spend(db, null, usd, { ago: Date.now() - (pktDayStart() - days * DAY + 3600e3), sample });
  for (let i = 1; i <= 7; i++) await earlier(i, 1); // a dollar a day for a week
  await earlier(1, 500, 1); // sample spending is never real

  await spend(db, null, 3);
  assert.deepEqual(await read(), [], "exactly $3 is not above $3");
  await spend(db, null, 0.5); // $3.50 against a usual $1
  let spike = await read();
  assert.equal(spike.length, 1);
  assert.equal(spike[0].day, "today");
  assert.match(spike[0].text, /Try-on spend today is \$3\.50 \(Rs\.970\), more than twice the usual \$1\.00 a day over the week before\./);

  // Not more than twice: a week at $5 makes a $9 day ordinary.
  const busy = await makeApp();
  const boss2 = await signIn(busy.app, busy.db, "founder");
  for (let i = 1; i <= 7; i++) await busy.db.run("INSERT INTO usage (at, kind, brand, device, user, seconds, usd, sample) VALUES (?,?,?,?,?,?,?,?)", pktDayStart() - i * DAY + 3600e3, "live", "sapphire", null, null, 250, 5, 0);
  await busy.db.run("INSERT INTO usage (at, kind, brand, device, user, seconds, usd, sample) VALUES (?,?,?,?,?,?,?,?)", Date.now(), "live", "sapphire", null, null, 450, 9, 0);
  assert.deepEqual((await call(busy.app, "GET", "/api/hq/overview", { headers: boss2.headers })).body.needs, []);
  await busy.db.run("INSERT INTO usage (at, kind, brand, device, user, seconds, usd, sample) VALUES (?,?,?,?,?,?,?,?)", Date.now(), "live", "sapphire", null, null, 50, 1.5, 0);
  const now = (await call(busy.app, "GET", "/api/hq/overview", { headers: boss2.headers })).body.needs;
  assert.deepEqual(now.map((n) => n.day), ["today"], "$10.50 is more than twice $5");

  // With no week behind it, a day over $3 is still worth saying, in plain words.
  const fresh = await makeApp();
  const boss3 = await signIn(fresh.app, fresh.db, "founder");
  await spend(fresh.db, null, 3.5);
  const first = (await call(fresh.app, "GET", "/api/hq/overview", { headers: boss3.headers })).body.needs;
  assert.equal(first[0].text, "Try-on spend today is $3.50 (Rs.970), and the week before had almost none.");
});

test("only the founder reads what needs them", async () => {
  const { app, db } = await makeApp();
  const shop = await signIn(app, db, "retailer", "sapphire");
  assert.equal((await call(app, "GET", "/api/hq/overview", { headers: shop.headers })).status, 403);
});

// ===== 6. out of credit is noticed =============================================================

test("an account out of credit is rested, recorded, told to the founder once a day, and shown first until a try-on works", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db);
  const boss = await signIn(app, db, "founder");
  const hq = async () => (await call(app, "GET", "/api/hq/overview", { headers: boss.headers })).body;
  const letters = () => rows(db, "SELECT * FROM outbox WHERE subject = 'The try-on account is out of credit'");
  assert.equal((await hq()).needs.length, 0);

  engine.image = () => new Response('{"detail":"Payment required"}', { status: 402 });
  const a = await shot(app, { headers: dev.header });
  assert.equal(a.status, 503);
  assert.deepEqual(a.body, { error: "Try-on is resting just now. Please try again in a little while.", limit: "resting" });
  assert.equal(await count(db, "usage"), 0, "a failed call is not metered");
  const flag = await db.get("SELECT * FROM flags WHERE key = 'tryon-credit'");
  assert.equal(flag.value, "out");
  assert.equal((await letters()).length, 1);
  const letter = (await letters())[0];
  assert.equal(letter.channel, "founder");
  assert.equal(letter.sent, null);
  assert.match(letter.body, /no credit left/);

  // More shoppers meet it, by portrait and by live token: still one message, still no meter.
  engine.token = () => new Response("insufficient funds", { status: 402 });
  const t = await call(app, "POST", "/api/token", { body: { brand: "sapphire" }, headers: dev.header });
  assert.deepEqual([t.status, t.body.limit, t.body.busy], [503, "resting", undefined]);
  for (let i = 0; i < 3; i++) assert.equal((await shot(app, { headers: dev.header })).status, 503);
  assert.equal((await letters()).length, 1, "once a day, however many shoppers meet it");
  assert.equal(await count(db, "usage"), 0);
  assert.equal((await db.get("SELECT at FROM flags WHERE key = 'tryon-credit'")).at, flag.at, "it remembers when it first noticed");

  // On the founder's desk, first.
  await plan(db, "sapphire", "studio", 1, "pilot");
  await liveUsed(db, dev.id, 60 * 60); // and a store near its live minutes
  const needs = (await hq()).needs;
  assert.equal(needs[0].kind, "credit");
  assert.match(needs[0].text, /^The try-on account is out of credit\./);
  assert.deepEqual(needs.map((n) => n.kind), ["credit", "store-near"]);

  // The next day it is still out: another message. (The day is the Pakistan day.)
  await db.run("UPDATE flags SET value = '2000-01-01' WHERE key = 'tryon-credit-told'");
  await shot(app, { headers: dev.header });
  assert.equal((await letters()).length, 2);

  // The next try-on that works clears it.
  engine.image = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  assert.equal((await shot(app, { headers: dev.header })).status, 200);
  assert.equal(await db.get("SELECT 1 AS n FROM flags WHERE key = 'tryon-credit'"), undefined);
  assert.deepEqual((await hq()).needs.map((n) => n.kind), ["store-near"]);
  assert.equal(await count(db, "usage"), 2, "and that one was metered, beside the hour of live put there above");
});

test("an out-of-credit token is rested too, and a working token clears the flag", async () => {
  const { app, db } = await makeApp({ openMirror: true });
  engine.token = () => new Response('{"detail":"Out of credits"}', { status: 402 });
  const t = await call(app, "POST", "/api/token", { body: { brand: "sapphire" } });
  assert.deepEqual([t.status, t.body.limit], [503, "resting"]);
  assert.equal(await count(db, "usage"), 0);
  assert.equal((await db.get("SELECT value FROM flags WHERE key = 'tryon-credit'")).value, "out");
  engine.token = () => new Response(JSON.stringify({ apiKey: "ek_test", expiresAt: new Date(Date.now() + 60e3).toISOString() }), { status: 200, headers: { "content-type": "application/json" } });
  assert.equal((await call(app, "POST", "/api/token", { body: { brand: "sapphire" } })).status, 200);
  assert.equal(await db.get("SELECT 1 AS n FROM flags WHERE key = 'tryon-credit'"), undefined, "cleared");
  assert.equal(await count(db, "usage"), 1);
});

test("the engine's own words about credit, balance or quota count, a busy engine does not, and a plain refusal stays plain", async () => {
  const { app, db } = await makeApp({ openMirror: true });
  const ask = async (res) => {
    engine.image = () => res;
    return shot(app);
  };
  for (const res of [
    new Response('{"detail":"Insufficient credits"}', { status: 403 }),
    new Response("Your balance is too low", { status: 400 }),
    new Response('{"detail":"Quota exceeded for this account"}', { status: 429 }),
  ]) {
    const r = await ask(res);
    assert.deepEqual([r.status, r.body.limit], [503, "resting"]);
  }
  assert.equal(await count(db, "flags"), 2, "the credit flag and the day it was told");
  await db.run("DELETE FROM flags");
  await db.run("DELETE FROM outbox");

  const busy = await ask(new Response("no credit, said the gateway", { status: 504 }));
  assert.deepEqual([busy.status, busy.body.busy, busy.body.limit], [503, true, undefined], "a gateway timeout is busy, whatever its page says");
  const slow = await ask(new Response("slow down", { status: 429 }));
  assert.equal(slow.body.busy, true);
  const refused = await ask(new Response("nope", { status: 401 }));
  assert.equal(refused.status, 502);
  const bad = await ask(new Response("no", { status: 400 }));
  assert.equal(bad.status, 502);
  assert.equal(await count(db, "flags"), 0, "none of those is about credit");
  assert.equal(await count(db, "outbox"), 0);
  assert.equal(await count(db, "usage"), 0);
});

test("a database that has not been given the flags table yet still answers calmly", async () => {
  const { app, db } = await makeApp({ openMirror: true });
  const boss = await signIn(app, db, "founder");
  await db.run("DROP TABLE flags");
  engine.image = () => new Response("pay", { status: 402 });
  const r = await shot(app);
  assert.deepEqual([r.status, r.body.limit], [503, "resting"], "not a 500");
  engine.image = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  assert.equal((await shot(app)).status, 200, "and a try-on that works is not hurt by the missing table");
  const o = await call(app, "GET", "/api/hq/overview", { headers: boss.headers });
  assert.equal(o.status, 200);
  assert.deepEqual(o.body.needs, []);
});

// ===== the schema =============================================================================

test("the flags table is part of the schema, can be made twice, and uses plain SQLite that D1 also reads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mirva-safeguards-schema-"));
  dirs.push(dir);
  openDb(dir).close();
  const db = openDb(dir); // a second start over the same file
  assert.deepEqual((await db.all("PRAGMA table_info(flags)")).map((c) => [c.name, c.type, c.pk]), [["key", "TEXT", 1], ["value", "TEXT", 0], ["at", "INTEGER", 0]]);
  const { SCHEMA } = await import("../lib/schema.mjs");
  assert.match(SCHEMA, /CREATE TABLE IF NOT EXISTS flags \(\s*key TEXT PRIMARY KEY,\s*value TEXT,\s*at INTEGER\s*\);/);
  db.close();
});

test("the month and the day are the ones the plans and Pakistan keep", () => {
  const noon = Date.UTC(2026, 9, 9, 12, 0, 0); // 5 pm in Pakistan
  assert.equal(pktDayStart(noon), Date.UTC(2026, 9, 8, 19, 0, 0));
  assert.equal(pktDayStart(Date.UTC(2026, 9, 8, 19, 0, 0)), Date.UTC(2026, 9, 8, 19, 0, 0), "midnight in Pakistan is the start of its day");
  assert.equal(pktDayStart(Date.UTC(2026, 9, 8, 18, 59, 59)), Date.UTC(2026, 9, 7, 19, 0, 0));
  assert.equal(monthStart(noon), Date.UTC(2026, 9, 1));
});

// ===== 7. pieces shown in the store's own photographs only ====================================

test("a store can keep a piece to its own photographs: the mirror is told, and no look is made of it", async () => {
  const { app, db } = await makeApp({ openMirror: true });
  const shop = await signIn(app, db, "retailer", "sapphire");
  const set = (body, who = shop) => call(app, "POST", "/api/console/catalogue/try-on", { body, headers: who.headers });
  const pieces = async () => (await call(app, "GET", "/api/brands/sapphire")).body.catalogue.products;
  assert.equal((await pieces()).some((p) => p.photoOnly), false);

  const on = await set({ brand: "sapphire", product: product.id, photoOnly: true });
  assert.deepEqual([on.status, on.body.photoOnly], [200, [product.id]]);
  const marked = (await pieces()).filter((p) => p.photoOnly).map((p) => p.id);
  assert.deepEqual(marked, [product.id], "only that piece is marked, and it is still offered");
  assert.equal((await call(app, "GET", "/api/console/catalogue?brand=sapphire", { headers: shop.headers })).body.products.find((p) => p.id === product.id).photoOnly, true);

  const refused = await shot(app);
  assert.deepEqual([refused.status, refused.body.limit, refused.body.error], [403, "photo-only", "This piece is shown in the store's own photographs."]);
  assert.equal(outbound.length, 0, "nothing went to the engine");
  assert.equal(await count(db, "usage"), 0);
  assert.equal((await shot(app, { fields: { product: catalogue.products[1].id } })).status, 200, "other pieces are untouched");

  const off = await set({ brand: "sapphire", product: product.id, photoOnly: false });
  assert.deepEqual(off.body.photoOnly, []);
  assert.equal((await shot(app)).status, 200);

  assert.equal((await set({ brand: "sapphire", product: "no-such-piece", photoOnly: true })).status, 404);
  assert.equal((await call(app, "POST", "/api/console/catalogue/try-on", { body: { brand: "sapphire", product: product.id, photoOnly: true } })).status, 401, "not for a passer-by");
  const trail = await rows(db, "SELECT action, target FROM audit WHERE action LIKE 'piece-%' ORDER BY id");
  assert.deepEqual(trail.map((r) => r.action), ["piece-photo-only", "piece-try-on"]);
});

test("a shopper's yes to sending a picture is recorded as an event, with nothing about her", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db);
  const res = await call(app, "POST", "/api/events", { body: { brand: "sapphire", visit: "v1", events: [{ kind: "consent" }, { kind: "not-a-kind" }] }, headers: dev.header });
  assert.equal(res.status, 200);
  assert.deepEqual((await rows(db, "SELECT kind, user FROM events")).map((r) => [r.kind, r.user]), [["consent", null]]);
});

// ===== 8. proof: sales counted at the store, a pilot's target, a fee on results, a size chart =====

test("sales counted on the mirror's tablet reach the overview, a pilot's target and a Results fee", async () => {
  const { app, db } = await makeApp();
  const dev = await pair(db);
  const boss = await signIn(app, db, "founder");
  const shop = await signIn(app, db, "retailer", "sapphire");
  const send = (visit, events) => call(app, "POST", "/api/events", { body: { brand: "sapphire", visit, events }, headers: dev.header });
  const overview = async () => (await call(app, "GET", "/api/console/overview", { headers: shop.headers })).body;
  assert.deepEqual((await overview()).sales, { count: 0, pkr: 0, visits: 0, share: 0, byStaff: [] });
  assert.equal((await overview()).pilot, null);

  await plan(db, "sapphire", "results", 1, "pilot");
  await send("v1", [{ kind: "portrait" }, { kind: "sale", product: product.id, value: 30000, meta: "Bilal" }]);
  await send("v2", [{ kind: "portrait" }]);
  await send("v3", [{ kind: "live_start" }, { kind: "sale", value: 20000, meta: "Bilal" }, { kind: "sale", value: 10000 }]);
  await send("v4", [{ kind: "sale", value: 5000, meta: "Sana" }]); // bought without trying anything on
  let o = await overview();
  assert.deepEqual([o.sales.count, o.sales.pkr, o.sales.visits, Math.round(o.sales.share * 100)], [4, 65000, 2, 67], "two of the three try-on visits bought");
  assert.deepEqual(o.sales.byStaff, [{ name: "Bilal", n: 2, pkr: 50000 }, { name: "Not named", n: 1, pkr: 10000 }, { name: "Sana", n: 1, pkr: 5000 }]);
  assert.deepEqual(o.plan.share, { rate: 0.03, cap: 250000, counted: 65000, fee: 26950 }, "the base and 3% of what was counted");

  // A pilot counts from the moment it is set, against one target.
  const setPilot = (body, who = boss) => call(app, "POST", "/api/hq/retailers/pilot", { body, headers: who.headers });
  assert.equal((await setPilot({ brand: "sapphire", metric: "nonsense", target: 5 })).status, 400);
  assert.equal((await setPilot({ brand: "sapphire", metric: "sales", target: 0 })).status, 400);
  assert.equal((await setPilot({ brand: "atelier", metric: "sales", target: 5 })).status, 404, "a store with no plan has nothing to pilot");
  assert.equal((await setPilot({ brand: "sapphire", metric: "sales", target: 5 }, shop)).status, 403, "only the founder sets the target");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await setPilot({ brand: "sapphire", metric: "buy-share", target: 50, days: 60 })).status, 200);
  o = await overview();
  assert.deepEqual([o.pilot.metric, o.pilot.target, o.pilot.days, o.pilot.day, o.pilot.value, o.pilot.met, o.pilot.ended], ["buy-share", 50, 60, 1, 0, false, false], "what was counted before it began is not the pilot's");
  await send("v5", [{ kind: "portrait" }, { kind: "sale", value: 12000, meta: "Sana" }]);
  await send("v6", [{ kind: "portrait" }]);
  o = await overview();
  assert.deepEqual([o.pilot.value, o.pilot.met], [50, true]);
  assert.match(o.pilot.label, /try-on visits end in a sale/);
  assert.equal((await setPilot({ brand: "sapphire", clear: true })).body.pilot, null);
  assert.equal((await overview()).pilot, null);

  // The fee never passes the cap, however good the month.
  await send("v7", [{ kind: "sale", value: 50000000 }]);
  assert.equal((await overview()).plan.share.fee, 250000);
});

test("a store types its size chart and the mirror is given it; nonsense is refused and an empty box takes it away", async () => {
  const { app, db } = await makeApp({ openMirror: true });
  const shop = await signIn(app, db, "retailer", "sapphire");
  const save = (sizeChart) => call(app, "POST", "/api/console/brand", { body: { brand: "sapphire", sizeChart }, headers: shop.headers });
  const given = async () => (await call(app, "GET", "/api/brands/sapphire")).body.brand.sizeChart;
  const saved = await save("M, 38-40, 32-34\nS, 34-36");
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(await given(), [{ label: "S", chest: [34, 36], waist: null }, { label: "M", chest: [38, 40], waist: [32, 34] }]);
  assert.deepEqual((await call(app, "GET", "/api/console/catalogue?brand=sapphire", { headers: shop.headers })).body.brand.sizeChart.length, 2);
  const bad = await save("our sizes run large");
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /One size to a line/);
  assert.equal((await given()).length, 2, "a refused chart changes nothing");
  assert.equal((await save("")).status, 200);
  assert.deepEqual(await given(), []);
});
