// MIRVA on Cloudflare. The same app as server.mjs, given the edge's own parts:
// D1 for the store, KV for portraits and loaded catalogues, the edge cache for product pictures.
import { DurableObject } from "cloudflare:workers";
import { createApp } from "../lib/app.mjs";
import { across } from "../lib/link.mjs";
import { databaseLimiter } from "../lib/auth.mjs";
import { createPush } from "../lib/push.mjs";
import sapphireBrand from "../brands/sapphire/brand.json";
import sapphireCatalogue from "../brands/sapphire/catalogue.json";
import lawrencepurBrand from "../brands/lawrencepur/brand.json";
import lawrencepurCatalogue from "../brands/lawrencepur/catalogue.json";
import outfittersBrand from "../brands/outfitters/brand.json";
import outfittersCatalogue from "../brands/outfitters/catalogue.json";
import naqshiBrand from "../brands/naqshi/brand.json";
import naqshiCatalogue from "../brands/naqshi/catalogue.json";
import baroqueBrand from "../brands/baroque/brand.json";
import baroqueCatalogue from "../brands/baroque/catalogue.json";
import aghaNoorBrand from "../brands/agha-noor/brand.json";
import aghaNoorCatalogue from "../brands/agha-noor/catalogue.json";

// Catalogues that ship with the code. Sapphire's, Lawrencepur's and Outfitters' are concept demos built from their public
// sites, with no agreement behind them. The founder chose to show them publicly; the mirror labels each a concept
// demo, and the founder's desk can take either off the public list at any time.
const BUILT_IN = {
  sapphire: { brand: sapphireBrand, catalogue: sapphireCatalogue },
  lawrencepur: { brand: lawrencepurBrand, catalogue: lawrencepurCatalogue },
  outfitters: { brand: outfittersBrand, catalogue: outfittersCatalogue },
  // Naqshi, Baroque and Agha Noor said yes to seeing their own catalogues in MIRVA (21 Oct 2026): chosen and described
  // by hand from their public sites, by link only (/for/<id>, /mirror?brand=<id>) until the founder lists them.
  naqshi: { brand: naqshiBrand, catalogue: naqshiCatalogue },
  baroque: { brand: baroqueBrand, catalogue: baroqueCatalogue },
  "agha-noor": { brand: aghaNoorBrand, catalogue: aghaNoorCatalogue },
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
  // All at once: one after another, a new isolate spent seconds here (27 stores, Oct 2026) and every page waited.
  await Promise.all(
    rows
      .filter(({ id, at }) => stamps.get(id) !== at)
      .map(async ({ id, at }) => {
        const entry = await env.FILES.get("store:" + id, "json");
        if (entry?.brand && entry?.catalogue) (brands.set(id, entry), stamps.set(id, at));
      }),
  );
  for (const [id, entry] of Object.entries(BUILT_IN)) if (!live.has(id) && !brands.has(id)) brands.set(id, entry);
  for (const id of [...brands.keys()]) if (!live.has(id) && !BUILT_IN[id]) (brands.delete(id), stamps.delete(id));
}

// The catalogues are read once by a new isolate, then looked at again at most every half minute, behind the answer:
// the database is in Milan, so a read before every call added a fifth of a second to each one from Pakistan.
// A store asked for by name that this isolate has not seen yet (loaded a moment ago elsewhere) is read before answering.
const STORES_FRESH_MS = 30e3;
let storesAt = 0;
let storesReading = null;
const readStores = (env, db) =>
  (storesReading ||= refreshBrands(env, db)
    .then(() => void (storesAt = Date.now()))
    .finally(() => (storesReading = null)));
async function storesFor(url, env, db, ctx) {
  const id = url.pathname.match(/^\/api\/(?:brands|cloth)\/([a-z0-9-]+)/)?.[1] || url.searchParams.get("brand");
  if (!storesAt || (id && !brands.has(id))) return readStores(env, db);
  if (Date.now() - storesAt > STORES_FRESH_MS) ctx.waitUntil(readStores(env, db).catch(() => {}));
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
  const app = await createApp({
    // Phone notifications: the signing key is two secrets (VAPID_PUBLIC_KEY, VAPID_PRIVATE_JWK). Without them, none are sent.
    push: createPush({ publicKey: env.VAPID_PUBLIC_KEY, privateJwk: env.VAPID_PRIVATE_JWK, subject: env.MIRVA_PUSH_SUBJECT || "mailto:founder@mirva.local" }),
    env: {
      key,
      hasKey,
      falKey: String(env.FAL_KEY || "").trim(), // a Worker secret: the outlines that keep her own face, and the second engine
      origin: publicOrigin,
      origins: new Set([publicOrigin, origin]),
      hosts: null, // Cloudflare only delivers requests for this app's own hostnames
      // A mirror open to anyone would let the whole internet spend the try-on budget.
      openMirror: env.MIRVA_OPEN_MIRROR === "1",
      payments: env.MIRVA_PAYMENTS || "off",
      config,
      shotsPerHour: clamp(num(env.MIRVA_SHOTS_PER_HOUR, 30), 1, 1000),
      tokensPerHour: clamp(num(env.MIRVA_SESSIONS_PER_HOUR, 20), 1, 1000),
      dailyUsd: clamp(num(env.MIRVA_DAILY_USD, 5), 0, 1000), // live Studio, a day
      dailyPortraitUsd: clamp(num(env.MIRVA_DAILY_PORTRAIT_USD, 3), 0, 1000), // portraits and backdrops, a day
      guestShots: clamp(num(env.MIRVA_GUEST_SHOTS, 0), 0, 1000), // free first portraits a day, before joining
      trials: String(env.MIRVA_TRIALS || ""), // features tried on named accounts first, e.g. "three:<user id>"
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
      return res.status === 200 ? { body: res.body, type: res.headers.get("content-type") || undefined, etag: res.headers.get("etag") || undefined } : null;
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
      // Plain http takes one permanent step to https, before anything else: the site's own address is read from the
      // first request an instance sees, and it must never be an http one. Local wrangler dev stays on http.
      if (url.protocol === "http:" && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) {
        url.protocol = "https:";
        return Response.redirect(url.toString(), 301);
      }
      ready ||= start(env, url.origin).catch((e) => ((ready = null), Promise.reject(e)));
      const { app, db } = await ready;
      // A store's tablet or its mirror screen joining their room (lib/link.mjs): the ticket says which room and side.
      if (url.pathname === "/api/link/socket") {
        if (request.headers.get("upgrade") !== "websocket") return new Response("This address takes a WebSocket.", { status: 426 });
        const seat = await app.checkLink(url.searchParams.get("t"));
        if (!seat) return new Response("That ticket is not good, or it is old.", { status: 403 });
        const forward = new Request(request);
        forward.headers.set("x-mirva-side", seat.side);
        return env.ROOMS.get(env.ROOMS.idFromName(seat.room)).fetch(forward);
      }
      // Pages and files never wait for the catalogues; the calls, the mirror and the picture proxy (its list of allowed
      // hosts comes from them) do. Catalogues can change in another isolate (see storesFor).
      if (url.pathname.startsWith("/api/") || url.pathname === "/mirror" || url.pathname === "/img") await storesFor(url, env, db, ctx).catch(() => {});
      return await app.fetch(request, { ip: request.headers.get("cf-connecting-ip") || "edge", host: undefined, later: (p) => ctx.waitUntil(p.catch(() => {})) });
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ error: "Something went wrong on the server." }), { status: 500, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }
  },

  // Housekeeping, every six hours: portraits nobody kept, expired sessions, old throttle counters.
  async scheduled(_event, env, ctx) {
    ready ||= start(env, String(env.MIRVA_PUBLIC_ORIGIN || "https://mirva.invalid"));
    const { app, db, limiter } = await ready;
    await readStores(env, db).catch(() => {}); // the founder's notes name stores
    ctx.waitUntil(Promise.allSettled([app.sweep(), limiter.sweep()]));
  },
};

// A store's tablet and its mirror screen, joined (lib/link.mjs): one room to a screen, holding one screen and one
// tablet. Each message from one side goes to the other as it is. The room sleeps between messages (WebSocket
// hibernation) and answers the sides' "ping" without waking, so a quiet store costs nothing.
export class MirrorRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    const side = request.headers.get("x-mirva-side") === "pad" ? "pad" : "glass";
    const { 0: client, 1: server } = new WebSocketPair();
    // A newer screen or tablet takes the older one's place (4000: it stops trying again).
    for (const old of this.ctx.getWebSockets(side)) old.close(4000, "replaced");
    this.ctx.acceptWebSocket(server, [side]);
    this.tell(across(side), { t: "peer", side, here: true });
    server.send(JSON.stringify({ t: "peer", side: across(side), here: this.ctx.getWebSockets(across(side)).length > 0 }));
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > 64000) return;
    const [side] = this.ctx.getTags(ws);
    for (const peer of this.ctx.getWebSockets(across(side))) peer.send(message);
  }

  webSocketClose(ws, code) {
    const [side] = this.ctx.getTags(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, "bye");
    } catch {}
    // Said only when no other socket holds this side (a replaced one is followed by its newer one).
    if (!this.ctx.getWebSockets(side).some((w) => w !== ws)) this.tell(across(side), { t: "peer", side, here: false });
  }

  webSocketError(ws) {
    this.webSocketClose(ws, 1011);
  }

  tell(side, message) {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets(side))
      try {
        ws.send(text);
      } catch {}
  }
}
