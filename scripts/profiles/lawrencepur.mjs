// Lawrencepur's catalogue, read the way its own pages put it. Used by scripts/snapshot-shopify.mjs:
//
//   node scripts/snapshot-shopify.mjs lawrencepur.com --profile lawrencepur
//
// What the store says is kept as it says it (names, prices, sizes, colours, cloth). What MIRVA adds is only how the
// stylist should group a piece (lane, formality, tradition) and the plain sentence that asks the engine for it.
// Nothing is invented: where the store's text does not say a cloth, a pattern or a detail, the field stays empty.
import { colourFamily } from "../../src/stylist.js";

export const HANDLES = [
  "men-classic-suits",
  "men-3-pc-suits",
  "double-breasted-blazers",
  "men-classic-blazers",
  "men-waistcoats",
  "classic-waist-coats",
  "mens-shalwar-kameez-traditional-festive-wear",
];

// The small things that finish a look, from the store's own accessory shelves.
export const ADDON_SHELVES = [
  { handle: "men-accessories-tie", kind: "tie" },
  { handle: "men-accessories-pocket-square", kind: "pocketsquare" },
  { handle: "belts", kind: "belt" },
  { handle: "men-wallets", kind: "wallet" },
  { handle: "premium-cotton-socks-for-men", kind: "socks" },
  { handle: "men-formal-trousers", kind: "bottoms" },
];

// How many of each to keep, and what was set aside after looking at the photographs (see the report in
// brands/lawrencepur: a piece whose photograph is not a clean front view of one garment is left out).
const CAPS = { suit2: 22, suit3: 8, blazer: 14, waistcoat: 10, kameez: 12 };
const ADDON_CAPS = { tie: 8, pocketsquare: 6, belt: 4, wallet: 4, socks: 3, bottoms: 6 };
const EXCLUDE = new Set([
  "8930878128385", // Deep Green two-piece: every photograph is a close-up or the back
  "7914312663297", // Black Tweed blazer: worn over a black polo neck, which would be copied with it
  "9131954995457", // Black Double Breasted blazer: shot among office furniture
  "8650566074625", // Tabriz White shalwar kameez: a folded shirt on a table, not worn
  "8650566795521", // Classic Cotton White shalwar kameez: the same
  "8916816298241", // Grey Checked two-piece (Bellini): a hand at the collar in the one full-length photograph; the others are close-ups
  "8725051834625", // Maroon two-piece: walking through a room in sunglasses, and a side-on portrait
  "7742196973825", // Black Serge blazer: the office-furniture set again
  "8776264220929", // Featherlight "Black" blazer: the photograph is a blue-grey striped jacket on a mannequin, not black
  "8609840693505", // Khaki Kashghar shalwar kameez: the pose is not found in any of its photographs, only the trousers are left
  "8689914282241", // Black Checks two-piece: its only photograph is posed in front of a window and a vase of flowers
  "9252757635329", // Black Plain two-piece (25,540): arm across the chest and a hand at the collar in every full-length photograph
]);
// Which of the store's photographs shows the garment best (0 = the first one, the default).
const IMAGE_AT = {
  "9130505601281": 1, // Dedum Grey two-piece: the first photograph has a hand at the tie
  "8667572338945": 3, // Sharda White shalwar kameez: the first photograph has a hand on the placket
  "9147198439681": 2, // Boski Edition: the first photographs are in front of a patterned rug, the third is plain
};

// ---------- words ----------
const tidyName = (t) =>
  String(t || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2") // the store sometimes runs two words together: "ChecksGraphite"
    .replace(/\s+/g, " ")
    .trim();

const BASE = new Set(
  "black white grey gray blue brown green beige cream ivory navy maroon burgundy red purple pink yellow tan khaki camel camal silver gold orange buff sand mehndi peach teal olive mustard plum wine coffee caramel chocolate espresso umber peanut tortilla gingerbread taupe ecru fawn rust skin indigo charcoal graphite slate ferozi pista lilac mauve aqua mint sage copper bronze cherry prussian peacock zinc".split(" "),
);
const MODIFIER = new Set("light dark mid medium deep dk sky royal iron steel bluish brownish soft cadet dusty storm warm golden burnished pale bright denim french hawaiian off".split(" "));

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s&-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** The colour as the store's title says it ("Graphite Grey", "Chocolate Brown"), else its Color option. */
function colourOf(title, option) {
  const tokens = String(title)
    .replace(/[’']s\b/g, "")
    .split(/[\s,.:;()\-–/]+/)
    .filter(Boolean);
  const runs = [];
  let run = [];
  const flush = () => {
    if (run.some((t) => BASE.has(t.toLowerCase()))) runs.push(run.join(" "));
    run = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i].toLowerCase();
    if (BASE.has(w) || MODIFIER.has(w)) run.push(tokens[i]);
    else if (w === "&" && run.length && (BASE.has((tokens[i + 1] || "").toLowerCase()) || MODIFIER.has((tokens[i + 1] || "").toLowerCase()))) run.push("&");
    else flush();
  }
  flush();
  const opt = String(option || "").replace(/^sky\s*blue$/i, "Sky Blue").trim();
  const optWord = opt.toLowerCase().split(/\s+/).pop();
  const hit = (optWord && runs.find((r) => r.toLowerCase().includes(optWord))) || runs[0];
  if (hit) return titleCase(hit);
  return /^(multi|)$/i.test(opt) ? "" : titleCase(opt);
}

const PATTERNS = [
  [/glen plaid/i, "glen plaid"],
  [/windowpane/i, "windowpane check"],
  [/houndstooth/i, "houndstooth"],
  [/herringbone/i, "herringbone"],
  [/bird ?eye/i, "bird's-eye"],
  [/criss cross/i, "criss-cross textured"],
  [/stripe/i, "striped"],
  [/check|plaid/i, "checked"],
  [/textured|texture/i, "textured"],
];
const patternOf = (t) => PATTERNS.find(([re]) => re.test(t))?.[1] || "";
const PATTERNED = /check|windowpane|houndstooth|herringbone|plaid|stripe|bird ?eye|criss cross|textured|glen/i;

// The store's cloth, as it names it. Only what the title says.
const QUALIFIER = /(Wool Rich|Poly Wool|Wool Blend|Merino Wool|S-?100'?s Pure Wool|Pure Wool)/i;
const LINE =
  /(Tropical Classic|Tropical Exclusive|Worsted Tweed|Signature Tweed|Superior Serge(?: Super \d+['’]?s)?|Bellini Super \d+['’]?s|Gaberdine(?: Super \d+['’]?s)?|Featherlight|Featherlite(?: Super \d+['’]?s)?|Premium Linen|Poly Linen|Linwool|Kashghar(?: Plus)?|Dedum|Florence|Exotic Black|Woolen Fleece|Poly Viscose|Egyptian Cotton|Classic Cotton|Boski|Wash (?:&|N|and) Wear)/i;
function fabricOf(title) {
  const line = String(title).match(LINE)?.[1];
  const qual = String(title).match(QUALIFIER)?.[1];
  if (!line && !qual) return "";
  return [qual, line].filter(Boolean).map((s) => s.replace(/Wash N Wear|Wash and Wear|Wash & Wear/i, "Wash & Wear")).join(" ");
}

// The cloth as it looks, for the sentence that asks the engine for it.
function materialOf(title) {
  const t = String(title);
  const out = [];
  if (/tweed/i.test(t)) out.push("tweed");
  else if (/linen|linwool/i.test(t)) out.push("linen");
  else if (/serge/i.test(t)) out.push("serge");
  else if (/flannel/i.test(t)) out.push("flannel");
  else if (/fleece/i.test(t)) out.push("fleece");
  else if (/gaberdine/i.test(t)) out.push("gaberdine");
  else if (/cotton/i.test(t)) out.push("cotton");
  else if (/boski/i.test(t)) out.push("boski");
  else if (/wool rich/i.test(t)) out.push("wool-rich");
  else if (/poly wool|wool blend/i.test(t)) out.push("wool-blend");
  else if (/merino/i.test(t)) out.push("merino wool");
  return out.join(" ");
}

const NUM = ["", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const text = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// What the garment's own text states about the front of it (and nothing the style options leave open).
function detailsOf(kind, title, body) {
  const t = text(body);
  const out = [];
  const doubleBreasted = /double[- ]breasted/i.test(title);
  if (kind === "blazer" && !doubleBreasted) {
    const buttons = [...t.matchAll(/(\d)\s*(?:front\s*)?buttons?(?!\s*(?:on|at|in)\s*(?:the\s*)?sleeves?)/gi)].find((m) => !/sleeve/i.test(t.slice(m.index, m.index + m[0].length + 18)));
    if (buttons && NUM[Number(buttons[1])]) out.push(`${NUM[Number(buttons[1])]} buttons`);
    if (/pockets? with flaps?/i.test(t) || /flap pockets?/i.test(t)) out.push("flap pockets");
  }
  if (kind === "waistcoat") {
    const b = t.match(/(\d)\s*buttons?/i);
    if (b && NUM[Number(b[1])]) out.push(`${NUM[Number(b[1])]} buttons`);
  }
  return out;
}

// ---------- sizes ----------
const LETTER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL"];
const weight = (label) => {
  const i = LETTER.indexOf(label.toUpperCase());
  return i >= 0 ? 1000 + i : Number.parseInt(label, 10) || 0;
};
function sizesOf(raw) {
  const at = raw.options.findIndex((o) => /^size$/i.test(o.name));
  if (at < 0) return [];
  const sizes = new Map();
  for (const v of raw.variants) {
    const label = String(v[`option${at + 1}`] || "").trim();
    if (!label) continue;
    sizes.set(label, sizes.get(label) || !!v.available);
  }
  // A suit is sold as jacket size and trouser size ("48/34"); a lone number in that list is a slip in the store's data.
  const paired = [...sizes.keys()].some((l) => l.includes("/"));
  return [...sizes]
    .filter(([label]) => !paired || label.includes("/"))
    .map(([label, inStock]) => ({ label, inStock }))
    .sort((a, b) => weight(a.label) - weight(b.label));
}
const stock = (p) => (p.sizes.length ? p.sizes.filter((s) => s.inStock).length / p.sizes.length : 0);

// ---------- what each piece is ----------
function kindOf(raw) {
  const type = raw.product_type;
  const title = raw.title;
  if (/ladies|women/i.test(`${title} ${raw.tags.join(" ")}`)) return null;
  if (type === "3Pcs Suit") return "suit3";
  if (type === "2Pc Suit" || type === "Suit") return "suit2";
  if (type === "Jacket" && /blazer/i.test(title)) return "blazer";
  if (type === "Waist Coat") return "waistcoat";
  if (type === "Shalwar Kameez") return "kameez";
  return null;
}

function cutOf(kind, title, body) {
  const db = /double[- ]breasted/i.test(title);
  if (kind === "suit2") return db ? "double-breasted two-piece suit" : "two-piece suit";
  if (kind === "suit3") return "three-piece suit";
  if (kind === "blazer") return db ? "double-breasted blazer" : /classic blazer/i.test(title) ? "classic blazer" : "blazer";
  if (kind === "waistcoat") return /ban(?:d)? collar/i.test(text(body)) ? "ban-collar waistcoat" : "waistcoat";
  return "shalwar kameez";
}

function formalityOf(kind, title, price) {
  const patterned = PATTERNED.test(title);
  if (kind === "suit3") return 5;
  if (kind === "suit2") return /double[- ]breasted/i.test(title) ? 4.5 : patterned ? 3.5 : 4;
  if (kind === "blazer") return /linen|featherl/i.test(title) ? 2.5 : /double[- ]breasted|formal blazer/i.test(title) ? 3.5 : 3;
  if (kind === "waistcoat") return patterned ? 3 : 3.5; // a layer over a shirt or kameez, smart rather than the main event
  return /boski edition/i.test(title) ? 4.5 : price >= 15000 ? 4 : price >= 11000 ? 3.5 : 2.5;
}

const LANE = { suit2: "suits", suit3: "suits", blazer: "blazers", waistcoat: "waistcoats", kameez: "eastern" };
// A suit is western tailoring and a shalwar kameez is eastern. The store files its waistcoats under "Eastern" (they are
// worn over a kameez), and a blazer is the piece worn on either side, over a kurta or with trousers: the "somewhere
// between" of the stylist's three moods.
const TRADITION = { suit2: "west", suit3: "west", blazer: "fusion", waistcoat: "east", kameez: "east" };

/** The one sentence that says what the garment is, in the words the engine needs and nothing the store did not say. */
function describe(kind, { colour, pattern, material, cut, details, doubleBreasted }) {
  const look = [colour.toLowerCase(), pattern, material].filter(Boolean).join(" ");
  const named = `${look} ${cut}`.replace(/\s+/g, " ").trim();
  if (kind === "suit2") return `${named} with a ${doubleBreasted ? "double-breasted " : ""}jacket and matching trousers`;
  if (kind === "suit3") return `${named} with a jacket, matching waistcoat and trousers`;
  if (kind === "kameez") return `${named}, a kameez shirt with matching shalwar`;
  return details.length ? `${named} with ${details.join(" and ")}` : `${named}, worn over a shirt`;
}

function enrich(item, raw) {
  const kind = kindOf(raw);
  if (!kind || EXCLUDE.has(item.id)) return null;
  if (!raw.variants.some((v) => v.available)) return null;
  const name = tidyName(raw.title);
  const colourOption = raw.options.find((o) => /colou?r/i.test(o.name))?.values?.[0];
  const colour = colourOf(name, colourOption);
  const cut = cutOf(kind, name, raw.body_html);
  const doubleBreasted = /double[- ]breasted/i.test(name);
  const pattern = patternOf(name);
  const material = materialOf(name);
  const details = detailsOf(kind, name, raw.body_html);
  const images = item.images.length ? item.images : [item.image];
  const at = Math.min(IMAGE_AT[item.id] || 0, images.length - 1);
  const ordered = [images[at], ...images.filter((_, i) => i !== at)];
  return {
    id: item.id,
    name,
    price: item.price,
    url: item.url,
    image: ordered[0],
    images: ordered,
    season: "Ready to wear",
    lane: LANE[kind],
    formality: formalityOf(kind, name, item.price),
    tradition: TRADITION[kind],
    gender: "men",
    unstitched: false,
    cut,
    colour,
    fabric: fabricOf(name),
    description: describe(kind, { colour, pattern, material, cut, details, doubleBreasted }),
    sizes: sizesOf(raw),
    kind,
  };
}

/** A varied handful: spread over colours and cloths, in-stock pieces first. Same input, same answer. */
function varied(list, n) {
  const pool = [...list].sort((a, b) => stock(b) - stock(a) || String(a.id).localeCompare(String(b.id)));
  const out = [];
  const used = { colour: {}, fabric: {}, pattern: {} };
  while (out.length < n && pool.length) {
    let best = 0;
    let top = -Infinity;
    pool.forEach((p, i) => {
      const c = colourFamily(p.colour);
      const s = stock(p) * 2 - (used.colour[c] || 0) * 1.6 - (used.fabric[p.fabric || "-"] || 0) * 1.1 - i * 0.01;
      if (s > top) (top = s, (best = i));
    });
    const [p] = pool.splice(best, 1);
    used.colour[colourFamily(p.colour)] = (used.colour[colourFamily(p.colour)] || 0) + 1;
    used.fabric[p.fabric || "-"] = (used.fabric[p.fabric || "-"] || 0) + 1;
    out.push(p);
  }
  return out;
}

function select(items) {
  // One of each name: the store lists the same piece twice now and then.
  const seen = new Map();
  for (const p of items) {
    const key = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!seen.has(key) || stock(p) > stock(seen.get(key))) seen.set(key, p);
  }
  const unique = [...seen.values()];
  const keep = [];
  for (const kind of Object.keys(CAPS)) keep.push(...varied(unique.filter((p) => p.kind === kind), CAPS[kind]));
  return keep.map(({ kind, ...p }) => p);
}

function addon(item, raw, kind) {
  if (!raw.variants.some((v) => v.available)) return null;
  const name = tidyName(raw.title);
  return { id: item.id, name, price: item.price, url: item.url, image: item.image, kind, gender: "men", colour: colourOf(name, raw.options.find((o) => /colou?r/i.test(o.name))?.values?.[0]).toLowerCase() };
}

function selectAddons(list) {
  const out = [];
  for (const kind of Object.keys(ADDON_CAPS)) {
    const names = new Set();
    const of = list.filter((a) => a.kind === kind && !names.has(a.name) && names.add(a.name));
    const used = {};
    while (out.filter((a) => a.kind === kind).length < ADDON_CAPS[kind] && of.length) {
      let best = 0;
      let top = -Infinity;
      of.forEach((a, i) => {
        const s = -(used[colourFamily(a.colour)] || 0) * 1.5 - i * 0.01;
        if (s > top) (top = s, (best = i));
      });
      const [a] = of.splice(best, 1);
      used[colourFamily(a.colour)] = (used[colourFamily(a.colour)] || 0) + 1;
      out.push(a);
    }
  }
  return out;
}

export default { brandId: "lawrencepur", handles: HANDLES, addons: ADDON_SHELVES, enrich, select, addon, selectAddons };
