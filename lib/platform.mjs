// The MIRVA platform: members and their wardrobes, voting boards, hand-offs from a store mirror,
// the event stream a retailer's console reads, leads from the retail site, and the founder's desk.
// The try-on engine itself lives in app.mjs; this module tells it who is asking and keeps the meter.
//
// Nothing here knows which runtime it is on. Requests come in as the web's Request and go out as
// Response; the database, the throttle and the portrait store are handed in by the host.
import { newId, newCode, parse } from "./ids.mjs";
import { hashPassword, verifyPassword, decoyHash, passwordProblem, startSession, endSession, currentUser, sha, newToken } from "./auth.mjs";
import { json, readBody, cookies, text, int, email as cleanEmail, SECURITY } from "./http.mjs";
import { MEMBER_TIERS, RETAIL_PLANS, EXTRAS, PILOT, COST, USD_TO_PKR, MIRROR, VISIT, tierOf, planOf, monthlyFee, monthStart, pktDayStart } from "./plans.mjs";
import { pushEndpoint } from "./push.mjs";
import { parseSizeChart } from "../src/stylist.js"; // plain rules with nothing of the browser in them, shared with the mirror

const DAY = 86400e3;
// A portrait can be replaced by its finished version (the shopper's own head laid back, src/restore.js) for this long, up to this size.
const FINISH_WINDOW = 15 * 60e3;
const FINISH_MAX = 3 * 1024 * 1024;
const COVER_MAX = 700 * 1024; // a question's link picture, 1200 by 630
const coverId = (code) => "cover_" + code;
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const PKT = 5 * 3600e3; // Pakistan is UTC+5 all year
const EVENT_KINDS = new Set([
  "visit", "brief", "looks_shown", "look_open", "portrait", "live_start", "live_end",
  "keep", "unkeep", "addon", "send", "size_pick", "size_missed", "compare", "ended", "consent", "sale",
  "backdrop", // the second, studio-wall pass of a portrait: a record of how it went, not a try (TRIED leaves it out)
]);
const LEAD_STATUS = ["new", "contacted", "demo", "pilot", "won", "lost"];
const TRIED = "kind IN ('portrait','live_start')"; // the events that make a visit a session
// A WhatsApp number as wa.me wants it: digits only, with the country code (a Pakistani 03xx number gains 92).
export const waNumber = (v) => {
  let d = String(v || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "92" + d.slice(1);
  return /^\d{10,15}$/.test(d) ? d : "";
};

// What a pilot's one written target can be measured in.
const PILOT_METRICS = { "buy-share": "of try-on visits end in a sale (%)", sales: "sales counted", kept: "looks kept" };
const CREDIT = "tryon-credit"; // flags: the try-on account has no credit left
const CREDIT_TOLD = "tryon-credit-told"; // flags: the Pakistan day the founder was last written to about it
const FAL_TOLD = "fal-credit-told"; // flags: the Pakistan day the founder was told the face-keeping account (fal) is empty
const rupees = (n) => "Rs." + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * db       the async store (get / all / run / batch)
 * limiter  { limit, blocked, strike }, all async
 * files    { put(id, bytes, type), get(id) -> {bytes, type} | null, del(id) } for kept portraits
 * kdf      which password scheme this runtime hashes with ("scrypt" or "pbkdf2")
 */
// Features tried on named accounts before anyone else: "<feature>:<user id>,<user id>; <feature>:..." (MIRVA_TRIALS).
// Returns (user) => the features that user has.
export function trialsFor(setting) {
  const map = new Map(String(setting || "").split(";").map((part) => part.split(":")).filter(([f, ids]) => f?.trim() && ids).map(([f, ids]) => [f.trim(), new Set(ids.split(",").map((s) => s.trim()).filter(Boolean))]));
  return (u) => (u?.id ? [...map].filter(([, ids]) => ids.has(u.id)).map(([f]) => f) : []);
}

export async function createPlatform({ db, limiter, files, brands, config, importShopify, saveBrand, origin, openMirror, payments, kdf, dailyUsd = 0, dailyPortraitUsd = dailyUsd, trials = "", setupKey = "", push = { publicKey: "", send: async () => 0 } }) {
  const secure = origin.startsWith("https://");

  // --- small shared pieces ---------------------------------------------------
  // `ip` is the caller's address as the host decided it, or null when there is no caller.
  const audit = (ip, actor, action, target = "") =>
    db.run("INSERT INTO audit (at, actor, action, target, ip) VALUES (?,?,?,?,?)", Date.now(), actor || "", action, String(target).slice(0, 120), ip || "");

  // Nothing is sent from here yet. Every message MIRVA would send waits in the outbox,
  // so connecting an email or WhatsApp sender later is one function, not a rewrite.
  const notify = (channel, recipient, subject, body) =>
    db.run("INSERT INTO outbox (at, channel, recipient, subject, body) VALUES (?,?,?,?,?)", Date.now(), channel, recipient, subject, body);

  // Features tried on named accounts before anyone else (MIRVA_TRIALS: "<feature>:<user id>,<user id>; ...").
  const trialsOf = trialsFor(trials);

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
  // mirror may spend in a Pakistan day, the live minutes and portraits its store's plan includes in a month (and the
  // live minutes the store has agreed to pay for on top), and how many try-ons one mirror may start in an hour.
  const settingsOf = (row) => {
    const s = parse(row?.settings);
    return s && typeof s === "object" && !Array.isArray(s) ? s : {};
  };
  // A number read from stored settings, kept inside its bounds. Anything that is not a number gives the fallback.
  const bounded = (v, lo, hi, fallback) => ((typeof v === "number" || (typeof v === "string" && v.trim() !== "")) && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : fallback);
  const budgetOf = (settings) => bounded(settings.mirrorDailyUsd, 0, 1000, MIRROR.dailyUsd);
  const extraLiveOf = (settings) => Math.round(bounded(settings.extraLiveMinutes, 0, MIRROR.extraLiveMax, 0));
  // Portraits a month the founder has added to a store's plan at no charge (a busy pilot must not stop at its allowance).
  const EXTRA_PORTRAITS_MAX = 20000;
  const extraPortraitsOf = (settings) => Math.round(bounded(settings.extraPortraits, 0, EXTRA_PORTRAITS_MAX, 0));

  // A retailers row read as a store: its plan, what the plan includes in a month for every store it has (live minutes
  // and portraits), the live minutes it has agreed to pay for on top, and its own settings.
  function storeFrom(row) {
    const plan = planOf(row.plan);
    const settings = settingsOf(row);
    const stores = Math.max(1, Math.round(Number(row.stores) || 1));
    return { row, settings, plan, stores, liveMinutes: plan ? plan.liveMinutes * stores : 0, extraMinutes: extraLiveOf(settings), portraits: plan ? plan.portraits * stores + extraPortraitsOf(settings) : 0, budget: budgetOf(settings) };
  }
  async function storeOf(brandId) {
    const row = brandId ? await db.get("SELECT * FROM retailers WHERE brand = ?", brandId) : undefined;
    return row ? storeFrom(row) : null;
  }
  // What a brand's paired mirrors have used this calendar month, from the meter: live seconds and portraits.
  // The seeded sample and members at home (no mirror) are not the store's. A studio backdrop comes with its portrait.
  const USED = "COALESCE(SUM(CASE WHEN kind = 'live' THEN seconds ELSE 0 END), 0) AS live, COALESCE(SUM(kind = 'portrait'), 0) AS portraits";
  async function usedIn(brandId, now = Date.now()) {
    const row = await db.get(`SELECT ${USED} FROM usage WHERE brand = ? AND device IS NOT NULL AND sample = 0 AND at >= ?`, brandId, monthStart(now));
    return { liveSeconds: Number(row?.live) || 0, portraits: Number(row?.portraits) || 0 };
  }
  async function usedByBrand(now = Date.now()) {
    const rows = await db.all(`SELECT brand, ${USED} FROM usage WHERE device IS NOT NULL AND sample = 0 AND at >= ? GROUP BY brand`, monthStart(now));
    return new Map(rows.map((r) => [r.brand, { liveSeconds: Number(r.live) || 0, portraits: Number(r.portraits) || 0 }]));
  }
  const NOTHING_USED = { liveSeconds: 0, portraits: 0 };
  // How a store stands against its month. Live: minutes used (to a tenth, never rounded down), what the plan includes,
  // what was bought on top, how far past the plan's own minutes it is and what that bills. A plan with no live minutes
  // is "stopped" for live from the start: live Studio comes with a mirror.
  function standingOf(store, used = NOTHING_USED) {
    const limit = store.liveMinutes + store.extraMinutes;
    const over = Math.max(0, Math.ceil(used.liveSeconds / 60 - store.liveMinutes - 1e-9));
    return {
      live: {
        usedMinutes: Math.ceil(used.liveSeconds / 6 - 1e-9) / 10, included: store.liveMinutes, extra: store.extraMinutes, limit,
        over, overPkr: over * EXTRAS.liveMinutePkr, stopped: used.liveSeconds > limit * 60 - MIRROR.liveFloorSeconds,
      },
      portraits: { used: used.portraits, included: store.portraits, stopped: used.portraits >= store.portraits },
    };
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
    if (store?.row.status === "paused") return { ok: false, status: 403, error: "Try-on is resting at this store for now. The stylist still works.", limit: "paused" };
    const left = (store ? store.budget : budgetOf({})) - (await spentToday(device.id, now));
    const dayOver = { ok: false, status: 429, error: "This mirror has done its try-ons for today. The stylist still works.", limit: "mirror-day" };
    if (left <= 1e-9) return dayOver;
    // A live look is reserved at its full length when it starts, so it may not run past what the day has left.
    let seconds = config.sessionSeconds;
    if (kind === "live" && config.ratePerSecond > 0) {
      seconds = Math.min(seconds, Math.floor(left / config.ratePerSecond + 1e-9));
      if (seconds < MIRROR.liveFloorSeconds) return dayOver;
    }
    // The store's month. Live is what costs, so it is the one held to the minute; when it runs out, or the plan has
    // none (Assist), the mirror is told so in words it can say and makes a portrait instead.
    if (store?.plan) {
      const used = await usedIn(device.brand, now);
      if (kind === "live") {
        const limit = (store.liveMinutes + store.extraMinutes) * 60;
        if (limit <= 0) return { ok: false, status: 402, error: "Live Studio comes with a MIRVA mirror. Here is a portrait instead.", limit: "no-live" };
        if (limit - used.liveSeconds < MIRROR.liveFloorSeconds)
          return { ok: false, status: 429, error: "This store has used its live minutes for the month. Here is a portrait instead.", limit: "store-live" };
        seconds = Math.min(seconds, Math.floor(limit - used.liveSeconds));
      } else if (kind === "portrait" && used.portraits >= store.portraits)
        return { ok: false, status: 429, error: "This store has used its portraits for the month. The stylist still works.", limit: "store-portraits" };
    }
    if (!(await limiter.limit("mirror:" + device.id, device.web ? MIRROR.perHour * 5 : MIRROR.perHour, 3600e3)))
      return { ok: false, status: 429, error: "This mirror has been busy this hour. Give it a little while; the stylist still works.", limit: "mirror-hour" };
    return { ok: true, seconds };
  }

  const GLASSES = ["plain", "oval"];
  const glassOf = (settings, deviceId) => (deviceId && settings?.glass && typeof settings.glass === "object" && settings.glass[deviceId] === "oval" ? "oval" : "plain");

  // How a shopper's visit at this mirror is shaped (the page enforces it), and how long it waits before it lets go.
  async function visitFor(device) {
    const store = await storeOf(device?.brand);
    const set = settingsOf(store?.row).visit;
    const v = set && typeof set === "object" && !Array.isArray(set) ? set : {};
    const n = (key, lo, hi, fallback = VISIT[key]) => Math.round(bounded(v[key], lo, hi, fallback));
    return {
      visit: { liveLooks: n("liveLooks", 0, 20), liveSeconds: n("liveSeconds", 20, 900), portraits: n("portraits", 0, 40), resetSeconds: n("resetSeconds", 10, 600) },
      idleSeconds: n("idleSeconds", 20, 600, Math.min(config.idleSeconds, VISIT.idleSeconds)),
      // false only for a store whose plan has no live minutes at all (Assist): the mirror then offers portraits, and says where live is
      studio: !device?.web && !(store?.plan && store.liveMinutes + store.extraMinutes <= 0),
      // the outline of this mirror's glass: MIRVA's own mirror is an oval, any other screen is a plain rectangle
      glass: glassOf(settingsOf(store?.row), device?.id),
    };
  }

  // What a store's console shows and sets about limits: the budget for each mirror and how today's spending stands against it,
  // the live minutes and portraits the plan includes and how many have been used, and the live minutes it has agreed to pay for on top.
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
      extraLiveMinutes: store ? store.extraMinutes : 0,
      extraLiveMax: MIRROR.extraLiveMax,
      liveMinutePkr: EXTRAS.liveMinutePkr,
      liveBlockMinutes: EXTRAS.liveBlockMinutes,
      tryOnsPerHour: MIRROR.perHour,
      plan: store?.plan ? { id: store.plan.id, name: store.plan.name, stores: store.stores, status: store.row.status } : null,
      month: store?.plan ? standingOf(store, await usedIn(brandId)) : null,
      mirrors: mirrors.map((d) => {
        const usd = spent.get(d.id) || 0;
        return { id: d.id, name: d.name, store: d.store || "", paired: !!d.paired, spentUsd: Math.round(usd * 1e4) / 1e4, hit: usd >= budget - 1e-9 };
      }),
    };
  }

  // What the founder should look at first, as sentences ready to read. In the order they matter:
  // the try-on account out of credit, stores past their allowance, stores close to it, mirrors that have used their day,
  // and a day whose spending is far above the week before. `rows` are the retailers rows, `monthly` this month's use by brand (see usedByBrand).
  async function founderNeeds(rows, monthly, now = Date.now()) {
    const out = [];
    const name = (id) => brands.get(id)?.brand.name || id;
    const credit = await flag(CREDIT);
    if (credit)
      out.push({ kind: "credit", since: Number(credit.at) || null, text: "The try-on account is out of credit. Shoppers and mirrors are being told try-on is resting. Top it up with Decart; this clears itself the next time a try-on works." });

    // Live minutes are what a store can run past. A plan with none (Assist) has nothing to be near or over.
    const stores = rows.map(storeFrom).filter((s) => s.plan && s.liveMinutes > 0).map((store) => ({ brand: store.row.brand, ...standingOf(store, monthly.get(store.row.brand)).live }));
    const minutes = (n) => `${n} live minute${n === 1 ? "" : "s"}`;
    for (const s of stores.filter((x) => x.over > 0))
      out.push({
        kind: "store-over", brand: s.brand, used: s.usedMinutes, included: s.included, over: s.over, pkr: s.overPkr,
        text: `${name(s.brand)} is past its plan: ${s.usedMinutes} live minutes this month against ${s.included} included. That is ${minutes(s.over)} to bill, ${rupees(s.overPkr)} at ${rupees(EXTRAS.liveMinutePkr)} each. ${s.stopped ? "Live Studio has stopped there until the 1st; portraits carry on." : `It has agreed to ${s.extra} extra, so about ${Math.max(0, Math.floor(s.limit - s.usedMinutes))} more can run.`}`,
      });
    for (const s of stores.filter((x) => x.over === 0 && x.usedMinutes >= 0.8 * x.included))
      out.push({
        kind: "store-near", brand: s.brand, used: s.usedMinutes, included: s.included,
        text: `${name(s.brand)} has used ${s.usedMinutes} of its ${s.included} live minutes this month (${Math.round((s.usedMinutes / s.included) * 100)}%).${s.stopped ? " Live Studio has stopped there until the 1st, or until it agrees to extra minutes; portraits carry on." : ""}`,
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
  // The face-keeping account (fal: outlines and the second engine) is empty. Portraits still come (the phone keeps her
  // face the old way), so this is a note to the founder, once a Pakistan day, not a resting mirror.
  async function falOut() {
    const now = Date.now();
    const day = new Date(now + PKT).toISOString().slice(0, 10);
    const told = await db.run("INSERT INTO flags (key, value, at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, at = excluded.at WHERE flags.value IS NOT excluded.value", FAL_TOLD, day, now);
    if (told.changes)
      await notify(
        "founder",
        "founder",
        "The face-keeping account (fal) is out of credit",
        "fal.ai answered that its account has no credit left. Portraits still work: until it is topped up, each phone lays the shopper's face back itself, the slower way, and the second engine is off.\n\nTop up at fal.ai (Billing). This message comes at most once a day.",
      );
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

  // --- a store's own website ---------------------------------------------------------------
  // public/embed.js, on a store's product page, asks for a pass. Only a website the store named in its console gets one,
  // and only for a store that has signed (a pilot or live): the portraits are the store's.
  const ORIGIN_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  const sitesOf = (row) => (Array.isArray(settingsOf(row).embed?.sites) ? settingsOf(row).embed.sites.filter((s) => ORIGIN_RE.test(s)) : []);
  async function embedSession(request, ip) {
    const from = String(request.headers.get("origin") || "");
    const cors = { "access-control-allow-origin": from || "*", vary: "origin" };
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" } });
    if (request.method !== "POST") return json(405, { error: "method not allowed" }, cors);
    const b = await readBody(request, 2000);
    const id = text(b.store, 80);
    const row = id && brands.has(id) ? await db.get("SELECT * FROM retailers WHERE brand = ?", id) : null;
    if (!row || !ORIGIN_RE.test(from) || !sitesOf(row).includes(from)) return json(403, { error: "This website isn't set up for MIRVA yet." }, cors);
    if (!["pilot", "live"].includes(row.status)) return json(403, { error: "MIRVA is resting on this website." }, cors);
    if (!(await limiter.limit("embed:" + ip, 40, 3600e3))) return json(429, { error: "Too many at once. Try again in a little while." }, cors);
    const pass = newId(24);
    await db.run("INSERT INTO embed_passes (id, brand, origin, at) VALUES (?,?,?,?)", pass, id, from, Date.now());
    return json(200, { pass, mirror: `${origin}/mirror?brand=${encodeURIComponent(id)}&embed=${pass}` }, cors);
  }

  // --- who is asking ---------------------------------------------------------
  // A store's own website opened the mirror with a pass (POST /api/embed/session): the try-ons are the store's, counted
  // as one more of its mirrors, named for the website ("web-<store>"), with no live Studio.
  const EMBED_HOURS = 3;
  async function embedPass(id) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(id || ""))) return null;
    return (await db.get("SELECT * FROM embed_passes WHERE id = ? AND at > ?", id, Date.now() - EMBED_HOURS * 3600e3)) || null;
  }
  const webMirror = (pass) => ({ id: "web-" + pass.brand, brand: pass.brand, name: "Your website", web: true, origin: pass.origin });

  async function identify(request) {
    const passed = request.headers.get("x-mirva-embed");
    if (passed) {
      const pass = await embedPass(passed);
      if (pass && (await signed(pass.brand))) return { kind: "device", device: webMirror(pass) };
    }
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
    // Ceilings on what one day of try-on may cost, whoever is asking: one for live Studio, one for portraits. They are
    // apart so that a few minutes of live video (about Rs.330 a minute) can never stop portraits (Rs.5.5 each) for
    // everyone else, as happened on 15 October 2026. A signed-in founder or store user is not held to them, so a demo
    // never stops in the middle of a meeting.
    const live = kind === "live";
    const ceiling = live ? dailyUsd : dailyPortraitUsd;
    if (ceiling > 0 && who.kind !== "staff" && !(who.kind === "member" && tierOf(who.user).unlimited)) {
      const spent = Number((await db.get(`SELECT COALESCE(SUM(usd), 0) AS n FROM usage WHERE at >= ? AND sample = 0 AND ${live ? "kind = 'live'" : "kind <> 'live'"}`, Date.now() - 86400e3))?.n) || 0;
      if (spent >= ceiling)
        return live
          ? { ok: false, status: 503, error: "Live Studio is resting for today. Tap Model for a portrait of you in it.", limit: "day-live" }
          : { ok: false, status: 503, error: "Try-on is resting for today. It will be back tomorrow." };
    }
    // A store's own mirror is held to its ceilings (see deviceCeilings). Staff are not, so a demo never stops.
    if (who.kind === "device" && who.device.web && kind === "live")
      return { ok: false, status: 402, error: "Live Studio is in MIRVA mirrors. Here is a portrait instead.", limit: "no-live" };
    if (who.kind === "device") return deviceCeilings(who.device, kind);
    if (who.kind !== "member") return { ok: true, seconds: config.sessionSeconds };
    const tier = tierOf(who.user);
    if (kind === "backdrop" || kind === "retake") {
      // A studio backdrop comes with a portrait, never on its own: at most one for each portrait made this month,
      // and it does not draw on the monthly portraits. (The hourly and daily ceilings apply to it all the same.)
      const row = await db.get(
        "SELECT COALESCE(SUM(kind = 'portrait'), 0) AS portraits, COALESCE(SUM(kind = ?), 0) AS backdrops FROM usage WHERE user = ? AND at >= ?",
        kind,
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

  // `bytes` null: the entry only. The phone sends the finished picture (her own face laid back) moments later, and
  // that is the one kept; storing the engine's 1.1 MB picture first took 2.8 s of her wait and a storage write.
  async function savePortrait(user, brandId, productId, bytes, type) {
    const id = newId(16);
    if (bytes) await files.put(id, bytes, type);
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
    // A question that closes within a day: she is told once, so she can decide or give it more time.
    for (const b of await db.all("SELECT code, user, title FROM boards WHERE closed = 0 AND reminded IS NULL AND closes > ? AND closes < ?", now, now + DAY)) {
      await db.run("UPDATE boards SET reminded = ? WHERE code = ?", now, b.code);
      const n = Number((await db.get("SELECT COUNT(*) n FROM votes WHERE board = ?", b.code)).n);
      const said = n ? `${n === 1 ? "1 answer" : n + " answers"} so far. Decide, or give it more time.` : "No answers yet. Send the link again, or give it more time.";
      await tell(b.user, "closing", `“${b.title}” closes tomorrow`, said, "/account?tab=opinions").catch(() => {});
    }
    await db.run("UPDATE boards SET closed = 1 WHERE closed = 0 AND closes < ?", now);
    // A question's link picture is kept for a week after it closes, then deleted.
    for (const { code } of await db.all("SELECT code FROM boards WHERE cover = 1 AND closes < ?", now - 7 * DAY)) {
      await Promise.resolve(files.del(coverId(code))).catch(() => {});
      await db.run("UPDATE boards SET cover = 0 WHERE code = ?", code);
    }
    await db.run("DELETE FROM notes WHERE at < ?", now - 60 * DAY);
    await db.run("DELETE FROM embed_passes WHERE at < ?", now - DAY);
    await dailyWatch(now).catch(() => {});
    for (const { id } of await db.all("SELECT id FROM guest_shots WHERE claimed IS NULL AND at < ?", now - DAY)) {
      await dropPortraitFile(id);
      await db.run("DELETE FROM guest_shots WHERE id = ?", id);
    }
    await db.run("DELETE FROM guest_shots WHERE claimed IS NOT NULL AND at < ?", now - 30 * DAY);
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
  const whereOf = (who) => (who.kind === "device" ? (who.device.web ? 4 : 0) : who.kind === "member" ? 2 : who.kind === "staff" ? 0 : 3);
  // Which visits a store's console counts: everywhere, or one place. Sales and a pilot's target are always in the store.
  const PLACES = { all: "sample IN (0,1,2,3,4)", store: "sample IN (0,1)", web: "sample = 4", app: "sample IN (2,3)" };
  async function overview(brandId, days, place = "all") {
    const since = Date.now() - days * DAY;
    const one = async (sql, ...p) => Number((await db.get(sql, ...p))?.n) || 0;
    const EV = `(SELECT * FROM events WHERE ${PLACES[place] || PLACES.all})`;
    const visits = await one(`SELECT COUNT(DISTINCT visit) n FROM ${EV} WHERE brand = ? AND at >= ? AND kind = 'visit'`, brandId, since);
    const briefed = await one(`SELECT COUNT(DISTINCT visit) n FROM ${EV} WHERE brand = ? AND at >= ? AND kind = 'looks_shown'`, brandId, since);
    const tried = await one(`SELECT COUNT(DISTINCT visit) n FROM ${EV} WHERE brand = ? AND at >= ? AND kind IN ('portrait','live_start')`, brandId, since);
    const kept = await one(`SELECT COUNT(DISTINCT visit) n FROM ${EV} WHERE brand = ? AND at >= ? AND kind = 'keep'`, brandId, since);
    const sent = await one(`SELECT COUNT(DISTINCT visit) n FROM ${EV} WHERE brand = ? AND at >= ? AND kind = 'send'`, brandId, since);
    const byDay = await db.all(
      `SELECT CAST((at + ${PKT}) / ${DAY} AS INTEGER) AS day, COUNT(DISTINCT CASE WHEN kind = 'visit' THEN visit END) AS visits,
              SUM(kind IN ('portrait','live_start')) AS tries, SUM(kind = 'keep') AS keeps
       FROM ${EV} WHERE brand = ? AND at >= ? GROUP BY day ORDER BY day`,
      brandId, since,
    );
    const names = new Map((brands.get(brandId)?.catalogue.products || []).map((p) => [p.id, p]));
    const top = (
      await db.all(
        `SELECT product, SUM(kind = 'look_open') AS opens, SUM(kind IN ('portrait','live_start')) AS tries, SUM(kind = 'keep') AS keeps
         FROM ${EV} WHERE brand = ? AND at >= ? AND product IS NOT NULL GROUP BY product ORDER BY tries DESC, opens DESC LIMIT 12`,
        brandId, since,
      )
    ).map((r) => ({ ...r, name: names.get(r.product)?.name || r.product, price: names.get(r.product)?.price || 0, image: thumb(names.get(r.product)?.image, 160) }));
    const missed = (
      await db.all(`SELECT product, meta AS size, COUNT(*) AS asks FROM ${EV} WHERE brand = ? AND at >= ? AND kind = 'size_missed' GROUP BY product, meta ORDER BY asks DESC LIMIT 8`, brandId, since)
    ).map((r) => ({ ...r, name: names.get(r.product)?.name || r.product, price: names.get(r.product)?.price || 0 }));
    const occasions = await db.all(`SELECT meta AS occasion, COUNT(*) AS n FROM ${EV} WHERE brand = ? AND at >= ? AND kind = 'brief' AND meta IS NOT NULL GROUP BY meta ORDER BY n DESC LIMIT 8`, brandId, since);
    const hours = await db.all(`SELECT CAST((at + ${PKT}) / 3600000 AS INTEGER) % 24 AS hour, COUNT(DISTINCT visit) AS visits FROM ${EV} WHERE brand = ? AND at >= ? AND kind = 'visit' GROUP BY hour ORDER BY hour`, brandId, since);
    const spend = await db.all("SELECT kind, COUNT(*) AS n, SUM(seconds) AS seconds, SUM(usd) AS usd FROM usage WHERE brand = ? AND at >= ? AND user IS NULL GROUP BY kind", brandId, since);
    const usd = spend.reduce((a, s) => a + (Number(s.usd) || 0), 0);
    // What the store pays for, and what a sale is measured against, is its own mirrors and website.
    const triedHere = await one(`SELECT COUNT(DISTINCT visit) n FROM store_events WHERE brand = ? AND at >= ? AND ${TRIED}`, brandId, since);
    const placeRows = await db.all("SELECT sample, COUNT(DISTINCT visit) AS n FROM events WHERE brand = ? AND at >= ? AND kind = 'visit' AND sample <> 1 GROUP BY sample", brandId, since);
    const placeOf = (k) => placeRows.filter((r) => k.includes(Number(r.sample))).reduce((a, r) => a + (Number(r.n) || 0), 0);
    const places = { store: placeOf([0]), web: placeOf([4]), app: placeOf([2, 3]) };
    const retailer = await db.get("SELECT * FROM retailers WHERE brand = ?", brandId);
    const plan = retailer ? planOf(retailer.plan) : null;
    // The month's use is counted over the calendar month, the way the plan is, not over the days the page is looking at.
    const standing = retailer && plan ? standingOf(storeFrom(retailer), await usedIn(brandId)) : null;
    // Sales the store's staff counted on the mirror's tablet ("Sold"): how many, how much, how many try-on visits ended
    // in one, and who helped. Entered by hand, so honest but rough; it is what a pilot's target and the Results plan read.
    const SALE = "FROM store_events WHERE brand = ? AND at >= ? AND kind = 'sale'";
    const boughtAfter = (from) => one(`SELECT COUNT(DISTINCT visit) n ${SALE} AND visit IN (SELECT visit FROM store_events WHERE brand = ? AND at >= ? AND ${TRIED})`, brandId, from, brandId, from);
    const soldRow = await db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(value), 0) AS pkr ${SALE}`, brandId, since);
    const soldVisits = await boughtAfter(since);
    const byStaff = (await db.all(`SELECT COALESCE(meta, '') AS name, COUNT(*) AS n, COALESCE(SUM(value), 0) AS pkr ${SALE} GROUP BY meta ORDER BY pkr DESC LIMIT 12`, brandId, since)).map((r) => ({ name: r.name || "Not named", n: Number(r.n) || 0, pkr: Math.round(Number(r.pkr) || 0) }));
    const sales = { count: Number(soldRow?.n) || 0, pkr: Math.round(Number(soldRow?.pkr) || 0), visits: soldVisits, tried: triedHere, share: triedHere ? soldVisits / triedHere : 0, byStaff };
    const monthSales = Math.round(Number((await db.get(`SELECT COALESCE(SUM(value), 0) AS pkr ${SALE}`, brandId, monthStart()))?.pkr) || 0);
    // A pilot: one target agreed in writing, and where the store stands against it since the day it began.
    const set = retailer ? settingsOf(retailer).pilot : null;
    let pilot = null;
    if (set && PILOT_METRICS[set.metric] && Number(set.target) > 0 && Number(set.start) > 0) {
      const from = Number(set.start), length = int(set.days, 7, 180, 60);
      const triedSince = await one(`SELECT COUNT(DISTINCT visit) n FROM store_events WHERE brand = ? AND at >= ? AND ${TRIED}`, brandId, from);
      const value =
        set.metric === "buy-share" ? (triedSince ? Math.round(((await boughtAfter(from)) / triedSince) * 1000) / 10 : 0)
        : set.metric === "sales" ? await one(`SELECT COUNT(*) n ${SALE}`, brandId, from)
        : await one("SELECT COUNT(*) n FROM store_events WHERE brand = ? AND at >= ? AND kind = 'keep'", brandId, from);
      const day = Math.min(length, Math.floor((Date.now() - from) / DAY) + 1);
      pilot = { metric: set.metric, label: PILOT_METRICS[set.metric], target: Number(set.target), start: from, days: length, day, ended: Date.now() >= from + length * DAY, value, met: value >= Number(set.target) };
    }
    const sample = (await one("SELECT COUNT(*) n FROM events WHERE brand = ? AND sample = 1", brandId)) > 0;
    const addons = await one(`SELECT COUNT(*) n FROM ${EV} WHERE brand = ? AND at >= ? AND kind = 'addon'`, brandId, since);
    return {
      brand: brandId,
      days,
      place: PLACES[place] ? place : "all",
      places,
      sample,
      funnel: { visits, briefed, tried, kept, sent },
      sales,
      pilot,
      addons,
      // every day of the period, quiet ones as zero, so the chart's spacing is true to the calendar
      byDay: (() => {
        const got = new Map(byDay.map((r) => [Number(r.day), r]));
        const last = Math.floor((Date.now() + PKT) / DAY), first = Math.max(last - days + 1, byDay.length ? Math.min(...byDay.map((r) => Number(r.day))) : last);
        const out = [];
        for (let d = first; d <= last; d++) {
          const r = got.get(d) || {};
          out.push({ date: new Date(d * DAY).toISOString().slice(0, 10), visits: Number(r.visits) || 0, tries: Number(r.tries) || 0, keeps: Number(r.keeps) || 0 });
        }
        return out;
      })(),
      top,
      missed,
      occasions,
      hours,
      spend: { byKind: spend, usd, pkr: Math.round(usd * USD_TO_PKR), perVisitPkr: triedHere ? Math.round((usd * USD_TO_PKR) / triedHere) : 0 },
      // What the plan is and how the month stands against it: `live` and `portraits` are as standingOf gives them.
      plan: standing
        ? {
            id: plan.id, name: plan.name, stores: retailer.stores, status: retailer.status, monthly: monthlyFee(plan.id, retailer.stores), mirrors: plan.mirrors * retailer.stores, minutePkr: EXTRAS.liveMinutePkr, ...standing,
            // a plan that takes a share of counted sales: what was counted this calendar month, and the fee that makes, never past the cap
            share: plan.share ? { rate: plan.share, cap: plan.cap, counted: monthSales, fee: Math.min(plan.cap, monthlyFee(plan.id, retailer.stores) + Math.round(plan.share * monthSales)) } : null,
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
    // A studio backdrop or a retake (the second engine for the same look) is part of making a portrait, so its cost belongs to Model.
    const cents = (usd) => Math.round(usd * 1e4) / 1e4;
    const modelUsd = cents(sum("portrait", "usd") + sum("backdrop", "usd") + sum("retake", "usd"));
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
      // lookbook: set in a store's brand.json once its lookbook (public/showcase/lookbook/<id>.json) is made, so the page
      // asks for one only where there is one (every store's page used to ask, and log a 404).
      brand: { id: entry.brand.id, name: entry.brand.name, wordmark: entry.brand.wordmark, accent: entry.brand.accent, mood: entry.brand.mood, source: entry.brand.source || entry.catalogue.source || "", lookbook: Boolean(entry.brand.lookbook) },
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
  // --- telling people ---------------------------------------------------------
  // A line on their account, and a nudge to every phone that asked for one. Nudges about one question come at most
  // once a minute; every line is kept, so the phone shows them together.
  async function tell(userId, kind, title, body = "", url = "/account", group = "") {
    await db.run("INSERT INTO notes (user, at, kind, title, body, url) VALUES (?,?,?,?,?,?)", userId, Date.now(), kind, text(title, 140), text(body, 240), text(url, 200));
    if (!push.publicKey) return;
    if (group && !(await limiter.limit("nudge:" + group, 1, 60e3))) return;
    for (const { endpoint } of await db.all("SELECT endpoint FROM push_subs WHERE user = ?", userId)) {
      const status = await push.send(endpoint);
      if (status === 404 || status === 410) await db.run("DELETE FROM push_subs WHERE endpoint = ?", endpoint);
    }
  }

  async function tellFounder(kind, title, body, url) {
    for (const { id } of await db.all("SELECT id FROM users WHERE role = 'founder'")) await tell(id, kind, title, body, url, kind);
  }
  // Once a Pakistan day, from the scheduled sweep: what needs the founder (try-on credit out, a store past its minutes, a
  // mirror at its day's budget, a day that spent far more than usual), in one note.
  async function dailyWatch(now = Date.now()) {
    const day = new Date(pktDayStart(now)).toISOString().slice(0, 10);
    const told = await db.get("SELECT value FROM meta WHERE key = 'watched'");
    if (told?.value === day) return;
    await db.run("INSERT INTO meta (key, value) VALUES ('watched', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", day);
    const rows = await db.all("SELECT * FROM retailers ORDER BY started");
    const needs = await founderNeeds(rows, await usedByBrand(now), now).catch(() => []);
    if (needs.length) await tellFounder("watch", needs.length === 1 ? "One thing needs you today" : `${needs.length} things need you today`, needs.map((n) => n.text || n.kind).join(" "), "/hq#today");
  }

  // --- questions ---------------------------------------------------------------
  const whatsappOf = async (brandId) => {
    return waNumber(parse((await db.get("SELECT settings FROM retailers WHERE brand = ?", brandId))?.settings).whatsapp) || null;
  };

  // A question as its asker or a guest sees it. Guests see her portraits only if she chose to send them, and only
  // while voting is open; once she has decided, everyone with the link sees which one she chose.
  async function boardOut(b, { owner = false, guest = false } = {}) {
    const closed = !!b.closed || b.closes < Date.now();
    const ids = parse(b.looks, []);
    const rows = await Promise.all(ids.map((id) => db.get("SELECT * FROM looks WHERE id = ? AND user = ?", id, b.user)));
    const votes = await db.all("SELECT look, name, note, created FROM votes WHERE board = ? ORDER BY created", b.code);
    const tally = Object.fromEntries(ids.map((id) => [id, { votes: 0, names: [] }]));
    for (const v of votes) if (tally[v.look]) (tally[v.look].votes++, v.name && tally[v.look].names.push(v.name));
    const show = owner || !closed || !!b.decided;
    const looks = !show
      ? []
      : rows.map((r, i) => {
          if (!r) return { id: ids[i], name: owner ? "A look you let go" : "A look she let go", gone: true };
          const out = lookOut(r, guest ? b.code : null);
          if (guest && (b.pictures === "store" || closed)) out.portrait = null;
          return out;
        });
    // The way to the store from her choice: the number a store gave in its console, if it gave one.
    if (owner) for (const l of looks) if (!l.gone) l.whatsapp = await whatsappOf(l.brand);
    return {
      code: b.code,
      title: b.title,
      occasion: b.occasion || null,
      url: `${origin}/b/${b.code}`,
      created: b.created,
      closes: b.closes,
      closed,
      decided: b.decided || null,
      pictures: b.pictures || "mine",
      cover: !!b.cover,
      looks,
      tally,
      total: votes.length,
      ...(owner ? { votes: votes.map((v) => ({ look: v.look, name: v.name || "", note: v.note || "", at: v.created })) } : {}),
    };
  }

  // The lines a link preview reads (WhatsApp, Facebook, iMessage): the question, who asks, and the looks' picture.
  async function boardPreview(code) {
    const b = await db.get("SELECT b.*, u.name AS owner FROM boards b JOIN users u ON u.id = b.user WHERE b.code = ?", code);
    if (!b) return null;
    const by = String(b.owner).split(" ")[0];
    const closed = !!b.closed || b.closes < Date.now();
    const n = parse(b.looks, []).length;
    const description = b.decided ? `${by} has decided. See which one.` : closed ? "Voting has closed." : `${n} looks. Tap the one you would choose. No app, no sign-in.`;
    const image = b.cover && b.closes > Date.now() - 7 * DAY ? `${origin}/api/board/${b.code}/cover` : `${origin}/share/mirva.jpg`;
    return [
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="MIRVA">`,
      `<meta property="og:title" content="${esc(`${by} asks: ${b.title}`)}">`,
      `<meta property="og:description" content="${esc(description)}">`,
      `<meta property="og:url" content="${esc(`${origin}/b/${b.code}`)}">`,
      `<meta property="og:image" content="${esc(image)}">`,
      `<meta property="og:image:width" content="1200">`,
      `<meta property="og:image:height" content="630">`,
      `<meta name="twitter:card" content="summary_large_image">`,
    ].join("\n");
  }

  // --- a first portrait before joining ----------------------------------------------
  // Someone who has never joined may make one portrait a day, on this browser, so she sees what MIRVA does before she is
  // asked for anything. It is held for her (its id is her browser's, in a cookie) and moves into her wardrobe if she
  // joins within the day; otherwise it is deleted. The day's ceilings still apply, and the free ones have their own cap.
  const guestOf = (request) => {
    const v = cookies(request).mirva_g || "";
    return /^[A-Za-z0-9_-]{12,40}$/.test(v) ? v : "";
  };
  async function guestGrant(request, ip, cap) {
    if (!(cap > 0)) return { ok: false, status: 401, error: "Join free to see this on you. It takes a minute.", limit: "join" };
    let guest = guestOf(request);
    const fresh = !guest;
    if (fresh) guest = newId(16);
    if (!fresh && (await db.get("SELECT 1 AS x FROM guest_shots WHERE guest = ? AND at > ?", guest, Date.now() - DAY)))
      return { ok: false, status: 403, error: "Join free to make more. The portrait you made is kept for you.", limit: "guest-used" };
    if (!(await limiter.limit("guest-ip:" + ip, 6, DAY))) return { ok: false, status: 403, error: "Join free to make more portraits.", limit: "guest-used" };
    const open = await grant({ kind: "open" }, "portrait"); // the day's ceiling, as for anyone
    if (!open.ok) return open;
    if (!(await limiter.limit("guest-day", cap, DAY))) return { ok: false, status: 403, error: "Today's free portraits have all been made. Join free and make yours.", limit: "guest-used" };
    return { ok: true, guest, cookie: fresh ? `mirva_g=${guest}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? "; Secure" : ""}` : null };
  }
  // The second, quiet pass on a busy wall belongs to the portrait it was made from: one, for her own fresh portrait.
  async function guestBackdrop(request, replaces, kind = "backdrop") {
    const guest = guestOf(request);
    const row = guest && replaces ? await db.get("SELECT * FROM guest_shots WHERE id = ? AND guest = ? AND at > ? AND claimed IS NULL", String(replaces).slice(0, 40), guest, Date.now() - FINISH_WINDOW) : null;
    if (!row || !(await limiter.limit(`guest-${kind}:` + row.id, 1, DAY))) return { ok: false, status: 401, error: "Join free to see this on you. It takes a minute.", limit: "join" };
    const open = await grant({ kind: "open" }, kind);
    return open.ok ? { ok: true, guest, row } : open;
  }
  async function saveGuestShot(guest, ip, brandId, productId, bytes, type, row = null) {
    const id = row?.id || newId(16);
    if (bytes) await files.put(id, bytes, type); // null: the phone sends the finished picture (see savePortrait)
    if (row) await db.run("UPDATE guest_shots SET type = ? WHERE id = ?", type, id);
    else await db.run("INSERT INTO guest_shots (id, guest, ip, brand, product, type, at) VALUES (?,?,?,?,?,?,?)", id, guest, String(ip || "").slice(0, 60), brandId, productId, type, Date.now());
    return id;
  }
  // Joining (or signing in) on the browser that made it brings the day's portrait into the new wardrobe.
  async function claimGuest(request, user) {
    const guest = guestOf(request);
    if (!guest || user.role !== "member") return 0;
    let n = 0;
    for (const row of await db.all("SELECT * FROM guest_shots WHERE guest = ? AND claimed IS NULL AND at > ?", guest, Date.now() - DAY)) {
      await db.run("INSERT OR IGNORE INTO portraits (id, user, brand, product, type, created) VALUES (?,?,?,?,?,?)", row.id, user.id, row.brand, row.product, row.type, row.at);
      await db.run("UPDATE guest_shots SET claimed = ? WHERE id = ?", user.id, row.id);
      if (await addLook(user, row.brand, row.product, { portrait: row.id, source: "home" })) n++;
    }
    return n;
  }

  async function handle(request, url, ctx = {}) {
    const path = url.pathname;
    const method = request.method;
    const key = `${method} ${path}`;
    const ip = ctx.ip || "";
    // Work that may finish after the answer has gone (a nudge to a phone). The edge keeps it alive with waitUntil.
    const later = ctx.later || ((p) => void p.catch(() => {}));
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

    // The founder's WhatsApp on the store site: nothing until the founder switches it on at /hq.
    if (key === "GET /api/contact") {
      const c = parse((await db.get("SELECT value FROM meta WHERE key = 'contact'"))?.value);
      return ok({ whatsapp: c.show && waNumber(c.whatsapp) ? waNumber(c.whatsapp) : null });
    }
    if (key === "GET /api/plans") return ok({ tiers: MEMBER_TIERS, retail: RETAIL_PLANS, extras: EXTRAS, pilot: PILOT, cost: COST, usdToPkr: USD_TO_PKR, payments });

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
      if (b.agree !== true) return fail(400, "Please confirm you are 18 or over and agree to the terms and the privacy notice first.");
      if (await db.get("SELECT 1 FROM users WHERE email = ?", mail)) return fail(409, "There's already an account with that email. Sign in instead.");
      const user = { id: newId(), role: "member", email: mail, name };
      const consent = { terms: Date.now(), updates: b.updates === true };
      await db.run("INSERT INTO users (id, role, email, name, pass, consent, created) VALUES (?,?,?,?,?,?,?)", user.id, "member", mail, name, await hashPassword(b.password, kdf), JSON.stringify(consent), Date.now());
      const cookie = await startSession(db, user, request, secure);
      await audit(ip, user.id, "join");
      await notify("email", mail, "Welcome to MIRVA", `Hello ${name},\n\nYour wardrobe is open: ${origin}/account\nEverything you keep in a MIRVA mirror lands there. You can delete all of it, at any time, from the same page.\n\nMIRVA`);
      const claimed = b.claim ? await claim(user, b.claim) : null;
      const kept = await claimGuest(request, { ...user, role: "member" });
      return ok({ user: publicUser(await db.get("SELECT * FROM users WHERE id = ?", user.id)), claimed, kept }, { "set-cookie": cookie });
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
      const kept = await claimGuest(request, user);
      return ok({ user: publicUser(user), claimed, kept }, { "set-cookie": cookie });
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
          trials: trialsOf(u),
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
        boards: await db.all("SELECT code, title, occasion, pictures, decided, created, closes, closed FROM boards WHERE user = ?", u.id),
        answers: await db.all("SELECT v.board, v.look, v.name, v.note, v.created FROM votes v JOIN boards b ON b.code = v.board WHERE b.user = ?", u.id),
        notes: await db.all("SELECT at, kind, title, body FROM notes WHERE user = ? ORDER BY at", u.id),
        portraits: await db.all("SELECT id, brand, product, created FROM portraits WHERE user = ?", u.id),
        usageThisMonth: await usageOf(u.id),
        payments: await db.all("SELECT at, amount, currency, provider, status, what FROM payments WHERE user = ?", u.id),
      });
    }

    if (key === "GET /api/me/deleted") {
      const u = await member();
      if (!u) return denied;
      const rows = await db.all("SELECT at, action, target FROM audit WHERE actor = ? AND action IN ('portrait-deleted','look-removed') ORDER BY at DESC LIMIT 40", u.id);
      return ok({ deleted: rows.map((r) => ({ at: Number(r.at), portrait: r.action === "portrait-deleted", name: r.target })) });
    }

    if (key === "POST /api/me/delete") {
      const u = await member();
      if (!u) return denied;
      const b = await readBody(request);
      if (!(await limiter.limit("delete:" + u.id, 5, 3600e3))) return fail(429, "Too many tries. Try again in an hour.");
      if (!(await verifyPassword(String(b.password || ""), u.pass))) return fail(401, "That password isn't right.");
      const kept = await db.all("SELECT id FROM portraits WHERE user = ?", u.id);
      const covers = await db.all("SELECT code FROM boards WHERE user = ? AND cover = 1", u.id);
      await db.batch([
        ["DELETE FROM notes WHERE user = ?", u.id],
        ["DELETE FROM push_subs WHERE user = ?", u.id],
        ["UPDATE waitlist SET user = NULL WHERE user = ?", u.id],
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
      for (const c of covers) await Promise.resolve(files.del(coverId(c.code))).catch(() => {});
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
      // What she removed, and when, stays on her own record until she deletes her account.
      await audit(ip, u.id, row.portrait ? "portrait-deleted" : "look-removed", row.name);
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
      const u = await me();
      const guest = !u ? guestOf(request) : "";
      const held = guest ? await db.get("SELECT * FROM guest_shots WHERE id = ? AND guest = ? AND claimed IS NULL", m[1], guest) : null;
      if (!held) {
        if (!u) return fail(401, "Sign in first.");
        if (u.role !== "member") return fail(403, "That is for a shopper's account.");
      }
      if (!(await limiter.limit("finish:" + (u?.id || guest), 60, 3600e3))) return fail(429, "That is a lot of portraits for one hour.");
      const row = held ? { ...held, created: held.at } : await db.get("SELECT * FROM portraits WHERE id = ? AND user = ?", m[1], u.id);
      if (!row || Date.now() - row.created > FINISH_WINDOW) return fail(404, "That portrait isn't here to finish.");
      const type = String(request.headers.get("content-type") || "").split(";")[0].trim();
      if (type !== "image/jpeg" && type !== "image/png") return fail(415, "That isn't a picture.");
      if (Number(request.headers.get("content-length") || 0) > FINISH_MAX) return fail(413, "That picture is too large.");
      const bytes = new Uint8Array(await request.arrayBuffer());
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      if (bytes.byteLength < 2000 || bytes.byteLength > FINISH_MAX || (type === "image/jpeg" ? !jpeg : !png)) return fail(400, "That isn't a picture.");
      await files.put(row.id, bytes, type);
      await db.run(held ? "UPDATE guest_shots SET type = ? WHERE id = ?" : "UPDATE portraits SET type = ? WHERE id = ?", type, row.id);
      return ok();
    }

    // ----- second opinions: a question a member asks, and the people she trusts answer with one tap
    if (key === "GET /api/boards") {
      const u = await member();
      if (!u) return denied;
      const rows = await db.all("SELECT * FROM boards WHERE user = ? ORDER BY created DESC LIMIT 30", u.id);
      return ok({ boards: await Promise.all(rows.map((b) => boardOut(b, { owner: true }))) });
    }

    if (key === "POST /api/boards") {
      const u = await member();
      if (!u) return denied;
      const b = await readBody(request);
      const ids = [...new Set((Array.isArray(b.looks) ? b.looks : []).map((x) => text(x, 40)))].slice(0, 6);
      const found = await Promise.all(ids.map((id) => db.get("SELECT 1 AS x FROM looks WHERE id = ? AND user = ?", id, u.id)));
      const mine = ids.filter((_, i) => found[i]);
      if (mine.length < 2) return fail(400, "Choose at least two looks to ask about.");
      const open = Number((await db.get("SELECT COUNT(*) n FROM boards WHERE user = ? AND closed = 0 AND closes > ?", u.id, Date.now())).n);
      if (open >= tierOf(u).boards) return fail(409, "You have as many open questions as your membership allows. Close one first.");
      const days = [1, 3, 7].includes(Number(b.days)) ? Number(b.days) : 3;
      const pictures = b.pictures === "store" ? "store" : "mine";
      const code = newCode(10);
      await db.run(
        "INSERT INTO boards (code, user, title, looks, created, closes, occasion, pictures) VALUES (?,?,?,?,?,?,?,?)",
        code, u.id, text(b.title, 80) || "Which one?", JSON.stringify(mine), Date.now(), Date.now() + days * DAY, text(b.occasion, 24) || null, pictures,
      );
      return ok({ code, url: `${origin}/b/${code}` });
    }

    if (key === "POST /api/boards/close" || key === "POST /api/boards/extend" || key === "POST /api/boards/decide") {
      const u = await member();
      if (!u) return denied;
      const b = await readBody(request);
      const board = await db.get("SELECT * FROM boards WHERE code = ? AND user = ?", text(b.code, 16), u.id);
      if (!board) return fail(404, "I can't find that question.");
      if (key.endsWith("/close")) await db.run("UPDATE boards SET closed = 1 WHERE code = ?", board.code);
      if (key.endsWith("/extend")) {
        // More time, up to two weeks from when she asked.
        const days = [1, 3, 7].includes(Number(b.days)) ? Number(b.days) : 1;
        const closes = Math.min(board.created + 14 * DAY, Math.max(board.closes, Date.now()) + days * DAY);
        if (closes <= Date.now()) return fail(409, "That question has been open for two weeks, the most there is. Ask it again.");
        await db.run("UPDATE boards SET closes = ?, closed = 0, reminded = NULL, decided = NULL WHERE code = ?", closes, board.code);
      }
      if (key.endsWith("/decide")) {
        // She has chosen. Voting stops, and everyone who opens the link sees what she chose.
        const look = text(b.look, 40);
        if (!parse(board.looks, []).includes(look)) return fail(400, "Choose one of the looks you asked about.");
        await db.run("UPDATE boards SET decided = ?, closed = 1 WHERE code = ?", look, board.code);
      }
      return ok({ board: await boardOut(await db.get("SELECT * FROM boards WHERE code = ?", board.code), { owner: true }) });
    }

    m = path.match(/^\/api\/board\/([A-Z0-9]{10})\/cover$/);
    if (m) {
      const board = await db.get("SELECT * FROM boards WHERE code = ?", m[1]);
      if (method === "POST") {
        // The picture a link shows in WhatsApp, composed on her own phone from the looks she is asking about.
        const u = await member();
        if (!u) return denied;
        if (!board || board.user !== u.id) return fail(404, "I can't find that question.");
        const type = String(request.headers.get("content-type") || "").split(";")[0].trim();
        if (type !== "image/jpeg") return fail(415, "That isn't a picture.");
        if (Number(request.headers.get("content-length") || 0) > COVER_MAX) return fail(413, "That picture is too large.");
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.byteLength < 2000 || bytes.byteLength > COVER_MAX || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return fail(400, "That isn't a picture.");
        await files.put(coverId(board.code), bytes, "image/jpeg");
        await db.run("UPDATE boards SET cover = 1 WHERE code = ?", board.code);
        return ok();
      }
      // Shown to link previews while the question is open and for a week after; then it is deleted.
      if (!board?.cover || board.closes < Date.now() - 7 * DAY) return fail(404, "not found");
      const stored = await files.get(coverId(board.code));
      if (!stored) return fail(404, "not found");
      return new Response(stored.bytes, { status: 200, headers: { ...SECURITY, "cross-origin-resource-policy": "cross-origin", "content-type": "image/jpeg", "cache-control": "public, max-age=600" } });
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
      if (!m[2] && method === "GET") {
        const mine = voter ? await db.get("SELECT look, name, note FROM votes WHERE board = ? AND voter = ?", board.code, voter) : null;
        const out = await boardOut(board, { owner, guest: !owner });
        // A guest sees how it is going only after answering, so the first answers do not steer the rest.
        if (!owner && !mine && !out.closed) out.tally = null;
        return ok({ ...out, by: board.owner.split(" ")[0], owner, voted: mine?.look || null, myName: mine?.name || "", myNote: mine?.note || "" });
      }
      if (m[2] && method === "POST") {
        if (closed) return fail(410, board.decided ? "She has decided. Voting has closed." : "Voting has closed.");
        if (!(await limiter.limit("vote:" + ip, 40, 3600e3))) return fail(429, "Too many votes from here. Try again later.");
        const b = await readBody(request);
        const look = text(b.look, 40);
        if (!ids.includes(look)) return fail(400, "Choose one of the looks.");
        let voterCookie = null;
        if (!voter) {
          voter = newId(14);
          voterCookie = `mirva_v=${voter}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? "; Secure" : ""}`;
        }
        const before = await db.get("SELECT look, name, note FROM votes WHERE board = ? AND voter = ?", board.code, voter);
        const name = text(b.name, 30);
        const note = b.note === undefined ? before?.note || null : text(b.note, 140) || null;
        await db.run(
          "INSERT INTO votes (board, voter, look, name, note, created) VALUES (?,?,?,?,?,?) ON CONFLICT(board, voter) DO UPDATE SET look = excluded.look, name = excluded.name, note = excluded.note",
          board.code, voter, look, name, note, Date.now(),
        );
        // She hears about a new answer, a changed mind or a word left for her; not about a name being corrected.
        if (!owner && (!before || before.look !== look || (note && note !== before.note))) {
          const row = await db.get("SELECT name FROM looks WHERE id = ?", look);
          const count = Number((await db.get("SELECT COUNT(*) n FROM votes WHERE board = ?", board.code)).n);
          const who = name || "Someone";
          const title = note && note !== before?.note ? `${who}: “${note}”` : `${who} chose ${row?.name || "a look"}`;
          later(tell(board.user, "vote", title, `${board.title} · ${count === 1 ? "1 answer" : count + " answers"} so far`, "/account?tab=opinions", "board:" + board.code));
        }
        const out = await boardOut(board, { owner, guest: !owner });
        return ok({ voted: look, tally: out.tally, myName: name, myNote: note || "" }, voterCookie ? { "set-cookie": voterCookie } : undefined);
      }
    }

    // ----- shoppers who would use a MIRVA mirror near them: the demand a store is shown before it buys one
    if (key === "POST /api/waitlist") {
      if (!(await limiter.limit("wait:" + ip, 6, 3600e3))) return fail(429, "That's a lot from one place. Try again later.");
      const b = await readBody(request);
      const city = text(b.city, 40);
      if (city.length < 2) return fail(400, "Which city?");
      const u = await me();
      await db.run(
        "INSERT INTO waitlist (id, at, city, area, store, contact, user) VALUES (?,?,?,?,?,?,?)",
        newId(12), Date.now(), city, text(b.area, 60) || null, text(b.store, 60) || null, text(b.contact, 80) || null, u?.role === "member" ? u.id : null,
      );
      const count = Number((await db.get("SELECT COUNT(*) n FROM waitlist WHERE lower(city) = lower(?)", city)).n);
      return ok({ city, count });
    }

    // ----- what a member or the founder is told, and the phones that asked to be told
    if (key === "GET /api/push/key") return ok({ key: push.publicKey || null });

    if (key === "POST /api/push/subscribe" || key === "POST /api/push/unsubscribe") {
      const u = await me();
      if (!u) return fail(401, "Sign in first.");
      const b = await readBody(request);
      const endpoint = pushEndpoint(b.endpoint);
      if (!endpoint) return fail(400, "That isn't a notification address MIRVA can use.");
      if (key.endsWith("/unsubscribe")) {
        await db.run("DELETE FROM push_subs WHERE endpoint = ? AND user = ?", endpoint, u.id);
        return ok();
      }
      if (!(await limiter.limit("push:" + u.id, 20, 3600e3))) return fail(429, "Too many tries. Try again later.");
      await db.run(
        "INSERT INTO push_subs (endpoint, user, created, agent) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user = excluded.user, created = excluded.created",
        endpoint, u.id, Date.now(), text(request.headers.get("user-agent"), 160),
      );
      return ok({ on: true });
    }

    if (key === "GET /api/notes") {
      // The service worker asks for what is new when a push wakes it; the account page asks for the recent list.
      const u = await me();
      if (!u) return fail(401, "Sign in first.");
      const fresh = url.searchParams.get("fresh") === "1";
      const rows = await db.all(
        fresh ? "SELECT * FROM notes WHERE user = ? AND seen = 0 ORDER BY at DESC LIMIT 5" : "SELECT * FROM notes WHERE user = ? ORDER BY at DESC LIMIT 30",
        u.id,
      );
      if (fresh && rows.length) await db.run(`UPDATE notes SET seen = 1 WHERE user = ? AND id IN (${rows.map(() => "?").join(",")})`, u.id, ...rows.map((r) => r.id));
      const unseen = fresh ? 0 : Number((await db.get("SELECT COUNT(*) n FROM notes WHERE user = ? AND seen = 0", u.id)).n);
      return ok({ notes: rows.map((r) => ({ id: r.id, at: r.at, kind: r.kind, title: r.title, body: r.body || "", url: r.url || "/account" })), unseen, push: !!push.publicKey });
    }

    if (key === "POST /api/notes/seen") {
      const u = await me();
      if (!u) return fail(401, "Sign in first.");
      await db.run("UPDATE notes SET seen = 1 WHERE user = ? AND seen = 0", u.id);
      return ok();
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
      // A mirror whose pairing is no longer good is told so, so it can be paired again (it never counts as a visitor).
      if (who.kind === "none" && request.headers.get("x-mirva-device")) return fail(401, "not paired");
      // Someone on MIRVA's own site who has not signed in is counted too (it is the store's piece she looked at), with a
      // tighter limit, since nothing vouches for her.
      if (!(await limiter.limit("events:" + ip, who.kind === "none" ? 300 : 1500, 3600e3))) return fail(429, "slow down");
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
          // sample (where it happened): 0 the store's own mirror or staff, 1 seeded sample, 2 a member on MIRVA's site or app,
          // 3 a visitor on MIRVA's site who has not signed in, 4 the store's own website (embed.js)
          "INSERT INTO events (at, brand, device, visit, user, kind, product, value, meta, sample) VALUES (?,?,?,?,?,?,?,?,?,?)",
          Date.now(), brandId, who.device?.id || null, visit, who.user?.id || null, kind, e.product ? text(e.product, 80) : null, value, e.meta ? text(e.meta, 60) : null, whereOf(who),
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
        city: text(b.city, 40), stores: int(b.stores, 0, 5000, 0), segment: text(b.segment, 20), plan: planOf(b.plan)?.id || "", message: text(b.message, 1200), source: text(b.source, 60),
      };
      if (lead.name.length < 2) return fail(400, "Tell us your name.");
      if (lead.company.length < 2) return fail(400, "Tell us the name of your store.");
      if (!lead.email) return fail(400, "That email doesn't look right.");
      const id = newId();
      await db.run(
        "INSERT INTO leads (id, at, name, company, role, email, phone, city, stores, segment, plan, message, source, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        id, Date.now(), lead.name, lead.company, lead.role, lead.email, lead.phone, lead.city, lead.stores, lead.segment, lead.plan, lead.message, lead.source, Date.now(),
      );
      later(tellFounder("lead", `New enquiry: ${lead.company}`, `${lead.name}${lead.stores ? `, ${lead.stores} stores` : ""}${lead.city ? `, ${lead.city}` : ""}. Reply within two working days.`, "/hq#enquiries"));
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
        return id ? ok(await overview(id, int(url.searchParams.get("days"), 1, 90, 30), String(url.searchParams.get("place") || "all"))) : denied;
      }
      if (key === "GET /api/console/catalogue") {
        const id = brandOf(u, url.searchParams.get("brand"));
        if (!id) return denied;
        const retailer = await db.get("SELECT settings FROM retailers WHERE brand = ?", id);
        const hidden = new Set(parse(retailer?.settings).hidden || []);
        const photoOnly = new Set(parse(retailer?.settings).photoOnly || []);
        const stats = new Map((await db.all("SELECT product, SUM(kind IN ('portrait','live_start')) AS tries, SUM(kind = 'keep') AS keeps FROM events WHERE sample <> 1 AND brand = ? AND product IS NOT NULL GROUP BY product", id)).map((r) => [r.product, r]));
        const entry = brands.get(id);
        return ok({
          brand: { id, name: entry.brand.name, mood: entry.brand.mood, accent: entry.brand.accent, byline: entry.brand.byline, takenAt: entry.catalogue.takenAt, sizeChart: entry.brand.sizeChart || [] },
          products: entry.catalogue.products.map((p) => ({
            id: p.id, name: p.name, price: p.price, image: thumb(p.image, 160), lane: p.lane, unstitched: !!p.unstitched,
            sizesOut: (p.sizes || []).filter((s) => !s.inStock).map((s) => s.label), hidden: hidden.has(p.id), photoOnly: photoOnly.has(p.id),
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
      // Some pieces should not be drawn by a machine: heavy hand embroidery, a designer who has not agreed. The store
      // marks them, and the mirror then shows its own photographs of them and makes no look.
      if (key === "POST /api/console/catalogue/try-on") {
        const b = await readBody(request);
        const id = brandOf(u, b.brand);
        if (!id) return denied;
        if (!product(id, text(b.product, 80))) return fail(404, "I can't find that piece.");
        const row = await db.get("SELECT * FROM retailers WHERE brand = ?", id);
        const settings = parse(row?.settings);
        const list = new Set(settings.photoOnly || []);
        b.photoOnly === true ? list.add(text(b.product, 80)) : list.delete(text(b.product, 80));
        settings.photoOnly = [...list];
        if (row) await db.run("UPDATE retailers SET settings = ? WHERE brand = ?", JSON.stringify(settings), id);
        else await db.run("INSERT INTO retailers (brand, plan, stores, status, started, settings) VALUES (?,?,?,?,?,?)", id, "studio", 1, "demo", Date.now(), JSON.stringify(settings));
        await audit(ip, u.id, b.photoOnly === true ? "piece-photo-only" : "piece-try-on", `${id}/${text(b.product, 80)}`);
        return ok({ photoOnly: settings.photoOnly });
      }
      if (key === "POST /api/console/brand") {
        const b = await readBody(request);
        const id = brandOf(u, b.brand);
        if (!id) return denied;
        const patch = {};
        if (["porcelain", "noir"].includes(b.mood)) patch.mood = b.mood;
        if (/^#[0-9a-f]{6}$/i.test(String(b.accent || ""))) patch.accent = b.accent.toUpperCase();
        if (b.byline !== undefined) patch.byline = text(b.byline, 40) || "styled by MIRVA";
        // One size to a line, "M, 38-40, 32-34": label, chest, waist, in inches. An empty box takes the chart away.
        if (b.sizeChart !== undefined) {
          const rows = parseSizeChart(String(b.sizeChart).slice(0, 2000));
          if (String(b.sizeChart).trim() && !rows.length) return fail(400, "I couldn't read that chart. One size to a line, like: M, 38-40, 32-34");
          patch.sizeChart = rows;
        }
        if (!Object.keys(patch).length) return fail(400, "Nothing to change.");
        await saveBrand(id, patch);
        await audit(ip, u.id, "brand-changed", id);
        return ok({ brand: brands.get(id).brand });
      }
      if (key === "GET /api/console/devices") {
        const id = brandOf(u, url.searchParams.get("brand"));
        if (!id) return denied;
        const shapes = parse((await db.get("SELECT settings FROM retailers WHERE brand = ?", id))?.settings);
        return ok({
          devices: (await db.all("SELECT id, name, store, paired, seen, created, pair_code, pair_expires FROM devices WHERE brand = ? ORDER BY created", id)).map((d) => ({
            ...d, glass: glassOf(shapes, d.id), pair_code: d.pair_expires > Date.now() ? d.pair_code : null, pairUrl: d.pair_expires > Date.now() ? `${origin}/mirror?brand=${id}&pair=${d.pair_code}` : null,
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
      if (key === "POST /api/console/devices/code" || key === "POST /api/console/devices/remove" || key === "POST /api/console/devices/glass") {
        const b = await readBody(request);
        const device = await db.get("SELECT * FROM devices WHERE id = ?", text(b.id, 40));
        if (!device || (u.role === "retailer" && device.brand !== u.brand)) return fail(404, "I can't find that mirror.");
        // The outline of the glass is kept with the store's other settings, under the mirror's id.
        const shapeIt = async (glass) => {
          const row = await db.get("SELECT * FROM retailers WHERE brand = ?", device.brand);
          const settings = parse(row?.settings);
          const all = settings.glass && typeof settings.glass === "object" && !Array.isArray(settings.glass) ? settings.glass : {};
          glass === "oval" ? (all[device.id] = "oval") : delete all[device.id];
          settings.glass = all;
          if (row) await db.run("UPDATE retailers SET settings = ? WHERE brand = ?", JSON.stringify(settings), device.brand);
          else if (glass === "oval") await db.run("INSERT INTO retailers (brand, plan, stores, status, started, settings) VALUES (?,?,?,?,?,?)", device.brand, "studio", 1, "demo", Date.now(), JSON.stringify(settings));
        };
        if (key.endsWith("/glass")) {
          if (!GLASSES.includes(b.glass)) return fail(400, "A mirror's glass is plain or oval.");
          await shapeIt(b.glass);
          await audit(ip, u.id, "mirror-glass", `${device.brand}/${device.id}/${b.glass}`);
          return ok({ glass: b.glass });
        }
        if (key.endsWith("/remove")) {
          await db.run("DELETE FROM devices WHERE id = ?", device.id);
          await shapeIt("plain");
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
      if (key === "GET /api/console/website") {
        const id = brandOf(u, url.searchParams.get("brand"));
        if (!id) return denied;
        const row = await db.get("SELECT * FROM retailers WHERE brand = ?", id);
        const s = settingsOf(row);
        const used = await db.get("SELECT COUNT(*) AS n FROM usage WHERE device = ? AND kind = 'portrait' AND sample = 0 AND at >= ?", "web-" + id, monthStart());
        const wanted = await db.all("SELECT area, city, at FROM waitlist WHERE LOWER(TRIM(store)) = LOWER(TRIM(?)) ORDER BY at DESC LIMIT 50", brands.get(id)?.brand.name || id);
        return ok({
          sites: sitesOf(row),
          whatsapp: waNumber(s.whatsapp) || "",
          signed: ["pilot", "live"].includes(row?.status),
          portraitsThisMonth: Number(used?.n) || 0,
          snippet: `<script src="${origin}/embed.js" data-store="${id}" async></script>`,
          waitlist: { count: wanted.length, areas: Object.entries(wanted.reduce((m, w) => ((m[w.area || w.city] = (m[w.area || w.city] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 8) },
        });
      }
      if (key === "POST /api/console/website") {
        const b = await readBody(request);
        const id = brandOf(u, b.brand);
        if (!id) return denied;
        const patch = {};
        if (b.sites !== undefined) {
          const asked = String(b.sites || "").split(/[\s,]+/).map((v) => v.trim().replace(/\/+$/, "").toLowerCase()).filter(Boolean);
          const sites = [...new Set(asked.map((v) => (/^https?:\/\//.test(v) ? v : "https://" + v)).map((v) => { try { return new URL(v).origin; } catch { return ""; } }))].filter((v) => ORIGIN_RE.test(v));
          if (asked.length && sites.length !== asked.length) return fail(400, "Each website is an address like https://yourstore.com.");
          if (sites.length > 5) return fail(400, "Up to five websites.");
          patch.embed = { sites };
        }
        if (b.whatsapp !== undefined) {
          const n = waNumber(b.whatsapp);
          if (b.whatsapp && !n) return fail(400, "That number doesn't look right. Write it with the country code, like +92 3xx xxxxxxx.");
          patch.whatsapp = n;
        }
        if (!Object.keys(patch).length) return fail(400, "Nothing to change.");
        const row = await db.get("SELECT * FROM retailers WHERE brand = ?", id);
        const settings = { ...settingsOf(row), ...patch };
        if (row) await db.run("UPDATE retailers SET settings = ? WHERE brand = ?", JSON.stringify(settings), id);
        else await db.run("INSERT INTO retailers (brand, plan, stores, status, started, settings) VALUES (?,?,?,?,?,?)", id, "assist", 1, "demo", Date.now(), JSON.stringify(settings));
        await audit(ip, u.id, "website-changed", `${id} sites=${(patch.embed?.sites || []).length} whatsapp=${patch.whatsapp ? "set" : "-"}`);
        return ok({ sites: settings.embed?.sites || [], whatsapp: settings.whatsapp || "" });
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
        if (b.extraLiveMinutes !== undefined) {
          const n = typeof b.extraLiveMinutes === "number" || (typeof b.extraLiveMinutes === "string" && b.extraLiveMinutes.trim() !== "") ? Number(b.extraLiveMinutes) : NaN;
          if (!Number.isInteger(n) || n < 0 || n > MIRROR.extraLiveMax || n % EXTRAS.liveBlockMinutes) return fail(400, `Extra live minutes come in blocks of ${EXTRAS.liveBlockMinutes}, from 0 to ${MIRROR.extraLiveMax}. Zero stops live Studio at the plan's own minutes.`);
          patch.extraLiveMinutes = n;
        }
        if (!Object.keys(patch).length) return fail(400, "Nothing to change.");
        // A store with no plan on record gets the same placeholder row hiding a piece makes, so its settings have somewhere to live.
        const row = await db.get("SELECT * FROM retailers WHERE brand = ?", id);
        const settings = { ...settingsOf(row), ...patch };
        if (row) await db.run("UPDATE retailers SET settings = ? WHERE brand = ?", JSON.stringify(settings), id);
        else await db.run("INSERT INTO retailers (brand, plan, stores, status, started, settings) VALUES (?,?,?,?,?,?)", id, "studio", 1, "demo", Date.now(), JSON.stringify(settings));
        await audit(ip, u.id, "limits-changed", `${id} daily=${patch.mirrorDailyUsd ?? "-"} extra-live=${patch.extraLiveMinutes ?? "-"}`);
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
        const monthly = await usedByBrand();
        const retailers = await Promise.all(
          rows.map(async (r) => {
            const store = storeFrom(r);
            return {
              brand: r.brand, name: brands.get(r.brand)?.brand.name || r.brand, plan: store.plan?.id || r.plan, planName: store.plan?.name || r.plan, stores: r.stores, status: r.status, started: r.started, monthly: monthlyFee(r.plan, r.stores),
              month: store.plan ? standingOf(store, monthly.get(r.brand)) : null,
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
        if (!planOf(b.plan)) return fail(400, "Choose a plan.");
        const status = ["demo", "pilot", "live", "paused"].includes(b.status) ? b.status : "pilot";
        await db.run(
          "INSERT INTO retailers (brand, plan, stores, status, started) VALUES (?,?,?,?,?) ON CONFLICT(brand) DO UPDATE SET plan = excluded.plan, stores = excluded.stores, status = excluded.status",
          id, planOf(b.plan).id, int(b.stores, 1, 5000, 1), status, Date.now(),
        );
        await audit(ip, u.id, "retailer-saved", id);
        return ok();
      }
      if (key === "POST /api/hq/retailers/pilot") {
        const b = await readBody(request);
        const id = text(b.brand, 80);
        const row = await db.get("SELECT * FROM retailers WHERE brand = ?", id);
        if (!row) return fail(404, "Set that store's plan first.");
        const settings = settingsOf(row);
        // Portraits added to the store's month at no charge: set on their own, or along with a target.
        if (b.extraPortraits !== undefined) {
          const n = Number(b.extraPortraits);
          if (!Number.isInteger(n) || n < 0 || n > EXTRA_PORTRAITS_MAX) return fail(400, `Extra portraits are a whole number up to ${EXTRA_PORTRAITS_MAX}.`);
          n ? (settings.extraPortraits = n) : delete settings.extraPortraits;
        }
        if (b.clear === true) delete settings.pilot;
        else if (b.metric === undefined && b.extraPortraits !== undefined) {
          // only the portraits were changed
        } else {
          const target = Number(b.target);
          if (!PILOT_METRICS[b.metric] || !(target > 0) || target > 1e6) return fail(400, "A pilot needs one measure and a target above zero.");
          settings.pilot = { metric: b.metric, target, days: int(b.days, 7, 180, 60), start: Date.now() };
        }
        await db.run("UPDATE retailers SET settings = ? WHERE brand = ?", JSON.stringify(settings), id);
        const onlyPortraits = b.clear !== true && b.metric === undefined;
        await audit(ip, u.id, b.clear === true ? "pilot-cleared" : onlyPortraits ? "portraits-added" : "pilot-set", `${id} ${b.clear === true ? "" : onlyPortraits ? `+${extraPortraitsOf(settings)} portraits a month` : `${b.metric}>=${b.target} in ${settings.pilot.days}d`}`);
        return ok({ pilot: settings.pilot || null, extraPortraits: extraPortraitsOf(settings) });
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
      // The founder marks a member as a teammate (the team's demo allowance), a tester, or back to an ordinary member.
      if (key === "POST /api/hq/members/tier") {
        const b = await readBody(request);
        const tier = ["member", "team", "tester"].includes(b.tier) ? b.tier : null;
        const row = tier && (await db.get("SELECT id, email FROM users WHERE id = ? AND role = 'member'", text(b.id, 40)));
        if (!row) return fail(400, "Choose a member and a tier.");
        await db.run("UPDATE users SET tier = ?, tier_until = NULL WHERE id = ?", tier, row.id);
        await audit(ip, u.id, "member-tier-" + tier, row.email);
        return ok({ tier });
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
      if (key === "GET /api/hq/contact") {
        const c = parse((await db.get("SELECT value FROM meta WHERE key = 'contact'"))?.value);
        return ok({ whatsapp: waNumber(c.whatsapp) || "", show: !!c.show });
      }
      if (key === "POST /api/hq/contact") {
        const b = await readBody(request);
        const number = waNumber(b.whatsapp);
        if (b.whatsapp && !number) return fail(400, "That number doesn't look right. Write it with the country code, like +92 3xx xxxxxxx.");
        const show = b.show === true && !!number;
        await db.run("INSERT INTO meta (key, value) VALUES ('contact', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify({ whatsapp: number, show }));
        await audit(ip, u.id, show ? "contact-shown" : "contact-hidden");
        return ok({ whatsapp: number, show });
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
  const photoOnlyFor = async (brandId) => new Set(parse((await db.get("SELECT settings FROM retailers WHERE brand = ?", brandId))?.settings).photoOnly || []);

  return { db, handle, tell, boardPreview, embedSession, embedPass, guestGrant, guestBackdrop, saveGuestShot, identify, grant, meter, visitFor, creditOut, creditOk, falOut, savePortrait, replacePortrait, hiddenFor, photoOnlyFor, signed, ensureFounder, sweep, audit, notify };
}
