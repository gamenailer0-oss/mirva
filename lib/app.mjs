// MIRVA's whole request handler, in the web's own terms: a Request goes in, a Response comes out.
// It knows nothing about Node, files or sockets. The host (server.mjs on a laptop, a Worker at the
// edge) supplies the database, the throttle, the portrait store, the pictures on disk and the
// outbound reach check, and decides who the caller is.
import { modelShotPrompt } from "./prompt.mjs";
import { TYPES, SECURITY, CSP, PAGES, PATTERNS, json, readBody, readForm } from "./http.mjs";
import { liveToken, portrait } from "./decart.mjs";
import { outlines, fashn, fashnCategory, FAL_PRICE, HER, DRAWN, DRAWN_STUDIO } from "./finish.mjs";
import { packShot, SHOT_TYPE } from "./shot.mjs";
import { readShopify, storeDomain, storeId } from "./shopify.mjs";
import { createPlatform } from "./platform.mjs";
import { migrate } from "./schema.mjs";
import { createPush } from "./push.mjs";

const MAX_BRANDS = 200;
const HSTS = { "strict-transport-security": "max-age=31536000; includeSubDomains" };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// The same answer path.extname gives: the last dot of the last segment, but not a leading one.
const extname = (p) => {
  const base = p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 || base === ".." ? "" : base.slice(dot);
};

const sha1 = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function createApp(deps) {
  const { env, db, limiter, files, brands } = deps;
  await migrate(db);
  const push = deps.push || createPush({});

  // Spending guard across the whole service: a sliding window per kind of paid call.
  const allow = (kind, max) => limiter.limit("spend:" + kind, max, 3600e3);

  // Paid or state-changing calls must come from this app's own page. A browser always sends
  // Origin on a cross-site POST, so another website cannot spend the key through a visitor.
  function trusted(request, host) {
    if (env.hosts && !env.hosts.has(host || "")) return false; // also stops DNS-rebinding tricks
    const origin = request.headers.get("origin");
    return !origin || env.origins.has(origin);
  }

  // --- brands ----------------------------------------------------------------
  const allowedImageHosts = () => {
    const hosts = new Set();
    for (const { brand } of brands.values()) for (const h of brand.imageHosts || []) hosts.add(h);
    return hosts;
  };

  // A retailer's console can change how MIRVA dresses for them: mood, accent, byline.
  async function saveBrand(id, patch) {
    const entry = brands.get(id);
    if (!entry) throw new Error("unknown brand");
    Object.assign(entry.brand, patch);
    await deps.saveBrandEntry(id, entry);
  }

  // Any Shopify store publishes /products.json. That is enough to dress MIRVA in a new brand.
  async function importBrand(input) {
    const id = storeId(storeDomain(input));
    // The cap is checked after the address is known to be well formed and before anyone is called.
    const entry = await readShopify(input, async (host) => {
      if (!brands.has(id) && brands.size >= MAX_BRANDS) throw new Error("MIRVA is holding as many demo stores as it can. Write to us and we will load yours.");
      return deps.reachable(host);
    });
    await deps.saveBrandEntry(entry.brand.id, entry);
    if (brands.get(entry.brand.id) !== entry) brands.set(entry.brand.id, entry);
    return entry.brand;
  }

  const platform = await createPlatform({
    db,
    limiter,
    files,
    brands,
    config: env.config,
    importShopify: importBrand,
    saveBrand,
    origin: env.origin,
    openMirror: env.openMirror,
    payments: env.payments,
    kdf: env.kdf,
    dailyUsd: env.dailyUsd || 0,
    dailyPortraitUsd: env.dailyPortraitUsd ?? env.dailyUsd ?? 0,
    setupKey: env.setupKey || "",
    push,
  });
  const firstRun = deps.firstRunWrite ? await platform.ensureFounder(deps.firstRunWrite) : null;

  // --- the try-on engine -------------------------------------------------------
  // The Model shot: one still of the shopper wearing the piece, in her own pose and framing.
  //   mode "portrait": her frame, plus the garment picture. With no garment picture the garment is told in words.
  //   mode "backdrop": the portrait she already has, with only the background replaced. No garment picture.
  //                    It comes with a portrait (see grant), costs the same, and replaces the kept portrait of a member.
  // A call that fails is never metered: the meter is written only once a picture has come back.
  // An account out of credit is the exception to "busy": the shopper is told it is resting, the founder is told why (see creditOut).
  const resting = () => json(503, { error: "Try-on is resting just now. Please try again in a little while.", limit: "resting" });

  async function modelShot(request, ip = "") {
    if (!env.hasKey) return json(503, { error: "No Decart key. Add DECART_API_KEY to the .env file and restart." });
    const who = await platform.identify(request);
    let form;
    try {
      form = await readForm(request, 9 * 1024 * 1024);
    } catch (e) {
      return json(e.status || 400, { error: e.status ? e.message : "I couldn't read that picture." });
    }
    const asked = String(form.get("mode") || "portrait");
    // "portrait": a new look. "retake": the same look again from the second engine, when Decart moved her head and her
    // own could not be laid back (it comes with a portrait, like a backdrop). "backdrop" ("relight" before): the old
    // studio-wall pass, still answered for mirrors that have not reloaded since 15 October 2026.
    const mode = asked === "backdrop" || asked === "relight" ? "backdrop" : asked === "retake" ? "retake" : "portrait";
    if (mode === "retake" && !env.falKey) return json(503, { error: "The second studio is not set up.", limit: "no-retake" });
    let may = await platform.grant(who, mode);
    // Someone who has not joined may see one portrait of herself before she is asked to (platform guestGrant).
    let guest = null;
    if (!may.ok && who.kind === "none" && env.guestShots > 0) {
      guest = mode === "portrait" ? await platform.guestGrant(request, ip, env.guestShots) : await platform.guestBackdrop(request, form.get("replaces"), mode);
      may = guest;
    }
    if (!may.ok) return json(may.status, { error: may.error, limit: may.limit });
    if (!(await allow("shot", env.shotsPerHour))) return json(429, { error: "That is a lot of portraits for one hour. Try again a little later." });
    const person = form.get("person");
    const reference = mode !== "backdrop" ? form.get("reference") : null;
    const isImage = (b) =>
      b && typeof b === "object" && typeof b.arrayBuffer === "function" && ["image/jpeg", "image/png", "image/webp"].includes(b.type) && b.size > 2000;
    if (!isImage(person)) return json(400, { error: "I need a picture of you to do that." });
    const brandId = String(form.get("brand") || "");
    const entry = brands.get(brandId);
    const product = entry?.catalogue.products.find((p) => p.id === String(form.get("product") || ""));
    if (!product) return json(404, { error: "I can't find that piece." });
    if ((await platform.photoOnlyFor(brandId)).has(product.id)) return json(403, { error: "This piece is shown in the store's own photographs.", limit: "photo-only" });
    const withReference = isImage(reference);
    // A portrait is made from the garment's own picture or not at all. Drawn from the description it would be a garment
    // of that kind, in colours and embroidery of the engine's choosing, and a store cannot have that shown as its piece.
    if (mode !== "backdrop" && !withReference) return json(422, { error: "This piece is shown in the store's own photographs.", limit: "photo-only" });

    // A mirror from 15 October 2026 on asks for the cloud's finish (form "finish=cloud"): the outlines that let the
    // phone lay her own face, hair and shoes back (lib/finish.mjs, src/keep.js), and the second engine when Decart
    // cannot. Older pages get exactly what they always did.
    const cloud = mode !== "backdrop" && form.get("finish") === "cloud" && !!env.falKey;
    const herKnown = form.get("her") === "known"; // the same photo as her last portrait: the phone still has its outlines
    const started = Date.now();
    const personBytes = cloud || mode === "retake" ? await person.arrayBuffer() : null;
    const falFault = (e) => {
      console.error("fal:", String(e?.message || e).replaceAll(env.falKey || "\u0000", "[key]"));
      if (e?.credit) platform.falOut().catch(() => {});
      return null;
    };
    // Her outlines are found while the engine works, so they cost no time.
    const herAsked = cloud && mode === "portrait" && !herKnown ? outlines(env.falKey, personBytes, person.type, HER).catch(falFault) : null;
    const second = async () => {
      const r = await fashn(env.falKey, { person: personBytes, personType: person.type, reference: await reference.arrayBuffer(), referenceType: reference.type, category: fashnCategory(product) });
      return { ...r, engine: "fashn" };
    };

    let result;
    let decartOut = null;
    if (mode === "retake") {
      try {
        result = await second();
      } catch (e) {
        falFault(e);
        return json(503, { error: "The second studio could not make it just now.", limit: "no-retake" });
      }
    } else {
      let prompt = modelShotPrompt(product, mode, { below: form.get("wornBelow"), above: form.get("wornAbove") });
      if (env.debugShots && form.get("promptOverride")) prompt = String(form.get("promptOverride"));
      try {
        result = { ...(await portrait(env.key, { prompt, person, reference: withReference ? reference : undefined })), engine: "decart" };
      } catch (e) {
        console.error("model-shot:", String(e.message || e).replaceAll(env.key, "[key]"));
        const up = e.status;
        const busy = !up || up >= 500 || up === 429;
        if (e.credit) {
          decartOut = e;
          await platform.creditOut();
        }
        // Out of credit, or down: a new mirror still gets its portrait, from the second engine.
        if (cloud && (e.credit || busy)) result = await second().catch(falFault);
        if (!result) {
          if (e.credit) return resting();
          // Busy (a gateway timeout, an upstream 5xx or 429, or our own timeout): she can simply try again.
          if (busy) return json(503, { error: "The studio is busy. One more try.", busy: true });
          if (up === 401 || up === 403) return json(502, { error: "The try-on engine refused the key (401)." });
          return json(502, { error: "The portrait didn't come out." });
        }
      }
    }
    const bytes = new Uint8Array(result.bytes);
    const type = result.type || "image/png";

    // What the phone needs to finish it. From Decart: the outlines (or "device": the cloud could not outline, so the
    // phone falls back to its own head restore). From FASHN: nothing, the engine kept her face itself.
    let meta = null, outlined = 0;
    if (cloud || mode === "retake") {
      if (result.engine === "fashn") meta = { face: "engine", engine: "fashn", type };
      else {
        const drawnAsked = outlines(env.falKey, bytes, type, form.get("studio") === "1" ? DRAWN_STUDIO : DRAWN).catch(falFault);
        const [her, drawn] = await Promise.all([herAsked, drawnAsked]);
        outlined = (her ? Object.keys(HER).length : 0) + (drawn ? Object.keys(drawn).length : 0);
        meta = drawn && (her || herKnown) ? { face: "cloud", engine: "decart", type, drawn, ...(her ? { her } : {}) } : { face: "device", engine: "decart", type };
      }
    }
    const usd = (result.engine === "fashn" ? FAL_PRICE.fashn : env.config.shotPrice) + outlined * FAL_PRICE.outline;
    await platform.meter(who, mode, brandId, 0, Math.round(usd * 1000) / 1000);
    if (result.engine === "decart") await platform.creditOk();
    else if (!decartOut) platform.falOk?.().catch(() => {});
    // A member's portrait is kept for them, so it can go into the wardrobe. Nobody else's is stored.
    // A backdrop or a retake takes the place of the portrait it was made from.
    const saved = guest
      ? await platform.saveGuestShot(guest.guest, ip, brandId, product.id, bytes, type, guest.row || null)
      : who.kind !== "member"
        ? ""
        : mode !== "portrait"
          ? await platform.replacePortrait(who.user, String(form.get("replaces") || "").slice(0, 40), brandId, product.id, bytes, type)
          : await platform.savePortrait(who.user, brandId, product.id, bytes, type);
    if (env.debugShots && deps.debugShot) await deps.debugShot(String(form.get("label") || mode).replace(/[^a-z0-9_-]/gi, "") + "-" + Date.now() + ".png", bytes);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    return new Response(meta ? packShot({ ...meta, seconds: Number(seconds) }, bytes) : bytes, {
      status: 200,
      headers: {
        ...SECURITY,
        "content-type": meta ? SHOT_TYPE : type,
        "cache-control": "no-store",
        "x-mirva-seconds": seconds,
        ...(saved ? { "x-mirva-portrait": saved } : {}),
        ...(guest ? { "x-mirva-guest": "1" } : {}),
        ...(guest?.cookie ? { "set-cookie": guest.cookie } : {}),
      },
    });
  }

  async function token(request) {
    if (!env.hasKey) return json(503, { error: "No Decart key. Add DECART_API_KEY to the .env file and restart." });
    const who = await platform.identify(request);
    const may = await platform.grant(who, "live");
    if (!may.ok) return json(may.status, { error: may.error, limit: may.limit });
    if (!(await allow("token", env.tokensPerHour))) return json(429, { error: "That is a lot of live sessions for one hour. Try again a little later." });
    const body = await readBody(request);
    const brandId = brands.has(body.brand) ? body.brand : null;
    // The token can only start a session for the next minute, and Decart itself
    // ends that session at the cap. The browser never sees the permanent key.
    let made;
    try {
      made = await liveToken(env.key, may.seconds);
    } catch (e) {
      if (!e.credit) throw e;
      console.error("token:", String(e.message || e).replaceAll(env.key, "[key]"));
      await platform.creditOut();
      return resting();
    }
    // The meter starts at the full cap; the mirror reports the real length when the look comes off. A token that failed is never metered.
    const grant = await platform.meter(who, "live", brandId, may.seconds, may.seconds * env.config.ratePerSecond);
    await platform.creditOk();
    return json(200, { apiKey: made.apiKey, expiresAt: made.expiresAt, grant, seconds: may.seconds });
  }

  async function proxyImage(url) {
    let target;
    try {
      target = new URL(url.searchParams.get("u"));
    } catch {
      return json(400, { error: "bad image address" });
    }
    if (target.protocol !== "https:" || !allowedImageHosts().has(target.host)) return json(403, { error: "image host not allowed" });

    const w = clamp(Number(url.searchParams.get("w")) || 720, 120, 1400);
    // Each platform has its own resize parameter. Ask for no more pixels than the mirror needs.
    if (target.host.endsWith("sapphireonline.pk")) target.search = `?sw=${w}`;
    else if (target.host === "cdn.shopify.com" || target.pathname.includes("/cdn/shop/")) target.search = `?width=${w}`;

    const key = await sha1(target.href);
    try {
      const cached = await deps.imageCache.get(key);
      if (cached) return new Response(cached.bytes, { status: 200, headers: { ...SECURITY, "content-type": cached.type, "cache-control": "public, max-age=604800" } });
      if (!(await deps.reachable(target.hostname))) return json(403, { error: "image host not allowed" });
      const upstream = await fetch(target, { headers: { "user-agent": "Mozilla/5.0 (MIRVA prototype)" }, redirect: "manual", signal: AbortSignal.timeout(15000) });
      const type = upstream.headers.get("content-type") || "";
      if (!upstream.ok || !type.startsWith("image/")) return json(502, { error: "image not available" });
      const bytes = new Uint8Array(await upstream.arrayBuffer());
      if (bytes.byteLength > 12 * 1024 * 1024) return json(502, { error: "image too large" });
      await deps.imageCache.put(key, bytes, type);
      return new Response(bytes, { status: 200, headers: { ...SECURITY, "content-type": type, "cache-control": "public, max-age=604800" } });
    } catch {
      return json(502, { error: "image fetch failed" });
    }
  }

  // --- pages and files -----------------------------------------------------------
  function fileResponse(rel, found, status = 200) {
    const ext = extname(rel).toLowerCase();
    return new Response(found.body, {
      status,
      headers: {
        ...SECURITY,
        ...(env.hsts ? HSTS : {}),
        ...(ext === ".html" ? { "content-security-policy": CSP } : {}),
        "content-type": TYPES[ext] || found.type || "application/octet-stream",
        // Bundles are rebuilt on every start, so they are always checked. The models never change under one name and are large
        // (the hair-and-skin model is 16 MB), so they sit in the cache for a month.
        "cache-control": ext === ".task" || ext === ".tflite" || ext === ".woff2" ? "public, max-age=2592000" : ext === ".wasm" ? "public, max-age=86400" : "no-cache",
        // The script stores put on their own websites is the one file other sites load.
        ...(/^(showcase|refs|share|icons|brand)\//.test(rel) && /\.(webp|jpe?g|png|svg)$/.test(rel) ? { "cache-control": "public, max-age=86400, stale-while-revalidate=604800" } : {}),
        ...(rel === "embed.js" ? { "cross-origin-resource-policy": "cross-origin", "cache-control": "public, max-age=3600" } : {}),
      },
    });
  }

  async function notFound(pathname) {
    // A person who mistypes an address gets a page; a script asking for a missing file gets a plain answer.
    if (!extname(pathname)) {
      try {
        const page = await deps.assets("site/404.html");
        if (page) return fileResponse("site/404.html", page, 404);
      } catch {}
    }
    return new Response("Not found", { status: 404, headers: { ...SECURITY, "content-type": "text/plain; charset=utf-8" } });
  }

  async function serveStatic(pathname, url = null) {
    let rel = PAGES[pathname] || PATTERNS.find(([re]) => re.test(pathname))?.[1];
    if (!rel) {
      try {
        rel = decodeURIComponent(pathname.slice(1));
      } catch {
        return json(400, { error: "bad address" });
      }
    }
    let found = null;
    try {
      found = await deps.assets(rel);
    } catch {}
    if (!found) return notFound(pathname);
    if (!rel.endsWith(".html")) return fileResponse(rel, found);
    // Link previews need whole addresses; the pages are written with paths, so they work under any domain.
    let html = (await new Response(found.body).text()).replace(/(<meta property="og:(?:image|url)" content=")\//g, (_, head) => head + env.origin + "/");
    // A voting link is opened from WhatsApp more than anywhere: its preview carries the question and the looks.
    const board = pathname.match(/^\/b\/([A-Z0-9]{10})$/);
    if (board) {
      const meta = await platform.boardPreview(board[1]).catch(() => null);
      if (meta) html = html.replace("</head>", meta + "\n</head>");
    }
    const res = fileResponse(rel, { body: html });
    // Opened in a store's own website with a pass it was given (public/embed.js): that website, and only that one, may
    // hold the mirror in its sheet. Every other page, and the mirror without a pass, can never be framed.
    const pass = pathname === "/mirror" && url?.searchParams.get("embed") ? await platform.embedPass(url.searchParams.get("embed")).catch(() => null) : null;
    if (pass) {
      res.headers.delete("x-frame-options");
      res.headers.set("content-security-policy", (res.headers.get("content-security-policy") || "").replace("frame-ancestors 'none'", "frame-ancestors " + pass.origin));
    }
    return res;
  }

  // One picture from each of a store's first three rails (or its first three pieces, when it has fewer rails).
  function coverOf(products) {
    const seen = new Set();
    const picks = [];
    for (const p of products) {
      if (!p.image || seen.has(p.lane)) continue;
      seen.add(p.lane);
      picks.push(p.image);
      if (picks.length === 3) return picks;
    }
    for (const p of products) {
      if (picks.length === 3) break;
      if (p.image && !picks.includes(p.image)) picks.push(p.image);
    }
    return picks;
  }

  // --- routes ----------------------------------------------------------------
  async function fetchRequest(request, ctx = {}) {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return json(400, { error: "bad address" });
    }
    const path = url.pathname;
    const method = request.method;
    const ip = ctx.ip || "";
    const host = ctx.host === undefined ? url.host : ctx.host;
    try {
      // The one call another website may make: a store's product page asking for a pass (public/embed.js).
      if (path === "/api/embed/session") return await platform.embedSession(request, ip);
      if (!["GET", "HEAD", "POST"].includes(method)) return json(405, { error: "method not allowed" });
      if (method === "POST" && !trusted(request, host)) return json(403, { error: "This request did not come from MIRVA." });
      if (path === "/api/health") return json(200, { ok: true });
      if (path === "/api/config") {
        // A store's paired mirror is told how a visit is shaped and gets a shorter idle wait. Everyone else gets the config as it is.
        // The page cannot start without this, so a database that stumbles must not take it down.
        let mirror = null;
        try {
          const who = await platform.identify(request);
          if (who.kind === "device") mirror = await platform.visitFor(who.device);
        } catch (e) {
          console.error("config:", e?.message || e);
        }
        return json(200, { ...env.config, open: !!env.openMirror, guest: !env.openMirror && env.guestShots > 0, ...(mirror ? { idleSeconds: mirror.idleSeconds, studio: mirror.studio, glass: mirror.glass } : {}), visit: mirror ? mirror.visit : null });
      }
      if (path === "/api/model-shot" && method === "POST") return await modelShot(request, ip);
      if (path === "/api/token" && method === "POST") return await token(request);

      if (path === "/api/brands" && method === "GET") {
        // A store loaded from a link opens by its link; only stores marked public are offered to everyone.
        const viewer = await platform.identify(request);
        const listed = [...brands.values()].filter(({ brand }) => brand.visibility !== "unlisted" || viewer.kind === "staff" || viewer.device?.brand === brand.id);
        return json(
          200,
          await Promise.all(
            listed.map(async ({ brand, catalogue }) => {
              const hidden = await platform.hiddenFor(brand.id);
              return {
                id: brand.id,
                name: brand.name,
                wordmark: brand.wordmark,
                accent: brand.accent,
                mood: brand.mood,
                imported: !!brand.imported,
                audience: brand.audience || "",
                tagline: brand.tagline || "",
                // three pieces from three different rails, for the store picker
                cover: coverOf(catalogue.products.filter((p) => !hidden.has(p.id))),
                count: catalogue.products.filter((p) => !hidden.has(p.id)).length,
              };
            }),
          ),
        );
      }

      if (path === "/api/brands/import" && method === "POST") {
        // Loading a new store writes to disk and calls out to the internet, so it is not for anonymous visitors.
        const who = await platform.identify(request);
        if (who.kind === "none" || who.kind === "member") return json(403, { error: "Only a store's own mirror can do that." });
        if (!(await limiter.limit("import:" + ip, 12, 3600e3))) return json(429, { error: "That's a lot of stores for one hour. Try again a little later." });
        const { domain } = await readBody(request);
        try {
          const brand = await importBrand(domain);
          return json(200, { id: brand.id, name: brand.name });
        } catch (e) {
          return json(400, { error: e.message });
        }
      }

      const m = path.match(/^\/api\/brands\/([a-z0-9-]+)$/);
      if (m && method === "GET") {
        const entry = brands.get(m[1]);
        if (!entry) return json(404, { error: "unknown brand" });
        const hidden = await platform.hiddenFor(m[1]);
        const brand = (await platform.signed(m[1])) ? { ...entry.brand, notice: "" } : entry.brand;
        const photoOnly = await platform.photoOnlyFor(m[1]);
        const products = hidden.size || photoOnly.size ? entry.catalogue.products.filter((p) => !hidden.has(p.id)).map((p) => (photoOnly.has(p.id) ? { ...p, photoOnly: true } : p)) : entry.catalogue.products;
        return json(200, { brand, catalogue: products === entry.catalogue.products ? entry.catalogue : { ...entry.catalogue, products } });
      }

      if (path === "/img") return await proxyImage(url);
      if (path.startsWith("/api/")) {
        const answer = await platform.handle(request, url, { ip, later: ctx.later });
        return answer || json(404, { error: "not found" });
      }
      return await serveStatic(path, url);
    } catch (e) {
      console.error(e);
      return json(500, { error: "Something went wrong on the server." });
    }
  }

  return {
    fetch: fetchRequest,
    platform,
    firstRun,
    async sweep() {
      await platform.sweep();
      await limiter.sweep?.();
    },
  };
}
