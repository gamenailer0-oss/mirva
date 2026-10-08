// MIRVA on Cloudflare. The same app as server.mjs, given the edge's own parts:
// D1 for the store, KV for portraits and loaded catalogues, the edge cache for product pictures.
import { createApp } from "../lib/app.mjs";
import { databaseLimiter } from "../lib/auth.mjs";
import sapphireBrand from "../brands/sapphire/brand.json";
import sapphireCatalogue from "../brands/sapphire/catalogue.json";
import lawrencepurBrand from "../brands/lawrencepur/brand.json";
import lawrencepurCatalogue from "../brands/lawrencepur/catalogue.json";

// Catalogues that ship with the code. Sapphire's and Lawrencepur's are concept demos built from their public
// sites, with no agreement behind them. The founder chose to show them publicly; the mirror labels each a concept
// demo, and the founder's desk can take either off the public list at any time.
const BUILT_IN = {
  sapphire: { brand: sapphireBrand, catalogue: sapphireCatalogue },
  lawrencepur: { brand: lawrencepurBrand, catalogue: lawrencepurCatalogue },
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== undefined && v !== "" ? Number(v) : fallback);

// D1 behind the four calls the app knows.
function store(DB) {
  const bind = (sql, p) => DB.prepare(sql).bind(...p.map((v) => (v === undefined ? null : v)));
  return {
    get: async (sql, ...p) => (await bind(sql, p).first()) ?? undefined,
    all: async (sql, ...p) => (await bind(sql, p).all()).results || [],
    run: async (sql, ...p) => {
      const r = await bind(sql, p).run();
      return { changes: Number(r.meta?.changes) || 0, lastId: Number(r.meta?.last_row_id) || 0 };
    },
    batch: async (list) => void (await DB.batch(list.map(([sql, ...p]) => bind(sql, p)))),
  };
}

// One app for the life of this isolate, and the catalogues it has in memory.
let ready = null;
const brands = new Map();
const stamps = new Map();

async function refreshBrands(env, db) {
  const rows = await db.all("SELECT id, at FROM stores");
  const live = new Set(rows.map((r) => r.id));
  for (const { id, at } of rows) {
    if (stamps.get(id) === at) continue;
    const entry = await env.FILES.get("store:" + id, "json");
    if (entry?.brand && entry?.catalogue) (brands.set(id, entry), stamps.set(id, at));
  }
  for (const [id, entry] of Object.entries(BUILT_IN)) if (!live.has(id) && !brands.has(id)) brands.set(id, entry);
  for (const id of [...brands.keys()]) if (!live.has(id) && !BUILT_IN[id]) (brands.delete(id), stamps.delete(id));
}

async function start(env, origin) {
  const db = store(env.DB);
  const key = String(env.DECART_API_KEY || "").trim();
  const hasKey = key.startsWith("dct_") && !key.includes("your_key");
  const publicOrigin = String(env.MIRVA_PUBLIC_ORIGIN || origin).replace(/\/+$/, "");
  const config = {
    live: hasKey,
    model: "lucy-vton-latest",
    sessionSeconds: clamp(num(env.MIRVA_SESSION_SECONDS, 120), 20, 900),
    idleSeconds: clamp(num(env.MIRVA_IDLE_SECONDS, 60), 20, 600),
    ratePerSecond: 0.02,
    shotPrice: 0.02,
    usdToPkr: 277,
  };
  const limiter = databaseLimiter(db);
  await refreshBrands(env, db);
  const app = await createApp({
    env: {
      key,
      hasKey,
      origin: publicOrigin,
      origins: new Set([publicOrigin, origin]),
      hosts: null, // Cloudflare only delivers requests for this app's own hostnames
      // A mirror open to anyone would let the whole internet spend the try-on budget.
      openMirror: env.MIRVA_OPEN_MIRROR === "1",
      payments: env.MIRVA_PAYMENTS || "off",
      config,
      shotsPerHour: clamp(num(env.MIRVA_SHOTS_PER_HOUR, 30), 1, 1000),
      tokensPerHour: clamp(num(env.MIRVA_SESSIONS_PER_HOUR, 20), 1, 1000),
      dailyUsd: clamp(num(env.MIRVA_DAILY_USD, 5), 0, 1000),
      setupKey: String(env.SETUP_KEY || ""),
      debugShots: false,
      kdf: "pbkdf2", // scrypt needs more processor time than a free edge request gets
      hsts: publicOrigin.startsWith("https://"),
    },
    db,
    limiter,
    files: {
      put: (id, bytes, type) => env.FILES.put("portrait:" + id, bytes, { metadata: { type } }),
      async get(id) {
        const { value, metadata } = await env.FILES.getWithMetadata("portrait:" + id, "arrayBuffer");
        return value ? { bytes: value, type: metadata?.type || "image/png" } : null;
      },
      del: (id) => env.FILES.delete("portrait:" + id),
    },
    brands,
    async saveBrandEntry(id, entry) {
      const at = Date.now();
      await env.FILES.put("store:" + id, JSON.stringify(entry));
      await db.run("INSERT INTO stores (id, at) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at", id, at);
      brands.set(id, entry);
      stamps.set(id, at);
    },
    async assets(path) {
      const res = await env.ASSETS.fetch(new Request("https://assets.invalid/" + path.split("/").map(encodeURIComponent).join("/")));
      return res.status === 200 ? { body: res.body, type: res.headers.get("content-type") || undefined } : null;
    },
    imageCache: {
      async get(k) {
        const hit = await caches.default.match("https://img-cache.invalid/" + k);
        return hit ? { bytes: await hit.arrayBuffer(), type: hit.headers.get("content-type") || "image/jpeg" } : null;
      },
      put: (k, bytes, type) => caches.default.put("https://img-cache.invalid/" + k, new Response(bytes, { headers: { "content-type": type, "cache-control": "public, max-age=604800" } })),
    },
    reachable: async () => true, // the edge cannot see a private network, so there is nothing to protect here
  });
  return { app, db, limiter };
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      ready ||= start(env, url.origin).catch((e) => ((ready = null), Promise.reject(e)));
      const { app, db } = await ready;
      // Catalogues can change in another isolate; the list is one cheap query away.
      if (url.pathname.startsWith("/api/") || url.pathname === "/mirror") await refreshBrands(env, db).catch(() => {});
      return await app.fetch(request, { ip: request.headers.get("cf-connecting-ip") || "edge", host: undefined });
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ error: "Something went wrong on the server." }), { status: 500, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }
  },

  // Housekeeping, every six hours: portraits nobody kept, expired sessions, old throttle counters.
  async scheduled(_event, env, ctx) {
    ready ||= start(env, String(env.MIRVA_PUBLIC_ORIGIN || "https://mirva.invalid"));
    const { app, limiter } = await ready;
    ctx.waitUntil(Promise.allSettled([app.sweep(), limiter.sweep()]));
  },
};
