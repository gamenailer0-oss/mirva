// The platform routes over real HTTP: members, wardrobes, boards, hand-offs, events, leads and the two desks.
// Two real servers run on throwaway data with no Decart key, so nothing here can spend money or touch the real database.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import http from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword, verifyPassword, passwordProblem } from "../lib/auth.mjs";
import { monthlyFee, tierOf, MEMBER_TIERS, RETAIL_PLANS } from "../lib/plans.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { products } = JSON.parse(readFileSync(join(ROOT, "brands/sapphire/catalogue.json"), "utf8"));
const sapphire = JSON.parse(readFileSync(join(ROOT, "brands/sapphire/brand.json"), "utf8"));
const [A, B, C] = products;

// --- two servers --------------------------------------------------------------
// `main` is a laptop-style server behind a trusted proxy header, so each test person can have their own address
// and the per-address throttles never bleed from one test into another. `closed` is a store-facing one: mirrors
// must be paired, and X-Forwarded-For is not believed.
const servers = [];
let main, closed;

async function startServer(port, env = {}) {
  const data = mkdtempSync(join(tmpdir(), "mirva-platform-test-"));
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      // Pin everything that changes how the server behaves, so a developer's shell or .env cannot.
      MIRVA_PUBLIC_ORIGIN: "", MIRVA_OPEN_MIRROR: "", MIRVA_PAYMENTS: "", MIRVA_FOUNDER_EMAIL: "", MIRVA_LISTEN: "", MIRVA_TRUST_PROXY: "",
      PORT: String(port), DECART_API_KEY: "", MIRVA_DATA: data, ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const server = { port, data, child, base: `http://localhost:${port}`, out: "", err: "" };
  servers.push(server);
  child.stderr.on("data", (d) => (server.err += d));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server on ${port} did not start`)), 20000);
    child.stdout.on("data", (d) => {
      server.out += d;
      if (String(d).includes("MIRVA is at")) (clearTimeout(timer), resolve());
    });
    child.on("exit", (code) => reject(new Error(`server on ${port} exited ${code}`)));
  });
  return server;
}

before(async () => {
  [main, closed] = await Promise.all([startServer(4397, { MIRVA_TRUST_PROXY: "1" }), startServer(4396, { MIRVA_OPEN_MIRROR: "0" })]);
});

after(async () => {
  for (const s of servers) {
    if (s.child.exitCode === null) {
      const gone = new Promise((resolve) => s.child.once("exit", resolve));
      s.child.kill();
      await gone;
    }
    // SQLite may still hold its files for a moment on Windows.
    try {
      rmSync(s.data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
  }
});

// --- a tiny browser -------------------------------------------------------------
let ipCounter = 0;
const freshIp = () => (ipCounter++, `10.${(ipCounter >> 8) + 1}.${ipCounter & 255}.7`);

// One person with their own cookie jar and their own address.
function visitor(ip = freshIp(), srv = main) {
  const jar = new Map();
  async function call(method, path, body, headers = {}) {
    const res = await fetch(srv.base + path, {
      method,
      headers: {
        "x-forwarded-for": ip,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookies = res.headers.getSetCookie();
    for (const line of cookies) {
      const pair = line.split(";")[0];
      const name = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);
      if (!value || /Max-Age=0/i.test(line)) jar.delete(name);
      else jar.set(name, value);
    }
    const isJson = (res.headers.get("content-type") || "").includes("json");
    return { status: res.status, headers: res.headers, cookies, body: isJson ? await res.json() : await res.text() };
  }
  return { ip, jar, get: (path, headers) => call("GET", path, undefined, headers), post: (path, body = {}, headers) => call("POST", path, body, headers) };
}

// fetch() will not let a caller set Origin, so the hostile cases use a raw request.
const raw = (path, { method = "GET", headers = {}, body, srv = main } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: srv.port, path, method, headers: { host: `localhost:${srv.port}`, ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });

const PASSWORD = "a long enough phrase";
let counter = 0;
const mailFor = (label) => `${label}-${++counter}@example.com`;
const err = (r, status, pattern) => {
  assert.equal(r.status, status, JSON.stringify(r.body));
  if (pattern) assert.match(r.body.error, pattern);
};

// A signed-in member with their own address.
async function member(label = "member", extra = {}) {
  const c = visitor();
  const email = mailFor(label);
  const name = label[0].toUpperCase() + label.slice(1) + " Tester";
  const r = await c.post("/api/auth/join", { name, email, password: PASSWORD, agree: true, ...extra });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return Object.assign(c, { email, name, id: r.body.user.id });
}

async function signInFounder(srv) {
  const file = readFileSync(join(srv.data, "first-run.txt"), "utf8");
  const email = file.match(/^email:\s+(\S+)/m)?.[1];
  const password = file.match(/^password:\s+(\S+)/m)?.[1];
  assert.ok(email && password, "first-run.txt names the founder's sign-in");
  const desk = visitor(undefined, srv);
  assert.equal((await desk.post("/api/auth/signin", { email, password })).status, 200);
  return desk;
}
let founderDesk;
const founder = () => (founderDesk ||= signInFounder(main));

const addLook = async (c, product, size) => (await c.post("/api/wardrobe", { brand: "sapphire", product: product.id, size })).body.look;
const SHORT_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]+$/; // the readable alphabet: no 0, O, 1, I or L
const lead = (extra = {}) => ({ name: "Sana Malik", company: `Atelier ${++counter}`, email: mailFor("lead"), ...extra });

// --- no server: the building blocks -----------------------------------------------
test("passwords are salted, and only the right one verifies", async () => {
  const hash = await hashPassword("correct horse battery");
  assert.match(hash, /^s1\$\d+\$[\w-]+\$[\w-]+$/);
  assert.ok(!hash.includes("correct horse"));
  assert.notEqual(hash, await hashPassword("correct horse battery"), "a new salt every time");
  assert.equal(await verifyPassword("correct horse battery", hash), true);
  for (const wrong of ["correct horse batterz", "Correct horse battery", "correct horse battery ", ""]) assert.equal(await verifyPassword(wrong, hash), false, JSON.stringify(wrong));
});

test("the same password typed in a different Unicode form still verifies", async () => {
  const hash = await hashPassword("éclair-secret");
  assert.equal(await verifyPassword("éclair-secret", hash), true);
});

test("a stored hash that is missing or damaged never verifies", async () => {
  for (const bad of [undefined, null, "", "plain text", "s1$$$", "s2$32768$AAAA$BBBB", "s1$32768$AAAA$"]) assert.equal(await verifyPassword("anything", bad), false, String(bad));
});

test("password rules ask for length, not symbols", () => {
  for (const short of ["short", "123456789", "", undefined, null]) assert.match(passwordProblem(short), /ten characters/, String(short));
  assert.equal(passwordProblem("abcdefghij"), "", "ten is enough");
  assert.equal(passwordProblem("only lowercase words are fine"), "");
  assert.equal(passwordProblem("x".repeat(200)), "");
  assert.match(passwordProblem("x".repeat(201)), /too long/);
  for (const famous of ["password123", "Password123", "QWERTYUIOP", "1234567890"]) assert.match(passwordProblem(famous), /too easy/, famous);
  assert.match(passwordProblem("Ayesha@Example.com", "ayesha@example.com"), /email/);
  assert.equal(passwordProblem("Ayesha@Example.com", "someone@else.com"), "");
});

test("a retailer's monthly fee follows the plan, with a lower rate from the tenth Assist store", () => {
  assert.equal(monthlyFee("assist", 12), 9 * 25000 + 3 * 20000);
  assert.equal(monthlyFee("assist", 1), 25000);
  assert.equal(monthlyFee("assist", 9), 9 * 25000);
  assert.equal(monthlyFee("assist", 10), 9 * 25000 + 20000);
  assert.equal(monthlyFee("studio", 2), 190000);
  assert.equal(monthlyFee("studio", 12), 12 * 95000, "only Assist has a volume rate");
  assert.equal(monthlyFee("flagship", 2), 390000);
  assert.equal(monthlyFee("results", 3), 75000, "the base; the share is billed from counted sales");
  assert.equal(monthlyFee("boutique", 1), 25000, "a store signed as Boutique is read as Results");
  assert.equal(monthlyFee("studio"), 95000, "one store unless told otherwise");
  assert.equal(monthlyFee("studio", 0), 95000, "never fewer than one store");
  assert.equal(monthlyFee("nope", 3), 0);
});

test("a member is on the free tier unless Private is current", () => {
  assert.equal(tierOf(null).id, "member");
  assert.equal(tierOf({ tier: "member" }).id, "member");
  assert.equal(tierOf({ tier: "private", tier_until: Date.now() + 60e3 }).id, "private");
  assert.equal(tierOf({ tier: "private" }).id, "private", "no end date means no end");
  assert.equal(tierOf({ tier: "private", tier_until: Date.now() - 1 }).id, "member", "a lapsed year is back to free");
});

// --- accounts -----------------------------------------------------------------
test("the price list is public", async () => {
  const r = await visitor().get("/api/plans");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.retail, JSON.parse(JSON.stringify(RETAIL_PLANS)));
  assert.equal(r.body.tiers.member.price, 0);
  assert.equal(r.body.payments, "test");
});

test("joining makes a member, signs them in, and never returns the password or its hash", async () => {
  const c = visitor();
  const email = mailFor("Ayesha");
  const r = await c.post("/api/auth/join", { name: "Ayesha Khan", email, password: PASSWORD, agree: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { user } = r.body;
  assert.equal(user.email, email.toLowerCase(), "emails are stored lower-case");
  assert.equal(user.name, "Ayesha Khan");
  assert.equal(user.role, "member");
  assert.equal(user.tier, "member");
  for (const key of ["pass", "password", "hash"]) assert.ok(!(key in user), key);
  const wire = JSON.stringify(r.body);
  assert.ok(!wire.includes(PASSWORD) && !wire.includes("s1$"), "no password or hash in the reply");

  const cookie = r.cookies.find((line) => line.startsWith("mirva_sid="));
  assert.ok(cookie, "a session cookie is set");
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Lax/);
  assert.match(cookie, /; Path=\//);
  assert.match(cookie, /; Max-Age=\d+/);
  assert.doesNotMatch(cookie, /Secure/, "this is plain http on a laptop");
  assert.ok(cookie.split(";")[0].length > 40, "an unguessable token");

  const me = await c.get("/api/me");
  assert.equal(me.body.user.id, user.id);
  const wireMe = JSON.stringify(me.body);
  assert.ok(!wireMe.includes(PASSWORD) && !wireMe.includes("s1$"));
});

test("joining is refused for a short password, a bad email, a missing agreement or a taken email", async () => {
  // Every attempt comes from its own address: joining is limited to a few accounts an hour from one place.
  const attempt = (body) => visitor().post("/api/auth/join", body);
  const good = { name: "Hira Shah", email: mailFor("hira"), password: PASSWORD, agree: true };
  const refusals = [
    [{ password: "only9char" }, /ten characters/],
    [{ password: "password123" }, /easy to guess/],
    [{ password: good.email }, /email/],
    [{ email: "not-an-email" }, /email/],
    [{ email: "a@b" }, /email/],
    [{ email: "" }, /email/],
    [{ agree: undefined }, /agree/],
    [{ agree: false }, /agree/],
    [{ agree: "yes" }, /agree/],
    [{ name: "H" }, /name/],
  ];
  for (const [patch, pattern] of refusals) {
    const r = await attempt({ ...good, ...patch });
    err(r, 400, pattern);
    assert.equal(r.cookies.length, 0, `no session for ${JSON.stringify(patch)}`);
  }
  assert.equal((await attempt({ ...good, password: "x".repeat(201) })).status, 400);
  // None of the refusals left an account behind: the same details still join.
  assert.equal((await attempt(good)).status, 200);
  err(await attempt(good), 409, /already an account/);
  err(await attempt({ ...good, email: good.email.toUpperCase() }), 409);
});

test("a broken body or a body that is not an object is a plain refusal, not a crash", async () => {
  const c = visitor();
  const r = await fetch(main.base + "/api/auth/join", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": freshIp() }, body: "{not json" });
  assert.equal(r.status, 400);
  assert.equal((await fetch(main.base + "/api/auth/join", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": freshIp() }, body: "[1,2,3]" })).status, 400);
  assert.equal((await c.get("/api/health")).status, 200);
});

test("/api/me is empty when signed out, and shows the member, their tier and usage when signed in", async () => {
  assert.deepEqual((await visitor().get("/api/me")).body, { user: null });
  assert.deepEqual((await visitor().get("/api/me", { cookie: "mirva_sid=not-a-real-session" })).body, { user: null });
  assert.deepEqual((await visitor().get("/api/me", { cookie: "mirva_sid=" + "x".repeat(500) })).body, { user: null });

  const m = await member("noor");
  const me = (await m.get("/api/me")).body;
  assert.equal(me.user.id, m.id);
  assert.equal(me.user.email, m.email);
  assert.equal(me.user.tier, "member");
  assert.equal(me.tier.id, "member");
  assert.equal(me.tier.portraitsPerMonth, MEMBER_TIERS.member.portraitsPerMonth);
  assert.deepEqual(me.usage, { portraits: 0, liveSeconds: 0 });
  assert.equal(me.looks, 0);
  assert.equal(me.invite, null);
  assert.equal(me.payments, "test");
});

test("answers about people are never cached", async () => {
  const r = await visitor().get("/api/me");
  assert.match(r.headers.get("cache-control"), /no-store/);
});

test("a wrong password and an unknown email get the same answer", async () => {
  const m = await member("sara");
  const wrong = await visitor().post("/api/auth/signin", { email: m.email, password: "not the password" });
  const unknown = await visitor().post("/api/auth/signin", { email: mailFor("nobody"), password: PASSWORD });
  const empty = await visitor().post("/api/auth/signin", {});
  for (const r of [wrong, unknown, empty]) {
    err(r, 401, /don't match/);
    assert.equal(r.cookies.length, 0, "no session on a failed sign-in");
  }
  assert.equal(wrong.status, unknown.status);
  assert.deepEqual(wrong.body, unknown.body, "the text does not say which half was wrong");
});

test("a correct sign-in works, whatever the case of the email, and every sign-in gets a fresh session", async () => {
  const m = await member("zara");
  const old = m.jar.get("mirva_sid");
  const again = await m.post("/api/auth/signin", { email: m.email.toUpperCase(), password: PASSWORD });
  assert.equal(again.status, 200);
  assert.equal(again.body.user.id, m.id);
  assert.ok(!JSON.stringify(again.body).includes("s1$"));
  assert.notEqual(m.jar.get("mirva_sid"), old);
  assert.equal((await m.get("/api/me")).body.user.id, m.id);
  assert.equal((await visitor().get("/api/me", { cookie: `mirva_sid=${old}` })).body.user, null, "the session it replaced is dead");
});

test("signing out ends the session on the server, not just in the browser", async () => {
  const m = await member("hina");
  const token = m.jar.get("mirva_sid");
  const out = await m.post("/api/auth/signout");
  assert.equal(out.status, 200);
  assert.match(out.cookies.find((line) => line.startsWith("mirva_sid=")), /Max-Age=0/);
  assert.equal((await m.get("/api/me")).body.user, null);
  assert.equal((await visitor().get("/api/me", { cookie: `mirva_sid=${token}` })).body.user, null, "a copied cookie no longer works");
  assert.equal((await visitor().post("/api/auth/signout")).status, 200, "signing out twice is fine");
});

test("asking for a reset gives the same answer for a known and an unknown email", async () => {
  const m = await member("maryam");
  const c = visitor();
  const known = await c.post("/api/auth/forgot", { email: m.email });
  const unknown = await c.post("/api/auth/forgot", { email: mailFor("ghost") });
  const nonsense = await c.post("/api/auth/forgot", { email: "nonsense" });
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.equal(nonsense.status, 200);
  assert.deepEqual(known.body, unknown.body);
  assert.deepEqual(known.body, nonsense.body);
  assert.deepEqual(known.cookies, []);
});

test("a reset with a bad token is refused", async () => {
  const c = visitor();
  err(await c.post("/api/auth/reset", { token: "not-a-token", password: "a brand new passphrase" }), 400, /expired/);
  err(await c.post("/api/auth/reset", { password: "a brand new passphrase" }), 400);
  err(await c.post("/api/auth/reset", {}), 400);
});

test("a reset link from the outbox sets a new password once and signs every device out", async () => {
  const desk = await founder();
  const m = await member("farah");
  await visitor().post("/api/auth/forgot", { email: m.email });
  const mail = (await desk.get("/api/hq/outbox")).body.outbox.find((row) => row.recipient === m.email && /new MIRVA password/.test(row.subject));
  assert.ok(mail, "the reset email waits in the outbox");
  assert.equal(mail.sent, null, "nothing is sent from here yet");
  const token = mail.body.match(/reset=([\w-]+)/)?.[1];
  assert.ok(token && token.length > 30);

  const c = visitor();
  err(await c.post("/api/auth/reset", { token, password: "short" }), 400, /ten characters/);
  const done = await c.post("/api/auth/reset", { token, password: "a brand new passphrase" });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.user.id, m.id);
  assert.ok(done.cookies.some((line) => line.startsWith("mirva_sid=")));
  assert.equal((await c.get("/api/me")).body.user.id, m.id);
  assert.equal((await m.get("/api/me")).body.user, null, "the old session is gone");
  err(await visitor().post("/api/auth/signin", { email: m.email, password: PASSWORD }), 401);
  assert.equal((await visitor().post("/api/auth/signin", { email: m.email, password: "a brand new passphrase" })).status, 200);
  err(await visitor().post("/api/auth/reset", { token, password: "another new passphrase" }), 400, /expired/);
});

test("the profile keeps sizes, and a one-letter name is refused", async () => {
  const m = await member("laila");
  const saved = await m.post("/api/me/profile", { name: "Laila K", sizes: { top: "M", bottom: "L", shoe: "38" }, height: 168, likes: ["linen", "festive"], modest: true });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.user.name, "Laila K");
  assert.deepEqual(saved.body.user.profile.sizes, { top: "M", bottom: "L", shoe: "38" });
  assert.equal(saved.body.user.profile.height, 168);
  assert.deepEqual(saved.body.user.profile.likes, ["linen", "festive"]);
  assert.equal(saved.body.user.profile.modest, true);
  assert.deepEqual((await m.get("/api/me")).body.user.profile.sizes, { top: "M", bottom: "L", shoe: "38" }, "it is remembered");

  const partial = await m.post("/api/me/profile", { height: 999 });
  assert.equal(partial.body.user.profile.height, 230, "height is clamped");
  assert.deepEqual(partial.body.user.profile.sizes, { top: "M", bottom: "L", shoe: "38" }, "sizes survive a change to something else");
  assert.equal(partial.body.user.name, "Laila K");
  assert.equal((await m.post("/api/me/profile", { sizes: { top: "ABCDEFGHIJ" } })).body.user.profile.sizes.top, "ABCDEF", "values are cut to a sane length");

  err(await m.post("/api/me/profile", { name: "L" }), 400, /name/);
  err(await m.post("/api/me/profile", { name: "  " }), 400, /name/);
  assert.equal((await m.get("/api/me")).body.user.name, "Laila K", "a refused change changes nothing");
});

// --- wardrobe -----------------------------------------------------------------
test("a kept look takes its name, price and picture from the catalogue, whatever the client says", async () => {
  const m = await member("amna");
  const r = await m.post("/api/wardrobe", {
    brand: "sapphire", product: A.id, size: "M",
    name: "Free dress", price: 1, currency: "USD", image: "https://evil.example/x.jpg", url: "https://evil.example/", id: "mine", user: "someone-else",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { look } = r.body;
  assert.equal(look.name, A.name);
  assert.equal(look.price, A.price);
  assert.equal(look.url, A.url);
  assert.equal(look.currency, sapphire.currency || "Rs.");
  assert.equal(look.brand, "sapphire");
  assert.equal(look.brandName, "Sapphire");
  assert.equal(look.product, A.id);
  assert.equal(look.size, "M");
  assert.equal(look.source, "home");
  assert.notEqual(look.id, "mine");
  assert.ok(look.image.includes(encodeURIComponent(A.image)) && !look.image.includes("evil"), look.image);
  const listed = (await m.get("/api/wardrobe")).body.looks;
  assert.deepEqual(listed.map((l) => [l.name, l.price]), [[A.name, A.price]]);
  assert.equal((await m.post("/api/wardrobe", { brand: "sapphire", product: B.id, source: "bogus" })).body.look.source, "home");
});

test("keeping the same piece twice keeps one look, with the latest size", async () => {
  const m = await member("bushra");
  const first = await addLook(m, A, "M");
  const second = await addLook(m, A, "L");
  assert.equal(second.id, first.id);
  assert.equal(second.size, "L");
  assert.equal((await addLook(m, A, "")).size, "L", "no size sent, size kept");
  assert.equal((await m.get("/api/wardrobe")).body.looks.length, 1);
  assert.equal((await m.get("/api/me")).body.looks, 1);
});

test("looks are listed newest first and can be removed", async () => {
  const m = await member("dania");
  const one = await addLook(m, A);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const two = await addLook(m, B);
  assert.deepEqual((await m.get("/api/wardrobe")).body.looks.map((l) => l.id), [two.id, one.id]);
  assert.equal((await m.post("/api/wardrobe/remove", { id: one.id })).status, 200);
  assert.deepEqual((await m.get("/api/wardrobe")).body.looks.map((l) => l.id), [two.id]);
  err(await m.post("/api/wardrobe/remove", { id: one.id }), 404, /isn't in your wardrobe/);
  err(await m.post("/api/wardrobe/remove", {}), 404);
});

test("a piece or store that is not in the catalogue is a 404", async () => {
  const m = await member("eman");
  for (const body of [
    { brand: "sapphire", product: "no-such-piece" },
    { brand: "no-such-store", product: A.id },
    { brand: "sapphire" },
    {},
    { brand: "sapphire", product: "' OR '1'='1" },
  ]) err(await m.post("/api/wardrobe", body), 404, /can't find/);
  assert.deepEqual((await m.get("/api/wardrobe")).body.looks, []);
});

test("every route that touches a member's own things needs a sign-in", async () => {
  const anon = visitor();
  const routes = [
    ["GET", "/api/wardrobe"], ["POST", "/api/wardrobe"], ["POST", "/api/wardrobe/remove"],
    ["GET", "/api/boards"], ["POST", "/api/boards"], ["POST", "/api/boards/close"],
    ["POST", "/api/claim"], ["POST", "/api/me/profile"], ["POST", "/api/me/export"], ["POST", "/api/me/delete"],
    ["POST", "/api/private/request"], ["POST", "/api/checkout/test"],
  ];
  for (const [method, path] of routes) {
    const r = method === "GET" ? await anon.get(path) : await anon.post(path, { brand: "sapphire", product: A.id, id: "x", code: "ABCDEFGH" });
    assert.equal(r.status, 401, `${method} ${path}`);
  }
});

test("one member cannot remove, see or use another member's looks", async () => {
  const a = await member("alice");
  const b = await member("bilal");
  const look = await addLook(a, A, "M");
  err(await b.post("/api/wardrobe/remove", { id: look.id }), 404);
  assert.deepEqual((await a.get("/api/wardrobe")).body.looks.map((l) => l.id), [look.id], "still there");
  assert.deepEqual((await b.get("/api/wardrobe")).body.looks, []);
  err(await b.post("/api/boards", { looks: [look.id, look.id] }), 400);
});

test("a free wardrobe holds sixty looks and then asks for one to go", async () => {
  const cap = MEMBER_TIERS.member.wardrobe;
  assert.ok(products.length > cap, "the catalogue is big enough for this test");
  const m = await member("collector");
  for (const p of products.slice(0, cap)) assert.equal((await m.post("/api/wardrobe", { brand: "sapphire", product: p.id })).status, 200, p.id);
  err(await m.post("/api/wardrobe", { brand: "sapphire", product: products[cap].id }), 409, new RegExp(String(cap)));
  assert.equal((await m.post("/api/wardrobe", { brand: "sapphire", product: A.id, size: "S" })).status, 200, "a piece already kept can still be updated");
  assert.equal((await m.get("/api/wardrobe")).body.looks.length, cap);
});

// --- boards ---------------------------------------------------------------------
// A member with three looks and an open board asking about the first two.
async function boardOf(label = "owner") {
  const owner = await member(label);
  const looks = [];
  for (const p of [A, B, C]) looks.push((await addLook(owner, p)).id);
  const made = await owner.post("/api/boards", { title: "Which one for the mehndi?", looks: looks.slice(0, 2) });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  return { owner, looks, code: made.body.code };
}

test("a board needs two of your own looks, and a free member keeps three open", async () => {
  const owner = await member("asker");
  const other = await member("other");
  const mine = [];
  for (const p of products.slice(0, 4)) mine.push((await addLook(owner, p)).id);
  const theirs = (await addLook(other, A)).id;

  err(await owner.post("/api/boards", { looks: [] }), 400, /two looks/);
  err(await owner.post("/api/boards", {}), 400, /two looks/);
  err(await owner.post("/api/boards", { looks: [mine[0]] }), 400, /two looks/);
  err(await owner.post("/api/boards", { looks: [mine[0], mine[0]] }), 400, /two looks/);
  err(await owner.post("/api/boards", { looks: [mine[0], theirs] }), 400, /two looks/);
  err(await owner.post("/api/boards", { looks: [mine[0], "nope"] }), 400, /two looks/);

  const made = await owner.post("/api/boards", { looks: [mine[0], mine[1]] });
  assert.equal(made.status, 200);
  assert.equal(made.body.code.length, 10);
  assert.match(made.body.code, /^[A-Z0-9]{10}$/);
  assert.match(made.body.code, SHORT_CODE);
  assert.equal(made.body.url, `${main.base}/b/${made.body.code}`);

  const listed = (await owner.get("/api/boards")).body.boards;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].code, made.body.code);
  assert.equal(listed[0].title, "Which one?", "a default title");
  assert.deepEqual(listed[0].looks, [mine[0], mine[1]]);
  assert.equal(listed[0].closed, false);
  assert.deepEqual(listed[0].votes, []);

  assert.equal((await owner.post("/api/boards", { looks: [mine[1], mine[2]] })).status, 200);
  const third = await owner.post("/api/boards", { looks: [mine[2], mine[3]] });
  assert.equal(third.status, 200);
  err(await owner.post("/api/boards", { looks: [mine[0], mine[3]] }), 409, /as many open questions/);

  err(await other.post("/api/boards/close", { code: third.body.code }), 404, /can't find/);
  assert.equal((await owner.get("/api/boards")).body.boards.find((b) => b.code === third.body.code).closed, false, "someone else's close did nothing");
  err(await owner.post("/api/boards/close", { code: "x' OR '1'='1" }), 404);
  assert.equal((await owner.post("/api/boards/close", { code: third.body.code })).status, 200);
  assert.equal((await owner.post("/api/boards", { looks: [mine[0], mine[3]] })).status, 200, "closing one makes room");
});

test("a guest sees the looks but no tally until they vote", async () => {
  const { owner, looks, code } = await boardOf("ayesha");
  const guest = visitor();
  const seen = await guest.get(`/api/board/${code}`);
  assert.equal(seen.status, 200, JSON.stringify(seen.body));
  assert.deepEqual(seen.body.looks.map((l) => l.id), looks.slice(0, 2));
  assert.equal(seen.body.tally, null);
  assert.equal(seen.body.voted, null);
  assert.equal(seen.body.owner, false);
  assert.equal(seen.body.closed, false);
  assert.equal(seen.body.by, "Ayesha", "only a first name");
  assert.equal(seen.body.title, "Which one for the mehndi?");
  assert.deepEqual(seen.body.looks.map((l) => [l.name, l.price]), [[A.name, A.price], [B.name, B.price]]);
  const wire = JSON.stringify(seen.body);
  assert.ok(!wire.includes(owner.email) && !wire.includes(owner.id), "the guest learns nothing about the owner");

  const mine = (await owner.get(`/api/board/${code}`)).body;
  assert.equal(mine.owner, true);
  assert.deepEqual(mine.tally[looks[0]], { votes: 0, names: [] }, "the owner sees the tally from the start");
});

test("voting sets a voter cookie, and voting again from the same cookie moves the vote", async () => {
  const { owner, looks, code } = await boardOf("bina");
  const guest = visitor();
  const voted = await guest.post(`/api/board/${code}/vote`, { look: looks[0], name: "Mum" });
  assert.equal(voted.status, 200, JSON.stringify(voted.body));
  assert.equal(voted.body.voted, looks[0]);
  assert.deepEqual(voted.body.tally[looks[0]], { votes: 1, names: ["Mum"] });
  assert.equal(voted.body.tally[looks[1]].votes, 0);
  const cookie = voted.cookies.find((line) => line.startsWith("mirva_v="));
  assert.ok(cookie, "a voter cookie");
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Lax/);

  const seen = (await guest.get(`/api/board/${code}`)).body;
  assert.equal(seen.voted, looks[0], "they are shown their own pick");
  assert.equal(seen.tally[looks[0]].votes, 1, "and the tally, now that they have voted");

  const changed = await guest.post(`/api/board/${code}/vote`, { look: looks[1], name: "Mum" });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.tally[looks[0]].votes, 0);
  assert.equal(changed.body.tally[looks[1]].votes, 1);
  assert.equal(changed.cookies.length, 0, "the same voter keeps the same cookie");

  const second = await visitor().post(`/api/board/${code}/vote`, { look: looks[0], name: "Dad" });
  assert.deepEqual(second.body.tally[looks[0]], { votes: 1, names: ["Dad"] });
  assert.deepEqual(second.body.tally[looks[1]], { votes: 1, names: ["Mum"] }, "a second guest adds a vote");

  const votes = (await owner.get("/api/boards")).body.boards[0].votes;
  assert.deepEqual(votes.map((v) => v.name).sort(), ["Dad", "Mum"]);
});

test("a vote for a look that is not on the board is refused", async () => {
  const { looks, code } = await boardOf("chand");
  const guest = visitor();
  for (const look of [looks[2], "nope", "", undefined]) {
    const r = await guest.post(`/api/board/${code}/vote`, { look });
    err(r, 400, /Choose one/);
    assert.equal(r.cookies.length, 0, "a refused vote does not hand out a voter cookie");
  }
  assert.equal((await guest.get(`/api/board/${code}`)).body.tally, null, "and counted nothing");
  err(await guest.post("/api/board/ZZZZZZZZZZ/vote", { look: looks[0] }), 404, /gone/);
  assert.equal((await guest.get("/api/board/ZZZZZZZZZZ")).status, 404);
  assert.equal((await guest.get("/api/board/short")).status, 404);
});

test("once the owner closes a board, voting is over but the owner still sees everything", async () => {
  const { owner, looks, code } = await boardOf("dua");
  const early = visitor();
  assert.equal((await early.post(`/api/board/${code}/vote`, { look: looks[0], name: "Early" })).status, 200);

  assert.equal((await owner.post("/api/boards/close", { code })).status, 200);
  err(await early.post(`/api/board/${code}/vote`, { look: looks[1] }), 410, /closed/);
  err(await visitor().post(`/api/board/${code}/vote`, { look: looks[0] }), 410, /closed/);

  const guestView = (await visitor().get(`/api/board/${code}`)).body;
  assert.equal(guestView.closed, true);
  assert.deepEqual(guestView.looks, [], "a closed board no longer shows its looks to guests");
  assert.equal(guestView.tally[looks[0]].votes, 1, "the earlier vote still counts");
  const ownerView = (await owner.get(`/api/board/${code}`)).body;
  assert.equal(ownerView.owner, true);
  assert.equal(ownerView.looks.length, 2);
  assert.equal((await owner.get("/api/boards")).body.boards[0].closed, true);
});

// --- hand-off from a mirror to a phone ------------------------------------------
test("a mirror hands a basket to a phone with a short code, and the phone can preview it", async () => {
  const mirror = visitor();
  const r = await mirror.post("/api/handoff", { brand: "sapphire", looks: [{ product: A.id, size: "M" }, { product: B.id }, { product: "no-such-piece" }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.code.length, 8);
  assert.match(r.body.code, SHORT_CODE);
  assert.equal(r.body.url, `${main.base}/claim/${r.body.code}`);

  const peek = await visitor().get(`/api/handoff/${r.body.code}`);
  assert.equal(peek.status, 200);
  assert.equal(peek.body.brand, "Sapphire");
  assert.equal(peek.body.claimed, false);
  assert.deepEqual(peek.body.looks.map((l) => [l.name, l.price, l.size]), [[A.name, A.price, "M"], [B.name, B.price, ""]], "pieces it does not know are left out");
  assert.equal((await visitor().get(`/api/handoff/${r.body.code.toLowerCase()}`)).status, 200, "a code typed in lower case still works");
  err(await visitor().get("/api/handoff/ZZZZZZZZ"), 404, /expired/);
});

test("a hand-off with nothing in it, or for an unknown store, is refused", async () => {
  const mirror = visitor();
  for (const body of [{ brand: "sapphire", looks: [] }, { brand: "sapphire" }, { brand: "sapphire", looks: [{ product: "nope" }] }, { brand: "no-such-store", looks: [{ product: A.id }] }, {}])
    err(await mirror.post("/api/handoff", body), 400, /nothing to send/);
  const many = await mirror.post("/api/handoff", { brand: "sapphire", looks: products.slice(0, 12).map((p) => ({ product: p.id })) });
  assert.equal((await visitor().get(`/api/handoff/${many.body.code}`)).body.looks.length, 8, "a basket holds eight");
});

test("a signed-in member claims a hand-off into the wardrobe, and nobody else can claim it", async () => {
  const sent = await visitor().post("/api/handoff", { brand: "sapphire", looks: [{ product: A.id, size: "M" }, { product: B.id, size: "L" }] });
  const a = await member("first");
  const b = await member("second");

  const claimed = await a.post("/api/claim", { code: sent.body.code });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  assert.equal(claimed.body.added, 2);
  assert.equal(claimed.body.brand, "sapphire");
  const wardrobe = (await a.get("/api/wardrobe")).body.looks;
  assert.deepEqual(wardrobe.map((l) => [l.product, l.size, l.source]).sort(), [[A.id, "M", "store"], [B.id, "L", "store"]].sort());
  assert.equal((await visitor().get(`/api/handoff/${sent.body.code}`)).body.claimed, true);

  err(await b.post("/api/claim", { code: sent.body.code }), 404, /already in someone's wardrobe/);
  assert.deepEqual((await b.get("/api/wardrobe")).body.looks, []);

  assert.equal((await a.post("/api/claim", { code: sent.body.code.toLowerCase() })).status, 200, "the owner can claim again");
  assert.equal((await a.get("/api/wardrobe")).body.looks.length, 2, "without doubling anything up");
  err(await b.post("/api/claim", { code: "ZZZZZZZZ" }), 404, /expired/);
  err(await b.post("/api/claim", {}), 404);
});

test("a hand-off can be claimed while joining or signing in", async () => {
  const mirror = visitor();
  const first = await mirror.post("/api/handoff", { brand: "sapphire", looks: [{ product: A.id, size: "S" }] });
  const joiner = visitor();
  const joined = await joiner.post("/api/auth/join", { name: "Quick Joiner", email: mailFor("quick"), password: PASSWORD, agree: true, claim: first.body.code });
  assert.equal(joined.status, 200);
  assert.equal(joined.body.claimed.added, 1);
  assert.deepEqual((await joiner.get("/api/wardrobe")).body.looks.map((l) => [l.product, l.size]), [[A.id, "S"]]);

  const second = await mirror.post("/api/handoff", { brand: "sapphire", looks: [{ product: B.id }] });
  const m = await member("returning");
  const again = visitor();
  const signedIn = await again.post("/api/auth/signin", { email: m.email, password: PASSWORD, claim: second.body.code });
  assert.equal(signedIn.body.claimed.added, 1);
  assert.deepEqual((await again.get("/api/wardrobe")).body.looks.map((l) => l.product), [B.id]);
});

// --- what happens at the mirror ---------------------------------------------------
test("events keep the known kinds and silently drop the rest", async () => {
  const mirror = visitor();
  const r = await mirror.post("/api/events", {
    brand: "sapphire",
    visit: "visit-a",
    events: [{ kind: "visit" }, { kind: "look_open", product: A.id }, { kind: "hack_the_planet" }, { kind: "ADMIN" }, {}, null, "text", { kind: "keep", product: A.id, value: "not a number" }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.stored, 3);
  assert.equal((await mirror.post("/api/events", { brand: "sapphire", events: [{ kind: "bogus" }] })).body.stored, 0);
  assert.equal((await mirror.post("/api/events", { brand: "sapphire" })).body.stored, 0, "no list, nothing stored");
  const flood = await mirror.post("/api/events", { brand: "sapphire", visit: "visit-flood", events: Array.from({ length: 60 }, () => ({ kind: "compare" })) });
  assert.equal(flood.body.stored, 40, "forty events a call");
});

test("events for a store that does not exist are a 404", async () => {
  const mirror = visitor();
  err(await mirror.post("/api/events", { brand: "no-such-store", events: [{ kind: "visit" }] }), 404);
  err(await mirror.post("/api/events", { events: [{ kind: "visit" }] }), 404);
});

test("the console's funnel counts distinct visits from the events a mirror sent", async () => {
  const desk = await founder();
  const read = async () => (await desk.get("/api/console/overview?brand=sapphire")).body;
  const before = await read();
  const mirror = visitor();
  const send = (visit, kinds) => mirror.post("/api/events", { brand: "sapphire", visit, events: kinds.map((e) => (typeof e === "string" ? { kind: e, product: A.id } : e)) });
  await send("funnel-1", ["visit", "visit", "looks_shown", "portrait", "keep", "send"]);
  await send("funnel-2", ["visit", { kind: "size_missed", product: A.id, meta: "XS" }]);
  const after = await read();
  const delta = (key) => after.funnel[key] - before.funnel[key];
  assert.deepEqual({ visits: delta("visits"), briefed: delta("briefed"), tried: delta("tried"), kept: delta("kept"), sent: delta("sent") }, { visits: 2, briefed: 1, tried: 1, kept: 1, sent: 1 });
  const top = after.top.find((p) => p.product === A.id);
  assert.equal(top.name, A.name);
  assert.ok(top.tries >= 1 && top.keeps >= 1);
  assert.ok(after.missed.some((m) => m.product === A.id && m.size === "XS" && m.asks >= 1), "a size asked for and missing is reported");
  assert.equal((await desk.get("/api/console/overview?brand=sapphire&days=1000")).body.days, 90, "the window is capped");
});

// --- the retail site -------------------------------------------------------------
test("a lead is stored cleaned up, and a stranger's mail waits in the outbox", async () => {
  const desk = await founder();
  const input = lead({ email: "Sana@Atelier.example", phone: "+92 300 1234567<script>", plan: "platinum", stores: 3, city: "Lahore", message: "Please call" });
  const r = await visitor().post("/api/leads", input);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(typeof r.body.id, "string");

  const stored = (await desk.get("/api/hq/leads")).body.leads.find((l) => l.id === r.body.id);
  assert.ok(stored, "it reaches the founder's desk");
  assert.deepEqual([stored.name, stored.company, stored.email, stored.status, stored.stores, stored.city], ["Sana Malik", input.company, "sana@atelier.example", "new", 3, "Lahore"]);
  assert.equal(stored.phone, "+92 300 1234567", "only phone characters survive");
  assert.equal(stored.plan, "", "an unknown plan is not kept");
  const outbox = (await desk.get("/api/hq/outbox")).body.outbox;
  assert.ok(outbox.some((m) => m.recipient === "sana@atelier.example" && m.sent === null), "the thank-you waits to be sent");
  assert.ok(outbox.some((m) => m.recipient === "founder" && m.subject.includes(input.company)), "and so does the founder's notice");
});

test("a filled-in honeypot field looks like success but stores nothing", async () => {
  const desk = await founder();
  const input = lead({ website: "http://spam.example" });
  const r = await visitor().post("/api/leads", input);
  assert.equal(r.status, 200);
  assert.equal(r.body.id, undefined);
  assert.ok(!(await desk.get("/api/hq/leads")).body.leads.some((l) => l.company === input.company));
});

test("a lead without a name, a store or a working email is refused", async () => {
  const site = visitor();
  err(await site.post("/api/leads", lead({ company: "" })), 400, /name of your store/);
  err(await site.post("/api/leads", { name: "Sana Malik", email: mailFor("lead") }), 400, /name of your store/);
  err(await site.post("/api/leads", lead({ name: "S" })), 400, /name/);
  err(await site.post("/api/leads", lead({ email: "nope" })), 400, /email/);
  err(await site.post("/api/leads", lead({ company: "A" })), 400, /store/);
});

// --- membership ---------------------------------------------------------------
test("a member asks for MIRVA Private and joins only after the founder invites them", async () => {
  const desk = await founder();
  const m = await member("private");
  err(await m.post("/api/checkout/test"), 403, /invitation/);
  assert.deepEqual((await m.post("/api/private/request", { note: "Wedding season" })).body, { status: "waiting" });
  assert.deepEqual((await m.post("/api/private/request", {})).body, { status: "waiting" }, "asking twice does not queue twice");
  assert.equal((await m.get("/api/me")).body.invite, "waiting");

  const waiting = (await desk.get("/api/hq/invites")).body.invites.filter((i) => i.user === m.id);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].note, "Wedding season");
  err(await m.post("/api/hq/invites/decide", { id: waiting[0].id, decision: "invite" }), 403);
  err(await m.post("/api/checkout/test"), 403, /invitation/); // still waiting

  assert.equal((await desk.post("/api/hq/invites/decide", { id: waiting[0].id, decision: "invite" })).body.status, "invited");
  const paid = await m.post("/api/checkout/test");
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  const me = (await m.get("/api/me")).body;
  assert.equal(me.user.tier, "private");
  assert.equal(me.tier.portraitsPerMonth, MEMBER_TIERS.private.portraitsPerMonth);
  assert.ok((await desk.get("/api/hq/outbox")).body.outbox.some((o) => o.recipient === m.email && /invitation/i.test(o.subject)));
});

test("a member can export what MIRVA holds about them, then delete it all", async () => {
  const m = await member("leaver");
  await addLook(m, A, "M");
  const sent = await visitor().post("/api/handoff", { brand: "sapphire", looks: [{ product: B.id }] });
  await m.post("/api/claim", { code: sent.body.code });

  const out = await m.post("/api/me/export");
  assert.equal(out.status, 200);
  assert.equal(out.body.account.email, m.email);
  assert.equal(out.body.wardrobe.length, 2);
  assert.ok(!JSON.stringify(out.body).includes("s1$"), "the hash is not part of anyone's data export");

  err(await m.post("/api/me/delete", { password: "not my password" }), 401, /password/);
  err(await m.post("/api/me/delete", {}), 401, /password/);
  assert.equal((await m.get("/api/me")).body.user.id, m.id, "a wrong password deletes nothing");

  const gone = await m.post("/api/me/delete", { password: PASSWORD });
  assert.equal(gone.status, 200);
  assert.equal((await m.get("/api/me")).body.user, null);
  err(await visitor().post("/api/auth/signin", { email: m.email, password: PASSWORD }), 401);
  const desk = await founder();
  assert.ok(!(await desk.get("/api/hq/members")).body.members.some((x) => x.email === m.email));
  const other = await member("heir");
  assert.equal((await other.post("/api/claim", { code: sent.body.code })).status, 200, "a hand-off the deleted member held is free again");
});

// --- the desks ------------------------------------------------------------------
test("the console and the founder's desk are closed to people who are signed out and to members", async () => {
  const m = await member("curious");
  const desks = [
    ["GET", "/api/console/brands"], ["GET", "/api/console/overview"], ["GET", "/api/console/overview?brand=sapphire"], ["GET", "/api/console/catalogue"], ["GET", "/api/console/devices"],
    ["POST", "/api/console/devices"], ["POST", "/api/console/devices/code"], ["POST", "/api/console/devices/remove"], ["POST", "/api/console/catalogue/hide"], ["POST", "/api/console/brand"],
    ["GET", "/api/console/anything-else"],
    ["GET", "/api/hq/overview"], ["GET", "/api/hq/leads"], ["GET", "/api/hq/members"], ["GET", "/api/hq/invites"], ["GET", "/api/hq/outbox"], ["GET", "/api/hq/audit"], ["GET", "/api/hq/tryons"],
    ["POST", "/api/hq/leads/update"], ["POST", "/api/hq/retailers"], ["POST", "/api/hq/retailers/user"], ["POST", "/api/hq/invites/decide"], ["POST", "/api/hq/outbox/sent"],
  ];
  const anon = visitor();
  for (const [method, path] of desks) {
    const ask = (who) => (method === "GET" ? who.get(path) : who.post(path, {}));
    assert.equal((await ask(anon)).status, 401, `signed out: ${method} ${path}`);
    assert.equal((await ask(m)).status, 403, `member: ${method} ${path}`);
  }
});

test("the founder's sign-in is written to a file on first start and never printed", async () => {
  const file = readFileSync(join(main.data, "first-run.txt"), "utf8");
  const email = file.match(/^email:\s+(\S+)/m)[1];
  const password = file.match(/^password:\s+(\S+)/m)[1];
  assert.ok(password.length >= 16);
  assert.ok(!main.out.includes(password) && !main.err.includes(password), "not in the server's output");
  assert.match(main.out, /first-run\.txt/, "the log points at the file instead");
  const desk = await founder();
  const me = (await desk.get("/api/me")).body;
  assert.equal(me.user.email, email);
  assert.equal(me.user.role, "founder");
  assert.equal(me.tier, undefined, "the founder has no shopper tier");
});

test("the founder's overview counts leads, members and the system", async () => {
  const desk = await founder();
  const read = async () => (await desk.get("/api/hq/overview")).body;
  const before = await read();
  assert.deepEqual(Object.keys(before.leads).sort(), ["contacted", "demo", "lost", "new", "pilot", "won"]);
  for (const key of ["total", "private", "week", "looks", "boards", "votes"]) assert.equal(typeof before.members[key], "number", key);

  const m = await member("counted");
  await addLook(m, A);
  await visitor().post("/api/leads", lead());
  const after = await read();
  assert.equal(after.members.total, before.members.total + 1);
  assert.equal(after.members.week, before.members.week + 1);
  assert.equal(after.members.looks, before.members.looks + 1);
  assert.equal(after.leads.new, before.leads.new + 1);

  assert.equal(after.system.live, false, "no Decart key in tests");
  assert.equal(after.system.model, "lucy-vton-latest");
  assert.equal(after.system.payments, "test");
  assert.equal(after.system.openMirror, true);
  assert.equal(after.system.origin, main.base);
  assert.ok(after.system.brands.includes("sapphire"));
  assert.ok(Array.isArray(after.retailers) && Array.isArray(after.usage));
  assert.deepEqual(after.spend, { usd: 0, pkr: 0 });
  assert.ok(after.waiting.outbox > 0, "mail is waiting to be sent");
  assert.ok(!JSON.stringify(after).includes("s1$"), "no password hash on the founder's desk either");
});

test("the founder's try-ons count portraits and live looks by who made them, and leave the sample out", async () => {
  const desk = await founder();
  const read = async (days = 30) => (await desk.get(`/api/hq/tryons?days=${days}`)).body;
  const before = await read();
  assert.deepEqual(Object.keys(before).sort(), ["byDay", "days", "members", "modes", "shoppers", "top"]);
  assert.equal((await read(5000)).days, 365, "the window is capped");
  assert.equal((await read(7)).byDay.length, 8, "a day for every day in the window, empty ones too");

  const one = await member("model");
  const two = await member("studio");
  const db = new DatabaseSync(join(main.data, "mirva.db"));
  const put = (kind, who, { seconds = 0, usd = 0, sample = 0, ago = 0 } = {}) =>
    db.prepare("INSERT INTO usage (at, kind, brand, device, user, seconds, usd, sample) VALUES (?,?,?,?,?,?,?,?)").run(Date.now() - ago, kind, "sapphire", null, who?.id ?? null, seconds, usd, sample);
  put("portrait", one, { usd: 0.05 });
  put("portrait", one, { usd: 0.05 });
  put("backdrop", one, { usd: 0.02 }); // part of a portrait: costs, but is not a try-on of its own
  put("portrait", two, { usd: 0.05, ago: 2 * 86400e3 });
  put("live", two, { seconds: 90, usd: 0.4 });
  put("live", null, { seconds: 30, usd: 0.1 }); // a mirror with no sign-in
  put("portrait", null, { usd: 0.05 });
  put("portrait", two, { usd: 9, sample: 1 }); // seeded sample: never counted
  db.close();
  const mirror = visitor();
  await one.post("/api/events", { brand: "sapphire", visit: "tryons-1", events: [{ kind: "portrait", product: A.id }, { kind: "live_start", product: A.id }, { kind: "keep", product: A.id }, { kind: "portrait", product: B.id }] });
  await mirror.post("/api/events", { brand: "sapphire", visit: "tryons-2", events: [{ kind: "portrait", product: A.id }] });

  const after = await read();
  const diff = (a, b) => a - b;
  assert.equal(diff(after.shoppers.total, before.shoppers.total), 2);
  assert.equal(diff(after.shoppers.joined, before.shoppers.joined), 2);
  assert.equal(diff(after.shoppers.active, before.shoppers.active), 2);
  assert.equal(diff(after.shoppers.portraits.members, before.shoppers.portraits.members), 3);
  assert.equal(diff(after.shoppers.portraits.mirrors, before.shoppers.portraits.mirrors), 1);
  assert.equal(diff(after.shoppers.live.members, before.shoppers.live.members), 1);
  assert.equal(diff(after.shoppers.live.mirrors, before.shoppers.live.mirrors), 1);
  assert.equal(diff(after.modes.model.count, before.modes.model.count), 4, "the backdrop and the sample are not portraits");
  assert.equal(diff(after.modes.studio.count, before.modes.studio.count), 2);
  assert.equal(diff(after.modes.model.people, before.modes.model.people), 2);
  assert.equal(diff(after.modes.studio.people, before.modes.studio.people), 1);
  assert.equal(diff(after.modes.both, before.modes.both), 1, "one member used both ways");
  assert.ok(Math.abs(after.modes.model.usd - before.modes.model.usd - 0.22) < 1e-9, "a backdrop is part of Model's cost, the sample is not");
  assert.ok(Math.abs(after.modes.studio.usd - before.modes.studio.usd - 0.5) < 1e-9);
  assert.ok(Math.abs(after.modes.studio.minutes - before.modes.studio.minutes - 2) < 1e-9);
  assert.ok(Math.abs(after.modes.model.share + after.modes.studio.share - 1) < 0.002);

  const today = after.byDay.at(-1);
  const twoDaysAgo = before.byDay.at(-3);
  assert.equal(today.date, new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10), "days are Pakistan days");
  assert.equal(today.portraits - before.byDay.at(-1).portraits, 3);
  assert.equal(today.live - before.byDay.at(-1).live, 2);
  assert.equal(after.byDay.at(-3).portraits - twoDaysAgo.portraits, 1, "two days ago is its own bar");

  const piece = after.top.find((p) => p.product === A.id);
  assert.equal(piece.name, A.name);
  assert.equal(piece.brandName, sapphire.name);
  assert.ok(piece.tries >= 3 && piece.keeps >= 1);
  assert.ok(after.top.length <= 10 && after.top.every((p, i, all) => !i || all[i - 1].tries >= p.tries), "most tried first");

  const row = after.members.find((r) => r.email === one.email);
  assert.deepEqual({ portraits: row.portraits, live: row.live, minutes: row.minutes, kept: row.kept }, { portraits: 2, live: 0, minutes: 0, kept: 0 });
  assert.equal(after.members.find((r) => r.email === two.email).minutes, 1.5);
  assert.ok(!JSON.stringify(after).includes("s1$") && after.members.every((r) => !("pass" in r)));
});

test("the founder can list members and read the audit trail", async () => {
  const desk = await founder();
  const m = await member("listed");
  const members = (await desk.get("/api/hq/members")).body.members;
  const row = members.find((x) => x.email === m.email);
  assert.ok(row);
  assert.ok(!("pass" in row) && !JSON.stringify(row).includes("s1$"));
  const trail = (await desk.get("/api/hq/audit")).body.audit;
  assert.ok(trail.some((a) => a.action === "join" && a.actor === m.id));
});

test("a lead moves through the founder's desk", async () => {
  const desk = await founder();
  const input = lead();
  const id = (await visitor().post("/api/leads", input)).body.id;
  const read = async () => (await desk.get("/api/hq/overview")).body.leads;
  const before = await read();

  const listing = (await desk.get("/api/hq/leads")).body;
  assert.deepEqual(listing.statuses, ["new", "contacted", "demo", "pilot", "won", "lost"]);
  assert.ok(listing.leads.some((l) => l.id === id));

  const moved = await desk.post("/api/hq/leads/update", { id, status: "contacted", notes: "Called Monday" });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.lead.status, "contacted");
  assert.equal(moved.body.lead.notes, "Called Monday");
  const after = await read();
  assert.equal(after.contacted, before.contacted + 1);
  assert.equal(after.new, before.new - 1);

  const noteOnly = await desk.post("/api/hq/leads/update", { id, status: "not-a-status" });
  assert.equal(noteOnly.body.lead.status, "contacted", "an unknown status changes nothing");
  assert.equal(noteOnly.body.lead.notes, "Called Monday", "and neither does leaving notes out");
  err(await desk.post("/api/hq/leads/update", { id: "no-such-lead", status: "won" }), 404);
});

test("a retailer's plan sets the monthly fee the console shows", async () => {
  const desk = await founder();
  const overview = async () => (await desk.get("/api/console/overview?brand=sapphire")).body;

  assert.equal((await desk.post("/api/hq/retailers", { brand: "sapphire", plan: "studio", stores: 2, status: "pilot" })).status, 200);
  const o = await overview();
  assert.equal(o.plan.monthly, 190000);
  assert.deepEqual([o.plan.id, o.plan.name, o.plan.stores, o.plan.status, o.plan.mirrors, o.plan.live.included, o.plan.portraits.included], ["studio", "Mirror", 2, "pilot", 2, 140, 5000]);

  assert.equal((await desk.post("/api/hq/retailers", { brand: "sapphire", plan: "assist", stores: 12, status: "live" })).status, 200);
  assert.equal((await overview()).plan.monthly, 9 * 25000 + 3 * 20000, "the Assist volume rate reaches the console");
  const hq = (await desk.get("/api/hq/overview")).body;
  const row = hq.retailers.find((r) => r.brand === "sapphire");
  assert.equal(row.monthly, 285000);
  assert.deepEqual([row.plan, row.planName], ["assist", "Assist"]);
  assert.equal(row.name, "Sapphire");
  assert.equal(hq.mrr, hq.retailers.filter((r) => r.status === "live").reduce((sum, r) => sum + r.monthly, 0));
  assert.ok(hq.mrr >= 285000);
  assert.equal((await desk.post("/api/hq/retailers", { brand: "sapphire", plan: "boutique", stores: 1, status: "live" })).status, 200);
  assert.deepEqual([(await overview()).plan.id, (await overview()).plan.name], ["results", "Results"], "the old name is stored as the plan that took its place");

  assert.equal((await desk.post("/api/hq/retailers", { brand: "sapphire", plan: "studio", stores: 0, status: "whatever" })).status, 200);
  const odd = (await overview()).plan;
  assert.deepEqual([odd.stores, odd.status, odd.monthly], [1, "pilot", 95000], "stores are at least one and an unknown status falls back to pilot");

  err(await desk.post("/api/hq/retailers", { brand: "sapphire", plan: "platinum" }), 400, /plan/);
  err(await desk.post("/api/hq/retailers", { brand: "no-such-store", plan: "studio" }), 404);
  assert.equal((await desk.post("/api/hq/retailers", { brand: "sapphire", plan: "studio", stores: 2, status: "pilot" })).status, 200);
  assert.equal((await overview()).plan.monthly, 190000);
});

test("a retailer login reads its own console but not the founder's desk", async () => {
  const desk = await founder();
  await desk.post("/api/hq/retailers", { brand: "sapphire", plan: "studio", stores: 2, status: "pilot" });
  const email = mailFor("manager");
  const made = await desk.post("/api/hq/retailers/user", { brand: "sapphire", name: "Store Manager", email });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.email, email);
  assert.ok(made.body.password.length >= 12, "a one-time password to pass on by hand");

  err(await desk.post("/api/hq/retailers/user", { brand: "sapphire", name: "Again", email }), 409, /already/);
  err(await desk.post("/api/hq/retailers/user", { brand: "sapphire", name: "S", email: mailFor("short") }), 400);
  err(await desk.post("/api/hq/retailers/user", { brand: "sapphire", name: "No Email", email: "nope" }), 400);
  err(await desk.post("/api/hq/retailers/user", { brand: "no-such-store", name: "Lost Soul", email: mailFor("lost") }), 404);

  const shop = visitor();
  const signedIn = await shop.post("/api/auth/signin", { email, password: made.body.password });
  assert.equal(signedIn.status, 200);
  assert.deepEqual([signedIn.body.user.role, signedIn.body.user.brand, signedIn.body.user.tier], ["retailer", "sapphire", null]);
  const me = (await shop.get("/api/me")).body;
  assert.equal(me.user.role, "retailer");
  assert.equal(me.tier, undefined, "no shopper tier for a retailer");

  const overview = await shop.get("/api/console/overview");
  assert.equal(overview.status, 200);
  assert.equal(overview.body.plan.monthly, 190000);
  assert.deepEqual((await shop.get("/api/console/brands")).body.brands.map((b) => b.id), ["sapphire"]);
  assert.equal((await shop.get("/api/console/overview?brand=no-such-store")).body.brand, "sapphire", "a retailer's own store, whatever they ask for");
  err(await desk.get("/api/console/overview?brand=no-such-store"), 404);

  for (const path of ["/api/hq/overview", "/api/hq/leads", "/api/hq/members", "/api/hq/outbox", "/api/hq/audit"]) assert.equal((await shop.get(path)).status, 403, path);
  for (const path of ["/api/hq/retailers", "/api/hq/retailers/user", "/api/hq/leads/update"]) assert.equal((await shop.post(path, {})).status, 403, path);

  const hq = (await desk.get("/api/hq/overview")).body;
  assert.ok(hq.retailers.find((r) => r.brand === "sapphire").users.some((u) => u.email === email));
  assert.ok(!JSON.stringify(hq).includes(made.body.password), "the one-time password is never shown again");
});

test("a store mirror is added with a pairing code that works once", async () => {
  const desk = await founder();
  const made = await desk.post("/api/console/devices", { brand: "sapphire", name: "Fitting room 1", store: "DHA" });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.code.length, 6);
  assert.match(made.body.code, SHORT_CODE);
  assert.ok(made.body.pairUrl.endsWith(`/mirror?brand=sapphire&pair=${made.body.code}`));

  const listed = async () => (await desk.get("/api/console/devices?brand=sapphire")).body.devices.find((d) => d.id === made.body.id);
  assert.equal((await listed()).pair_code, made.body.code);
  assert.equal((await listed()).paired, null);

  const store = visitor();
  const paired = await store.post("/api/pair", { code: made.body.code });
  assert.equal(paired.status, 200, JSON.stringify(paired.body));
  assert.deepEqual([paired.body.device, paired.body.brand, paired.body.name], [made.body.id, "sapphire", "Fitting room 1"]);
  assert.ok(paired.body.token.length >= 40);

  err(await store.post("/api/pair", { code: made.body.code }), 404, /isn't right, or it has expired/);
  const after = await listed();
  assert.equal(after.pair_code, null, "the code is spent");
  assert.equal(typeof after.paired, "number");
  assert.ok(!JSON.stringify((await desk.get("/api/console/devices?brand=sapphire")).body).includes(paired.body.token), "the token is never shown again");

  err(await store.post("/api/pair", { code: "AAAAAA" }), 404);
  err(await store.post("/api/pair", {}), 404);

  const fresh = await desk.post("/api/console/devices/code", { id: made.body.id });
  assert.equal(fresh.status, 200);
  assert.notEqual(fresh.body.code, made.body.code);
  const again = await visitor().post("/api/pair", { code: fresh.body.code.toLowerCase() });
  assert.equal(again.status, 200, "a code typed in lower case still pairs");
  assert.notEqual(again.body.token, paired.body.token);

  assert.equal((await desk.post("/api/console/devices/remove", { id: made.body.id })).status, 200);
  assert.equal(await listed(), undefined);
  err(await desk.post("/api/console/devices/remove", { id: made.body.id }), 404, /can't find/);
});

test("a retailer cannot see or touch another store's mirrors", async (t) => {
  const desk = await founder();
  const brands = (await visitor().get("/api/brands")).body;
  const other = brands.find((b) => b.id !== "sapphire");
  if (!other) return t.skip("only one store is loaded");
  const email = mailFor("fence");
  const made = await desk.post("/api/hq/retailers/user", { brand: "sapphire", name: "Fenced Manager", email });
  const shop = visitor();
  await shop.post("/api/auth/signin", { email, password: made.body.password });
  const theirs = (await desk.post("/api/console/devices", { brand: other.id, name: "Not yours" })).body;
  const mine = (await shop.post("/api/console/devices", { brand: other.id, name: "Mine" })).body;
  assert.ok(mine.pairUrl.includes("brand=sapphire"), "a retailer's new mirror always lands in their own store");
  const listed = (await shop.get(`/api/console/devices?brand=${other.id}`)).body.devices;
  assert.ok(!listed.some((d) => d.id === theirs.id));
  err(await shop.post("/api/console/devices/remove", { id: theirs.id }), 404);
  err(await shop.post("/api/console/devices/code", { id: theirs.id }), 404);
  assert.equal((await desk.get(`/api/console/devices?brand=${other.id}`)).body.devices.some((d) => d.id === theirs.id), true, "it is still there");
  try {
    const hidden = await shop.post("/api/console/catalogue/hide", { brand: other.id, product: A.id, hidden: true });
    assert.equal(hidden.status, 200, "a hide lands on the retailer's own store");
    assert.equal((await desk.get("/api/console/catalogue?brand=" + other.id)).body.products.some((p) => p.hidden), false, "and not on the other one");
  } finally {
    await shop.post("/api/console/catalogue/hide", { brand: "sapphire", product: A.id, hidden: false });
  }
});

test("a retailer can hide a piece from the catalogue the mirror loads, and show it again", async () => {
  const desk = await founder();
  const anon = visitor();
  const loaded = async () => (await anon.get("/api/brands/sapphire")).body;
  const before = await loaded();
  const piece = products[5];
  try {
    const hidden = await desk.post("/api/console/catalogue/hide", { brand: "sapphire", product: piece.id, hidden: true });
    assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
    assert.deepEqual(hidden.body.hidden, [piece.id]);
    const after = await loaded();
    assert.ok(!after.catalogue.products.some((p) => p.id === piece.id), "the mirror no longer lists it");
    assert.equal(after.catalogue.products.length, before.catalogue.products.length - 1);
    assert.equal(after.brand.id, "sapphire");
    assert.deepEqual(after.catalogue.addons, before.catalogue.addons);
    const row = (await desk.get("/api/console/catalogue?brand=sapphire")).body.products.find((p) => p.id === piece.id);
    assert.equal(row.hidden, true, "the console still shows it, marked hidden");
    err(await desk.post("/api/console/catalogue/hide", { brand: "sapphire", product: "no-such-piece", hidden: true }), 404);
  } finally {
    await desk.post("/api/console/catalogue/hide", { brand: "sapphire", product: piece.id, hidden: false });
  }
  const shown = await loaded();
  assert.equal(shown.catalogue.products.length, before.catalogue.products.length);
  assert.ok(shown.catalogue.products.some((p) => p.id === piece.id));
});

test("member-only routes refuse staff logins", async () => {
  const desk = await founder();
  const made = await desk.post("/api/hq/retailers/user", { brand: "sapphire", name: "Not A Shopper", email: mailFor("staff") });
  const shop = visitor();
  await shop.post("/api/auth/signin", { email: made.body.email, password: made.body.password });
  assert.equal((await shop.get("/api/wardrobe")).status, 403);
  assert.equal((await shop.post("/api/wardrobe", { brand: "sapphire", product: A.id })).status, 403);
  assert.equal((await shop.post("/api/boards", {})).status, 403);
});

// --- the mirror when mirrors must be paired -----------------------------------------
test("with closed mirrors, only a paired mirror or a signed-in member can send events and hand-offs", async () => {
  const body = { brand: "sapphire", visit: "closed-1", events: [{ kind: "visit" }] };
  const basket = { brand: "sapphire", looks: [{ product: A.id }] };
  const anon = visitor(undefined, closed);
  err(await anon.post("/api/events", body), 401, /not paired/);
  err(await anon.post("/api/handoff", basket), 401, /Pair this mirror/);

  const desk = await signInFounder(closed);
  const made = (await desk.post("/api/console/devices", { brand: "sapphire", name: "Mirror 1" })).body;
  const paired = (await visitor(undefined, closed).post("/api/pair", { code: made.code })).body;
  const header = { "x-mirva-device": `${paired.device}.${paired.token}` };
  assert.equal((await anon.post("/api/events", body, header)).body.stored, 1);
  assert.equal((await anon.post("/api/handoff", basket, header)).status, 200);

  for (const forged of [`${paired.device}.wrong-token`, `no-such-device.${paired.token}`, paired.token, `${paired.device}.`, ".x"])
    assert.equal((await anon.post("/api/events", body, { "x-mirva-device": forged })).status, 401, forged);

  const asMember = visitor(undefined, closed);
  assert.equal((await asMember.post("/api/auth/join", { name: "Closed Member", email: mailFor("closed"), password: PASSWORD, agree: true })).status, 200);
  assert.equal((await asMember.post("/api/events", body)).status, 200);

  const reset = await desk.post("/api/console/devices/code", { id: made.id });
  assert.equal(reset.status, 200);
  assert.equal((await anon.post("/api/events", body, header)).status, 401, "re-pairing a mirror cuts off its old token");
});

test("when the server is not behind a proxy a forged X-Forwarded-For does not dodge the throttles", async () => {
  const c = visitor("203.0.113.1", closed);
  let firstRefusal = -1;
  for (let i = 0; i < 15 && firstRefusal < 0; i++) {
    const r = await c.post("/api/pair", { code: "AAAAAA" }, { "x-forwarded-for": `198.51.100.${i + 1}` });
    if (r.status === 429) firstRefusal = i;
    else assert.equal(r.status, 404);
  }
  assert.ok(firstRefusal > 0 && firstRefusal <= 10, `refused after ${firstRefusal} tries from one real address`);
});

// --- security -----------------------------------------------------------------
test("another website cannot post to the platform through a visitor's browser", async () => {
  const email = mailFor("forged");
  const forged = { name: "Forged Member", email, password: PASSWORD, agree: true };
  const paths = ["/api/auth/join", "/api/auth/signin", "/api/auth/signout", "/api/auth/forgot", "/api/leads", "/api/events", "/api/handoff", "/api/wardrobe", "/api/boards", "/api/pair", "/api/claim"];
  for (const origin of ["https://evil.example", "null", "http://localhost:4398", `${main.base}.evil.example`, "http://localhost:4396"])
    for (const path of paths) {
      const r = await raw(path, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(forged) });
      assert.equal(r.status, 403, `${origin} -> ${path}`);
    }
  const sameSite = await raw("/api/leads", { method: "POST", headers: { origin: main.base, "content-type": "application/json" }, body: "{}" });
  assert.equal(sameSite.status, 400, "the app's own origin is let through to the normal checks");
  assert.equal((await visitor().post("/api/auth/join", forged)).status, 200, "the forged join left no account behind");
});

test("no cross-origin read access is granted", async () => {
  const r = await visitor().get("/api/me", { origin: "https://evil.example" });
  assert.equal(r.headers.get("access-control-allow-origin"), null);
  assert.equal(r.headers.get("access-control-allow-credentials"), null);
  assert.equal(r.headers.get("cross-origin-resource-policy"), "same-origin");
});

test("every kind of reply carries the sniffing and framing protections", async () => {
  const a = await member("headers");
  for (const [path, who] of [["/api/health", visitor()], ["/api/plans", visitor()], ["/api/me", a], ["/api/wardrobe", visitor()], ["/api/no-such-route", visitor()], ["/mirror", visitor()], ["/no-such-page", visitor()], ["/api/hq/overview", visitor()]]) {
    const r = await who.get(path);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", path);
    assert.equal(r.headers.get("x-frame-options"), "DENY", path);
  }
});

test("a 150 KB body is refused whole, never cut short and accepted, and the server keeps serving", async () => {
  const c = visitor();
  const email = mailFor("big");
  const padding = "x".repeat(150 * 1024);
  const r = await c.post("/api/auth/join", { name: "Big Body", email, password: PASSWORD, agree: true, padding });
  assert.ok(r.status >= 400 && r.status < 500, `status ${r.status}`);
  assert.equal(r.cookies.length, 0);
  err(await visitor().post("/api/auth/signin", { email, password: PASSWORD }), 401, /don't match/);

  const huge = { name: "Big Body", email: mailFor("big"), company: "Big Co", brand: "sapphire", looks: [{ product: A.id }], events: [{ kind: "visit" }], padding };
  for (const path of ["/api/auth/signin", "/api/leads", "/api/events", "/api/handoff"]) {
    const res = await visitor().post(path, huge);
    assert.ok(res.status >= 400 && res.status < 500, `${path} -> ${res.status}`);
  }
  const forgot = await visitor().post("/api/auth/forgot", huge);
  assert.equal(forgot.status, 200, "a reset request always gets the same answer");
  assert.equal((await c.get("/api/health")).status, 200);
  assert.equal((await c.get("/api/plans")).status, 200);
});

test("hostile text in a name or a note is stored as plain text and never breaks the reply", async () => {
  const m = await member("hostile", { name: `<img src=x onerror=alert(1)> "quoted" \u0000nul` });
  const me = (await m.get("/api/me")).body.user;
  assert.ok(!me.name.includes("\u0000"), "control characters are stripped");
  assert.ok(me.name.includes("<img"), "text is kept as typed; the pages are what must escape it");
  assert.match((await m.get("/api/me")).headers.get("content-type"), /^application\/json/, "so it can never be read as a page");
});

// --- throttles: these come last, each from its own address, so nothing above is affected -------
test("sign-in is throttled per email: eight wrong tries and the ninth is refused", async () => {
  const m = await member("target");
  const c = visitor();
  for (let i = 1; i <= 8; i++) err(await c.post("/api/auth/signin", { email: m.email, password: `wrong try ${i}` }), 401);
  err(await c.post("/api/auth/signin", { email: m.email, password: "wrong again" }), 429, /Wait fifteen minutes/);
  err(await c.post("/api/auth/signin", { email: m.email, password: PASSWORD }), 429, /Wait fifteen minutes/); // even the right password waits
  const bystander = await member("bystander");
  assert.equal((await c.post("/api/auth/signin", { email: bystander.email, password: PASSWORD })).status, 200, "another email from the same place is not caught up in it");
});

test("sign-in is throttled per address: twenty failures from one place and the next is refused", async () => {
  const c = visitor();
  for (let i = 1; i <= 20; i++) err(await c.post("/api/auth/signin", { email: mailFor("stranger"), password: "guess" }), 401);
  err(await c.post("/api/auth/signin", { email: mailFor("stranger"), password: "guess" }), 429);
  const someoneElse = await member("elsewhere");
  assert.equal((await visitor().post("/api/auth/signin", { email: someoneElse.email, password: PASSWORD })).status, 200, "other addresses are unaffected");
});

test("making accounts, asking for resets, pairing and sending leads are all throttled", async () => {
  const hammer = async (path, makeBody, allowed) => {
    const c = visitor();
    for (let i = 0; i < allowed; i++) assert.notEqual((await c.post(path, makeBody(i))).status, 429, `${path} #${i + 1}`);
    err(await c.post(path, makeBody(allowed)), 429);
  };
  await hammer("/api/auth/join", () => ({ name: "Spam", email: "nope", password: PASSWORD, agree: true }), 8);
  await hammer("/api/auth/forgot", () => ({ email: mailFor("spam") }), 6);
  await hammer("/api/pair", () => ({ code: "AAAAAA" }), 10);
  await hammer("/api/leads", () => lead(), 5);
});

// --- last ---------------------------------------------------------------------
test("neither server logged an error while all of this was going on", () => {
  for (const s of servers) {
    const noise = s.err.split(/\r?\n/).filter((line) => line.trim() && !/ExperimentalWarning|--trace-warnings/.test(line));
    assert.deepEqual(noise, [], `server on ${s.port} wrote to stderr`);
  }
});

// --- trust: what she removed stays on her own record; joining says 18 or over -------------------------

test("a member can see what she removed and when, and nobody else's", async () => {
  const m = await member("remover");
  const other = await member("onlooker");
  assert.deepEqual((await m.get("/api/me/deleted")).body.deleted, []);
  const look = await addLook(m, A, "M");
  const before = Date.now();
  assert.equal((await m.post("/api/wardrobe/remove", { id: look.id })).status, 200);
  const { deleted } = (await m.get("/api/me/deleted")).body;
  assert.equal(deleted.length, 1);
  assert.deepEqual([deleted[0].name, deleted[0].portrait], [A.name, false]);
  assert.ok(deleted[0].at >= before - 5 && deleted[0].at <= Date.now() + 5);
  assert.deepEqual((await other.get("/api/me/deleted")).body.deleted, [], "her record is hers alone");
  err(await visitor().get("/api/me/deleted"), 401);
});

test("joining asks for 18 or over in the same breath as the terms", async () => {
  const r = await visitor().post("/api/auth/join", { name: "No Tick", email: mailFor("notick"), password: PASSWORD });
  err(r, 400, /18 or over.*terms.*privacy notice/);
});
