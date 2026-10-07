// MIRVA server, the Node host.
// The request handling itself lives in lib/app.mjs and speaks the web's Request and Response, so the
// same code can run elsewhere. This file is what only a laptop or a small server needs: the .env
// file, the SQLite file, portraits and pictures on disk, the brand files, and the HTTP listener.
import http from "node:http";
import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, normalize, dirname, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { lookup } from "node:dns/promises";
import { json } from "./lib/http.mjs";
import { openDb } from "./lib/db.mjs";
import { memoryLimiter } from "./lib/auth.mjs";
import { createApp } from "./lib/app.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, "public");
const BRANDS = join(ROOT, "brands");
const CACHE = join(ROOT, ".cache", "img");

// --- environment -----------------------------------------------------------
if (existsSync(join(ROOT, ".env"))) {
  for (const line of readFileSync(join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const KEY = (process.env.DECART_API_KEY || "").trim();
const HAS_KEY = KEY.startsWith("dct_") && !KEY.includes("your_key");
const PORT = Number(process.env.PORT) || 4310;
const DATA = process.env.MIRVA_DATA || join(ROOT, ".data");
// Set MIRVA_PUBLIC_ORIGIN (https://…) when this runs behind a real address. Until then it is a local machine.
const PUBLIC_ORIGIN = (process.env.MIRVA_PUBLIC_ORIGIN || "").replace(/\/+$/, "");
const ORIGIN = PUBLIC_ORIGIN || "http://localhost:" + PORT;
// An open mirror lets anyone who can reach the page start a paid try-on. Fine on a laptop, never on the internet.
const OPEN_MIRROR = process.env.MIRVA_OPEN_MIRROR ? process.env.MIRVA_OPEN_MIRROR === "1" : !PUBLIC_ORIGIN;
const PAYMENTS = process.env.MIRVA_PAYMENTS || (PUBLIC_ORIGIN ? "off" : "test");
const CONFIG = {
  live: HAS_KEY,
  model: "lucy-vton-latest",
  sessionSeconds: clamp(Number(process.env.MIRVA_SESSION_SECONDS) || 180, 20, 900),
  idleSeconds: clamp(Number(process.env.MIRVA_IDLE_SECONDS) || 75, 20, 600),
  ratePerSecond: 0.02, // Decart list price for realtime try-on, USD
  shotPrice: 0.02, // Decart list price for one 720p still, USD
  usdToPkr: 277,
};
const SHOTS_PER_HOUR = clamp(Number(process.env.MIRVA_SHOTS_PER_HOUR) || 60, 1, 1000);
const TOKENS_PER_HOUR = clamp(Number(process.env.MIRVA_SESSIONS_PER_HOUR) || 60, 1, 1000);
const DEBUG_SHOTS = process.env.MIRVA_DEBUG_SHOTS === "1"; // keeps generated stills on disk; off by default
const ORIGINS = new Set(["http://localhost:" + PORT, "http://127.0.0.1:" + PORT, ...(PUBLIC_ORIGIN ? [PUBLIC_ORIGIN] : [])]);
const HOSTS = new Set([...ORIGINS].map((o) => o.replace(/^https?:\/\//, "")));
const TRUST_PROXY = process.env.MIRVA_TRUST_PROXY === "1";

// --- reaching out ----------------------------------------------------------
// Outbound requests go only to public addresses, so a typed "store address" can never be used
// to reach this machine or the network it sits on.
function isPrivate(address, family) {
  if (family === 6) {
    const a = address.toLowerCase();
    if (a.startsWith("::ffff:")) return isPrivate(a.slice(7), 4);
    return a === "::1" || a === "::" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe8") || a.startsWith("fe9") || a.startsWith("fea") || a.startsWith("feb");
  }
  const [p, q] = address.split(".").map(Number);
  return p === 0 || p === 10 || p === 127 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127) || p >= 224;
}
async function reachable(host) {
  try {
    const found = await lookup(host, { all: true });
    return found.length > 0 && found.every(({ address, family }) => !isPrivate(address, family));
  } catch {
    return false;
  }
}

// --- brands on disk --------------------------------------------------------
const brands = new Map(); // id -> { brand, catalogue }
const catalogueOnDisk = new WeakSet(); // catalogues already saved as they are, so a brand change rewrites only brand.json

async function loadBrands() {
  if (!existsSync(BRANDS)) return;
  for (const dir of await readdir(BRANDS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const bFile = join(BRANDS, dir.name, "brand.json");
    const cFile = join(BRANDS, dir.name, "catalogue.json");
    if (!existsSync(bFile) || !existsSync(cFile)) continue;
    try {
      const brand = JSON.parse(await readFile(bFile, "utf8"));
      const catalogue = JSON.parse(await readFile(cFile, "utf8"));
      brands.set(brand.id, { brand, catalogue });
      catalogueOnDisk.add(catalogue);
    } catch (e) {
      console.warn(`brand ${dir.name} skipped: ${e.message}`);
    }
  }
}

// Saves a brand (and its catalogue, when it is new) and makes it the one in memory.
async function saveBrandEntry(id, entry) {
  await mkdir(join(BRANDS, id), { recursive: true });
  await writeFile(join(BRANDS, id, "brand.json"), JSON.stringify(entry.brand, null, 1));
  if (!catalogueOnDisk.has(entry.catalogue)) {
    await writeFile(join(BRANDS, id, "catalogue.json"), JSON.stringify(entry.catalogue, null, 1));
    catalogueOnDisk.add(entry.catalogue);
  }
  brands.set(id, entry);
}

// --- files -----------------------------------------------------------------
// Kept portraits: one file per portrait, named by its id. The picture's type lives in the database row.
const PORTRAITS = join(DATA, "portraits");
mkdirSync(PORTRAITS, { recursive: true });
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const files = {
  put: (id, bytes) => writeFile(join(PORTRAITS, id), bytes),
  async get(id) {
    if (!SAFE_ID.test(id)) return null;
    try {
      return { bytes: await readFile(join(PORTRAITS, id)), type: "application/octet-stream" };
    } catch {
      return null;
    }
  },
  del: (id) => (SAFE_ID.test(id) ? unlink(join(PORTRAITS, id)).catch(() => {}) : Promise.resolve()),
};

// Product pictures fetched once from the store and kept on disk. The key is the SHA-1 of the address.
const SAFE_KEY = /^[0-9a-f]{40}$/;
const imageCache = {
  async get(key) {
    if (!SAFE_KEY.test(key)) return null;
    const file = join(CACHE, key);
    if (!existsSync(file) || !existsSync(file + ".type")) return null;
    return { type: await readFile(file + ".type", "utf8"), bytes: await readFile(file) };
  },
  async put(key, bytes, type) {
    if (!SAFE_KEY.test(key)) return;
    await mkdir(CACHE, { recursive: true });
    await writeFile(join(CACHE, key), bytes);
    await writeFile(join(CACHE, key + ".type"), type);
  },
};

// The built site. A path that climbs out of public/ is simply not found.
async function assets(rel) {
  const file = normalize(join(PUBLIC, rel));
  if (file === PUBLIC || !file.startsWith(PUBLIC + sep)) return null;
  try {
    return { body: await readFile(file) };
  } catch {
    return null;
  }
}

async function debugShot(name, bytes) {
  await mkdir(join(ROOT, ".cache", "shots"), { recursive: true });
  await writeFile(join(ROOT, ".cache", "shots", basename(name)), bytes);
}

async function firstRunWrite(text) {
  const file = join(DATA, "first-run.txt");
  await writeFile(file, text);
  return file;
}

await loadBrands();
const app = await createApp({
  env: {
    key: KEY,
    hasKey: HAS_KEY,
    origin: ORIGIN,
    origins: ORIGINS,
    hosts: HOSTS,
    openMirror: OPEN_MIRROR,
    payments: PAYMENTS,
    config: CONFIG,
    shotsPerHour: SHOTS_PER_HOUR,
    tokensPerHour: TOKENS_PER_HOUR,
    debugShots: DEBUG_SHOTS,
    kdf: "scrypt",
    dailyUsd: Math.max(0, Number(process.env.MIRVA_DAILY_USD) || 0), // 0 = no ceiling, right for a laptop
    setupKey: process.env.MIRVA_SETUP_KEY || "",
    hsts: PUBLIC_ORIGIN.startsWith("https://"),
  },
  db: openDb(DATA),
  limiter: memoryLimiter(),
  files,
  brands,
  saveBrandEntry,
  assets,
  imageCache,
  reachable,
  debugShot,
  firstRunWrite,
});

// --- Node http <-> web Request and Response ---------------------------------
// Who is asking: the address the socket came from, or, behind our own proxy, the one the proxy saw.
function clientIp(req) {
  if (TRUST_PROXY) {
    const first = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || "";
}

// The request's body as a web stream, read only as fast as the app asks for it. Unlike Readable.toWeb,
// giving up on it (a body past its size limit, a route that never reads it) does not tear the
// connection down: what the app did not read is quietly discarded, so the reply still gets through.
function bodyStream(req) {
  let open = true;
  const stream = new ReadableStream({
    start(controller) {
      req.on("data", (chunk) => {
        if (!open) return;
        controller.enqueue(new Uint8Array(chunk));
        if (controller.desiredSize <= 0) req.pause();
      });
      req.on("end", () => open && ((open = false), controller.close()));
      req.on("error", (e) => open && ((open = false), controller.error(e)));
      req.on("close", () => open && ((open = false), controller.error(new Error("the connection closed before the body ended"))));
      req.pause();
    },
    pull() {
      if (open) req.resume();
    },
    cancel() {
      open = false;
      req.resume();
    },
  });
  // Called once the reply is out: whatever is left of the body is thrown away.
  const discard = () => {
    open = false;
    if (!req.readableEnded) req.resume();
  };
  return { stream, discard };
}

function toRequest(req, url) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    try {
      headers.append(name, Array.isArray(value) ? value.join(name === "cookie" ? "; " : ", ") : value);
    } catch {}
  }
  const init = { method: req.method, headers };
  let discard = () => {};
  if (req.method === "POST") {
    const body = bodyStream(req);
    Object.assign(init, { body: body.stream, duplex: "half" });
    discard = body.discard;
  }
  return { request: new Request(url.href, init), discard };
}

async function send(req, res, response) {
  const headers = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  if (req.method === "HEAD" || !response.body) {
    res.writeHead(response.status, headers);
    return res.end();
  }
  const body = Buffer.from(await response.arrayBuffer());
  headers["content-length"] = body.length;
  res.writeHead(response.status, headers);
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    return send(req, res, json(400, { error: "bad address" }));
  }
  let request, discard;
  try {
    ({ request, discard } = toRequest(req, url));
  } catch {
    // The web's Request refuses a few things Node's parser lets through: a method like TRACE, or an
    // address with a user name in it. Neither is something this server answers.
    return send(req, res, ["GET", "HEAD", "POST"].includes(req.method) ? json(400, { error: "bad address" }) : json(405, { error: "method not allowed" }));
  }
  res.on("close", discard);
  try {
    await send(req, res, await app.fetch(request, { ip: clientIp(req), host: req.headers.host }));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) await send(req, res, json(500, { error: "Something went wrong on the server." }));
    else res.end();
  }
});
server.requestTimeout = 120e3;
server.headersTimeout = 20e3;

// Housekeeping every six hours: portraits nobody kept, expired sessions, closed boards.
setInterval(() => app.sweep().catch(() => {}), 6 * 3600e3).unref();

// Localhost only by default: this process can mint tokens that spend money.
server.listen(PORT, process.env.MIRVA_LISTEN || "127.0.0.1", () => {
  console.log(`MIRVA is at ${ORIGIN}`);
  console.log(`  shoppers /   mirror /mirror   stores /retail   console /console   founder /hq`);
  console.log(`  brands: ${[...brands.keys()].join(", ") || "none"}`);
  console.log(`  live try-on: ${HAS_KEY ? `on, capped at ${CONFIG.sessionSeconds}s a session` : "off (no key in .env)"}`);
  console.log(`  mirror: ${OPEN_MIRROR ? "open to this machine" : "paired mirrors and members only"}   payments: ${PAYMENTS}`);
  if (app.firstRun) console.log(`  first run: the founder sign-in is in ${app.firstRun}`);
});
