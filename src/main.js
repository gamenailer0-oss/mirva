// MIRVA front of house: the conversation on the tablet, the glass, and what the shopper keeps.
import { Mirror } from "./mirror.js";
import { OCCASIONS, MOODS, budgetSteps, pickLooks, parseAsk, line, colourFamily, addOns, sizeFor } from "./stylist.js";
import { facelessReference, warmUp } from "./vision.js";
import * as memory from "./memory.js";
import * as link from "./link.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function h(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid);
  return n;
}

// Gives up after 15 seconds. A GET that never got through, or met a server just out of reach, tries again
// twice; anything that sends something is never repeated, because it may already have happened.
const RETRY = [400, 1200];
const api = async (path, options) => {
  const read = !options?.method || options.method === "GET";
  for (let tries = 0; ; tries++) {
    let res;
    let body = {};
    try {
      const signal = link.timeout(15000);
      res = await fetch(path, { ...options, headers: { ...options?.headers, ...link.auth() }, signal });
      body = await res.json().catch((e) => {
        if (signal.aborted) throw e;
        return {};
      });
    } catch (e) {
      if (read && tries < RETRY.length) {
        await sleep(RETRY[tries]);
        continue;
      }
      throw e;
    }
    if (read && tries < RETRY.length && [502, 503, 504].includes(res.status)) {
      await sleep(RETRY[tries]);
      continue;
    }
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }
};

const LANES = { formal: "Formal", festive: "Festive", outfits: "Outfits", smart: "Smart casual", fusion: "Fusion", casual: "Casual", unstitched: "Unstitched", west: "Western", men: "Men", suits: "Suits", blazers: "Blazers", waistcoats: "Waistcoats", eastern: "Eastern" };

const S = {
  config: null,
  brand: null,
  products: [],
  addons: [],
  takenAt: null,
  mem: null,
  brief: {},
  step: "occasion",
  looks: [],
  shown: new Set(),
  avoid: new Set(),
  selected: null, // product whose details are open
  wearing: null, // product live on the glass (Studio)
  pending: null, // tapped before the mirror was on
  mode: null, // "model" | "studio": stays chosen once the shopper picks one
  view: "mirror", // "mirror" | "portrait": what the glass is showing
  portrait: null, // { pid, url, thumb } on the glass now
  portraits: new Map(), // pid -> { url, thumb }, kept for the sitting so a second tap is instant
  extras: new Map(), // pid -> Set of add-on ids the shopper added
  developing: null, // the "being made" sequence on the glass, while something is generated
  ticket: 0,
  shooting: 0, // portraits being made right now
  visit: { looks: 0, portraits: 0, base: 0 }, // what this shopper has used since Start over (see visitLimits)
  lane: "all",
  garments: new Map(),
  refs: new Map(),
};
let mirror;

const glass = $("#glass");
const frame = $("#frame");
const money = (n) => `${S.brand.currency}${Math.round(n).toLocaleString("en-PK")}`;
const pic = (url, w) => `/img?u=${encodeURIComponent(url)}&w=${w}`;
const spoken = (name) => name.replace(/^\d\s*-?\s*piece\s*-\s*/i, "").toLowerCase();
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sentence = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

// ---------- MIRVA's two voices: on the tablet and on the glass ----------
function replay(node, text) {
  if (node.textContent === text) return;
  node.textContent = text;
  node.classList.remove("in");
  void node.offsetWidth;
  node.classList.add("in");
}
const say = (text) => replay($("#say"), text);
const caption = (text) => replay($("#caption"), text);

// True when a shopper is at the screen: a paired store mirror, or a member's own device.
// Then nothing about keys, dollars or settings belongs on the glass.
// On a public address that is everyone except the founder and a store's own staff.
const forShopper = () => !!(link.pairedTo() || link.member || (S.config?.open === false && !link.staff));
// On a public address a look is made only for a member, a paired store mirror, or staff.
const mustJoin = () => S.config?.open === false && !link.member && !link.pairedTo() && !link.staff;
function askToJoin() {
  caption("Join free to see this on you. It takes a minute.");
  const t = $("#toast");
  t.replaceChildren(h("span", { text: "Membership is free, and your pictures stay yours." }), h("a", { href: "/account?join=1", text: "Join free" }));
  t.hidden = false;
}
const RESTING = "Try-on is resting just now. Please try again in a little while.";
const FULL_LINE = "That's a full fitting. Tap Start over for the next one, or ask the staff.";
const CAMERA_DOWN_LINE = "The camera has stopped. Tap Try the camera again, then pick a look.";
// A store on a plan without live Studio (Assist): the Studio button stays, says where live is, and gives a portrait.
const NO_LIVE_LINE = "Live Studio comes with a MIRVA mirror. Here is a portrait instead.";
const noLive = () => S.config?.studio === false;
const NOT_SENT_LINE = "No picture was sent. Tap a look whenever you are ready.";
// A piece the store shows in its own photographs only (hand embroidery, a designer's wish): no look is made of it.
const PHOTO_ONLY_LINE = "This piece is shown in the store's own photographs.";

// ---------- before the first look ----------
// A look is made from a picture of the shopper, and the engine that makes it runs abroad. She is told so in plain
// words before the first picture leaves: every shopper at a store mirror, and once on a person's own device.
const CONSENT_KEY = "mirva:consent";
const consentFor = () => link.member?.user.id || "this-device";
function hasAgreed() {
  if (S.agreed) return true;
  if (link.pairedTo()) return false; // a store mirror belongs to nobody: each shopper is asked
  try {
    return localStorage.getItem(CONSENT_KEY) === consentFor();
  } catch {
    return false;
  }
}
function agreed() {
  if (hasAgreed()) return Promise.resolve(true);
  const box = $("#consent");
  const keeps = link.pairedTo() ? "This mirror keeps no pictures." : link.member ? "Your portraits stay in your wardrobe until you delete them." : "Nothing is kept.";
  $("#consentCopy").textContent = `To show a piece on you, one picture from the mirror goes to our try-on engine, which runs abroad. It is used to make your look and for nothing else. ${keeps}`;
  return new Promise((resolve) => {
    const yes = $("#consentYes"), no = $("#consentNo");
    const done = (ok) => {
      yes.removeEventListener("click", onYes);
      no.removeEventListener("click", onNo);
      box.removeEventListener("cancel", onNo);
      if (box.open) box.close();
      if (ok) {
        S.agreed = true;
        if (!link.pairedTo())
          try {
            localStorage.setItem(CONSENT_KEY, consentFor());
          } catch {}
        link.track("consent");
      }
      resolve(ok);
    };
    const onYes = () => done(true);
    const onNo = () => done(false);
    yes.addEventListener("click", onYes);
    no.addEventListener("click", onNo);
    box.addEventListener("cancel", onNo);
    box.showModal();
  });
}

// What one shopper may use of a store mirror before the next one: the server says (`visit` in /api/config), and a paired
// mirror whose server has not said uses these. Anyone else is not held to a visit. A number that is absent, null or not
// above zero means no limit on that.
const VISIT_DEFAULTS = { liveLooks: 4, liveSeconds: 240, portraits: 8, resetSeconds: 60 };
function visitLimits() {
  const given = S.config?.visit;
  const v = given && typeof given === "object" ? given : link.pairedTo() ? VISIT_DEFAULTS : null;
  if (!v) return null;
  const n = (x) => (Number(x ?? 0) > 0 ? Number(x) : 0);
  return { liveLooks: n(v.liveLooks), liveSeconds: n(v.liveSeconds), portraits: n(v.portraits), resetSeconds: n(v.resetSeconds) };
}
const resetVisit = () => Object.assign(S.visit, { looks: 0, portraits: 0, base: mirror ? mirror.liveSeconds : 0 });
const liveUsed = () => mirror.liveSeconds - S.visit.base;
// True when this shopper has had what a visit allows of that kind of try-on.
function fullFitting(kind) {
  const v = visitLimits();
  if (!v) return false;
  if (kind === "portrait") return !!v.portraits && S.visit.portraits >= v.portraits;
  return (!!v.liveLooks && S.visit.looks >= v.liveLooks) || (!!v.liveSeconds && liveUsed() >= v.liveSeconds);
}

function friendly(e) {
  const m = String(e?.message || e || "");
  // The server refused on purpose (a daily, monthly or per-visit ceiling) and said why: say that, as it is.
  if (e?.limit && m) return m;
  if (e?.kind === "slow") return "The connection is slow. Check it, then tap a look to try again.";
  if (e?.kind === "busy") return "The studio is busy just now. Please try again in a little while.";
  if (e?.name === "NotAllowedError") return "The camera is blocked. Allow it in the address bar, or use a photo.";
  if (e?.name === "NotFoundError" || e?.name === "OverconstrainedError") return "I can't find a camera. Use a photo instead.";
  if (e?.name === "NotReadableError") return "Another app is using the camera. Close it and try again.";
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "That took too long. Tap to try again.";
  if (/401|unauthor|invalid.*key/i.test(m)) return forShopper() ? RESTING : "The try-on engine refused the key. Check DECART_API_KEY in .env.";
  if (/402|credit|quota|payment|balance/i.test(m)) return forShopper() ? RESTING : "The try-on account is out of credit.";
  if (/network|failed to fetch|websocket|ice|timeout/i.test(m)) return "The connection dropped. Tap to try again.";
  return m.length && m.length < 140 ? m : "Something went wrong. Tap to try again.";
}

// ---------- brand ----------
function onAccent(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#0b0d12" : "#ffffff";
}
function setAccent(hex) {
  document.documentElement.style.setProperty("--accent", hex);
  document.documentElement.style.setProperty("--on-accent", onAccent(hex));
  $("#accentInput").value = hex;
}
function applyBrand(brand) {
  document.documentElement.dataset.mood = brand.mood || "porcelain";
  setAccent(brand.accent || "#1e3fae");
  $("#wordmark").textContent = brand.wordmark || brand.name;
  $("#byline").textContent = brand.notice ? "concept demo by MIRVA" : brand.byline || "styled by MIRVA";
  $("#wakeNotice").textContent = brand.notice || "";
  $("#storeName").textContent = brand.name;
  document.title = `MIRVA for ${brand.name}`;
  $("#pageTitle").textContent = `MIRVA, the stylist for ${brand.name}`;
  const when = S.takenAt ? new Date(S.takenAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  $("#notice").textContent = [brand.notice, when && `Prices and sizes read from the store's public site on ${when}.`].filter(Boolean).join(" ");
}

function forgetPortraits() {
  for (const p of S.portraits.values()) URL.revokeObjectURL(p.url);
  S.portraits.clear();
  S.portrait = null;
  S.view = "mirror";
  $("#portrait").hidden = true;
  if (!S.wearing) $("#wearing").hidden = true; // the name and price of a portrait that is no longer on the glass
}

async function loadBrand(id) {
  const { brand, catalogue } = await api(`/api/brands/${id}`);
  if (mirror.isLive) mirror.stop("user");
  forgetPortraits();
  S.brand = brand;
  S.products = catalogue.products;
  S.addons = catalogue.addons || [];
  S.takenAt = catalogue.takenAt;
  S.mem = memory.load(id);
  S.mem.visits += 1;
  memory.store(id, S.mem);
  memory.lastBrand.set(id);
  link.setBrand(id);
  mirror.brandId = id;
  S.garments.clear();
  S.refs.clear();
  S.extras.clear();
  S.lane = "all";
  mirror.enhance = !!brand.enhancePrompt;
  applyBrand(brand);
  renderSaved();
  renderCatalogue();
  startConversation();
}

// ---------- conversation ----------
function startConversation() {
  S.brief = { who: S.brand?.audience === "men" ? "men" : "women", formalityShift: 0 };
  S.step = "occasion";
  link.newVisit();
  S.looks = [];
  S.shown = new Set();
  S.avoid = new Set();
  S.selected = null;
  resetVisit();
  const kept = S.mem.saved[0];
  say(kept && S.mem.visits > 1 ? line("welcomeBack", { name: spoken(kept.name) }) : line("hello"));
  renderConversation();
  renderLooks();
  syncGlass();
}

function suggest(tone) {
  const picks = pickLooks(S.products, S.brief, { shown: S.shown, avoidColours: S.avoid });
  S.looks = picks;
  picks.forEach((k) => S.shown.add(k.product.id));
  S.step = "looks";
  if (!tone && S.brief.occasion) link.track("brief", { meta: S.brief.occasion });
  link.track("looks_shown", { value: picks.length });
  if (!picks.length) say(line("none"));
  else if (tone) say(line(tone));
  else say(line(mirror.awake ? "picked" : "pickedAsleep", { stretch: picks.some((k) => k.stretch) }));
  S.mem.brief = { ...S.brief };
  memory.store(S.brand.id, S.mem);
  renderConversation();
  renderLooks();
  // Have the garment pictures in hand before she taps, so the tap feels instant.
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 250));
  idle(() => picks.forEach((k) => garment(k.product).catch(() => {})));
}

function refine(kind) {
  if (kind === "less") S.brief.formalityShift = Math.max(-3, (S.brief.formalityShift || 0) - 1);
  if (kind === "more") S.brief.formalityShift = Math.min(3, (S.brief.formalityShift || 0) + 1);
  if (kind === "cheaper") {
    const prices = S.looks.map((k) => k.product.price);
    const floor = Math.min(...S.products.filter((p) => p.gender === S.brief.who).map((p) => p.price));
    S.brief.budget = Math.max(floor, (prices.length ? Math.min(...prices) : S.brief.budget || floor) - 1);
  }
  if (kind === "colour") {
    S.avoid = new Set(S.looks.map((k) => colourFamily(k.product.colour)));
    S.brief.colour = null;
  }
  suggest(kind === "three" ? "three" : kind);
}

function chip(label, onclick, cls = "") {
  return h("button", { class: `chip ${cls}`.trim(), type: "button", onclick, text: label });
}

function renderConversation() {
  const chips = $("#chips");
  const refineBox = $("#refine");
  chips.replaceChildren();
  refineBox.replaceChildren();
  const hasMen = S.products.some((p) => p.gender === "men");
  const hasWomen = S.products.some((p) => p.gender === "women");
  const go = (step, text) => {
    S.step = step;
    say(text);
    renderConversation();
    renderLooks();
  };

  if (S.step === "occasion") {
    for (const o of OCCASIONS)
      chips.append(
        chip(o.label, () => {
          S.brief.occasion = o.id;
          S.brief.formalityShift = 0;
          go("mood", line("mood"));
        }),
      );
    if (hasMen && hasWomen)
      chips.append(
        chip(S.brief.who === "men" ? "Shopping for her" : "Shopping for him", () => {
          S.brief.who = S.brief.who === "men" ? "women" : "men";
          renderConversation();
        }, "quiet"),
      );
  } else if (S.step === "mood") {
    for (const m of MOODS) chips.append(chip(m.label, () => ((S.brief.mood = m.id), go("budget", line("budget")))));
  } else if (S.step === "budget") {
    for (const b of budgetSteps(S.products.filter((p) => p.gender === S.brief.who)))
      chips.append(chip(`Under ${money(b)}`, () => ((S.brief.budget = b), suggest())));
    chips.append(chip("No limit", () => ((S.brief.budget = null), suggest())));
  } else {
    // The brief, said back. Tap a part to change it.
    const o = OCCASIONS.find((x) => x.id === S.brief.occasion);
    const m = MOODS.find((x) => x.id === S.brief.mood);
    if (o) chips.append(chip(o.label, () => go("occasion", line("hello")), "on"));
    if (m) chips.append(chip(m.label, () => go("mood", line("mood")), "on"));
    if (S.brief.budget) chips.append(chip(`Under ${money(S.brief.budget)}`, () => go("budget", line("budget")), "on"));
    if (S.brief.colour) chips.append(chip(sentence(S.brief.colour), () => ((S.brief.colour = null), suggest()), "on"));
    if (S.brief.who === "men" && hasWomen) chips.append(chip("For him", () => ((S.brief.who = "women"), S.shown.clear(), suggest()), "on"));
    for (const [kind, label] of [["less", "Less formal"], ["more", "More formal"], ["cheaper", "Lower price"], ["colour", "Another colour"], ["three", "Three more"]])
      refineBox.append(chip(label, () => refine(kind)));
  }
}

// Cards are built once per set of looks and then only re-marked, so a tap never
// rebuilds the grid or reloads a picture.
function lookCard(p, extra = {}) {
  const base = extra.stretch ? "A stretch" : extra.first ? "My pick" : p.unstitched ? "Unstitched" : "";
  return h(
    "button",
    { class: "look", type: "button", "data-pid": p.id, "data-badge": base, onclick: () => choose(p) },
    h("span", { class: "shot" }, h("img", { src: pic(p.image, 420), alt: p.name, loading: "lazy", decoding: "async" }), h("span", { class: "badge", text: base, hidden: !base })),
    h("span", { class: "name", text: p.name }),
    h("span", { class: "price", text: money(p.price) }),
    extra.why && h("span", { class: "why", text: extra.why }),
  );
}

function renderLooks() {
  const box = $("#looks");
  box.replaceChildren(...(S.step === "looks" ? S.looks.map((k, i) => lookCard(k.product, { ...k, first: i === 0 && !k.stretch })) : []));
  markCards();
  renderDetail();
}

function markCards() {
  for (const card of $$(".look")) {
    const pid = card.dataset.pid;
    const live = pid === S.wearing?.id;
    const portrait = S.view === "portrait" && pid === S.portrait?.pid;
    const text = live ? "On you" : portrait ? "Your portrait" : card.dataset.badge;
    card.classList.toggle("on", live || portrait || pid === S.selected?.id);
    const badge = card.querySelector(".badge");
    badge.textContent = text;
    badge.hidden = !text;
    badge.classList.toggle("onyou", live || portrait);
  }
}

function chosenExtras(p) {
  const ids = S.extras.get(p.id);
  return ids ? S.addons.filter((a) => ids.has(a.id)) : [];
}

function renderDetail() {
  const box = $("#detail");
  const p = S.selected;
  if (!p || S.step !== "looks") return (box.hidden = true);
  const facts = [p.colour, p.fabric && !p.fabric.includes("%") ? p.fabric : "", p.season].filter(Boolean).join(" · ");
  const mine = S.mem.size;
  const picks = addOns(p, S.addons);
  const extras = chosenExtras(p);
  const total = p.price + extras.reduce((n, a) => n + a.price, 0);
  const parts = [
    h("h3", { text: p.name }),
    h("p", { class: "facts" }, h("b", { text: money(p.price) }), facts ? `  ·  ${facts}` : ""),
    p.unstitched && h("p", { class: "note", text: "Sold as unstitched fabric. The mirror shows it stitched." }),
    p.sizes.length
      ? h(
          "div",
          { class: "sizes", role: "group", "aria-label": "Size" },
          h("span", { class: "label", text: "Size" }),
          p.sizes.map((z) =>
            h("button", {
              class: `size${z.inStock ? "" : " gone"}${mine === z.label ? " mine" : ""}`,
              type: "button",
              "aria-pressed": String(mine === z.label),
              "aria-label": `${z.label}, ${z.inStock ? "in stock online" : "sold out online"}`,
              text: z.label,
              onclick: () => {
                S.mem.size = z.label;
                link.track(z.inStock ? "size_pick" : "size_missed", { product: p.id, meta: z.label });
                memory.store(S.brand.id, S.mem);
                caption(z.inStock ? line("size", { size: z.label }) : `${z.label} is sold out online. I'd ask the floor for it.`);
                renderDetail();
              },
            }),
          ),
        )
      : null,
    mine && p.sizes.length
      ? h("p", {
          class: "note",
          text: !p.sizes.some((z) => z.label === mine) ? `This piece is not made in ${mine}.` : p.sizes.find((z) => z.label === mine).inStock ? `Your size, ${mine}, is in stock.` : `Your size, ${mine}, is sold out online. Other sizes are available.`,
        })
      : null,
    p.sizes.length && S.brand.sizeChart?.length ? h("button", { class: "textlink sizer-link", type: "button", text: S.mem.measure ? "Change my measurements" : "Not sure? Find my size", onclick: openSizer }) : null,
    picks.length
      ? h(
          "div",
          { class: "addons" },
          h("p", { class: "label", text: "Goes with it" }),
          h(
            "div",
            { class: "addon-row" },
            picks.map((k) => {
              const on = S.extras.get(p.id)?.has(k.addon.id);
              return h(
                "button",
                {
                  class: `addon${on ? " on" : ""}`,
                  type: "button",
                  "aria-pressed": String(!!on),
                  title: `${k.addon.name}. ${k.why}.`,
                  onclick: () => {
                    const set = S.extras.get(p.id) || new Set();
                    set.has(k.addon.id) ? set.delete(k.addon.id) : set.add(k.addon.id);
                    S.extras.set(p.id, set);
                    if (set.has(k.addon.id)) link.track("addon", { product: p.id, meta: k.label });
                    renderDetail();
                  },
                },
                h("img", { src: pic(k.addon.image, 160), alt: "", loading: "lazy", decoding: "async" }),
                h("span", { class: "addon-kind", text: k.label }),
                h("span", { class: "addon-price", text: money(k.addon.price) }),
                h("span", { class: "addon-why", text: on ? "Added" : k.why }),
              );
            }),
          ),
          extras.length ? h("p", { class: "note total" }, "The whole look, ", h("b", { text: money(total) }), ".") : null,
        )
      : null,
    h(
      "div",
      { class: "detail-actions" },
      h("button", { class: "primary small", type: "button", text: "Keep this look", onclick: keep, disabled: !canKeepFor(p) }),
      h("button", { class: "chip", type: "button", text: "Send to phone", onclick: () => openSend([{ ...p, extras }]) }),
      // The store's own people count a sale that came from this mirror: one tap, on the store's device only.
      link.pairedTo() || link.staff ? h("button", { class: "chip", type: "button", text: "Sold", onclick: () => openSold(p, total) }) : null,
      h("a", { class: "textlink", href: p.url, target: "_blank", rel: "noopener", text: `View at ${S.brand.name}` }),
    ),
  ];
  box.replaceChildren(...parts.filter(Boolean));
  box.hidden = false;
}

// ---------- the glass ----------
const hasPicture = () => glass.classList.contains("has-picture");
// A portrait is one picture: kept once, it is kept. (A live look can be kept again, turned another way.)
const keptAlready = () => S.view === "portrait" && !!S.portrait && S.keptUrl === S.portrait.url;
const canKeepFor = (p) => !keptAlready() && ((S.view === "portrait" && S.portrait?.pid === p.id) || (S.wearing?.id === p.id && hasPicture()));
const canKeep = () => !keptAlready() && ((S.view === "portrait" && !!S.portrait) || (!!S.wearing && hasPicture()));

function syncGlass() {
  let st = "awake";
  if (mirror.state === "asleep") st = "asleep";
  else if (S.developing) st = "thinking";
  else if (S.view === "portrait") st = "portrait";
  else if (mirror.state === "connecting" || (mirror.state === "live" && !hasPicture())) st = "thinking";
  else if (mirror.state === "live") st = "live";
  glass.dataset.state = st;
  frame.dataset.state = st;
  glass.classList.toggle("photo", mirror.source?.kind === "photo");

  const awake = st !== "asleep";
  // The dock. Nothing until a look is chosen; then the two ways to wear it, said in full; once a look is on the glass,
  // a switch between them with Keep and Take off. While something is being made it keeps the shape it had (it is out
  // of sight then), so nothing under the glass moves during the wait.
  const on = mirror.isLive || S.view === "portrait";
  let dock = !awake ? "none" : on ? "result" : S.selected && !S.selected.photoOnly ? "choose" : "none";
  if (st === "thinking" && awake) dock = frame.dataset.dock !== "none" ? frame.dataset.dock : S.selected ? "choose" : "none";
  frame.dataset.dock = dock;
  $("#dock").hidden = dock === "none";
  $("#glassActions").hidden = dock !== "result";
  $("#shapeBtn").hidden = !awake;
  $("#camBtn").hidden = !awake;
  $("#camBtn").classList.toggle("lit", mirror.source?.kind === "camera" && !mirror.cameraDown);
  $("#likeness").hidden = !(st === "portrait" || st === "live");
  for (const b of $$("#modes button")) {
    const on = (b.dataset.mode === "model" && S.view === "portrait") || (b.dataset.mode === "studio" && mirror.isLive && S.view !== "portrait");
    b.setAttribute("aria-pressed", String(on));
  }
  $("#keepBtn").disabled = !canKeep();
  $("#keepBtn").textContent = keptAlready() ? "Kept" : "Keep";
  $("#meter").hidden = !(mirror.state === "live" && S.view !== "portrait");
  $("#hint").hidden = !(st === "awake" && $("#hint").textContent);
}

async function garment(p) {
  if (!S.garments.has(p.id)) {
    // The cloth on its own when the product has a clean reference; the catalogue photo, model and all, when not.
    let res = p.ref ? await fetch(p.ref).catch(() => null) : null;
    if (!res?.ok) res = await fetch(pic(p.image, 768));
    if (!res.ok) throw new Error("I couldn't load that garment's picture.");
    S.garments.set(p.id, await res.blob());
  }
  return S.garments.get(p.id);
}

// The garment picture with nothing of the catalogue model left in it: no face, no hair, no neck. The still engine
// copies whatever of her it can see, so this is what keeps the portrait the shopper's own (docs/portrait-experiments.md).
//  - A product with `ref` was cleaned ahead of time (scripts/prepare-refs.mjs): fetch that.
//  - `ref: null` means nothing clean could be made from its photo.
//  - No `ref` at all (a store loaded just now, or a prepared file that would not load): clean the photo here, which
//    brings in the 16 MB hair-and-skin model, once.
// Resolves a Blob, or null: there is then no portrait of this piece, and the store's own photo is shown instead.
async function reference(p) {
  if (!S.refs.has(p.id)) {
    let ref = null;
    if (p.ref) {
      const res = await fetch(p.ref).catch(() => null);
      if (res?.ok) ref = await res.blob();
    }
    if (!ref && p.ref !== null) {
      try {
        const { cleanReference } = await import("./reference.js");
        // A larger photo than the look card shows, cut down to the figure: the engine reads the print and the embroidery from these pixels.
        const large = await fetch(pic(p.image, 1200)).catch(() => null);
        ref = (await cleanReference(large?.ok ? await large.blob() : await garment(p), { tight: true, maxSide: 1200 })).blob;
      } catch (e) {
        console.warn("Could not prepare the garment picture.", e);
      }
    }
    S.refs.set(p.id, ref);
  }
  return S.refs.get(p.id);
}

function needMirror(p) {
  S.pending = p;
  caption(line("needMirror"));
  const btn = $("#wakeBtn");
  btn.classList.remove("nudge");
  void btn.offsetWidth;
  btn.classList.add("nudge");
}

// On a phone the glass is above the looks. A look tapped from far down the page (the Catalogue is a long way) would
// answer somewhere out of sight, so the page eases back up to the glass.
function showGlass() {
  if (!matchMedia("(max-width: 980px)").matches) return;
  const r = glass.getBoundingClientRect();
  const seen = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
  if (seen >= r.height * 0.6) return;
  glass.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function choose(p) {
  mirror.touch();
  showGlass();
  S.selected = p;
  link.track("look_open", { product: p.id });
  if (S.step === "looks") renderDetail();
  markCards();
  if (p.photoOnly) return syncGlass(), caption(PHOTO_ONLY_LINE), openPhoto(p);
  if (!mirror.awake) return needMirror(p);
  mirror.preload();
  if (S.mode !== "studio") fetchAhead();
  if (S.mode === "studio") return studio(p);
  if (S.mode === "model") return modelShot(p);
  syncGlass();
  caption(line("whichMode"));
}

function setMode(mode) {
  const p = S.selected;
  if (!p || p.photoOnly) return;
  S.mode = mode;
  if (mode === "model") modelShot(p);
  else studio(p);
}

// ---- the wait, made into part of the experience ----
// While a look is being made, the glass shows the piece itself: its close-ups, its cloth,
// and a tailor's steps. The wait builds wanting instead of testing patience.
function storyLines(p) {
  const out = [];
  if (p.fabric && !p.fabric.includes("%")) out.push(`${sentence(p.fabric.toLowerCase())}.`);
  if (p.cut && p.cut.length < 64 && !/unstitched/i.test(p.cut)) out.push(`${sentence(p.cut)}.`);
  if (p.unstitched) out.push("Sold as fabric. Shown stitched, for you.");
  if (p.colour && !/multi/i.test(p.colour)) out.push(`In ${p.colour.toLowerCase()}.`);
  if (S.brief.budget && p.price <= S.brief.budget - 500) out.push(`${money(S.brief.budget - p.price)} under what you set.`);
  const left = p.sizes.filter((z) => z.inStock).map((z) => z.label);
  if (left.length > 4) out.push(`In ${left.length} sizes, ${left[0]} to ${left[left.length - 1]}.`);
  else if (left.length) out.push(`Made in ${left.join(", ")}.`);
  return out.length ? out : [`${p.name}.`];
}

function develop(p, kind) {
  S.developing?.cancel();
  const reel = $("#reel");
  const imgs = [$("#reelA"), $("#reelB")];
  const shots = (p.images?.length > 1 ? p.images.slice(1, 6) : [p.image]).map((u) => pic(u, 720));
  const steps = kind === "model" ? ["Taking your measure", "Cutting the cloth", "Stitching it for you", "Pressing the last seam"] : ["Opening the studio", "Fitting it to you"];
  const lines = storyLines(p);
  let n = 0;
  let front = 0;
  const frame = () => {
    const img = imgs[front ^ 1];
    img.onload = () => {
      img.classList.add("on");
      imgs[front].classList.remove("on");
      front ^= 1;
    };
    img.src = shots[n % shots.length];
    replay($("#reelStep"), steps[Math.min(n, steps.length - 1)]);
    replay($("#reelLine"), lines[n % lines.length]);
    n++;
  };
  imgs.forEach((i) => i.classList.remove("on"));
  frame();
  const timer = setInterval(frame, 3400);
  reel.hidden = false;
  requestAnimationFrame(() => reel.classList.add("on"));
  const me = {
    kind: "model",
    cancel() {
      if (S.developing !== me) return;
      clearInterval(timer);
      S.developing = null;
      reel.classList.remove("on");
      setTimeout(() => !S.developing && (reel.hidden = true), 700);
      syncGlass();
    },
  };
  S.developing = me;
  syncGlass();
  return me;
}

// The wait in Studio: she keeps seeing herself, a little dimmed, with the step and the pose check's cue.
function seeHerself() {
  S.developing?.cancel();
  const box = $("#seeing");
  const step = (text) => replay($("#seeingStep"), text);
  const steps = ["Opening the studio", "Fitting it to you"];
  let n = 0;
  const timer = setInterval(() => {
    step(steps[++n]);
    if (n >= steps.length - 1) clearInterval(timer);
  }, 3400);
  const slow = setTimeout(() => step("Taking a little longer than usual"), 10000);
  step(steps[0]);
  replay($("#seeingHint"), framingCue());
  box.hidden = false;
  requestAnimationFrame(() => box.classList.add("on"));
  const me = {
    kind: "studio",
    hint: (text) => replay($("#seeingHint"), text || ""),
    queue(place) {
      clearInterval(timer);
      clearTimeout(slow);
      step(`The studio is busy. You are number ${place} in line.`);
    },
    cancel() {
      if (S.developing !== me) return;
      clearInterval(timer);
      clearTimeout(slow);
      S.developing = null;
      box.classList.remove("on");
      setTimeout(() => !S.developing && (box.hidden = true), 700);
      syncGlass();
    },
  };
  S.developing = me;
  syncGlass();
  return me;
}

// What the pose check would say to her right now, if anything.
const framingCue = () => (mirror.presence.known && (!mirror.presence.present || mirror.presence.ok === false) ? mirror.presence.hint : "");

// A garment swapped inside a live look: a light pass over the picture until the new one has settled.
let sweepTimer;
function sweep(on) {
  clearTimeout(sweepTimer);
  glass.classList.toggle("swapping", on);
  if (on) sweepTimer = setTimeout(() => sweep(false), 5000);
}

async function countdown() {
  const box = $("#count");
  box.hidden = false;
  caption("Stand tall and look here.");
  for (const n of ["3", "2", "1"]) {
    replay(box, n);
    await sleep(820);
  }
  box.hidden = true;
}

function afterUnveil(p) {
  const left = p.sizes.filter((z) => z.inStock).map((z) => z.label);
  if (S.brief.budget && p.price <= S.brief.budget - 500) return `That is ${money(S.brief.budget - p.price)} under what you set.`;
  if (p.sizes.length && left.length && left.length <= 2) return `Only ${left.join(" and ")} left online.`;
  return "Keep it, or see it live.";
}

function showPortrait(entry, pid) {
  // A portrait on the glass is the answer: nothing still "being made" belongs over it (a Studio wait that was cut short
  // by a portrait that was already there used to stay, and keep the controls under it out of reach).
  S.developing?.cancel();
  const img = $("#portrait");
  img.src = entry.url;
  img.hidden = false;
  img.classList.remove("unveil");
  void img.offsetWidth;
  img.classList.add("unveil");
  S.portrait = { pid, ...entry };
  S.view = "portrait";
  const p = S.products.find((x) => x.id === pid);
  $("#wearingName").textContent = p.name;
  $("#wearingPrice").textContent = money(p.price);
  $("#wearing").hidden = false;
  syncGlass();
  markCards();
  renderDetail();
}

function hidePortrait() {
  if (S.view !== "portrait") return;
  S.view = "mirror";
  S.portrait = null;
  $("#portrait").hidden = true;
  if (!S.wearing) $("#wearing").hidden = true;
  syncGlass();
  markCards();
  renderDetail();
}

async function thumbOf(blob, width = 300) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = Math.round((width * bmp.height) / bmp.width);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}

// The engine redraws the head along with the clothes, whatever it is told and whichever store the piece is from. So
// before any portrait is shown, the shopper's own head is laid back over it, from the frame she sent (src/restore.js).
// A member's wardrobe gets the finished picture too. If it cannot be done, the portrait is shown as it came.
let restoring = null;
const restorer = () => (restoring ??= import("./restore.js").catch((e) => (console.warn(e), (restoring = null))));
async function ownHead(person, portrait, saved, options) {
  try {
    const mod = await restorer();
    if (!mod) return portrait;
    // After the backdrop pass (tight) the garment goes back first, as it was first drawn, and then her head over it.
    const both = async () => {
      const figure = options?.tight ? await mod.restoreFigure(person, portrait) : null;
      const head = await mod.restoreHead(person, figure?.blob || portrait, options);
      return head.how === "restored" || figure?.how !== "restored" ? head : figure;
    };
    const fixed = await Promise.race([both(), sleep(RESTORE_WAIT).then(() => null)]);
    if (fixed?.how !== "restored") return portrait;
    if (saved) fetch(`/api/portrait/${saved}`, { method: "POST", headers: { ...link.auth(), "content-type": fixed.blob.type }, body: fixed.blob }).catch(() => {});
    return fixed.blob;
  } catch (e) {
    console.warn(e);
    return portrait;
  }
}
// A wrong face is worse than a longer wait, so the restore is given time: on a slow line its model is still arriving.
const RESTORE_WAIT = 45000;
// The model is 16 MB. It starts coming the first time a look is chosen (only fetched, into the browser's cache: nothing is
// compiled yet, so the camera never stutters), unless the shopper has asked her browser to save data.
let fetched = false;
function fetchAhead() {
  if (fetched || navigator.connection?.saveData) return;
  fetched = true;
  for (const f of ["selfie_multiclass_256x256.tflite", "blaze_face_short_range.tflite"]) fetch(`/models/${f}`, { priority: "low" }).catch(() => {});
}

// Model: one portrait of the shopper in the piece, in her own pose, framing and light (the engine edits the clothes
// and nothing else). If the wall behind her is not plain, a second, quiet pass puts the same portrait on a studio
// backdrop, and the glass fades to it when it is ready. See src/portrait.js and docs/portrait-experiments.md.
async function modelShot(p, { retake = false } = {}) {
  mirror.touch();
  if (p.photoOnly) return caption(PHOTO_ONLY_LINE);
  if (mustJoin()) return askToJoin();
  if (!mirror.awake) return needMirror(p);
  if (!S.config.live) return caption(forShopper() ? RESTING : "Portraits are off. Add your Decart key to the .env file and restart.");
  // A portrait already made is shown again for free; a new one is a try-on, and a visit has only so many.
  const fresh = retake || !S.portraits.has(p.id);
  if (fresh && mirror.cameraDown) return caption(CAMERA_DOWN_LINE);
  if (fresh && fullFitting("portrait")) return caption(FULL_LINE);
  if (fresh && !(await agreed())) return caption(NOT_SENT_LINE);
  const ticket = ++S.ticket;
  if (mirror.isLive) {
    mirror.stop("switch");
    if (S.developing?.kind === "studio") S.developing.cancel(); // that wait was for a look that is no longer coming
  }
  const cached = !retake && S.portraits.get(p.id);
  if (cached) {
    showPortrait(cached, p.id);
    return caption("This is you in it.");
  }
  if (mirror.presence.known && !mirror.presence.present) return caption("Step into the mirror so I can see you.");
  hidePortrait();
  let pass;
  try {
    pass = await import("./portrait.js");
  } catch (e) {
    console.error(e);
    return caption(friendly(e));
  }
  if (mirror.source.kind === "camera") {
    await countdown();
    if (ticket !== S.ticket) return;
  }
  // A look at the frame before anything is spent: too dim and no later step can bring the colours back.
  let person;
  try {
    person = await mirror.frameBlob(1024);
  } catch (e) {
    console.error(e);
    return caption(friendly(e));
  }
  const look = await pass.lookAt(person);
  if (ticket !== S.ticket) return;
  if (look.dim) return caption(pass.DIM_LINE);
  const dev = develop(p, "model");
  S.shooting++;
  caption(line("putting"));
  try {
    const ref = await reference(p);
    if (!ref) {
      // No picture of the garment could be made ready. A portrait drawn from its description would not be the store's
      // piece (the colours and embroidery would be invented), so none is made: she is shown the store's photo.
      dev.cancel();
      if (ticket === S.ticket) caption(PHOTO_ONLY_LINE), openPhoto(p);
      return;
    }
    const form = new FormData();
    form.append("person", person, "person.jpg");
    form.append("reference", ref, "garment.jpg");
    form.append("brand", S.brand.id);
    form.append("product", p.id);
    form.append("mode", "portrait");
    const asked = pass.requestShot(form, { headers: link.auth(), timeout: link.timeout, onBusy: () => ticket === S.ticket && caption(pass.BUSY_LINE) });
    restorer().then((m) => m?.warmRestore()); // its models load, and take their slow first look, behind the wait
    const { blob: drawn, saved } = await asked;
    const slow = setTimeout(() => ticket === S.ticket && caption("Finishing your portrait."), 5000); // its model is still arriving
    const blob = await ownHead(person, drawn, saved);
    clearTimeout(slow);
    // For a member the server keeps the portrait, so Keep can put it in the wardrobe.
    const entry = { url: URL.createObjectURL(blob), thumb: await thumbOf(blob), saved, backdrop: null };
    link.track("portrait", { product: p.id });
    S.visit.portraits++;
    if (link.member) link.whoIsHere().then(showMember);
    S.portraits.set(p.id, entry);
    if (ticket !== S.ticket) return dev.cancel(); // she moved on; it is kept for when she comes back (and the wait over it is let go, unless it is someone else's by now)
    dev.cancel();
    showPortrait(entry, p.id);
    caption("This is you in it.");
    setTimeout(() => ticket === S.ticket && S.view === "portrait" && caption(afterUnveil(p)), 2600);

    // The wall is not plain: make the same portrait again on a studio backdrop, without a spinner, one ask for each
    // portrait however often she taps. If it fails the first picture stays, and she is never told.
    if (look.busy && !entry.backdrop) {
      entry.backdrop = "asking";
      const again = new FormData();
      again.append("person", blob, "portrait.png");
      again.append("brand", S.brand.id);
      again.append("product", p.id);
      again.append("mode", "backdrop");
      if (saved) again.append("replaces", saved);
      pass
        .requestShot(again, { headers: link.auth(), timeout: link.timeout })
        .then(async (next) => {
          if (S.portraits.get(p.id) !== entry) return; // her pictures were cleared meanwhile: nothing to put it in
          next.blob = await ownHead(blob, next.blob, next.saved, { tight: true }); // the wall is new; her face is not
          if (S.portraits.get(p.id) !== entry) return;
          const url = URL.createObjectURL(next.blob);
          const old = entry.url;
          const here = ticket === S.ticket && S.view === "portrait" && S.portrait?.pid === p.id;
          if (here) await pass.crossfade($("#portrait"), url); // she has moved on otherwise: the picture is only kept
          Object.assign(entry, { url, thumb: await thumbOf(next.blob), saved: next.saved || entry.saved, backdrop: "done" });
          if (S.portrait?.pid === p.id) S.portrait = { pid: p.id, ...entry };
          setTimeout(() => URL.revokeObjectURL(old), 2000);
          if (here && ticket === S.ticket && S.view === "portrait") {
            caption(pass.BACKDROP_LINE);
            setTimeout(() => ticket === S.ticket && S.view === "portrait" && caption(afterUnveil(p)), 2600);
          }
        })
        .catch((e) => {
          entry.backdrop = "failed";
          console.warn("The studio backdrop did not come out; the first portrait stays.", e);
        });
    }
  } catch (e) {
    console.error(e);
    dev.cancel(); // does nothing if another look has taken the glass since
    if (ticket !== S.ticket) return;
    caption(friendly(e));
  } finally {
    S.shooting--;
  }
}

// Studio: the piece on her, live, in the mirror.
async function studio(p) {
  mirror.touch();
  if (p.photoOnly) return caption(PHOTO_ONLY_LINE);
  if (mustJoin()) return askToJoin();
  if (!mirror.awake) return needMirror(p);
  if (!S.config.live) return caption(forShopper() ? RESTING : "Live try-on is off. Add your Decart key to the .env file and restart.");
  // At home, live video is a Private perk: it costs by the second and no store is paying for it.
  if (link.member && !link.member.tier.liveSecondsPerMonth) return (S.mode = "model"), caption("Live Studio is in MIRVA stores. At home, I'll make you a portrait."), modelShot(p);
  if (noLive()) return (S.mode = "model"), caption(NO_LIVE_LINE), modelShot(p);
  if (mirror.cameraDown) return caption(CAMERA_DOWN_LINE);
  if (fullFitting("live")) return caption(FULL_LINE);
  if (mirror.presence.known && !mirror.presence.present) return caption("Step into the mirror so I can see you.");
  if (!(await agreed())) return caption(NOT_SENT_LINE);
  const ticket = ++S.ticket;
  hidePortrait();
  const swapping = mirror.state === "live" && hasPicture();
  let wait = null;
  if (swapping) sweep(true);
  else wait = seeHerself();
  caption(line("putting"));
  syncGlass();
  // The garment starts coming the moment the tap lands, alongside the token and the connection.
  const blob = garment(p);
  blob.catch(() => {});
  try {
    await mirror.wear(p, blob);
    if (swapping) setTimeout(() => ticket === S.ticket && sweep(false), 700);
  } catch (e) {
    wait?.cancel(); // the wait this tap began ends with it, whoever has the glass now (it does nothing if another has taken it over)
    // A look taken off while it was still connecting, or one that a later tap has replaced, has nothing to report.
    if (ticket !== S.ticket || e?.message === "cancelled") return;
    console.error(e);
    sweep(false);
    S.developing?.cancel();
    // The store's live minutes for the month are used, or its plan has none: the server says so, and a portrait is made.
    if (e?.limit === "store-live" || e?.limit === "no-live") {
      if (e.limit === "no-live") S.config.studio = false;
      S.mode = "model";
      syncGlass();
      return modelShot(p);
    }
    caption(friendly(e));
    syncGlass();
    if (weakLine(e)) offerPortrait(p);
  }
}

// The line here would not carry live video: it never connected, or it dropped. A portrait needs one picture up and one
// down, so it is offered in a single tap. Only on that path: a Studio that works is never interrupted with it.
const weakLine = (e) =>
  !e?.limit && (e?.kind === "slow" || e?.name === "TimeoutError" || e?.name === "AbortError" || /network|failed to fetch|websocket|ice|timeout|connect/i.test(String(e?.message || "")));
function offerPortrait(p) {
  if (!p || p.photoOnly || !S.config.live || mirror.cameraDown || fullFitting("portrait")) return;
  const t = $("#toast");
  const go = h("button", { type: "button", text: "Portrait instead" });
  go.addEventListener("click", () => {
    t.hidden = true;
    S.mode = "model";
    syncGlass();
    modelShot(p);
  });
  t.replaceChildren(h("span", { text: "The connection here is not carrying live video." }), go);
  t.hidden = false;
  syncGlass();
}

// Why a look ended, for the reasons the stylist has no line for.
const ENDED = {
  camera: "The camera stopped, so I ended the live look.",
  hidden: "I ended the live look while this window was out of sight. Tap a look to carry on.",
  nopicture: "That didn't come through. Tap the look to try again.",
  visit: FULL_LINE,
};

function wireMirror() {
  mirror.addEventListener("awake", () => {
    forgetPortraits(); // a new picture of her makes the old portraits stale
    syncGlass();
    if (S.pending) {
      const p = S.pending;
      S.pending = null;
      choose(p);
    } else {
      caption(S.step === "looks" && S.looks.length ? "There you are. Tap a look to begin." : line("awake"));
    }
  });
  mirror.addEventListener("state", syncGlass);
  mirror.addEventListener("asleep", () => {
    S.ticket++;
    S.developing?.cancel();
    forgetPortraits();
    S.pending = null;
    $("#camLost").hidden = true;
    glass.classList.remove("blind", "has-picture");
    $("#compare").hidden = true;
    $("#hint").textContent = "";
    caption("");
    syncGlass();
  });
  mirror.addEventListener("picture", () => {
    if (!mirror.isLive) return;
    glass.classList.add("has-picture");
    S.developing?.cancel();
    syncGlass();
    renderDetail();
    if (S.unveil) {
      const p = S.unveil;
      const ticket = S.ticket;
      caption(line("wearing", p));
      setTimeout(() => ticket === S.ticket && mirror.state === "live" && caption(afterUnveil(p).replace("Keep it, or see it live.", "Turn, and see how it moves.")), 4200);
    }
    S.unveil = null;
  });
  mirror.addEventListener("wearing", ({ detail: { product } }) => {
    S.wearing = product;
    S.visit.looks++;
    link.track("live_start", { product: product.id });
    $("#wearingName").textContent = product.name;
    $("#wearingPrice").textContent = money(product.price);
    $("#wearing").hidden = false;
    markCards();
    renderDetail();
    syncGlass();
    // First look: speak when the first real frame lands. A swap inside a live
    // session has no such signal, so settle on a short timer instead.
    if (!hasPicture()) return void (S.unveil = product);
    const ticket = S.ticket;
    setTimeout(() => ticket === S.ticket && mirror.isLive && caption(line("wearing", product)), 1400);
  });
  mirror.addEventListener("queue", ({ detail }) => {
    if (!(detail?.position > 0)) return;
    // The engine reports a place and the size of the line, not a wait, so no wait is promised.
    const of = detail.queueSize >= detail.position ? ` of ${detail.queueSize}` : "";
    caption(`The studio is busy. You are number ${detail.position}${of} in line.`);
    S.developing?.queue?.(`${detail.position}${of}`);
  });
  // A dropped line is redialled by the engine. Say so quietly, and take the note away when it is back or the look has ended.
  mirror.addEventListener("link", ({ detail: { state } }) => {
    const note = $("#lineNote");
    note.textContent = state === "reconnecting" ? "The line is slow. Holding your look." : "";
    note.hidden = !note.textContent;
  });
  mirror.addEventListener("abandoned", ({ detail: { grant } }) => link.track("live_end", { value: 0, grant, meta: "failed" }));
  // A look that never got going (the token was refused, the engine did not answer, the line dropped on the way in).
  // Whatever it had begun to put on the glass goes, so the next tap starts from a clean glass.
  mirror.addEventListener("failed", () => {
    glass.classList.remove("has-picture");
    $("#toast").hidden = true;
    $("#lineNote").hidden = true;
    $("#haloArc").style.strokeDashoffset = "0";
    if (S.view !== "portrait") $("#wearing").hidden = true;
    S.wearing = null;
    S.unveil = null;
    sweep(false);
    if (S.developing?.kind === "studio") S.developing.cancel();
    syncGlass();
    markCards();
    renderDetail();
  });
  mirror.addEventListener("camera", ({ detail: { state, error } }) => {
    const lost = state === "lost";
    $("#camLost").hidden = !lost;
    glass.classList.toggle("blind", lost);
    if (lost) {
      $("#camLostText").textContent = error ? friendly(error) : "The camera stopped. Another app may be using it.";
      $("#camRetry").focus();
    } else caption(state === "restarting" ? "The camera paused. Starting it again." : "There you are.");
  });
  mirror.addEventListener("tick", ({ detail: d }) => {
    $("#meterTime").textContent = clock(d.remaining);
    $("#meterCost").textContent = `$${d.cost.toFixed(2)}`;
    $("#meter").title = `About ${money(d.cost * S.config.usdToPkr)} so far`;
    $("#haloArc").style.strokeDashoffset = String(Math.min(100, (d.elapsed / d.cap) * 100));
    // A visit's live seconds are a ceiling too: the look that crosses it ends there.
    const v = visitLimits();
    if (v?.liveSeconds && liveUsed() >= v.liveSeconds) mirror.stop("visit");
  });
  mirror.addEventListener("idle", ({ detail: { grace } }) => {
    const t = $("#toast");
    t.replaceChildren(
      h("span", { text: `Still there? I'll pause the live look in ${grace} seconds.` }),
      h("button", { type: "button", text: "Keep going", onclick: () => (mirror.touch(), (t.hidden = true)) }),
    );
    t.hidden = false;
  });
  mirror.addEventListener("presence", ({ detail: f }) => {
    $("#hint").textContent = f.known && (!f.present || f.ok === false) ? f.hint : "";
    S.developing?.hint?.($("#hint").textContent);
    syncGlass();
  });
  mirror.addEventListener("ended", ({ detail: { reason, elapsed, grant } }) => {
    const was = S.wearing;
    link.track("live_end", { value: Math.round(elapsed), grant, meta: reason });
    glass.classList.remove("has-picture");
    $("#toast").hidden = true;
    if (S.view !== "portrait") $("#wearing").hidden = true;
    $("#haloArc").style.strokeDashoffset = "0";
    $("#lineNote").hidden = true;
    S.wearing = null;
    S.unveil = null;
    sweep(false);
    if (reason !== "switch" && reason !== "reshape") {
      S.ticket++;
      S.developing?.cancel();
    }
    syncGlass();
    markCards();
    renderDetail();
    if (reason !== "reshape" && reason !== "switch") caption(ENDED[reason] || line(`ended.${reason}`) || line("ended.user"));
    if (reason === "lost" || reason === "nopicture") offerPortrait(was || S.selected);
  });
  mirror.addEventListener("fault", ({ detail }) => caption(friendly(detail)));
  mirror.addEventListener("shape", ({ detail: { shape, wearing } }) => {
    glass.dataset.shape = shape;
    frame.dataset.shape = shape;
    forgetPortraits();
    if (!wearing) S.developing?.cancel(); // it was still connecting: there is no look to bring back, so no wait to keep
    syncGlass();
    if (wearing) studio(wearing);
  });
}

// ---------- kept looks ----------
function keep() {
  const fromPortrait = S.view === "portrait" && S.portrait;
  const p = fromPortrait ? S.products.find((x) => x.id === S.portrait.pid) : S.wearing;
  if (!p || !canKeep()) return;
  const extras = chosenExtras(p).map((a) => ({ name: a.name, price: a.price, url: a.url }));
  S.mem.saved.unshift({ id: Date.now(), pid: p.id, name: p.name, price: p.price, url: p.url, extras, thumb: fromPortrait ? S.portrait.thumb : mirror.snapshot(300) });
  memory.store(S.brand.id, S.mem);
  renderSaved();
  if (fromPortrait) S.keptUrl = S.portrait.url;
  syncGlass();
  renderDetail();
  link.track("keep", { product: p.id });
  // On a member's own device the look goes straight to the wardrobe; in a store it waits for Send.
  if (link.member)
    link
      .saveLook({ brand: S.brand.id, product: p.id, size: S.mem.size || "", portrait: fromPortrait ? S.portrait.saved : null })
      .then(() => caption("Kept, and in your wardrobe."))
      .catch((e) => caption(e.message));
  caption(line("kept"));
}

function renderSaved() {
  const saved = S.mem.saved;
  $("#saved").replaceChildren(
    ...saved.map((k) =>
      h(
        "div",
        { class: "kept" },
        h(
          "button",
          {
            type: "button",
            "aria-label": `${k.name}, ${money(k.price)}. Open it again.`,
            onclick: () => {
              const p = S.products.find((x) => x.id === k.pid);
              if (p) choose(p);
            },
          },
          h("img", { src: k.thumb, alt: "" }),
        ),
        h("button", {
          class: "drop",
          type: "button",
          "aria-label": `Remove ${k.name}`,
          text: "×",
          onclick: () => {
            S.mem.saved = S.mem.saved.filter((x) => x.id !== k.id);
            memory.store(S.brand.id, S.mem);
            renderSaved();
          },
        }),
      ),
    ),
  );
  $("#compareBtn").hidden = saved.length < 2;
  $("#sendAllBtn").hidden = saved.length < 1;
}

function openCompare() {
  const [a, b] = S.mem.saved;
  if (!a || !b) return;
  const box = $("#compare");
  const fig = (k) => h("figure", {}, h("img", { src: k.thumb, alt: k.name }), h("figcaption", {}, h("b", { text: k.name }), money(k.price)));
  const close = h("button", { class: "close", type: "button", text: "Close", onclick: () => (box.hidden = true) });
  box.replaceChildren(close, fig(a), fig(b));
  box.hidden = false;
  close.focus();
}

// The store's own photograph of a piece: beside the look that is on the glass, or by itself for a piece that is
// shown in photographs only. What she compares is the real thing against the likeness.
function openPhoto(piece) {
  const worn = S.view === "portrait" && S.portrait ? S.products.find((x) => x.id === S.portrait.pid) : S.wearing;
  const p = piece || worn;
  if (!p) return;
  const box = $("#compare");
  const fig = (src, title, sub) => h("figure", {}, h("img", { src, alt: title }), h("figcaption", {}, h("b", { text: title }), sub));
  const close = h("button", { class: "close", type: "button", text: "Close", onclick: () => ((box.hidden = true), box.classList.remove("one")) });
  const mine = !piece && (S.view === "portrait" ? S.portrait?.url : hasPicture() ? mirror.snapshot(600) : null);
  box.classList.toggle("one", !mine);
  box.replaceChildren(close, fig(pic(p.image, 420), "The store's photo", p.name), mine ? fig(mine, "On you", "A likeness, not a fitting") : null); // the size the look card has already loaded
  box.hidden = false;
  close.focus();
  link.track("compare", { product: p.id });
}

async function openSend(items) {
  const list = items.filter((x, i, all) => all.findIndex((y) => (y.pid || y.id) === (x.pid || x.id)) === i).slice(0, 6);
  if (!list.length) return;
  const rows = list.flatMap((x) => [x, ...(x.extras || [])]);
  const text = [`My looks from ${S.brand.name}, styled by MIRVA:`, ...rows.map((x) => `• ${x.name}, ${money(x.price)}\n${x.url}`)].join("\n");
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(text)}`;
  // The code opens her MIRVA wardrobe with these looks waiting in it. If the platform is out of reach, it falls back to WhatsApp.
  let target = whatsapp;
  try {
    target = (await link.handoff(S.brand.id, list.map((x) => ({ product: x.pid || x.id, size: S.mem.size || "" })))).url;
    link.track("send", { value: list.length });
  } catch {}
  $("#sendCopy").textContent = target === whatsapp ? "Scan to open WhatsApp with these looks. Send them to yourself or to family." : "Scan with your phone. These looks open in your MIRVA wardrobe, ready when you get home.";
  const { default: QRCode } = await import("qrcode");
  await QRCode.toCanvas($("#qr"), target, { width: 240, margin: 1, errorCorrectionLevel: "L" });
  $("#sendList").replaceChildren(...rows.map((x) => h("li", {}, h("b", { text: x.name }), `  ${money(x.price)}`)));
  $("#sendLink").href = whatsapp;
  $("#send").showModal();
}

// ---------- counted at the store: a sale, and a size ----------
const SOLD_BY = "mirva:sold-by";
function openSold(p, total) {
  $("#soldCopy").textContent = p.name;
  $("#soldAmount").value = String(Math.round(total));
  try {
    $("#soldBy").value = localStorage.getItem(SOLD_BY) || "";
  } catch {}
  $("#soldForm").onsubmit = (e) => {
    e.preventDefault();
    const amount = Math.round(Number(String($("#soldAmount").value).replace(/[^\d.]/g, "")));
    if (!(amount > 0)) return $("#soldAmount").focus();
    const by = $("#soldBy").value.trim().slice(0, 40);
    try {
      localStorage.setItem(SOLD_BY, by);
    } catch {}
    link.track("sale", { product: p.id, value: amount, meta: by || undefined });
    link.flush?.();
    $("#sold").close();
    caption(`Counted: ${money(amount)}${by ? `, with ${by}` : ""}.`);
  };
  $("#sold").showModal();
}

// Her size on this store's own chart, from two measurements. Outside the chart, MIRVA says so and does not guess.
function openSizer() {
  const had = S.mem.measure || {};
  $("#sizerChest").value = had.chest || "";
  $("#sizerWaist").value = had.waist || "";
  $("#sizerMsg").textContent = "";
  $("#sizerForm").onsubmit = (e) => {
    e.preventDefault();
    const chest = Number($("#sizerChest").value), waist = Number($("#sizerWaist").value) || 0;
    if (!(chest >= 20 && chest <= 70)) return ($("#sizerMsg").textContent = "Chest in inches, between 20 and 70.");
    const label = sizeFor(S.brand.sizeChart, { chest, waist });
    if (!label) return ($("#sizerMsg").textContent = "That is outside this store's chart. Ask the staff to measure you.");
    S.mem.measure = { chest, waist: waist || undefined };
    S.mem.size = label;
    memory.store(S.brand.id, S.mem);
    link.track("size_pick", { meta: label });
    $("#sizer").close();
    caption(`On ${S.brand.name}'s chart you are ${label}.`);
    renderDetail();
  };
  $("#sizer").showModal();
}

// ---------- catalogue tab ----------
function renderCatalogue() {
  const lanes = ["all", ...new Set(S.products.map((p) => p.lane))];
  $("#lanes").replaceChildren(
    ...lanes.map((l) => chip(l === "all" ? "Everything" : LANES[l] || l, () => ((S.lane = l), renderCatalogue()), S.lane === l ? "on" : "")),
  );
  const items = S.products.filter((p) => S.lane === "all" || p.lane === S.lane);
  $("#grid").replaceChildren(...items.map((p) => lookCard(p)));
  markCards();
}

function showTab(name) {
  for (const b of $$(".tabs button")) {
    const on = b.dataset.tab === name;
    b.classList.toggle("on", on);
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  }
  $("#foryou").hidden = name !== "foryou";
  $("#catalogue").hidden = name !== "catalogue";
}

// ---------- the next shopper ----------
// "Start over". In a store it is the next shopper: nothing of the last one stays on the glass, and the visit's count
// starts again. The mirror does the same by itself when nobody has been in front of it, or touched it, for a while.
function startOver() {
  S.ticket++; // whatever was still being made for the last shopper is dropped, not shown to the next
  S.developing?.cancel();
  if (link.pairedTo()) {
    if (mirror.isLive) mirror.stop("user");
    forgetPortraits();
    S.mem = memory.load(S.brand.id);
    S.extras.clear();
    S.mode = null;
    S.pending = null;
    S.agreed = false;
    S.lane = "all";
    renderSaved();
    renderCatalogue();
    $("#compare").hidden = true;
    $("#toast").hidden = true;
    $("#askInput").value = "";
  }
  showTab("foryou");
  startConversation(); // also starts the visit's count again
  if (link.pairedTo() && mirror.awake) caption(line("awake"));
}

// Has anything been done at this mirror that the next shopper should not find?
const used = () =>
  S.mem.saved.length || S.portraits.size || S.extras.size || S.mode || S.selected || S.step !== "occasion" || S.view === "portrait" || mirror.isLive || S.visit.looks || S.visit.portraits || $("#askInput").value;

function resetByItself() {
  const secs = visitLimits()?.resetSeconds;
  if (!link.pairedTo() || !secs || !mirror?.awake || mirror.cameraDown || document.hidden) return;
  // Only when the pose check knows nobody is there, and nothing has been touched, for the whole time.
  if (!mirror.presence.known || mirror.presence.present) return;
  const now = performance.now();
  if (now - mirror.lastTouch < secs * 1000 || now - mirror.lastSeen < secs * 1000) return;
  if (document.querySelector("dialog[open]") || !$("#compare").hidden) return;
  if (!used()) return;
  startOver();
}

// ---------- which store ----------
// Anywhere but a store's own mirror, the shopper chooses whose rails she is looking at: asked once when the mirror
// opens (unless a link named the store), and one tap away afterwards.
const STORE_CHOSEN = "mirva:store-chosen";
const WHO = { men: "Menswear", women: "Womenswear" };
async function openStores() {
  let brands;
  try {
    brands = await api("/api/brands");
  } catch (e) {
    return caption(friendly(e));
  }
  const last = memory.lastBrand.get();
  // the store that is open first, then the one from last time, then the rest as the list has them
  const rank = (b) => (b.id === S.brand?.id ? 0 : b.id === last ? 1 : 2);
  brands = brands.map((b, i) => [b, i]).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map(([b]) => b);
  $("#storeList").replaceChildren(
    ...brands.map((b) =>
      h(
        "button",
        {
          class: `store-card${b.id === S.brand?.id ? " on" : ""}`,
          type: "button",
          onclick: async () => {
            try {
              sessionStorage.setItem(STORE_CHOSEN, "1");
            } catch {}
            $("#stores").close();
            if (b.id !== S.brand?.id) await loadBrand(b.id).catch((e) => caption(friendly(e)));
          },
        },
        h("span", { class: "store-shots" }, (b.cover || []).slice(0, 3).map((u) => h("img", { src: pic(u, 240), alt: "", decoding: "async" }))),
        h(
          "span",
          { class: "store-meta" },
          b.id === S.brand?.id ? h("em", { text: "Open now" }) : b.id === last ? h("em", { text: "Last time" }) : null,
          h("b", { text: b.name }),
          h("span", { text: [b.tagline || WHO[b.audience] || "", `${b.count} pieces`].filter(Boolean).join(" · ") }),
        ),
      ),
    ),
  );
  $("#stores").showModal();
}

// ---------- adapt sheet ----------
async function openAdapt() {
  const brands = await api("/api/brands");
  $("#brandList").replaceChildren(
    ...brands.map((b) =>
      h(
        "button",
        {
          class: `chip brand-pick${b.id === S.brand.id ? " on" : ""}`,
          type: "button",
          onclick: async () => {
            $("#adapt").close();
            await loadBrand(b.id);
          },
        },
        h("i", { style: `background:${b.accent}` }),
        `${b.name} · ${b.count}`,
      ),
    ),
  );
  const cams = mirror.awake ? await mirror.cameras().catch(() => []) : [];
  const sel = $("#cameraSelect");
  sel.replaceChildren(...cams.map((c) => h("option", { value: c.id, text: c.label, selected: c.id === mirror.deviceId })));
  $("#cameraRow").hidden = cams.length < 1;
  const info = mirror.sourceInfo();
  $("#cameraInfo").textContent = info
    ? `${info.kind === "photo" ? "Using a photo" : "Camera"}: ${info.width} × ${info.height}. ${info.height < 700 && info.kind === "camera" ? "This camera is soft; the looks will be too. An external webcam or a phone used as a webcam will look much better." : ""}`
    : "Turn the mirror on to choose a camera.";
  $("#fastToggle").checked = mirror.fast;
  const c = S.config;
  const used = mirror.totalSeconds;
  $("#liveInfo").textContent = c.live
    ? `A Model portrait costs about $${c.shotPrice.toFixed(2)}. Studio costs $${c.ratePerSecond.toFixed(2)} a second (about ${S.brand.currency}${(c.ratePerSecond * c.usdToPkr).toFixed(1)}), ` +
      `is capped at ${clock(c.sessionSeconds)} a session by the server, and pauses after ${c.idleSeconds} seconds without a tap or when nobody is in the mirror. ` +
      `This sitting: ${clock(used)} live, $${(used * c.ratePerSecond).toFixed(2)}.`
    : "Try-on is off. Add DECART_API_KEY to the .env file and restart the server.";
  $("#importMsg").textContent = "";
  $("#adapt").showModal();
}

// ---------- wiring ----------
function wireUI() {
  $("#wakeBtn").addEventListener("click", async () => {
    const btn = $("#wakeBtn");
    btn.disabled = true;
    caption("Waking the mirror.");
    try {
      await mirror.startCamera();
    } catch (e) {
      console.error(e);
      caption(friendly(e));
    } finally {
      btn.disabled = false;
    }
  });
  $("#camRetry").addEventListener("click", () => mirror.retryCamera());
  $("#photoBtn").addEventListener("click", () => $("#photoInput").click());
  $("#photoInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await mirror.usePhoto(file);
    } catch {
      caption("I couldn't read that photo. Try a JPEG or PNG.");
    }
  });
  for (const b of $$("#modes button")) b.addEventListener("click", () => setMode(b.dataset.mode));
  $("#keepBtn").addEventListener("click", keep);
  $("#offBtn").addEventListener("click", () => {
    if (S.view === "portrait") {
      hidePortrait();
      caption(line("ended.user"));
    } else mirror.stop("user");
  });
  $("#shapeBtn").addEventListener("click", () => mirror.setShape(mirror.shape === "portrait" ? "landscape" : "portrait"));
  $("#restartBtn").addEventListener("click", startOver);
  $("#photoPeek").addEventListener("click", () => openPhoto());
  $("#camBtn").addEventListener("click", () => mirror.sleep());
  $("#compareBtn").addEventListener("click", openCompare);
  $("#sendAllBtn").addEventListener("click", () => openSend(S.mem.saved));
  $("#adaptBtn").addEventListener("click", openAdapt);
  $("#storeBtn").addEventListener("click", openStores);
  for (const b of $$(".tabs button")) b.addEventListener("click", () => showTab(b.dataset.tab));
  $(".tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = $$(".tabs button");
    const next = tabs[(tabs.findIndex((t) => t.classList.contains("on")) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    showTab(next.dataset.tab);
    next.focus();
  });

  $("#ask").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#askInput");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    showTab("foryou");
    const r = parseAsk(text, S.products);
    if (!r.understood) return say(line("unsure"));
    if (r.patch.occasion && r.patch.occasion !== S.brief.occasion) S.brief.formalityShift = 0;
    const whoChanged = r.patch.who && r.patch.who !== S.brief.who;
    Object.assign(S.brief, r.patch);
    if (r.refine && S.step === "looks" && !whoChanged) return refine(r.refine);
    if (Object.keys(r.patch).length) S.shown = new Set();
    suggest();
  });

  for (const b of $$("[data-mood-set]")) b.addEventListener("click", () => (document.documentElement.dataset.mood = b.dataset.moodSet));
  $("#accentInput").addEventListener("input", (e) => setAccent(e.target.value));
  $("#fastToggle").addEventListener("change", (e) => (mirror.fast = e.target.checked));
  $("#cameraSelect").addEventListener("change", async (e) => {
    try {
      if (mirror.isLive) mirror.stop("user");
      await mirror.startCamera(e.target.value);
    } catch (err) {
      $("#cameraInfo").textContent = friendly(err);
    }
  });
  $("#importForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#importMsg");
    msg.textContent = "Reading the catalogue…";
    try {
      const { id, name } = await api("/api/brands/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: $("#importInput").value }),
      });
      msg.textContent = `${name} is in.`;
      $("#importInput").value = "";
      $("#adapt").close();
      await loadBrand(id);
    } catch (err) {
      msg.textContent = err.message;
    }
  });

  // Any touch counts as "still here" for the live-session idle timer.
  for (const type of ["pointerdown", "keydown"]) document.addEventListener(type, () => mirror.touch(), { passive: true });
  document.addEventListener("keydown", (e) => e.key === "Escape" && ($("#compare").hidden = true));
  window.addEventListener("pagehide", () => (mirror.stop("user"), link.flush(true)));
}

// On a member's own device the mirror says whose it is and how many portraits are left this month.
function showMember(me) {
  const node = $("#memberLine");
  if (!me) return void (node.hidden = true);
  const left = Math.max(0, me.tier.portraitsPerMonth - me.usage.portraits);
  node.replaceChildren(
    `${me.user.name.split(" ")[0]}'s mirror. ${left} of ${me.tier.portraitsPerMonth} portraits left this month. `,
    h("a", { class: "tap", href: "/account", text: "Your wardrobe" }),
    " ",
    h("button", { class: "tap", type: "button", text: "Sign out", onclick: signOut }),
  );
  node.hidden = false;
}

// The mirror then opens as anyone's: the member's name and portrait count are gone with the sign-in.
async function signOut() {
  try {
    await api("/api/auth/signout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  } catch (e) {
    return caption(e.message);
  }
  location.reload();
}

// Nothing to wear yet: no store has opened its mirror at this address.
function noStore() {
  say("No store has opened its mirror here yet.");
  $("#chips").replaceChildren(h("a", { class: "chip", href: "/retail#yours", text: "I run a store" }), h("a", { class: "chip", href: "/", text: "What MIRVA is" }));
  $("#ask").hidden = true;
  $("#wakeBtn").disabled = true;
}

async function boot() {
  S.config = await api("/api/config");
  // MIRVA's own mirror is an oval. A store's paired mirror is told so by its console; "?glass=oval" shows it on any screen.
  if (S.config.glass === "oval" || new URLSearchParams(location.search).get("glass") === "oval") document.documentElement.dataset.glass = "oval";
  mirror = new Mirror({ cam: $("#cam"), live: $("#live"), config: S.config });
  mirror.auth = link.auth; // so a live session is billed to the right mirror or member
  // An uploaded photo is shown from the mirror's own canvas, not through the video the camera uses: on some phones a
  // video fed by a canvas shows nothing when the picture never changes, and the glass stayed empty under "There you are".
  mirror.canvas.id = "still";
  mirror.canvas.setAttribute("aria-label", "Your photo");
  $("#cam").after(mirror.canvas);
  wireMirror();
  wireUI();
  // The pose model blocks the page for a few seconds the first time it runs. Spend them while the
  // shopper is still reading the wake screen, so the camera never freezes under her afterwards.
  if (!navigator.connection?.saveData) setTimeout(warmUp, 1500);
  const brands = await api("/api/brands");
  // A store's console can pair this screen (…/mirror?pair=CODE) and a link can name the store (…/mirror?brand=id).
  const query = new URLSearchParams(location.search);
  let paired = "";
  if (query.get("pair")) {
    try {
      paired = (await link.pair(query.get("pair"))).name;
    } catch (e) {
      paired = "!" + e.message;
    }
  }
  // The server tells a store mirror what one visit may use, and it could not know this screen was one when it was asked.
  if (paired && !paired.startsWith("!")) Object.assign(S.config, await api("/api/config").catch(() => ({})));
  const want = query.get("brand") || link.pairedTo()?.brand || memory.lastBrand.get();
  // A store loaded from a link is not on the public list, so the link's own id is tried before any fallback.
  const linked = want && !brands.some((b) => b.id === want) ? await api(`/api/brands/${want}`).then(() => want, () => "") : "";
  const first = { id: brands.find((b) => b.id === want)?.id || linked || brands.find((b) => b.id === "sapphire")?.id || brands[0]?.id };
  const named = !!query.get("brand") && first.id === query.get("brand");
  if (query.has("pair") || query.has("brand") || query.has("for")) history.replaceState(null, "", location.pathname);
  showMember(await link.whoIsHere());
  memory.setStoreMirror(!!link.pairedTo());
  memory.setOwner(link.member?.user.id);
  document.body.classList.toggle("shopper", forShopper()); // hides the cost meter and the Adapt sheet
  if (noLive()) $('#modes [data-mode="studio"] span').textContent = "With a MIRVA mirror";
  if (!first.id) return noStore();
  await loadBrand(first.id);
  // "See them on you" on the home page names the occasion the reader chose there: the conversation carries on from it.
  const occasion = OCCASIONS.find((o) => o.id === query.get("for"));
  if (occasion) {
    S.brief.occasion = occasion.id;
    S.step = "mood";
    say(line("mood"));
    renderConversation();
  }
  syncGlass();
  // A paired mirror belongs to one store. Anywhere else the shopper chooses: the store's name heads the tablet with a
  // way to change it, and the picker opens by itself the first time, unless a link has already named the store.
  const choice = !link.pairedTo() && brands.length > 1;
  $("#storeBar").hidden = !choice;
  let chosen = named;
  try {
    chosen ||= !!sessionStorage.getItem(STORE_CHOSEN);
    if (named) sessionStorage.setItem(STORE_CHOSEN, "1");
  } catch {}
  if (choice && !chosen) openStores();
  if (paired) caption(paired.startsWith("!") ? paired.slice(1) : `This screen is now the mirror "${paired}".`);
  window.mirva = { S, mirror, visitLimits }; // a handle for the console while this is a prototype
  // On a phone the ask bar docks at the bottom of the screen once the glass has scrolled away (see styles.css).
  if ("IntersectionObserver" in window)
    new IntersectionObserver(([e]) => document.body.classList.toggle("glass-away", e.intersectionRatio < 0.5), { threshold: [0, 0.25, 0.5, 0.75, 1] }).observe(glass);
  setInterval(resetByItself, 1000);
  setInterval(unstick, 1000);
}

// The last safety net. A "being made" wait over the glass hides the controls under it, so one that outlives the work it
// stands for would leave the mirror unable to start the next look. Each way that can happen is closed where it happens;
// this closes one that nobody foresaw, after three quiet seconds.
let quiet = 0;
function unstick() {
  const stuck = S.developing && !mirror.isLive && !S.shooting;
  quiet = stuck ? quiet + 1 : 0;
  if (quiet < 3) return;
  quiet = 0;
  console.warn("A wait on the glass had nothing left to wait for; it was cleared.");
  S.developing.cancel();
}

addEventListener("offline", () => caption("The connection dropped. Portraits and live looks will wait until it's back."));
addEventListener("online", () => caption("Back online. Tap a look to carry on."));

boot().catch((e) => {
  console.error(e);
  $("#say").textContent = "MIRVA could not start. Is the server running?";
});
