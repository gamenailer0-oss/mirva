// Starts the real server with no Decart key, so nothing here can spend money.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 4399;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const base = `http://localhost:${PORT}`;
// The server gets its own empty data directory, so these tests never touch the real database.
const DATA = mkdtempSync(join(tmpdir(), "mirva-server-test-"));
let server;

before(async () => {
  server = spawn(process.execPath, ["server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DECART_API_KEY: "", MIRVA_DATA: DATA },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 15000);
    server.stdout.on("data", (d) => String(d).includes("MIRVA is at") && (clearTimeout(timer), resolve()));
    server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
});

after(async () => {
  if (server && server.exitCode === null) {
    const gone = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await gone;
  }
  // SQLite may still hold its files for a moment on Windows.
  try {
    rmSync(DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
});

// fetch() will not let a caller set Host or Origin freely, so the hostile cases use a raw request.
const raw = (path, { method = "GET", headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path, method, headers: { host: `localhost:${PORT}`, ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });

test("the mirror app shell loads with security headers and a content policy", async () => {
  const res = await fetch(base + "/mirror");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  const csp = res.headers.get("content-security-policy");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.match(res.headers.get("permissions-policy"), /camera=\(self\)/);
  const html = await res.text();
  assert.match(html, /<title>MIRVA<\/title>/);
  assert.doesNotMatch(html, /dct_/, "no key in the page");
});

test("the server keeps its data in the directory it was given", () => {
  assert.ok(existsSync(join(DATA, "mirva.db")), "database is in the throwaway directory");
  assert.ok(existsSync(join(DATA, "first-run.txt")), "founder sign-in is written there too");
});

test("the built bundle and the files the engines need are served", async () => {
  for (const [path, type] of [
    ["/dist/app.js", /javascript/],
    ["/dist/frame-metadata-worker.js", /javascript/],
    ["/dist/chunks/frame-metadata-worker.js", /javascript/],
    ["/dist/mp/vision_wasm_internal.wasm", /application\/wasm/],
    ["/models/pose_landmarker_lite.task", /octet-stream/],
    ["/styles.css", /text\/css/],
  ]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get("content-type"), type, path);
    await res.arrayBuffer();
  }
});

test("the bundle never contains the permanent key", async () => {
  const js = await (await fetch(base + "/dist/app.js")).text();
  assert.doesNotMatch(js, /dct_[A-Za-z0-9_-]{20,}/);
});

test("config reports that try-on is off without a key", async () => {
  const c = await (await fetch(base + "/api/config")).json();
  assert.equal(c.live, false);
  assert.ok(c.sessionSeconds >= 20 && c.idleSeconds >= 20);
  assert.equal(c.model, "lucy-vton-latest");
});

test("brands and catalogues are served", async () => {
  const brands = await (await fetch(base + "/api/brands")).json();
  assert.ok(brands.some((b) => b.id === "sapphire"));
  const { brand, catalogue } = await (await fetch(base + "/api/brands/sapphire")).json();
  assert.equal(brand.name, "Sapphire");
  assert.match(brand.notice, /Not affiliated/);
  assert.ok(catalogue.products.length > 0 && Array.isArray(catalogue.addons));
  assert.equal((await fetch(base + "/api/brands/nope")).status, 404);
  assert.equal((await fetch(base + "/api/unknown")).status, 404);
});

test("paid calls refuse cleanly when there is no key", async () => {
  const token = await fetch(base + "/api/token", { method: "POST" });
  assert.equal(token.status, 503);
  assert.match((await token.json()).error, /DECART_API_KEY/);
  const shot = await fetch(base + "/api/model-shot", { method: "POST", body: new FormData() });
  assert.equal(shot.status, 503);
});

test("another website cannot make paid calls through a visitor's browser", async () => {
  for (const path of ["/api/token", "/api/model-shot", "/api/brands/import"]) {
    const res = await raw(path, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 403, path);
  }
});

test("a request addressed to another host name is refused (DNS rebinding)", async () => {
  const res = await raw("/api/token", { method: "POST", headers: { host: "evil.example" } });
  assert.equal(res.status, 403);
});

test("unsupported methods are refused", async () => {
  for (const method of ["PUT", "DELETE", "PATCH"]) assert.equal((await raw("/api/config", { method })).status, 405, method);
});

test("the image proxy only fetches from the stores it knows", async () => {
  const hostile = [
    "https://evil.example/x.jpg",
    "http://127.0.0.1:4399/api/config",
    "http://169.254.169.254/latest/meta-data/",
    "file:///etc/passwd",
    "https://pk.sapphireonline.pk.evil.example/x.jpg",
  ];
  for (const u of hostile) assert.equal((await fetch(`${base}/img?u=${encodeURIComponent(u)}`)).status, 403, u);
  assert.equal((await fetch(`${base}/img?u=not-a-url`)).status, 400);
  assert.equal((await fetch(`${base}/img`)).status, 400);
});

test("files outside the public folder cannot be read", async () => {
  for (const path of ["/.env", "/../.env", "/..%2f.env", "/%2e%2e/%2e%2e/.env", "/..\\.env", "/server.mjs", "/../server.mjs", "/dist/../../package.json"]) {
    const res = await raw(path);
    assert.ok([403, 404].includes(res.status), `${path} -> ${res.status}`);
    assert.doesNotMatch(res.body, /DECART_API_KEY|createDecartClient|"dependencies"/, path);
  }
});

test("bringing in a store rejects anything that is not a plain store address", async () => {
  for (const domain of ["", "localhost", "127.0.0.1", "not a domain", "javascript:alert(1)", "http://", "a".repeat(400)]) {
    const res = await fetch(base + "/api/brands/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain }) });
    assert.equal(res.status, 400, JSON.stringify(domain));
  }
});

test("a broken or oversized body does not crash the server", async () => {
  const bad = await fetch(base + "/api/brands/import", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
  assert.equal(bad.status, 400);
  const big = await raw("/api/brands/import", { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(200_000) }).catch(() => ({ status: 0 }));
  assert.ok([0, 400, 413, 500].includes(big.status));
  assert.equal((await fetch(base + "/api/config")).status, 200, "still serving");
});

test("error replies never leak internals", async () => {
  const res = await fetch(base + "/api/brands/..%2f..%2fetc");
  const text = await res.text();
  assert.doesNotMatch(text, /at .*\(|node:internal|D:\\|\/Mirva\//);
});
