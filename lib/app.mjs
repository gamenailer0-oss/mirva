// MIRVA's whole request handler, in the web's own terms: a Request goes in, a Response comes out.
// It knows nothing about Node, files or sockets. The host (server.mjs on a laptop, a Worker at the
// edge) supplies the database, the throttle, the portrait store, the pictures on disk and the
// outbound reach check, and decides who the caller is.
import { modelShotPrompt } from "./prompt.mjs";
import { TYPES, SECURITY, CSP, PAGES, PATTERNS, json, readBody, readForm } from "./http.mjs";
import { liveToken, portrait } from "./decart.mjs";
import { readShopify, storeDomain, storeId } from "./shopify.mjs";
import { createPlatform } from "./platform.mjs";

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
    setupKey: env.setupKey || "",
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

  async function modelShot(request) {
    if (!env.hasKey) return json(503, { error: "No Decart key. Add DECART_API_KEY to the .env file and restart." });
    const who = await platform.identify(request);
    let form;
    try {
      form = await readForm(request, 9 * 1024 * 1024);
    } catch (e) {
      return json(e.status || 400, { error: e.status ? e.message : "I couldn't read that picture." });
    }
    const asked = String(form.get("mode") || "portrait");
    const mode = asked === "backdrop" || asked === "relight" ? "backdrop" : "portrait"; // "relight" is the old name
    const may = await platform.grant(who, mode);
    if (!may.ok) return json(may.status, { error: may.error, limit: may.limit });
    if (!(await allow("shot", env.shotsPerHour))) return json(429, { error: "That is a lot of portraits for one hour. Try again a little later." });
    const person = form.get("person");
    const reference = mode === "portrait" ? form.get("reference") : null;
    const isImage = (b) =>
      b && typeof b === "object" && typeof b.arrayBuffer === "function" && ["image/jpeg", "image/png", "image/webp"].includes(b.type) && b.size > 2000;
    if (!isImage(person)) return json(400, { error: "I need a picture of you to do that." });
    const brandId = String(form.get("brand") || "");
    const entry = brands.get(brandId);
    const product = entry?.catalogue.products.find((p) => p.id === String(form.get("product") || ""));
    if (!product) return json(404, { error: "I can't find that piece." });
    const withReference = isImage(reference);

    let prompt = modelShotPrompt(product, mode, { reference: withReference });
    if (env.debugShots && form.get("promptOverride")) prompt = String(form.get("promptOverride"));
    const started = Date.now();
    let result;
    try {
      result = await portrait(env.key, { prompt, person, reference: withReference ? reference : undefined });
    } catch (e) {
      console.error("model-shot:", String(e.message || e).replaceAll(env.key, "[key]"));
      if (e.credit) {
        await platform.creditOut();
        return resting();
      }
      const up = e.status;
      // Busy (a gateway timeout, an upstream 5xx or 429, or our own timeout): she can simply try again.
      if (!up || up >= 500 || up === 429) return json(503, { error: "The studio is busy. One more try.", busy: true });
      if (up === 401 || up === 403) return json(502, { error: "The try-on engine refused the key (401)." });
      return json(502, { error: "The portrait didn't come out." });
    }
    const bytes = new Uint8Array(result.bytes);
    const type = result.type || "image/png";
    await platform.meter(who, mode, brandId, 0, env.config.shotPrice);
    await platform.creditOk();
    // A member's portrait is kept for them, so it can go into the wardrobe. Nobody else's is stored.
    // A backdrop takes the place of the portrait it was made from.
    const saved =
      who.kind !== "member"
        ? ""
        : mode === "backdrop"
          ? await platform.replacePortrait(who.user, String(form.get("replaces") || "").slice(0, 40), brandId, product.id, bytes, type)
          : await platform.savePortrait(who.user, brandId, product.id, bytes, type);
    if (env.debugShots && deps.debugShot) await deps.debugShot(String(form.get("label") || mode).replace(/[^a-z0-9_-]/gi, "") + "-" + Date.now() + ".png", bytes);
    return new Response(bytes, {
      status: 200,
      headers: {
        ...SECURITY,
        "content-type": type,
        "cache-control": "no-store",
        "x-mirva-seconds": ((Date.now() - started) / 1000).toFixed(1),
        ...(saved ? { "x-mirva-portrait": saved } : {}),
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
        // Bundles are rebuilt on every start, so they are always checked; fonts and models can sit in the cache.
        "cache-control": ext === ".task" || ext === ".tflite" || ext === ".wasm" ? "public, max-age=86400" : "no-cache",
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

  async function serveStatic(pathname) {
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
    return found ? fileResponse(rel, found) : notFound(pathname);
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
        return json(200, { ...env.config, open: !!env.openMirror, ...(mirror ? { idleSeconds: mirror.idleSeconds } : {}), visit: mirror ? mirror.visit : null });
      }
      if (path === "/api/model-shot" && method === "POST") return await modelShot(request);
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
        return json(200, { brand, catalogue: hidden.size ? { ...entry.catalogue, products: entry.catalogue.products.filter((p) => !hidden.has(p.id)) } : entry.catalogue });
      }

      if (path === "/img") return await proxyImage(url);
      if (path.startsWith("/api/")) {
        const answer = await platform.handle(request, url, { ip });
        return answer || json(404, { error: "not found" });
      }
      return await serveStatic(path);
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
