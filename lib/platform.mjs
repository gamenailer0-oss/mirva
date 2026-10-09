// The MIRVA platform: members and their wardrobes, voting boards, hand-offs from a store mirror,
// the event stream a retailer's console reads, leads from the retail site, and the founder's desk.
// The try-on engine itself lives in app.mjs; this module tells it who is asking and keeps the meter.
//
// Nothing here knows which runtime it is on. Requests come in as the web's Request and go out as
// Response; the database, the throttle and the portrait store are handed in by the host.
import { newId, newCode, parse } from "./ids.mjs";
import { hashPassword, verifyPassword, decoyHash, passwordProblem, startSession, endSession, currentUser, sha, newToken } from "./auth.mjs";
import { json, readBody, cookies, text, int, email as cleanEmail, SECURITY } from "./http.mjs";
import { MEMBER_TIERS, RETAIL_PLANS, EXTRAS, COST, USD_TO_PKR, MIRROR, VISIT, tierOf, monthlyFee, monthStart, pktDayStart } from "./plans.mjs";

const DAY = 86400e3;
// A portrait can be replaced by its finished version (the shopper's own head laid back, src/restore.js) for this long, up to this size.
const FINISH_WINDOW = 15 * 60e3;
const FINISH_MAX = 3 * 1024 * 1024;
const PKT = 5 * 3600e3; // Pakistan is UTC+5 all year
const EVENT_KINDS = new Set([
  "visit", "brief", "looks_shown", "look_open", "portrait", "live_start", "live_end",
  "keep", "unkeep", "addon", "send", "size_pick", "size_missed", "compare", "ended",
]);
const LEAD_STATUS = ["new", "contacted", "demo", "pilot", "won", "lost"];
const TRIED = "kind IN ('portrait','live_start')"; // the events that make a visit a session
const CREDIT = "tryon-credit"; // flags: the try-on account has no credit left
const CREDIT_TOLD = "tryon-credit-told"; // flags: the Pakistan day the founder was last written to about it
const rupees = (n) => "Rs." + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * db       the async store (get / all / run / batch)
 * limiter  { limit, blocked, strike }, all async
 * files    { put(id, bytes, type), get(id) -> {bytes, type} | null, del(id) } for kept portraits
 * kdf      which password scheme this runtime hashes with ("scrypt" or "pbkdf2")
 */
export async function createPlatform({ db, limiter, files, brands, config, importShopify, saveBrand, origin, openMirror, payments, kdf, dailyUsd = 0, setupKey = "" }) {
  const secure = origin.startsWith("https://");

  // --- small shared pieces ---------------------------------------------------
  // `ip` is the caller's address as the host decided it, or null when there is no caller.
  const audit = (ip, actor, action, target = "") =>
    db.run("INSERT INTO audit (at, actor, action, target, ip) VALUES (?,?,?,?,?)", Date.now(), actor || "", action, String(target).slice(0, 120), ip || "");

  // Nothing is sent from here yet. Every message MIRVA would send waits in the outbox,
  // so connecting an email or WhatsApp sender later is one function, not a rewrite.
  const notify = (channel, recipient, subject, body) =>
    db.run("INSERT INTO outbox (at, channel, recipient, subject, body) VALUES (?,?,?,?,?)", Date.now(), channel, recipient, subject, body);

  const publicUser = (u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    brand: u.brand || null,
    tier: u.role === "member" ? tierOf(u).id : null,
    profile: parse(u.profile),
    joined: u.created,
  });

  const usageOf = async (userId) => {
    const since = monthStart();
    const row = await db.get(
      "SELECT COALESCE(SUM(kind = 'portrait'), 0) AS portraits, COALESCE(SUM(CASE WHEN kind = 'live' THEN seconds ELSE 0 END), 0) AS live FROM usage WHERE user = ? AND at >= ?",
      userId,
      since,
    );
    return { portraits: Number(row.portraits) || 0, liveSeconds: Math.round(Number(row.live) || 0) };
  };

  // --- a store mirror's ceilings ----------------------------------------------
  // A paired mirror has no member's allowance to run out of, so it is held to three things instead: what one
  // mirror may spend in a Pakistan day, how many sessions the store's plan includes in a month (and what the
  // store has agreed to go over by), and how many try-ons one mirror may start in an hour.
  const settingsOf = (row) => {
    const s = parse(row?.settings);
    return s && typeof s === "object" && !Array.isArray(s) ? s : {};
  };
  // A number read from stored settings, kept inside its bounds. Anything that is not a number gives the fallback.
  const bounded = (v, lo, hi, fallback) => ((typeof v === "number" || (typeof v === "string" && v.trim() !== "")) && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback);
  const budgetOf = (settings) => bounded(settings.mirrorDailyUsd, 0, 1000, MIRROR.dailyUsd);
  const overageOf = (settings) => Math.round(bounded(settings.overageSessions, 0, MIRROR.overageMax, 0));

  // A retailers row read as a store: its plan, the sessions it includes (plan x stores), and its own settings.
  function storeFrom(row) {
    const plan = RETAIL_PLANS[row.plan] || null;
    const settings = settingsOf(row);
    const stores = Math.max(1, Math.round(Number(row.stores) || 1));
    return { row, settings, plan, stores, allowance: plan ? plan.sessions * stores : 0, overage: overageOf(settings), budget: budgetOf(settings) };
  }
  async function storeOf(brandId) {
    const row = brandId ? await db.get("SELECT * FROM retailers WHERE brand = ?", brandId) : undefined;
    return row ? storeFrom(row) : null;
  }
  // Sessions this month at a brand's paired mirrors: visits that reached a portrait or a live look.
  // The seeded sample (sample 1), members at home (2) and a signed-in desk (no device) are not the store's.
  async function sessionsIn(brandId, now = Date.now()) {
    const row = await db.get(`SELECT COUNT(DISTINCT COALESCE(visit, '')) AS n FROM events WHERE brand = ? AND device IS NOT NULL AND sample = 0 AND at >= ? AND ${TRIED}`, brandId, monthStart(now));
    return Number(row?.n) || 0;
  }
  function sessionsOf(store, used) {
    const limit = store.allowance + store.overage;
    const over = Math.max(0, used - store.allowance);
    return { used, allowance: store.allowance, overage: store.overage, limit, over, overPkr: over * EXTRAS.sessionOverage, stopped: used >= limit };
  }
  async function spentToday(deviceId, now = Date.now()) {
    const row = await db.get("SELECT COALESCE(SUM(usd), 0) AS n FROM usage WHERE device = ? AND at >= ? AND sample = 0", deviceId, pktDayStart(now));
    return Number(row?.n) || 0;
  }

  // May this paired mirror start another try-on? The answer is a refusal, or the seconds a live look may run.
  // The hourly counter is asked last, so a refusal for any other reason never uses up one of its hits.
  async function deviceCeilings(device, kind) {
    const now = Date.now();
    const store = await storeOf(device.brand);
    const left = (store ? store.budget : budgetOf({})) - (await spentToday(device.id, now));
    const dayOver = { ok: false, status: 429, error: "This mirror has done its try-ons for today. The stylist still works.", limit: "mirror-day" };
    if (left <= 1e-9) return dayOver;
    // A live look is reserved at its full length when it starts, so it may not run past what the day has left.
    let seconds = config.sessionSeconds;
    if (kind === "live" && config.ratePerSecond > 0) {
      seconds = Math.min(seconds, Math.floor(left / config.ratePerSecond + 1e-9));
      if (seconds < MIRROR.liveFloorSeconds) return dayOver;
    }
    if (store?.plan && (await sessionsIn(device.brand, now)) >= store.allowance + store.overage)
      return { ok: false, status: 429, error: "This store has used its try-ons for the month. The stylist still works.", limit: "store-month" };
    if (!(await limiter.limit("mirror:" + device.id, MIRROR.perHour, 3600e3)))
      return { ok: false, status: 429, error: "This mirror has been busy this hour. Give it a little while; the stylist still works.", limit: "mirror-hour" };
    return { ok: true, seconds };
  }

  // How a shopper's visit at this mirror is shaped (the page enforces it), and how long it waits before it lets go.
  async function visitFor(device) {
    const set = settingsOf((await storeOf(device?.brand))?.row).visit;
    const v = set && typeof set === "object" && !Array.isArray(set) ? set : {};
    const n = (key, lo, hi, fallback = VISIT[key]) => Math.round(bounded(v[key], lo, hi, fallback));
    return {
      visit: { liveLooks: n("liveLooks", 0, 20), liveSeconds: n("liveSeconds", 20, 900), portraits: n("portraits", 0, 40), resetSeconds: n("resetSeconds", 10, 600) },
      idleSeconds: n("idleSeconds", 20, 600, Math.min(config.idleSeconds, VISIT.idleSeconds)),
    };
  }

  // What a store's console shows and sets about limits: the budget for each mirror and how today's spending stands against it,
  // the sessions the plan includes and how many have been used, and how far past them the store has agreed to go.
  async function limitsOf(brandId, user) {
    const store = await storeOf(brandId);
    const budget = store ? store.budget : budgetOf({});
    const spent = new Map(
      (await db.all("SELECT device, SUM(usd) AS n FROM usage WHERE device IS NOT NULL AND at >= ? AND sample = 0 AND device IN (SELECT id FROM devices WHERE brand = ?) GROUP BY device", pktDayStart(), brandId)).map((r) => [r.device, Number(r.n) || 0]),
    );
    const mirrors = await db.all("SELECT id, name, store, paired FROM devices WHERE brand = ? ORDER BY created", brandId);
    return {
      brand: brandId,
      mirrorDailyUsd: budget,
      mirrorDailyPkr: Math.round(budget * USD_TO_PKR),
      defaultDailyUsd: MIRROR.dailyUsd,
      minDailyUsd: MIRROR.dailyUsdMin,
      maxDailyUsd: user?.role === "founder" ? MIRROR.dailyUsdMaxFounder : MIRROR.dailyUsdMaxRetailer,
      overageSessions: store ? store.overage : 0,
      overageMax: MIRROR.overageMax,
      overagePkr: EXTRAS.sessionOverage,
      tryOnsPerHour: MIRROR.perHour,
      plan: store?.plan ? { id: store.plan.id, name: store.plan.name, stores: store.stores, status: store.row.status } : null,
      sessions: store?.plan ? sessionsOf(store, await sessionsIn(brandId)) : null,
      mirrors: mirrors.map((d) => {
        const usd = spent.get(d.id) || 0;
        return { id: d.id, name: d.name, store: d.store || "", paired: !!d.paired, spentUsd: Math.round(usd * 1e4) / 1e4, hit: usd >= budget - 1e-9 };
      }),
    };
  }

  // What the founder should look at first, as sentences ready to read. In the order they matter:
  // the try-on account out of credit, stores past their allowance, stores close to it, mirrors that have used their day,
  // and a day whose spending is far above the week before. `rows` are the retailers rows, `monthly` this month's sessions by brand.
  async function founderNeeds(rows, monthly, now = Date.now()) {
    const out = [];
    const name = (id) => brands.get(id)?.brand.name || id;
    const credit = await flag(CREDIT);
    if (credit)
      out.push({ kind: "credit", since: Number(credit.at) || null, text: "The try-on account is out of credit. Shoppers and mirrors are being told try-on is resting. Top it up with Decart; this clears itself the next time a try-on works." });

    const stores = rows.map(storeFrom).filter((s) => s.plan).map((store) => ({ store, brand: store.row.brand, ...sessionsOf(store, monthly.get(store.row.brand) || 0) }));
    for (const s of stores.filter((x) => x.used > x.allowance))
      out.push({
        kind: "store-over", brand: s.brand, used: s.used, allowance: s.allowance, over: s.over, pkr: s.overPkr,
        text: `${name(s.brand)} is over its allowance: ${s.used} sessions this month against ${s.allowance} included. That is ${s.over} to bill, ${rupees(s.overPkr)} at ${rupees(EXTRAS.sessionOverage)} each. ${s.stopped ? "Its mirrors have stopped until the 1st." : `Its overage cap is ${s.overage}, so ${s.limit - s.used} more can run.`}`,
      });
    for (const s of stores.filter((x) => x.used <= x.allowance && x.used >= 0.8 * x.allowance))
      out.push({
        kind: "store-near", brand: s.brand, used: s.used, allowance: s.allowance,
        text: `${name(s.brand)} has used ${s.used} of its ${s.allowance} sessions this month (${Math.round((s.used / s.allowance) * 100)}%).${s.stopped ? " Its mirrors have stopped until the 1st, or until its overage cap is raised." : ""}`,
      });

    const budgets = new Map(rows.map((r) => [r.brand, budgetOf(settingsOf(r))]));
    const named = new Map((await db.all("SELECT id, name, brand FROM devices")).map((d) => [d.id, d]));
    const today = await db.all("SELECT device, SUM(usd) AS usd FROM usage WHERE device IS NOT NULL AND at >= ? AND sample = 0 GROUP BY device", pktDayStart(now));
    for (const t of today) {
      const d = named.get(t.device);
      const budget = d ? (budgets.has(d.brand) ? budgets.get(d.brand) : MIRROR.dailyUsd) : 0;
      if (d && (Number(t.usd) || 0) >= budget - 1e-9)
        out.push({ kind: "mirror-day", brand: d.brand, device: d.id, text: `${d.name} at ${name(d.brand)} has used its try-on budget for today ($${(Number(t.usd) || 0).toFixed(2)} of $${budget}). It rests until midnight, Pakistan time.` });
    }

    const days = new Map(
      (await db.all(`SELECT CAST((at + ${PKT}) / ${DAY} AS INTEGER) AS day, SUM(usd) AS usd FROM usage WHERE at >= ? AND sample = 0 GROUP BY day`, pktDayStart(now) - 8 * DAY)).map((r) => [Number(r.day), Number(r.usd) || 0]),
    );
    const todayIndex = Math.floor((now + PKT) / DAY);
    for (const [index, label] of [[todayIndex, "today"], [todayIndex - 1, "yesterday"]]) {
      const spent = days.get(index) || 0;
      let before = 0;
      for (let i = 1; i <= 7; i++) before += days.get(index - i) || 0;
      const usual = before / 7;
      if (spent > 3 && spent > 2 * usual)
        out.push({
          kind: "spend", day: label, usd: spent, usual,
          text: `Try-on spend ${label} is $${spent.toFixed(2)} (${rupees(spent * USD_TO_PKR)}), ${usual < 0.01 ? "and the week before had almost none." : `more than twice the usual $${usual.toFixed(2)} a day over the week before.`}`,
        });
    }
    return out;
  }

  // --- the try-on account running out of credit --------------------------------
  // A flag stands until a try-on works again. The table is read and written without letting a failure here
  // (for example a database that has not been given it yet) turn the shopper's calm answer into an error.
  async function flag(key) {
    try {
      return (await db.get("SELECT value, at FROM flags WHERE key = ?", key)) || null;
    } catch {
      return null;
    }
  }
  async function creditOut() {
    try {
      const now = Date.now();
      await db.run("INSERT INTO flags (key, value, at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", CREDIT, "out", now);
      // One message to the founder a Pakistan day, however many shoppers meet it. The write is the gate, so two at once send one.
      const day = new Date(now + PKT).toISOString().slice(0, 10);
      if ((await flag(CREDIT_TOLD))?.value === day) return;
      const told = await db.run("INSERT INTO flags (key, value, at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at WHERE flags.value IS NOT excluded.value", CREDIT_TOLD, day, now);
      if (told.changes) {
        await notify(
          "founder",
          "founder",
          "The try-on account is out of credit",
          "Decart answered that the try-on account has no credit left. Shoppers and store mirrors are being told that try-on is resting.\n\nTop up the account at Decart. The notice on the Today page clears itself the next time a try-on works, and this message comes at most once a day.",
        );
      }
    } catch (e) {
      console.error("credit flag:", e?.message || e);
    }
  }
  async function creditOk() {
    try {
      await db.run("DELETE FROM flags WHERE key = ?", CREDIT);
    } catch {}
  }

  const product = (brandId, productId) => brands.get(brandId)?.catalogue.products.find((p) => p.id === productId);
  const thumb = (src, w = 480) => (src ? `/img?u=${encodeURIComponent(src)}&w=${w}` : null);

  const lookOut = (row, board) => ({
    id: row.id,
    brand: row.brand,
    brandName: brands.get(row.brand)?.brand.name || row.brand,
    product: row.product,
    name: row.name,
    price: row.price,
    currency: row.currency,
    image: thumb(row.image),
    url: row.url,
    size: row.size,
    portrait: row.portrait ? `/api/portrait/${row.portrait}${board ? `?b=${board}` : ""}` : null,
    source: row.source,
    created: row.created,
  });

  // --- who is asking ---------------------------------------------------------
  async function identify(request) {
    const user = await currentUser(db, request);
    if (user) return { kind: user.role === "member" ? "member" : "staff", user };
    const header = String(request.headers.get("x-mirva-device") || "");
    if (header && header.length < 200) {
      const dot = header.indexOf(".");
      const device = dot > 0 ? await db.get("SELECT * FROM devices WHERE id = ?", header.slice(0, dot)) : null;
      if (device?.token && sha(header.slice(dot + 1)) === device.token) {
        await db.run("UPDATE devices SET seen = ? WHERE id = ?", Date.now(), device.id);
        return { kind: "device", device };
      }
    }
    return openMirror ? { kind: "open" } : { kind: "none" };
  }

  // May this caller start a paid try-on? Members draw on a monthly allowance; a store mirror is held to its own ceilings
  // (a day's budget, its store's month, its hour); staff are not held, so a demo never stops in the middle of a meeting.
  async function grant(who, kind) {
    if (who.kind === "none") return { ok: false, status: 401, error: "Sign in, or pair this mirror with a store, to do that." };
    // A ceiling on what one day of try-on may cost, whoever is asking. A signed-in founder or store
    // user is not held to it, so a demo never stops in the middle of a meeting.
    if (dailyUsd > 0 && who.kind !== "staff" && !(who.kind === "member" && tierOf(who.user).unlimited)) {
      const spent = Number((await db.get("SELECT COALESCE(SUM(usd), 0) AS n FROM usage WHERE at >= ? AND sample = 0", Date.now() - 86400e3))?.n) || 0;
      if (spent >= dailyUsd) return { ok: false, status: 503, error: "Try-on is resting for today. It will be back tomorrow." };
    }
    // A store's own mirror is held to its ceilings (see deviceCeilings). Staff are not, so a demo never stops.
    if (who.kind === "device") return deviceCeilings(who.device, kind);
    if (who.kind !== "member") return { ok: true, seconds: config.sessionSeconds };
    const tier = tierOf(who.user);
    if (kind === "backdrop") {
      // A studio backdrop comes with a portrait, never on its own: at most one for each portrait made this month,
      // and it does not draw on the monthly portraits. (The hourly and daily ceilings apply to it all the same.)
      const row = await db.get(
        "SELECT COALESCE(SUM(kind = 'portrait'), 0) AS portraits, COALESCE(SUM(kind = 'backdrop'), 0) AS backdrops FROM usage WHERE user = ? AND at >= ?",
        who.user.id,
        monthStart(),
      );
      if ((Number(row.backdrops) || 0) >= (Number(row.portraits) || 0))
        return { ok: false, status: 402, error: "The studio backdrop comes with each portrait. Make a portrait first.", limit: "backdrop" };
      return { ok: true };
    }
    const used = await usageOf(who.user.id);
    if (kind === "portrait") {
      if (used.portraits >= tier.portraitsPerMonth)
        return { ok: false, status: 402, error: `You've had this month's ${tier.portraitsPerMonth} portraits. They come back on the 1st.`, limit: "portraits" };
      return { ok: true };
    }
    const left = tier.liveSecondsPerMonth - used.liveSeconds;
    if (tier.liveSecondsPerMonth <= 0)
      return { ok: false, status: 402, error: "Live Studio is in MIRVA stores. At home, ask me for a portrait.", limit: "live" };
    if (left < 15) return { ok: false, status: 402, error: "You've used this month's live minutes at home. Portraits still work.", limit: "live" };
    return { ok: true, seconds: Math.min(config.sessionSeconds, left) };
  }

  // A paired mirror's spend is its store's, whatever store the page says it is showing.
  async function meter(who, kind, brand, seconds, usd) {
    const r = await db.run(
      "INSERT INTO usage (at, kind, brand, device, user, seconds, usd) VALUES (?,?,?,?,?,?,?)",
      Date.now(), kind, who.device?.brand || brand || null, who.device?.id || null, who.user?.id || null, seconds, usd,
    );
    return Number(r.lastId);
  }

  // The mirror says how long a live look really ran. The meter began at the full length it was granted, and a mirror that
  // reports less than the clock allows is not believed: the length recorded is the larger of what it said and the time
  // since the token was issued less a little slack, and never more than was reserved. Only the caller who started the
  // look can settle it.
  async function settleLive(who, grant, reported) {
    const row = await db.get("SELECT * FROM usage WHERE id = ? AND kind = 'live'", grant);
    if (!row || (row.device || null) !== (who.device?.id || null) || (row.user || null) !== (who.user?.id || null)) return;
    const age = (Date.now() - row.at) / 1000;
    if (age >= 3600 || !(reported >= 0)) return;
    const seconds = Math.min(row.seconds, Math.max(reported, age - MIRROR.meterSlackSeconds));
    if (seconds < row.seconds) await db.run("UPDATE usage SET seconds = ?, usd = ? WHERE id = ?", seconds, seconds * COST.liveUsdPerSecond, row.id);
  }

  async function savePortrait(user, brandId, productId, bytes, type) {
    const id = newId(16);
    await files.put(id, bytes, type);
    await db.run("INSERT INTO portraits (id, user, brand, product, type, created) VALUES (?,?,?,?,?,?)", id, user.id, brandId, productId, type, Date.now());
    return id;
  }

  const dropPortraitFile = (id) => Promise.resolve(files.del(id)).catch(() => {});

  // The studio backdrop pass gives a better version of a portrait she already has. Keep the new one in its place:
  // any look that held the old portrait now holds the new one, and the old picture goes.
  async function replacePortrait(user, oldId, brandId, productId, bytes, type) {
    const id = await savePortrait(user, brandId, productId, bytes, type);
    const old = oldId ? await db.get("SELECT id FROM portraits WHERE id = ? AND user = ?", oldId, user.id) : null;
    if (old) {
      await db.run("UPDATE looks SET portrait = ? WHERE portrait = ? AND user = ?", id, old.id, user.id);
      await db.run("DELETE FROM portraits WHERE id = ?", old.id);
      await dropPortraitFile(old.id);
    }
    return id;
  }

  // Housekeeping: portraits nobody kept, and anything past its expiry. The host decides when to call it.
  async function sweep() {
    const now = Date.now();
    const stale = await db.all("SELECT id FROM portraits WHERE created < ? AND id NOT IN (SELECT portrait FROM looks WHERE portrait IS NOT NULL)", now - 2 * DAY);
    for (const { id } of stale) {
      await db.run("DELETE FROM portraits WHERE id = ?", id);
      await dropPortraitFile(id);
    }
    await db.run("DELETE FROM sessions WHERE expires < ?", now);
    await db.run("DELETE FROM resets WHERE expires < ?", now);
    await db.run("DELETE FROM handoffs WHERE expires < ?", now - 30 * DAY);
    await db.run("UPDATE boards SET closed = 1 WHERE closed = 0 AND closes < ?", now);
  }

  async function addLook(user, brandId, productId, { size = "", portrait = null, source = "home" } = {}) {
    const p = product(brandId, productId);
    if (!p) return null;
    const entry = brands.get(brandId);
    if (portrait && !(await db.get("SELECT 1 FROM portraits WHERE id = ? AND user = ?", portrait, user.id))) portrait = null;
    const had = await db.get("SELECT * FROM looks WHERE user = ? AND brand = ? AND product = ?", user.id, brandId, productId);
    if (had) {
      await db.run("UPDATE looks SET size = ?, portrait = COALESCE(?, portrait) WHERE id = ?", size || had.size, portrait, had.id);
      return db.get("SELECT * FROM looks WHERE id = ?", had.id);
    }
    const id = newId();
    await db.run(
      "INSERT INTO looks (id, user, brand, product, name, price, currency, image, url, size, portrait, source, created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      id, user.id, brandId, productId, p.name, p.price, entry.brand.currency || "Rs.", p.image, p.url || "", size, portrait, source, Date.now(),
    );
    return db.get("SELECT * FROM looks WHERE id = ?", id);
  }

  async function claim(user, code) {
    const row = await db.get("SELECT * FROM handoffs WHERE code = ? AND expires > ?", String(code || "").toUpperCase(), Date.now());
    if (!row) return { error: "That link has expired. Ask the mirror for a new one." };
    if (row.claimed && row.claimed !== user.id) return { error: "Those looks are already in someone's wardrobe." };
    const items = parse(row.payload, []);
    let added = 0;
    for (const it of Array.isArray(items) ? items : []) if (await addLook(user, row.brand, it.product, { size: it.size, source: "store" })) added++;
    await db.run("UPDATE handoffs SET claimed = ? WHERE code = ?", user.id, row.code);
    return { added, brand: row.brand };
  }

  // --- first run ---------------------------------------------------------------
  // The founder's sign-in is made once and handed to `write`, which keeps it somewhere only the
  // owner can reach and returns where. It is never printed or sent.
  async function ensureFounder(write) {
    if (typeof write !== "function") return null;
    if (await db.get("SELECT 1 FROM users WHERE role = 'founder'")) return null;
    const mail = cleanEmail(globalThis.process?.env?.MIRVA_FOUNDER_EMAIL) || "founder@mirva.local";
    const password = newCode(16);
    await db.run("INSERT INTO users (id, role, email, name, pass, created) VALUES (?,?,?,?,?,?)", newId(), "founder", mail, "Founder", await hashPassword(password, kdf), Date.now());
    return (await write(`MIRVA founder sign-in, for /hq\n\nemail:    ${mail}\npassword: ${password}\n\nChange nothing here; delete this file once the password is in your password manager.\n`)) ?? null;
  }

  // --- analytics for one brand -------------------------------------------------
  async function overview(brandId, days) {
    const since = Date.now() - days * DAY;
    const one = async (sql, ...p) => Number((await db.get(sql, ...p))?.n) || 0;
    const visits = await one("SELECT COUNT(DISTINCT visit) n FROM store_events WHERE brand = ? AND at >= ? AND kind = 'visit'", brandId, since);
    const briefed = await one("SELECT COUNT(DISTINCT visit) n FROM store_events WHERE brand = ? AND at >= ? AND kind = 'looks_shown'", brandId, since);
    const tried = await one("SELECT COUNT(DISTINCT visit) n FROM store_events WHERE brand = ? AND at >= ? AND kind IN ('portrait','live_start')", brandId, since);
    const kept = await one("SELECT COUNT(DISTINCT visit) n FROM store_events WHERE brand = ? AND at >= ? AND kind = 'keep'", brandId, since);
    const sent = await one("SELECT COUNT(DISTINCT visit) n FROM store_events WHERE brand = ? AND at >= ? AND kind = 'send'", brandId, since);
    const byDay = await db.all(
      `SELECT CAST((at + ${PKT}) / ${DAY} AS INTEGER) AS day, COUNT(DISTINCT CASE WHEN kind = 'visit' THEN visit END) AS visits,
              SUM(kind IN ('portrait','live_start')) AS tries, SUM(kind = 'keep') AS keeps
       FROM store_events WHERE brand = ? AND at >= ? GROUP BY day ORDER BY day`,
      brandId, since,
    );
    const names = new Map((brands.get(brandId)?.catalogue.products || []).map((p) => [p.id, p]));
    const top = (
      await db.all(
        `SELECT product, SUM(kind = 'look_open') AS opens, SUM(kind IN ('portrait','live_start')) AS tries, SUM(kind = 'keep') AS keeps
         FROM store_events WHERE brand = ? AND at >= ? AND product IS NOT NULL GROUP BY product ORDER BY tries DESC, opens DESC LIMIT 12`,
        brandId, since,
      )
    ).map((r) => ({ ...r, name: names.get(r.product)?.name || r.product, price: names.get(r.product)?.price || 0, image: thumb(names.get(r.product)?.image, 160) }));
    const missed = (
      await db.all("SELECT product, meta AS size, COUNT(*) AS asks FROM store_events WHERE brand = ? AND at >= ? AND kind = 'size_missed' GROUP BY product, meta ORDER BY asks DESC LIMIT 8", brandId, since)
    ).map((r) => ({ ...r, name: names.get(r.product)?.name || r.product, price: names.get(r.product)?.price || 0 }));
    const occasions = await db.all("SELECT meta AS occasion, COUNT(*) AS n FROM store_events WHERE brand = ? AND at >= ? AND kind = 'brief' AND meta IS NOT NULL GROUP BY meta ORDER BY n DESC LIMIT 8", brandId, since);
    const hours = await db.all(`SELECT CAST((at + ${PKT}) / 3600000 AS INTEGER) % 24 AS hour, COUNT(DISTINCT visit) AS visits FROM store_events WHERE brand = ? AND at >= ? AND kind = 'visit' GROUP BY hour ORDER BY hour`, brandId, since);
    const spend = await db.all("SELECT kind, COUNT(*) AS n, SUM(seconds) AS seconds, SUM(usd) AS usd FROM usage WHERE brand = ? AND at >= ? AND user IS NULL GROUP BY kind", brandId, since);
    const usd = spend.reduce((a, s) => a + (Number(s.usd) || 0), 0);
    const retailer = await db.get("SELECT * FROM retailers WHERE brand = ?", brandId);
    const plan = retailer ? RETAIL_PLANS[retailer.plan] : null;
    // Sessions are counted over the calendar month, the way the allowance is, not over the days the page is looking at.
    const standing = retailer && plan ? sessionsOf(storeFrom(retailer), await sessionsIn(brandId)) : null;
    const sample = (await one("SELECT COUNT(*) n FROM events WHERE brand = ? AND sample = 1", brandId)) > 0;
    const addons = await one("SELECT COUNT(*) n FROM store_events WHERE brand = ? AND at >= ? AND kind = 'addon'", brandId, since);
    return {
      brand: brandId,
      days,
      sample,
      funnel: { visits, briefed, tried, kept, sent },
      addons,
      byDay: byDay.map((r) => ({ date: new Date(Number(r.day) * DAY).toISOString().slice(0, 10), visits: Number(r.visits) || 0, tries: Number(r.tries) || 0, keeps: Number(r.keeps) || 0 })),
      top,
      missed,
      occasions,
      hours,
      spend: { byKind: spend, usd, pkr: Math.round(usd * USD_TO_PKR), perVisitPkr: tried ? Math.round((usd * USD_TO_PKR) / tried) : 0 },
      // `sessions` is what the plan includes; `overage` is the rupees for each one past it. `used` is this calendar month at paired
      // mirrors, `overageCap` how many past the allowance the store has agreed to, `over` how many it is past it, and `overagePkr` what that bills.
      plan: standing
        ? {
            id: plan.id, name: plan.name, stores: retailer.stores, status: retailer.status, sessions: plan.sessions * retailer.stores, monthly: monthlyFee(plan.id, retailer.stores), overage: EXTRAS.sessionOverage,
            used: standing.used, overageCap: standing.overage, over: standing.over, overagePkr: standing.overPkr, stopped: standing.stopped,
          }
        : null,
    };
  }

  // --- who tries on, and which way: Model (a portrait) or Studio (live). The seeded sample is never counted. ---
  async function tryons(days) {
    const now = Date.now();
    const since = now - days * DAY;
    const real = "at >= ? AND sample <> 1";
    const one = async (sql, ...p) => Number((await db.get(sql, ...p))?.n) || 0;
    const [total, joined, kinds, people, both, active, perDay, top, who] = await Promise.all([
      one("SELECT COUNT(*) n FROM users WHERE role = 'member'"),
      one("SELECT COUNT(*) n FROM users WHERE role = 'member' AND created >= ?", since),
      db.all(`SELECT kind, user IS NULL AS mirror, COUNT(*) AS n, SUM(seconds) AS seconds, SUM(usd) AS usd FROM usage WHERE ${real} GROUP BY kind, mirror`, since),
      db.get(`SELECT COUNT(DISTINCT CASE WHEN kind = 'portrait' THEN user END) AS model, COUNT(DISTINCT CASE WHEN kind = 'live' THEN user END) AS studio FROM usage WHERE ${real} AND user IS NOT NULL`, since),
      one(`SELECT COUNT(*) n FROM (SELECT user FROM usage WHERE ${real} AND user IS NOT NULL AND kind IN ('portrait','live') GROUP BY user HAVING COUNT(DISTINCT kind) = 2)`, since),
      one(`SELECT COUNT(DISTINCT user) n FROM usage WHERE ${real} AND user IS NOT NULL AND kind IN ('portrait','live')`, since),
      db.all(`SELECT CAST((at + ${PKT}) / ${DAY} AS INTEGER) AS day, kind, COUNT(*) AS n FROM usage WHERE ${real} AND kind IN ('portrait','live') GROUP BY day, kind`, since),
      db.all(
        `SELECT brand, product, SUM(kind IN ('portrait','live_start')) AS tries, SUM(kind = 'keep') AS keeps FROM events
         WHERE ${real} AND product IS NOT NULL GROUP BY brand, product HAVING tries > 0 ORDER BY tries DESC, keeps DESC LIMIT 10`,
        since,
      ),
      db.all(
        `SELECT u.name, u.email, u.tier, u.seen, SUM(g.kind = 'portrait') AS portraits, SUM(g.kind = 'live') AS live,
                SUM(CASE WHEN g.kind = 'live' THEN g.seconds ELSE 0 END) AS seconds, (SELECT COUNT(*) FROM looks l WHERE l.user = u.id) AS kept
         FROM usage g JOIN users u ON u.id = g.user
         WHERE g.at >= ? AND g.sample <> 1 AND g.kind IN ('portrait','live') AND u.role = 'member'
         GROUP BY u.id ORDER BY COUNT(*) DESC, u.seen DESC LIMIT 50`,
        since,
      ),
    ]);

    const sum = (kind, field, mirror) => kinds.filter((r) => r.kind === kind && (mirror === undefined || !!Number(r.mirror) === mirror)).reduce((a, r) => a + (Number(r[field]) || 0), 0);
    const portraits = sum("portrait", "n");
    const live = sum("live", "n");
    const share = (n) => (portraits + live ? Math.round((n / (portraits + live)) * 1000) / 1000 : 0);
    // A studio backdrop is part of making a portrait, so its cost belongs to Model.
    const cents = (usd) => Math.round(usd * 1e4) / 1e4;
    const modelUsd = cents(sum("portrait", "usd") + sum("backdrop", "usd"));
    const studioUsd = cents(sum("live", "usd"));

    const counts = new Map(perDay.map((r) => [`${r.day}:${r.kind}`, Number(r.n) || 0]));
    const byDay = [];
    for (let d = Math.floor((since + PKT) / DAY); d <= Math.floor((now + PKT) / DAY); d++) {
      byDay.push({ date: new Date(d * DAY).toISOString().slice(0, 10), portraits: counts.get(`${d}:portrait`) || 0, live: counts.get(`${d}:live`) || 0 });
    }

    return {
      days,
      shoppers: {
        total,
        joined,
        active,
        portraits: { members: sum("portrait", "n", false), mirrors: sum("portrait", "n", true) },
        live: { members: sum("live", "n", false), mirrors: sum("live", "n", true) },
      },
      modes: {
        model: { count: portraits, share: share(portraits), people: Number(people?.model) || 0, usd: modelUsd, pkr: Math.round(modelUsd * USD_TO_PKR) },
        studio: { count: live, share: share(live), people: Number(people?.studio) || 0, usd: studioUsd, pkr: Math.round(studioUsd * USD_TO_PKR), minutes: Math.round(sum("live", "seconds") / 6) / 10 },
        both,
      },
      byDay,
      top: top.map((r) => {
        const entry = brands.get(r.brand);
        return { brand: r.brand, brandName: entry?.brand.name || r.brand, product: r.product, name: entry?.catalogue.products.find((p) => p.id === r.product)?.name || r.product, tries: Number(r.tries) || 0, keeps: Number(r.keeps) || 0 };
      }),
      members: who.map((r) => ({ name: r.name, email: r.email, tier: r.tier, portraits: Number(r.portraits) || 0, live: Number(r.live) || 0, minutes: Math.round((Number(r.seconds) || 0) / 6) / 10, kept: Number(r.kept) || 0, seen: r.seen ?? null })),
    };
  }

  // Facts about a store's own catalogue, for the page MIRVA prepares for that store.
  function pitchFacts(brandId) {
    const entry = brands.get(brandId);
    if (!entry) return null;
    const items = entry.catalogue.products;
    const prices = items.map((p) => p.price).filter(Boolean).sort((a, b) => a - b);
    let sizes = 0, sizesOut = 0, withGap = 0;
    for (const p of items) {
      const out = (p.sizes || []).filter((s) => !s.inStock).length;
      sizes += (p.sizes || []).length;
      sizesOut += out;
      if (out) withGap++;
    }
    return {
      brand: { id: entry.brand.id, name: entry.brand.name, wordmark: entry.brand.wordmark, accent: entry.brand.accent, mood: entry.brand.mood, source: entry.brand.source || entry.catalogue.source || "" },
      takenAt: entry.catalogue.takenAt,
      facts: {
        products: items.length,
        addons: (entry.catalogue.addons || []).length,
        priceMin: prices[0] || 0,
        priceMax: prices[prices.length - 1] || 0,
        priceMedian: prices[Math.floor(prices.length / 2)] || 0,
        unstitched: items.filter((p) => p.unstitched).length,
        formal: items.filter((p) => p.formality >= 4).length,
        sizes,
        sizesOut,
        withGap,
      },
      pictures: items.slice(0, 40).filter((p) => p.image).filter((_, i) => i % 5 === 0).slice(0, 6).map((p) => ({ name: p.name, price: p.price, image: thumb(p.image, 420) })),
      currency: entry.brand.currency || "Rs.",
    };
  }

  // --- routes ----------------------------------------------------------------
  // Returns a Response for a route it owns, or null for anything else.
  async function handle(request, url, ctx = {}) {
    const path = url.pathname;
    const method = request.method;
    const key = `${method} ${path}`;
    const ip = ctx.ip || "";
    const ok = (body = { ok: true }, headers) => json(200, body, headers);
    const fail = (status, error, extra = {}) => json(status, { error, ...extra });
    // A guard that says no leaves its answer here, so the route can return it as it is.
    let denied = null;
    const refuse = (status, error) => ((denied = fail(status, error)), null);
    const me = () => currentUser(db, request);
    const member = async () => {
      const u = await me();
      if (!u) return refuse(401, "Sign in first.");
      // A store's or the founder's sign-in has no wardrobe, and must never be deleted through a shopper's route.
      if (u.role !== "member") return refuse(403, "That is for a shopper's account.");
      return u;
    };
    const staff = async (founderOnly = false) => {
      const u = await me();
      if (!u) return refuse(401, "Sign in first.");
      if (u.role === "member" || (founderOnly && u.role !== "founder")) return refuse(403, "That desk isn't yours.");
      return u;
    };
    // A retailer sees only their own brand. The founder can look at any.
    const brandOf = (u, asked) => {
      const id = u.role === "retailer" ? u.brand : text(asked, 80) || [...brands.keys()][0];
      if (!id || !brands.has(id)) return refuse(404, "I don't know that store.");
      return id;
    };

    if (key === "POST /api/setup") {
      if (!setupKey) return fail(404, "not found");
      if (!(await limiter.limit("setup:" + ip, 5, 3600e3))) return fail(429, "Too many tries. Try again in an hour.");
      const b = await readBody(request);
      if (await db.get("SELECT 1 AS x FROM users WHERE role = 'founder' LIMIT 1")) return fail(409, "The founder's desk is already set up. Sign in instead.");
      if (sha(String(b.key || "")) !== sha(setupKey)) {
        await audit(ip, "", "setup-refused");
        return fail(403, "That setup key isn't right.");
      }
      const mail = cleanEmail(b.email);
      if (!mail) return fail(400, "That email doesn't look right.");
      const problem = passwordProblem(b.password, mail);
      if (problem) return fail(400, problem);
      if (await db.get("SELECT 1 AS x FROM users WHERE email = ?", mail)) return fail(409, "That email already has a shopper's account. Use another for the desk.");
      const user = { id: newId(), role: "founder", email: mail, name: "Founder" };
      await db.run("INSERT INTO users (id, role, email, name, pass, created) VALUES (?,?,?,?,?,?)", user.id, "founder", mail, "Founder", await hashPassword(b.password, kdf), Date.now());
      const cookie = await startSession(db, user, request, secure);
      await audit(ip, user.id, "founder-set-up");
      return ok({ user: publicUser(await db.get("SELECT * FROM users WHERE id = ?", user.id)) }, { "set-cookie": cookie });
    }

    if (key === "GET /api/plans") return ok({ tiers: MEMBER_TIERS, retail: RETAIL_PLANS, extras: EXTRAS, cost: COST, usdToPkr: USD_TO_PKR, payments });

    // ----- accounts
    if (key === "POST /api/auth/join") {
      if (!(await limiter.limit("join:" + ip, 8, 3600e3))) return fail(429, "Too many new accounts from here. Try again in an hour.");
      const b = await readBody(request);
      const name = text(b.name, 80);
      const mail = cleanEmail(b.email);
      if (name.length < 2) return fail(400, "Tell me your name.");
      if (!mail) return fail(400, "That email doesn't look right.");
      const problem = passwordProblem(b.password, mail);
      if (problem) return fail(400, problem);
      if (b.agree !== true) return fail(400, "Please agree to the terms and the privacy notice first.");
      if (await db.get("SELECT 1 FROM users WHERE email = ?", mail)) return fail(409, "There's already an account with that email. Sign in instead.");
      const user = { id: newId(), role: "member", email: mail, name };
      const consent = { terms: Date.now(), updates: b.updates === true };
      await db.run("INSERT INTO users (id, role, email, name, pass, consent, created) VALUES (?,?,?,?,?,?,?)", user.id, "member", mail, name, await hashPassword(b.password, kdf), JSON.stringify(consent), Date.now());
      const cookie = await startSession(db, user, request, secure);
      await audit(ip, user.id, "join");
      await notify("email", mail, "Welcome to MIRVA", `Hello ${name},\n\nYour wardrobe is open: ${origin}/account\nEverything you keep in a MIRVA mirror lands there. You can delete all of it, at any time, from the same page.\n\nMIRVA`);
      const claimed = b.claim ? await claim(user, b.claim) : null;
      return ok({ user: publicUser(await db.get("SELECT * FROM users WHERE id = ?", user.id)), claimed }, { "set-cookie": cookie });
    }

    if (key === "POST /api/auth/signin") {
      const b = await readBody(request);
      const mail = cleanEmail(b.email);
      // Only wrong tries count, so someone who signs in often is never locked out by their own success.
      if ((await limiter.blocked("signin:" + ip, 20, 900e3)) || (await limiter.blocked("signin:" + mail, 8, 900e3))) return fail(429, "Too many tries. Wait fifteen minutes, then try again.");
      const user = mail ? await db.get("SELECT * FROM users WHERE email = ?", mail) : null;
      const good = await verifyPassword(String(b.password || ""), user ? user.pass : await decoyHash(kdf));
      if (!user || !good) {
        await limiter.strike("signin:" + ip);
        await limiter.strike("signin:" + mail);
        await audit(ip, mail, "signin-failed");
        return fail(401, "That email and password don't match.");
      }
      await endSession(db, request, secure); // a fresh session on every sign-in: the old row goes, only the new cookie is sent
      const cookie = await startSession(db, user, request, secure);
      await audit(ip, user.id, "signin");
      const claimed = b.claim && user.role === "member" ? await claim(user, b.claim) : null;
      return ok({ user: publicUser(user), claimed }, { "set-cookie": cookie });
    }

    if (key === "POST /api/auth/signout") {
      const cookie = await endSession(db, request, secure);
      return ok(undefined, { "set-cookie": cookie });
    }

    if (key === "POST /api/auth/forgot") {
      const b = await readBody(request);
      const mail = cleanEmail(b.email);
      if (!(await limiter.limit("forgot:" + ip, 6, 3600e3))) return fail(429, "Too many requests. Try again in an hour.");
      const user = mail ? await db.get("SELECT * FROM users WHERE email = ?", mail) : null;
      if (user) {
        const token = newToken();
        await db.run("INSERT INTO resets (hash, user, expires) VALUES (?,?,?)", sha(token), user.id, Date.now() + 30 * 60e3);
        await notify("email", mail, "Choose a new MIRVA password", `Open this within thirty minutes to choose a new password:\n${origin}/account?reset=${token}\n\nIf you didn't ask for this, ignore it. Nothing has changed.`);
        await audit(ip, user.id, "reset-asked");
      }
      return ok(); // the same answer whether or not the account exists
    }

    if (key === "POST /api/auth/reset") {
      const b = await readBody(request);
      if (!(await limiter.limit("reset:" + ip, 10, 3600e3))) return fail(429, "Too many tries. Try again in an hour.");
      const row = await db.get("SELECT * FROM resets WHERE hash = ? AND expires > ?", sha(String(b.token || "")), Date.now());
      if (!row) return fail(400, "That link has expired. Ask for a new one.");
      const user = await db.get("SELECT * FROM users WHERE id = ?", row.user);
      const problem = passwordProblem(b.password, user.email);
      if (problem) return fail(400, problem);
      await db.run("UPDATE users SET pass = ? WHERE id = ?", await hashPassword(b.password, kdf), user.id);
      await db.run("DELETE FROM resets WHERE user = ?", user.id);
      await db.run("DELETE FROM sessions WHERE user = ?", user.id); // every device signs in again
      const cookie = await startSession(db, user, request, secure);
      await audit(ip, user.id, "reset-done");
      return ok({ user: publicUser(user) }, { "set-cookie": cookie });
    }

    if (key === "GET /api/me") {
      const u = await me();
      // Where there is no first-run file, the founder's sign-in is made once on the desk itself.
      if (!u) return ok({ user: null, ...(setupKey && !(await db.get("SELECT 1 AS x FROM users WHERE role = 'founder' LIMIT 1")) ? { setup: true } : {}) });
      const tier = tierOf(u);
      const body = { user: publicUser(u) };
      if (u.role === "member") {
        const invite = await db.get("SELECT status FROM invites WHERE user = ? ORDER BY at DESC LIMIT 1", u.id);
        Object.assign(body, {
          tier,
          usage: await usageOf(u.id),
          looks: Number((await db.get("SELECT COUNT(*) n FROM looks WHERE user = ?", u.id)).n),
          invite: invite?.status || null,
          payments,
        });
      }
      return ok(body);
    }

    if (key === "POST /api/me/profile") {
      const u = await member();
      if (!u) return denied;
      const b = await readBody(request);
      const old = parse(u.profile);
      const sizes = b.sizes && typeof b.sizes === "object" ? b.sizes : old.sizes || {};
      const profile = {
        sizes: { top: text(sizes.top, 6), bottom: text(sizes.bottom, 6), shoe: text(sizes.shoe, 6) },
        height: b.height === undefined ? old.height || 0 : int(b.height, 0, 230, 0),
        likes: (Array.isArray(b.likes) ? b.likes : old.likes || []).slice(0, 8).map((s) => text(s, 24)).filter(Boolean),
        modest: b.modest === undefined ? !!old.modest : b.modest === true,
      };
      const name = b.name === undefined ? u.name : text(b.name, 80);
      if (name.length < 2) return fail(400, "Tell me your name.");
      await db.run("UPDATE users SET name = ?, profile = ? WHERE id = ?", name, JSON.stringify(profile), u.id);
      return ok({ user: publicUser(await db.get("SELECT * FROM users WHERE id = ?", u.id)) });
    }

    if (key === "POST /api/me/export") {
      const u = await member();
      if (!u) return denied;
      await audit(ip, u.id, "export");
      return ok({
        exported: new Date().toISOString(),
        account: { ...publicUser(u), consent: parse(u.consent) },
        wardrobe: await db.all("SELECT brand, product, name, price, currency, size, url, source, created FROM looks WHERE user = ? ORDER BY created", u.id),
        boards: await db.all("SELECT code, title, created, closes, closed FROM boards WHERE user = ?", u.id),
        portraits: await db.all("SELECT id, brand, product, created FROM portraits WHERE user = ?", u.id),
        usageThisMonth: await usageOf(u.id),
        payments: await db.all("SELECT at, amount, currency, provider, status, what FROM payments WHERE user = ?", u.id),
      });
    }

    if (key === "POST /api/me/delete") {
      const u = await member();
      if (!u) return denied;
      const b = await readBody(request);
      if (!(await limiter.limit("delete:" + u.id, 5, 3600e3))) return fail(429, "Too many tries. Try again in an hour.");
      if (!(await verifyPassword(String(b.password || ""), u.pass))) return fail(401, "That password isn't right.");
      const kept = await db.all("SELECT id FROM portraits WHERE user = ?", u.id);
      await db.batch([
        ["UPDATE events SET user = NULL WHERE user = ?", u.id],
        ["UPDATE usage SET user = NULL WHERE user = ?", u.id],
        ["UPDATE handoffs SET claimed = NULL WHERE claimed = ?", u.id],
        ["DELETE FROM payments WHERE user = ?", u.id],
        ["DELETE FROM outbox WHERE recipient = ?", u.email], // messages written to her go too
        ["DELETE FROM audit WHERE actor = ?", u.email], // failed sign-ins typed with her email
        ["UPDATE audit SET actor = '' WHERE actor = ?", u.id],
        ["DELETE FROM users WHERE id = ?", u.id], // wardrobe, portraits, boards, votes and sessions go with it
      ]);
      for (const f of kept) await dropPortraitFile(f.id);
      const cookie = await endSession(db, request, secure);
      await audit(ip, "", "account-deleted");
      return ok(undefined, { "set-cookie": cookie });
    }

    // ----- wardrobe
    if (key === "GET /api/wardrobe") {
      const u = await member();
      if (!u) return denied;
      return ok({ looks: (await db.all("SELECT * FROM looks WHERE user = ? ORDER BY created DESC", u.id)).map((r) => lookOut(r)) });
    }

    if (key === "POST /api/wardrobe") {
      const u = await member();
      if (!u) return denied;
      const b = await readBody(request);
      const tier = tierOf(u);
      const count = Number((await db.get("SELECT COUNT(*) n FROM looks WHERE user = ?", u.id)).n);
      const exists = await db.get("SELECT 1 FROM looks WHERE user = ? AND brand = ? AND product = ?", u.id, text(b.brand, 80), text(b.product, 80));
      if (!exists && count >= tier.wardrobe) return fail(409, `Your wardrobe holds ${tier.wardrobe} looks. Let one go to keep this.`);
      const row = await addLook(u, text(b.brand, 80), text(b.product, 80), { size: text(b.size, 8), portrait: b.portrait ? text(b.portrait, 40) : null, source: b.source === "store" ? "store" : "home" });
      if (!row) return fail(404, "I can't find that piece.");
      return ok({ look: lookOut(row) });
    }

    if (key === "POST /api/wardrobe/remove") {
      const u = await member();
      if (!u) return denied;
      const b = await readBody(request);
      const row = await db.get("SELECT * FROM looks WHERE id = ? AND user = ?", text(b.id, 40), u.id);
      if (!row) return fail(404, "That look isn't in your wardrobe.");
      await db.run("DELETE FROM looks WHERE id = ?", row.id);
      if (row.portrait) {
        await db.run("DELETE FROM portraits WHERE id = ?", row.portrait);
        await dropPortraitFile(row.portrait);
      }
      return ok();
    }

    let m = path.match(/^\/api\/portrait\/([A-Za-z0-9_-]{8,40})$/);
    if (m && method === "GET") {
      const row = await db.get("SELECT * FROM portraits WHERE id = ?", m[1]);
      let allowed = false;
      const u = await me();
      if (row && u && u.id === row.user) allowed = true;
      const code = text(url.searchParams.get("b"), 16);
      if (row && !allowed && code) {
        // A portrait is visible to a board's guests only while that board is open and holds that look.
        const board = await db.get("SELECT * FROM boards WHERE code = ? AND closed = 0 AND closes > ?", code, Date.now());
        if (board) {
          const ids = parse(board.looks, []);
          allowed = !!(await db.get(`SELECT 1 FROM looks WHERE portrait = ? AND user = ? AND id IN (${ids.map(() => "?").join(",") || "''"})`, row.id, board.user, ...ids));
        }
      }
      const stored = allowed ? await files.get(m[1]) : null;
      if (!allowed || !stored) return fail(404, "not found");
      return new Response(stored.bytes, { status: 200, headers: { ...SECURITY, "content-type": row.type, "cache-control": "private, max-age=3600" } });
    }

    if (m && method === "POST") {
      // The mirror lays the shopper's own head back on a portrait (src/restore.js) and sends the finished picture here,
      // so the wardrobe holds the one she saw. Her own portrait only, only while it is fresh, and only a picture.
      const u = await member();
      if (!u) return denied;
      if (!(await limiter.limit("finish:" + u.id, 60, 3600e3))) return fail(429, "That is a lot of portraits for one hour.");
      const row = await db.get("SELECT * FROM portraits WHERE id = ? AND user = ?", m[1], u.id);
      if (!row || Date.now() - row.created > FINISH_WINDOW) return fail(404, "That portrait isn't here to finish.");
      const type = String(request.headers.get("content-type") || "").split(";")[0].trim();
      if (type !== "image/jpeg" && type !== "image/png") return fail(415, "That isn't a picture.");
      if (Number(request.headers.get("content-length") || 0) > FINISH_MAX) return fail(413, "That picture is too large.");
      const bytes = new Uint8Array(await request.arrayBuffer());
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      if (bytes.byteLength < 2000 || bytes.byteLength > FINISH_MAX || (type === "image/jpeg" ? !jpeg : !png)) return fail(400, "That isn't a picture.");
      await files.put(row.id, bytes, type);
      await db.run("UPDATE portraits SET type = ? WHERE id = ?", type, row.id);
      return ok();
    }

    // ----- second opinions: a board a member shares, and guests vote on
    if (key === "GET /api/boards") {
      const u = await member();
      if (!u) return denied;
      const rows = await db.all("SELECT * FROM boards WHERE user = ? ORDER BY created DESC LIMIT 30", u.id);
      return ok({
        boards: await Promise.all(
          rows.map(async (b) => ({
            code: b.code,
            title: b.title,
            url: `${origin}/b/${b.code}`,
            created: b.created,
            closes: b.closes,
            closed: !!b.closed || b.closes < Date.now(),
            looks: parse(b.looks, []),
            votes: await db.all("SELECT look, name FROM votes WHERE board = ? ORDER BY created", b.code),
          })),
        ),
      });
    }

    if (key === "POST /api/boards") {
      const u = await member();
      if (!u) return denied;
      const b = await readBody(request);
      const ids = [...new Set((Array.isArray(b.looks) ? b.looks : []).map((x) => text(x, 40)))].slice(0, 6);
      const found = await Promise.all(ids.map((id) => db.get("SELECT 1 FROM looks WHERE id = ? AND user = ?", id, u.id)));
      const mine = ids.filter((_, i) => found[i]);
      if (mine.length < 2) return fail(400, "Choose at least two looks to ask about.");
      const open = Number((await db.get("SELECT COUNT(*) n FROM boards WHERE user = ? AND closed = 0 AND closes > ?", u.id, Date.now())).n);
      if (open >= tierOf(u).boards) return fail(409, "You have as many open questions as your membership allows. Close one first.");
      const code = newCode(10);
      await db.run("INSERT INTO boards (code, user, title, looks, created, closes) VALUES (?,?,?,?,?,?)", code, u.id, text(b.title, 80) || "Which one?", JSON.stringify(mine), Date.now(), Date.now() + 3 * DAY);
      return ok({ code, url: `${origin}/b/${code}` });
    }

    if (key === "POST /api/boards/close") {
      const u = await member();
      if (!u) return denied;
      const b = await readBody(request);
      const r = await db.run("UPDATE boards SET closed = 1 WHERE code = ? AND user = ?", text(b.code, 16), u.id);
      return r.changes ? ok() : fail(404, "I can't find that question.");
    }

    m = path.match(/^\/api\/board\/([A-Z0-9]{10})(\/vote)?$/);
    if (m) {
      const board = await db.get("SELECT b.*, u.name AS owner FROM boards b JOIN users u ON u.id = b.user WHERE b.code = ?", m[1]);
      if (!board) return fail(404, "That question has gone.");
      const closed = !!board.closed || board.closes < Date.now();
      const ids = parse(board.looks, []);
      const jar = cookies(request);
      let voter = /^[A-Za-z0-9_-]{10,40}$/.test(jar.mirva_v || "") ? jar.mirva_v : "";
      const u = await me();
      const owner = u?.id === board.user;
      const tally = async () => {
        const out = Object.fromEntries(ids.map((id) => [id, { votes: 0, names: [] }]));
        for (const v of await db.all("SELECT look, name FROM votes WHERE board = ?", board.code)) if (out[v.look]) (out[v.look].votes++, v.name && out[v.look].names.push(v.name));
        return out;
      };
      if (!m[2] && method === "GET") {
        const mine = voter ? (await db.get("SELECT look FROM votes WHERE board = ? AND voter = ?", board.code, voter))?.look || null : null;
        const looks = closed && !owner ? [] : (await Promise.all(ids.map((id) => db.get("SELECT * FROM looks WHERE id = ? AND user = ?", id, board.user)))).filter(Boolean).map((r) => lookOut(r, board.code));
        return ok({ code: board.code, title: board.title, by: board.owner.split(" ")[0], closes: board.closes, closed, owner, voted: mine, looks, tally: mine || closed || owner ? await tally() : null });
      }
      if (m[2] && method === "POST") {
        if (closed) return fail(410, "Voting has closed.");
        if (!(await limiter.limit("vote:" + ip, 40, 3600e3))) return fail(429, "Too many votes from here. Try again later.");
        const b = await readBody(request);
        const look = text(b.look, 40);
        if (!ids.includes(look)) return fail(400, "Choose one of the looks.");
        let voterCookie = null;
        if (!voter) {
          voter = newId(14);
          voterCookie = `mirva_v=${voter}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? "; Secure" : ""}`;
        }
        await db.run("INSERT INTO votes (board, voter, look, name, created) VALUES (?,?,?,?,?) ON CONFLICT(board, voter) DO UPDATE SET look = excluded.look, name = excluded.name", board.code, voter, look, text(b.name, 30), Date.now());
        return ok({ voted: look, tally: await tally() }, voterCookie ? { "set-cookie": voterCookie } : undefined);
      }
    }

    // ----- from a store mirror to a phone
    if (key === "POST /api/handoff") {
      const who = await identify(request);
      if (who.kind === "none") return fail(401, "Pair this mirror with a store first.");
      if (!(await limiter.limit("handoff:" + ip, 60, 3600e3))) return fail(429, "Too many hand-offs. Try again later.");
      const b = await readBody(request);
      const brandId = text(b.brand, 80);
      const items = (Array.isArray(b.looks) ? b.looks : []).slice(0, 8).map((x) => ({ product: text(x?.product, 80), size: text(x?.size, 8) })).filter((x) => product(brandId, x.product));
      if (!items.length) return fail(400, "There is nothing to send yet.");
      const code = newCode(8);
      await db.run("INSERT INTO handoffs (code, brand, device, payload, created, expires) VALUES (?,?,?,?,?,?)", code, brandId, who.device?.id || null, JSON.stringify(items), Date.now(), Date.now() + 14 * DAY);
      return ok({ code, url: `${origin}/claim/${code}` });
    }

    m = path.match(/^\/api\/handoff\/([A-Za-z0-9]{8})$/);
    if (m && method === "GET") {
      if (!(await limiter.limit("peek:" + ip, 60, 3600e3))) return fail(429, "Try again later.");
      const row = await db.get("SELECT * FROM handoffs WHERE code = ? AND expires > ?", m[1].toUpperCase(), Date.now());
      if (!row) return fail(404, "That link has expired. Ask the mirror for a new one.");
      const items = parse(row.payload, []).map((it) => ({ p: product(row.brand, it.product), size: it.size })).filter((x) => x.p);
      return ok({
        code: row.code,
        brand: brands.get(row.brand)?.brand.name || row.brand,
        claimed: !!row.claimed,
        looks: items.map(({ p, size }) => ({ name: p.name, price: p.price, size, image: thumb(p.image, 360) })),
        currency: brands.get(row.brand)?.brand.currency || "Rs.",
      });
    }

    if (key === "POST /api/claim") {
      const u = await member();
      if (!u) return denied;
      const b = await readBody(request);
      const out = await claim(u, b.code);
      return out.error ? fail(404, out.error) : ok(out);
    }

    if (key === "POST /api/pair") {
      if (!(await limiter.limit("pair:" + ip, 10, 900e3))) return fail(429, "Too many tries. Wait a few minutes.");
      const b = await readBody(request);
      const device = await db.get("SELECT * FROM devices WHERE pair_code = ? AND pair_expires > ?", text(b.code, 12).toUpperCase(), Date.now());
      if (!device) return fail(404, "That pairing code isn't right, or it has expired.");
      const token = newToken();
      await db.run("UPDATE devices SET token = ?, pair_code = NULL, pair_expires = NULL, paired = ?, seen = ? WHERE id = ?", sha(token), Date.now(), Date.now(), device.id);
      await audit(ip, device.id, "mirror-paired", device.brand);
      return ok({ device: device.id, token, brand: device.brand, name: device.name });
    }

    // ----- what happened at the mirror
    if (key === "POST /api/events") {
      const who = await identify(request);
      if (who.kind === "none") return fail(401, "not paired");
      if (!(await limiter.limit("events:" + ip, 1500, 3600e3))) return fail(429, "slow down");
      const b = await readBody(request, 4e4);
      // A paired mirror's visits are its store's, whatever store the page says it is showing: they are what a store's sessions are counted from.
      const brandId = who.device?.brand || text(b.brand, 80);
      if (!brands.has(brandId)) return fail(404, "unknown brand");
      const visit = text(b.visit, 40);
      const list = (Array.isArray(b.events) ? b.events : []).slice(0, 40);
      let stored = 0;
      for (const e of list) {
        const kind = text(e?.kind, 20);
        if (!EVENT_KINDS.has(kind)) continue;
        const value = Number.isFinite(Number(e.value)) ? Number(e.value) : null;
        await db.run(
          // sample: 0 a store's mirror, 1 seeded sample, 2 a member at home (kept out of the store's own numbers)
          "INSERT INTO events (at, brand, device, visit, user, kind, product, value, meta, sample) VALUES (?,?,?,?,?,?,?,?,?,?)",
          Date.now(), brandId, who.device?.id || null, visit, who.user?.id || null, kind, e.product ? text(e.product, 80) : null, value, e.meta ? text(e.meta, 60) : null, who.kind === "member" ? 2 : 0,
        );
        stored++;
        // The mirror reports how long a live look really ran; the meter was set to the full cap when it started.
        if (kind === "live_end" && Number.isInteger(Number(e.grant)) && value !== null) await settleLive(who, Number(e.grant), value);
      }
      return ok({ stored });
    }

    // ----- membership
    if (key === "POST /api/private/request") {
      const u = await member();
      if (!u) return denied;
      const b = await readBody(request);
      const had = await db.get("SELECT * FROM invites WHERE user = ? AND status IN ('waiting','invited')", u.id);
      if (had) return ok({ status: had.status });
      await db.run("INSERT INTO invites (id, user, at, note) VALUES (?,?,?,?)", newId(), u.id, Date.now(), text(b.note, 400));
      await notify("founder", "founder", "A member asked about MIRVA Private", `${u.name} <${u.email}> asked for an invitation.\n\n${text(b.note, 400)}`);
      return ok({ status: "waiting" });
    }

    if (key === "POST /api/checkout/test") {
      const u = await member();
      if (!u) return denied;
      // Real payments need a merchant account, which is the founder's decision. Until then only the test path exists.
      if (payments !== "test") return fail(501, "Payments aren't connected yet.");
      const invite = await db.get("SELECT * FROM invites WHERE user = ? AND status = 'invited'", u.id);
      if (!invite) return fail(403, "MIRVA Private is by invitation.");
      const tier = MEMBER_TIERS.private;
      await db.batch([
        ["INSERT INTO payments (id, user, at, amount, currency, provider, status, what) VALUES (?,?,?,?,?,?,?,?)", newId(), u.id, Date.now(), tier.price, "PKR", "test", "paid", "MIRVA Private, one year"],
        ["UPDATE users SET tier = 'private', tier_until = ? WHERE id = ?", Date.now() + 365 * DAY, u.id],
        ["UPDATE invites SET status = 'joined', decided = ? WHERE id = ?", Date.now(), invite.id],
      ]);
      await audit(ip, u.id, "private-joined-test");
      return ok({ tier: "private" });
    }

    // ----- the retail site
    if (key === "POST /api/leads") {
      const b = await readBody(request);
      if (text(b.website, 100)) return ok(); // a field people never see; only scripts fill it
      if (!(await limiter.limit("lead:" + ip, 5, 3600e3))) return fail(429, "Thank you. We already have your note; we'll be in touch.");
      const lead = {
        name: text(b.name, 80), company: text(b.company, 100), role: text(b.role, 60), email: cleanEmail(b.email), phone: text(b.phone, 24).replace(/[^0-9+ ()-]/g, ""),
        city: text(b.city, 40), stores: int(b.stores, 0, 5000, 0), segment: text(b.segment, 20), plan: RETAIL_PLANS[b.plan] ? b.plan : "", message: text(b.message, 1200), source: text(b.source, 60),
      };
      if (lead.name.length < 2) return fail(400, "Tell us your name.");
      if (lead.company.length < 2) return fail(400, "Tell us the name of your store.");
      if (!lead.email) return fail(400, "That email doesn't look right.");
      const id = newId();
      await db.run(
        "INSERT INTO leads (id, at, name, company, role, email, phone, city, stores, segment, plan, message, source, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id, Date.now(), lead.name, lead.company, lead.role, lead.email, lead.phone, lead.city, lead.stores, lead.segment, lead.plan, lead.message, lead.source, Date.now(),
      );
      await notify("founder", "founder", `New store enquiry: ${lead.company}`, `${lead.name}, ${lead.role || "role not given"}\n${lead.email} ${lead.phone}\n${lead.city} · ${lead.stores || "?"} stores · ${lead.plan || "no plan chosen"}\n\n${lead.message}`);
      await notify("email", lead.email, "MIRVA has your note", `Hello ${lead.name},\n\nThank you for asking about MIRVA for ${lead.company}. You'll hear from the founder within two working days, with a time to show it on your own catalogue.\n\nMIRVA`);
      return ok({ id });
    }

    if (key === "POST /api/preview") {
      if (!(await limiter.limit("preview:" + ip, 6, 3600e3))) return fail(429, "That's a lot of stores for one hour. Try again a little later.");
      const b = await readBody(request);
      try {
        const brand = await importShopify(b.domain);
        await audit(ip, "", "store-preview", brand.id);
        return ok({ id: brand.id, name: brand.name });
      } catch (e) {
        return fail(400, e.message);
      }
    }

    m = path.match(/^\/api\/pitch\/([a-z0-9-]+)$/);
    if (m && method === "GET") {
      const facts = pitchFacts(m[1]);
      return facts ? ok(facts) : fail(404, "I don't know that store.");
    }

    // ----- a retailer's console
    if (path.startsWith("/api/console/")) {
      const u = await staff();
      if (!u) return denied;
      if (key === "GET /api/console/brands") {
        const list = u.role === "retailer" ? [u.brand] : [...brands.keys()];
        return ok({ brands: list.filter((id) => brands.has(id)).map((id) => ({ id, name: brands.get(id).brand.name })) });
      }
      if (key === "GET /api/console/overview") {
        const id = brandOf(u, url.searchParams.get("brand"));
        return id ? ok(await overview(id, int(url.searchParams.get("days"), 1, 90, 30))) : denied;
      }
      if (key === "GET /api/console/catalogue") {
        const id = brandOf(u, url.searchParams.get("brand"));
        if (!id) return denied;
        const retailer = await db.get("SELECT settings FROM retailers WHERE brand = ?", id);
        const hidden = new Set(parse(retailer?.settings).hidden || []);
        const stats = new Map((await db.all("SELECT product, SUM(kind IN ('portrait','live_start')) AS tries, SUM(kind = 'keep') AS keeps FROM store_events WHERE brand = ? AND product IS NOT NULL GROUP BY product", id)).map((r) => [r.product, r]));
        const entry = brands.get(id);
        return ok({
          brand: { id, name: entry.brand.name, mood: entry.brand.mood, accent: entry.brand.accent, byline: entry.brand.byline, takenAt: entry.catalogue.takenAt },
          products: entry.catalogue.products.map((p) => ({
            id: p.id, name: p.name, price: p.price, image: thumb(p.image, 160), lane: p.lane, unstitched: !!p.unstitched,
            sizesOut: (p.sizes || []).filter((s) => !s.inStock).map((s) => s.label), hidden: hidden.has(p.id),
            tries: Number(stats.get(p.id)?.tries) || 0, keeps: Number(stats.get(p.id)?.keeps) || 0,
          })),
        });
      }
      if (key === "POST /api/console/catalogue/hide") {
        const b = await readBody(request);
        const id = brandOf(u, b.brand);
        if (!id) return denied;
        if (!product(id, text(b.product, 80))) return fail(404, "I can't find that piece.");
        const row = await db.get("SELECT * FROM retailers WHERE brand = ?", id);
        const settings = parse(row?.settings);
        const hidden = new Set(settings.hidden || []);
        b.hidden === true ? hidden.add(text(b.product, 80)) : hidden.delete(text(b.product, 80));
        settings.hidden = [...hidden];
        if (row) await db.run("UPDATE retailers SET settings = ? WHERE brand = ?", JSON.stringify(settings), id);
        else await db.run("INSERT INTO retailers (brand, plan, stores, status, started, settings) VALUES (?,?,?,?,?,?)", id, "studio", 1, "demo", Date.now(), JSON.stringify(settings));
        await audit(ip, u.id, b.hidden === true ? "piece-hidden" : "piece-shown", `${id}/${text(b.product, 80)}`);
        return ok({ hidden: settings.hidden });
      }
      if (key === "POST /api/console/brand") {
        const b = await readBody(request);
        const id = brandOf(u, b.brand);
        if (!id) return denied;
        const patch = {};
        if (["porcelain", "noir"].includes(b.mood)) patch.mood = b.mood;
        if (/^#[0-9a-f]{6}$/i.test(String(b.accent || ""))) patch.accent = b.accent.toUpperCase();
        if (b.byline !== undefined) patch.byline = text(b.byline, 40) || "styled by MIRVA";
        if (!Object.keys(patch).length) return fail(400, "Nothing to change.");
        await saveBrand(id, patch);
        await audit(ip, u.id, "brand-changed", id);
        return ok({ brand: brands.get(id).brand });
      }
      if (key === "GET /api/console/devices") {
        const id = brandOf(u, url.searchParams.get("brand"));
        if (!id) return denied;
        return ok({
          devices: (await db.all("SELECT id, name, store, paired, seen, created, pair_code, pair_expires FROM devices WHERE brand = ? ORDER BY created", id)).map((d) => ({
            ...d, pair_code: d.pair_expires > Date.now() ? d.pair_code : null, pairUrl: d.pair_expires > Date.now() ? `${origin}/mirror?brand=${id}&pair=${d.pair_code}` : null,
          })),
        });
      }
      if (key === "POST /api/console/devices") {
        const b = await readBody(request);
        const id = brandOf(u, b.brand);
        if (!id) return denied;
        if (Number((await db.get("SELECT COUNT(*) n FROM devices WHERE brand = ?", id)).n) >= 200) return fail(409, "That is a lot of mirrors. Talk to MIRVA first.");
        const device = { id: newId(9), code: newCode(6) };
        await db.run("INSERT INTO devices (id, brand, name, store, pair_code, pair_expires, created) VALUES (?,?,?,?,?,?,?)", device.id, id, text(b.name, 40) || "Mirror", text(b.store, 60), device.code, Date.now() + 30 * 60e3, Date.now());
        await audit(ip, u.id, "mirror-added", id);
        return ok({ id: device.id, code: device.code, pairUrl: `${origin}/mirror?brand=${id}&pair=${device.code}` });
      }
      if (key === "POST /api/console/devices/code" || key === "POST /api/console/devices/remove") {
        const b = await readBody(request);
        const device = await db.get("SELECT * FROM devices WHERE id = ?", text(b.id, 40));
        if (!device || (u.role === "retailer" && device.brand !== u.brand)) return fail(404, "I can't find that mirror.");
        if (key.endsWith("/remove")) {
          await db.run("DELETE FROM devices WHERE id = ?", device.id);
          await audit(ip, u.id, "mirror-removed", device.brand);
          return ok();
        }
        const code = newCode(6);
        await db.run("UPDATE devices SET token = NULL, pair_code = ?, pair_expires = ? WHERE id = ?", code, Date.now() + 30 * 60e3, device.id);
        return ok({ code, pairUrl: `${origin}/mirror?brand=${device.brand}&pair=${code}` });
      }
      if (key === "GET /api/console/limits") {
        const id = brandOf(u, url.searchParams.get("brand"));
        return id ? ok(await limitsOf(id, u)) : denied;
      }
      if (key === "POST /api/console/limits") {
        const b = await readBody(request);
        const id = brandOf(u, b.brand);
        if (!id) return denied;
        const patch = {};
        const maxDaily = u.role === "founder" ? MIRROR.dailyUsdMaxFounder : MIRROR.dailyUsdMaxRetailer;
        if (b.mirrorDailyUsd !== undefined) {
          const n = typeof b.mirrorDailyUsd === "number" || (typeof b.mirrorDailyUsd === "string" && b.mirrorDailyUsd.trim() !== "") ? Number(b.mirrorDailyUsd) : NaN;
          if (!Number.isFinite(n) || n < MIRROR.dailyUsdMin || n > maxDaily) return fail(400, `A mirror's daily budget is between $${MIRROR.dailyUsdMin} and $${maxDaily}.`);
          patch.mirrorDailyUsd = Math.round(n * 100) / 100;
        }
        if (b.overageSessions !== undefined) {
          const n = typeof b.overageSessions === "number" || (typeof b.overageSessions === "string" && b.overageSessions.trim() !== "") ? Number(b.overageSessions) : NaN;
          if (!Number.isInteger(n) || n < 0 || n > MIRROR.overageMax) return fail(400, `The overage cap is a whole number of sessions, from 0 to ${MIRROR.overageMax}. Zero stops the mirrors at the allowance.`);
          patch.overageSessions = n;
        }
        if (!Object.keys(patch).length) return fail(400, "Nothing to change.");
        // A store with no plan on record gets the same placeholder row hiding a piece makes, so its settings have somewhere to live.
        const row = await db.get("SELECT * FROM retailers WHERE brand = ?", id);
        const settings = { ...settingsOf(row), ...patch };
        if (row) await db.run("UPDATE retailers SET settings = ? WHERE brand = ?", JSON.stringify(settings), id);
        else await db.run("INSERT INTO retailers (brand, plan, stores, status, started, settings) VALUES (?,?,?,?,?,?)", id, "studio", 1, "demo", Date.now(), JSON.stringify(settings));
        await audit(ip, u.id, "limits-changed", `${id} daily=${patch.mirrorDailyUsd ?? "-"} overage=${patch.overageSessions ?? "-"}`);
        return ok(await limitsOf(id, u));
      }
      return fail(404, "not found");
    }

    // ----- the founder's desk
    if (path.startsWith("/api/hq/")) {
      const u = await staff(true);
      if (!u) return denied;
      if (key === "GET /api/hq/overview") {
        const since = Date.now() - 30 * DAY;
        const rows = await db.all("SELECT * FROM retailers ORDER BY started");
        const monthly = new Map(
          (await db.all(`SELECT brand, COUNT(DISTINCT COALESCE(visit, '')) AS n FROM events WHERE device IS NOT NULL AND sample = 0 AND at >= ? AND ${TRIED} GROUP BY brand`, monthStart())).map((r) => [r.brand, Number(r.n) || 0]),
        );
        const retailers = await Promise.all(
          rows.map(async (r) => {
            const store = storeFrom(r);
            return {
              brand: r.brand, name: brands.get(r.brand)?.brand.name || r.brand, plan: r.plan, stores: r.stores, status: r.status, started: r.started, monthly: monthlyFee(r.plan, r.stores),
              sessions: store.plan ? sessionsOf(store, monthly.get(r.brand) || 0) : null,
              users: await db.all("SELECT name, email FROM users WHERE role = 'retailer' AND brand = ?", r.brand),
            };
          }),
        );
        const usage = await db.all(`SELECT CAST((at + ${PKT}) / ${DAY} AS INTEGER) AS day, kind, COUNT(*) AS n, SUM(seconds) AS seconds, SUM(usd) AS usd FROM usage WHERE at >= ? AND sample = 0 GROUP BY day, kind ORDER BY day`, since);
        const usd = usage.reduce((a, r) => a + (Number(r.usd) || 0), 0);
        const count = async (sql, ...p) => Number((await db.get(sql, ...p)).n);
        const leads = Object.fromEntries(await Promise.all(LEAD_STATUS.map(async (s) => [s, await count("SELECT COUNT(*) n FROM leads WHERE status = ?", s)])));
        return ok({
          leads,
          needs: await founderNeeds(rows, monthly),
          members: {
            total: await count("SELECT COUNT(*) n FROM users WHERE role = 'member'"),
            private: await count("SELECT COUNT(*) n FROM users WHERE role = 'member' AND tier = 'private'"),
            week: await count("SELECT COUNT(*) n FROM users WHERE role = 'member' AND created >= ?", Date.now() - 7 * DAY),
            looks: await count("SELECT COUNT(*) n FROM looks"),
            boards: await count("SELECT COUNT(*) n FROM boards"),
            votes: await count("SELECT COUNT(*) n FROM votes"),
          },
          retailers,
          mrr: retailers.filter((r) => r.status === "live").reduce((a, r) => a + r.monthly, 0),
          pilots: retailers.filter((r) => r.status === "pilot").length,
          usage: usage.map((r) => ({ date: new Date(Number(r.day) * DAY).toISOString().slice(0, 10), kind: r.kind, n: Number(r.n), seconds: Number(r.seconds) || 0, usd: Number(r.usd) || 0 })),
          spend: { usd, pkr: Math.round(usd * USD_TO_PKR) },
          waiting: {
            invites: await count("SELECT COUNT(*) n FROM invites WHERE status = 'waiting'"),
            outbox: await count("SELECT COUNT(*) n FROM outbox WHERE sent IS NULL"),
          },
          system: { live: config.live, model: config.model, sessionSeconds: config.sessionSeconds, idleSeconds: config.idleSeconds, payments, openMirror, origin, dailyUsd, brands: [...brands.keys()], stores: [...brands.values()].map(({ brand }) => ({ id: brand.id, name: brand.name, visibility: brand.visibility || "public" })) },
        });
      }
      if (key === "GET /api/hq/tryons") return ok(await tryons(int(url.searchParams.get("days"), 1, 365, 30)));
      if (key === "GET /api/hq/leads") return ok({ leads: await db.all("SELECT * FROM leads ORDER BY at DESC LIMIT 300"), statuses: LEAD_STATUS });
      if (key === "POST /api/hq/leads/update") {
        const b = await readBody(request);
        const lead = await db.get("SELECT * FROM leads WHERE id = ?", text(b.id, 40));
        if (!lead) return fail(404, "I can't find that enquiry.");
        const status = LEAD_STATUS.includes(b.status) ? b.status : lead.status;
        await db.run("UPDATE leads SET status = ?, notes = ?, updated = ? WHERE id = ?", status, b.notes === undefined ? lead.notes : text(b.notes, 4000), Date.now(), lead.id);
        await audit(ip, u.id, "lead-" + status, lead.company);
        return ok({ lead: await db.get("SELECT * FROM leads WHERE id = ?", lead.id) });
      }
      if (key === "POST /api/hq/stores/visibility") {
        const b = await readBody(request);
        const id = text(b.brand, 80);
        if (!brands.has(id)) return fail(404, "I don't know that store.");
        if (!["public", "unlisted"].includes(b.visibility)) return fail(400, "Listed, or by link only.");
        await saveBrand(id, { visibility: b.visibility });
        await audit(ip, u.id, "store-" + b.visibility, id);
        return ok();
      }
      if (key === "POST /api/hq/retailers") {
        const b = await readBody(request);
        const id = text(b.brand, 80);
        if (!brands.has(id)) return fail(404, "Load that store's catalogue first.");
        if (!RETAIL_PLANS[b.plan]) return fail(400, "Choose a plan.");
        const status = ["demo", "pilot", "live", "paused"].includes(b.status) ? b.status : "pilot";
        await db.run(
          "INSERT INTO retailers (brand, plan, stores, status, started) VALUES (?,?,?,?,?) ON CONFLICT(brand) DO UPDATE SET plan = excluded.plan, stores = excluded.stores, status = excluded.status",
          id, b.plan, int(b.stores, 1, 5000, 1), status, Date.now(),
        );
        await audit(ip, u.id, "retailer-saved", id);
        return ok();
      }
      if (key === "POST /api/hq/retailers/user") {
        const b = await readBody(request);
        const id = text(b.brand, 80);
        const mail = cleanEmail(b.email);
        if (!brands.has(id)) return fail(404, "I don't know that store.");
        if (!mail || text(b.name, 80).length < 2) return fail(400, "A name and an email, please.");
        if (await db.get("SELECT 1 FROM users WHERE email = ?", mail)) return fail(409, "That email already has an account.");
        const password = newCode(14);
        await db.run("INSERT INTO users (id, role, email, name, pass, brand, created) VALUES (?,?,?,?,?,?,?)", newId(), "retailer", mail, text(b.name, 80), await hashPassword(password, kdf), id, Date.now());
        await audit(ip, u.id, "retailer-user-added", id);
        return ok({ email: mail, password }); // shown once, to pass on by hand
      }
      if (key === "GET /api/hq/members") {
        return ok({ members: await db.all("SELECT u.id, u.name, u.email, u.tier, u.created, u.seen, (SELECT COUNT(*) FROM looks l WHERE l.user = u.id) AS looks FROM users u WHERE u.role = 'member' ORDER BY u.created DESC LIMIT 300") });
      }
      if (key === "GET /api/hq/invites") {
        return ok({ invites: await db.all("SELECT i.*, u.name, u.email, (SELECT COUNT(*) FROM looks l WHERE l.user = u.id) AS looks FROM invites i JOIN users u ON u.id = i.user ORDER BY i.at DESC LIMIT 200") });
      }
      if (key === "POST /api/hq/invites/decide") {
        const b = await readBody(request);
        const row = await db.get("SELECT i.*, u.name, u.email FROM invites i JOIN users u ON u.id = i.user WHERE i.id = ?", text(b.id, 40));
        if (!row) return fail(404, "I can't find that request.");
        const status = b.decision === "invite" ? "invited" : "declined";
        await db.run("UPDATE invites SET status = ?, decided = ? WHERE id = ?", status, Date.now(), row.id);
        if (status === "invited") await notify("email", row.email, "Your invitation to MIRVA Private", `Hello ${row.name},\n\nThere is a place for you in MIRVA Private. Open your account to accept it: ${origin}/account\n\nMIRVA`);
        await audit(ip, u.id, "invite-" + status, row.email);
        return ok({ status });
      }
      if (key === "GET /api/hq/outbox") return ok({ outbox: await db.all("SELECT * FROM outbox ORDER BY at DESC LIMIT 200") });
      if (key === "POST /api/hq/outbox/sent") {
        const b = await readBody(request);
        await db.run("UPDATE outbox SET sent = ? WHERE id = ?", Date.now(), int(b.id, 0, 1e12, 0));
        return ok();
      }
      if (key === "GET /api/hq/audit") return ok({ audit: await db.all("SELECT * FROM audit ORDER BY id DESC LIMIT 200") });
      return fail(404, "not found");
    }

    return null;
  }

  // A store that has signed is no longer a "concept demo": its mirror drops that notice.
  const signed = async (brandId) => ["pilot", "live"].includes((await db.get("SELECT status FROM retailers WHERE brand = ?", brandId))?.status);
  const hiddenFor = async (brandId) => new Set(parse((await db.get("SELECT settings FROM retailers WHERE brand = ?", brandId))?.settings).hidden || []);

  await sweep().catch(() => {});
  return { db, handle, identify, grant, meter, visitFor, creditOut, creditOk, savePortrait, replacePortrait, hiddenFor, signed, ensureFounder, sweep, audit, notify };
}
