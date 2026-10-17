// MIRVA's stylist. Rules, not a language model: the prototype has to be honest about
// facts (price, size, stock come straight from the catalogue) and cost nothing to think.
// A language model can replace parseAsk() and the wording later without touching the rest.

export const OCCASIONS = [
  { id: "wedding", label: "A wedding", formality: 5, words: ["wedding", "shaadi", "shadi", "barat", "baraat", "walima", "valima", "mehndi", "mehendi", "mayun", "nikah", "nikkah", "engagement", "reception"] },
  { id: "eid", label: "Eid", formality: 4.2, words: ["eid", "festive", "festival", "chand raat", "chaand raat"] },
  { id: "dinner", label: "A dinner", formality: 3.6, words: ["dinner", "party", "date", "dawat", "daawat", "birthday", "evening", "night out"] },
  { id: "work", label: "Work", formality: 3, words: ["work", "office", "meeting", "interview"] },
  { id: "everyday", label: "Everyday", formality: 2, words: ["everyday", "every day", "casual", "daily", "home", "brunch", "lunch"] },
  // Casual days. Their pieces cluster near the same formality, so each also says which garments suit it (`likes`, a bonus
  // or a cost per kind of garment, see garmentOf) and the trio is spread over different garments.
  { id: "university", label: "University", formality: 1.8, words: ["university", "uni", "college", "campus", "class", "classes", "lecture"], likes: { jeans: 1.4, overshirt: 1.2, hoodie: 1, shirt: 0.8, coord: 0.6, tee: 0.5, polo: 0.4, knit: 0.3, jogger: -0.2, shorts: -0.8, dress: -0.5 } },
  { id: "weekend", label: "A weekend", formality: 1.5, words: ["weekend", "saturday", "sunday", "errands", "chill", "lazy"], likes: { tee: 1.2, shorts: 1.1, jogger: 0.9, jeans: 0.5, polo: 0.4, overshirt: 0.4, knit: 0.3, hoodie: 0.2 } },
  { id: "travel", label: "Travel", formality: 1.6, words: ["travel", "travelling", "traveling", "trip", "flight", "airport", "journey", "holiday", "vacation"], likes: { jogger: 1.6, coord: 1.4, hoodie: 1.3, jacket: 1.2, knit: 1.2, tee: 0.3, dress: 0.2, shirt: -0.2, jeans: -0.3, shorts: -0.2 } },
  { id: "friends", label: "Out with friends", formality: 2.2, words: ["friends", "hangout", "hang out", "outing", "mall", "movie", "movies"], likes: { shirt: 1.2, jacket: 1.2, jeans: 1, overshirt: 1, dress: 0.8, polo: 0.8, knit: 0.6, trousers: 0.6, tee: 0.2, hoodie: -0.3, shorts: -0.4, jogger: -0.8 } },
];

export const MOODS = [
  { id: "traditional", label: "Traditional", words: ["traditional", "eastern", "desi", "classic", "ethnic"] },
  { id: "between", label: "Somewhere between", words: ["between", "fusion", "mix", "both"] },
  { id: "contemporary", label: "Contemporary", words: ["contemporary", "modern", "western", "minimal"] },
];

const TRADITION_FIT = {
  traditional: { east: 2, fusion: 0, west: -3 },
  between: { east: 1, fusion: 2, west: 0 },
  contemporary: { east: -0.5, fusion: 2, west: 2 },
};
const MODERN_CUT = /\b(kaftan|dress|jacket|co-?ord|jumper|top|sweater|peshwas)\b/i;
const CLASSIC_CUT = /\b(3 piece|2 piece|dupatta|shalwar|suit|kurta)\b/i;

// What kind of garment a piece is, read from its name and cut. Only the casual occasions look at it.
// The first kind that matches wins, so a jacket with a hood is a jacket and a cargo jean is a jean.
const GARMENTS = [
  ["coord", /\b(co-?ords?|set|tracksuit)\b/i],
  ["dress", /\b(dress|jumpsuit|kaftan|gown|maxi)\b/i],
  ["suit", /\b(suit|\d\s*-?\s*piece)\b/i],
  ["jeans", /\b(jeans?|jorts)\b/i],
  ["shorts", /\b(shorts|bermudas?)\b/i],
  ["jogger", /\b(joggers?|sweatpants|track\s?pants)\b/i],
  ["trousers", /\b(trousers?|pants|chinos?|cargos?|skirt|culottes|palazzo|leggings|tights)\b/i],
  ["waistcoat", /\b(waist\s?coats?)\b/i],
  ["blazer", /\bblazer\b/i],
  ["jacket", /\b(jacket|puffer|bomber|coat|parka|windbreaker|gilet|vest)\b/i],
  ["overshirt", /\b(over\s?shirt|shacket)\b/i],
  ["polo", /\bpolo/i],
  ["hoodie", /\b(hoodies?|sweatshirts?|pull-?over|quarter\s?zip)/i],
  ["knit", /\b(sweaters?|cardigan|jumper|knit)\b/i],
  ["kameez", /\b(kameez|kurta|kurti|shalwar|peshwas)\b/i],
  ["tee", /\b(t-?shirts?|tees?|henley|tank|camisole)\b/i],
  ["shirt", /\b(shirts?|blouse|top)\b/i],
];
export const garmentOf = (p) => {
  const hay = `${p.name || ""} ${p.cut || ""}`;
  return GARMENTS.find(([, re]) => re.test(hay))?.[0] || "other";
};

// The mood question (traditional, between, contemporary) only means something where a store sells more than one
// tradition. A store that is western throughout has nothing to choose between, so every mood reads as contemporary
// there and the question can be skipped.
export const moodMatters = (products) => new Set(products.map((p) => p.tradition)).size > 1;

// The occasions a store can speak to: one whose most fitting piece is within reach of the occasion's formality.
// A casual store has no wedding to offer; a tailor has no university.
export function occasionsFor(products, reach = 1.2) {
  if (!products.length) return OCCASIONS;
  const have = products.map((p) => p.formality);
  const fits = OCCASIONS.filter((o) => Math.min(...have.map((f) => Math.abs(f - o.formality))) <= reach);
  return fits.length ? fits : OCCASIONS;
}

const COLOUR_WORDS = ["black", "white", "ivory", "beige", "brown", "taupe", "grey", "blue", "navy", "teal", "green", "olive", "yellow", "mustard", "orange", "rust", "red", "maroon", "merlot", "pink", "peach", "purple", "plum"];
const COLOUR_KIN = { navy: "blue", cobalt: "blue", royal: "blue", olive: "green", sage: "green", merlot: "maroon", burgundy: "maroon", plum: "purple", ivory: "white", "off white": "white", tea: "pink", rust: "orange", taupe: "brown" };
// Shades the casual stores give their own names to. Only read when no plain colour word is in the name.
const COLOUR_NAMES = { skyway: "blue", twilight: "blue", indigo: "blue", "coconut milk": "white", vanilla: "white", flamingo: "pink", magenta: "pink", coral: "pink", grape: "purple", anthracite: "grey", metal: "grey", mink: "brown", caramel: "brown", coffee: "brown", mushroom: "brown", peanut: "beige", sand: "beige" };
export const colourFamily = (c = "") => {
  const s = c.toLowerCase();
  for (const [k, v] of Object.entries(COLOUR_KIN)) if (s.includes(k)) return v;
  return COLOUR_WORDS.find((w) => s.includes(w)) || Object.entries(COLOUR_NAMES).find(([k]) => new RegExp(`\\b${k}\\b`).test(s))?.[1] || s;
};

// Budget steps come from the store's own prices, so they make sense for any brand.
export function budgetSteps(products) {
  const prices = products.map((p) => p.price).sort((a, b) => a - b);
  if (!prices.length) return [];
  const at = (q) => prices[Math.min(prices.length - 1, Math.floor(q * prices.length))];
  const round = (n) => {
    const step = n > 20000 ? 5000 : n > 8000 ? 2500 : 1000;
    return Math.ceil(n / step) * step;
  };
  return [...new Set([round(at(0.35)), round(at(0.7)), round(at(0.92))])];
}

const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
};

/**
 * Pick three looks.
 * brief: { occasion, mood, budget, who, colour, formalityShift }
 * ctx:   { shown: Set<id>, avoidColours: Set<family> }
 */
export function pickLooks(products, brief, ctx = {}) {
  const occasion = OCCASIONS.find((o) => o.id === brief.occasion);
  const target = Math.min(5, Math.max(1, (occasion?.formality ?? 3) + (brief.formalityShift || 0)));
  // In a store that is one tradition throughout, the mood has nothing to rank: it counts as contemporary and moves nothing.
  const moody = moodMatters(products);
  const fit = moody ? TRADITION_FIT[brief.mood] || TRADITION_FIT.between : {};
  const likes = occasion?.likes;
  // A store that dresses one gender only (a men's tailor) is asked for that gender, whatever the brief began with.
  const asked = brief.who || "women";
  const who = products.some((p) => p.gender === asked) ? asked : products[0]?.gender || asked;
  const shown = ctx.shown || new Set();
  const avoid = ctx.avoidColours || new Set();

  const pool = products.filter((p) => p.gender === who);
  const score = (p) => {
    let s = -Math.abs(p.formality - target) * 2.5 + (fit[p.tradition] ?? 0);
    if (target >= 4.5 && p.formality <= 3) s -= 2; // underdressed for a wedding
    if (moody && brief.mood === "contemporary" && MODERN_CUT.test(p.name)) s += 1;
    if (moody && brief.mood === "traditional" && CLASSIC_CUT.test(p.name)) s += 1;
    if (likes) s += likes[garmentOf(p)] ?? 0;
    if (brief.colour && colourFamily(p.colour) === brief.colour) s += 4;
    if (avoid.has(colourFamily(p.colour))) s -= 3;
    if (shown.has(p.id)) s -= 6;
    if (p.sizes.length && !p.sizes.some((z) => z.inStock)) s -= 4; // nothing to buy
    return s + hash(p.id) * 0.6;
  };

  const within = brief.budget ? pool.filter((p) => p.price <= brief.budget) : pool;
  const ranked = [...within].sort((a, b) => score(b) - score(a));
  const picks = [];
  const take = (p, stretch = false) => picks.push({ product: p, stretch });
  // Prefer three different things, but a second colour of the right piece beats a wrong piece.
  const sameness = (p) =>
    picks.reduce((n, k) => {
      if (k.product.name === p.name) n += 2.5;
      if (colourFamily(k.product.colour) === colourFamily(p.colour)) n += k.product.lane === p.lane ? 1.6 : 0.6;
      // A casual trio is three different garments (a tee, a jean, a layer), not three tees.
      if (likes && garmentOf(p) !== "other" && garmentOf(k.product) === garmentOf(p)) n += 1.2;
      return n;
    }, 0);
  while (picks.length < 3) {
    const rest = ranked.filter((p) => !picks.some((k) => k.product.id === p.id));
    if (!rest.length) break;
    take(rest.reduce((best, p) => (score(p) - sameness(p) > score(best) - sameness(best) ? p : best)));
  }
  // Not enough inside the budget: offer the nearest thing above it, and say so.
  if (picks.length < 3 && brief.budget) {
    const above = pool.filter((p) => p.price > brief.budget).sort((a, b) => a.price - b.price || score(b) - score(a));
    for (const p of above) {
      if (picks.length === 3) break;
      take(p, true);
    }
  }
  return picks.map((k) => ({ ...k, why: why(k.product, brief, k.stretch) }));
}

const cleanFabric = (f = "") => (f.includes("%") ? "" : f);
export function why(p, brief, stretch) {
  const bits = [];
  if (p.unstitched) bits.push("Unstitched, shown stitched");
  else if (cleanFabric(p.fabric)) bits.push(cleanFabric(p.fabric));
  if (brief.budget) {
    const gap = brief.budget - p.price;
    if (stretch) bits.push(`${Math.abs(gap).toLocaleString("en-PK")} over`);
    else if (gap >= 1000) bits.push(`${(Math.floor(gap / 500) * 500).toLocaleString("en-PK")} under`);
  }
  const left = p.sizes.filter((z) => z.inStock);
  if (p.sizes.length && left.length && left.length <= 2) bits.push(`only ${left.map((z) => z.label).join(" and ")} left`);
  return bits.slice(0, 2).join(" · ");
}

// A store's size chart as it is typed in the console, one size to a line: "M, 38-40, 32-34" (label, chest, waist,
// in inches; the waist may be left out). Lines that make no sense are dropped. Returns [{ label, chest:[lo,hi], waist }].
export function parseSizeChart(text) {
  const rows = [];
  for (const raw of String(text || "").split(/\r?\n/).slice(0, 30)) {
    const parts = raw.split(",").map((x) => x.trim());
    const label = (parts[0] || "").slice(0, 12);
    const range = (x) => {
      const m = /^(\d{1,2}(?:\.\d)?)(?:\s*(?:-|to)\s*(\d{1,2}(?:\.\d)?))?$/i.exec(x || "");
      if (!m) return null;
      const lo = Number(m[1]), hi = Number(m[2] ?? m[1]);
      return lo >= 15 && hi <= 80 && lo <= hi ? [lo, hi] : null;
    };
    const chest = range(parts[1]);
    if (!label || !chest) continue;
    rows.push({ label, chest, waist: range(parts[2]) });
    if (rows.length === 20) break;
  }
  return rows.sort((a, b) => a.chest[0] - b.chest[0]);
}

// The size on a store's chart for a shopper's measurements: the smallest size whose chest takes hers, moved up if
// her waist needs more. Null when she is outside the chart either way; MIRVA then says so instead of guessing.
export function sizeFor(chart, { chest, waist } = {}) {
  if (!Array.isArray(chart) || !chart.length || !(chest > 0)) return null;
  if (chest < chart[0].chest[0] - 2) return null;
  let i = chart.findIndex((r) => chest <= r.chest[1]);
  if (i < 0) return null;
  while (waist > 0 && chart[i].waist && waist > chart[i].waist[1] && i < chart.length - 1) i++;
  if (waist > 0 && chart[i].waist && waist > chart[i].waist[1] + 1) return null;
  return chart[i].label;
}

// Reads a typed request. Returns what it understood so MIRVA can say it back.
export function parseAsk(text, products = []) {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s.,-]/gu, " ")} `;
  const has = (w) => t.includes(` ${w} `) || t.includes(` ${w},`) || t.includes(` ${w}.`);
  const patch = {};
  let refine = null;

  const occ = OCCASIONS.find((o) => o.words.some(has));
  if (occ) patch.occasion = occ.id;
  const mood = MOODS.find((m) => m.words.some(has));
  if (mood) patch.mood = mood.id;

  const money =
    t.match(/(?:under|below|less than|up ?to|max|maximum|within|budget(?: of| is)?|around)\s*(?:rs\.?|pkr)?\s*([\d][\d,.]*)\s*(k|thousand|lakh|lac)?/) ||
    t.match(/(?:rs\.?|pkr)\s*([\d][\d,.]*)\s*(k|thousand|lakh|lac)?/) ||
    t.match(/\b([\d][\d,.]*)\s*(k|thousand|lakh|lac)\b/);
  if (money) {
    let n = Number(money[1].replace(/,/g, ""));
    const unit = money[2];
    if (unit === "k" || unit === "thousand") n *= 1000;
    if (unit === "lakh" || unit === "lac") n *= 100000;
    if (n >= 500) patch.budget = Math.round(n);
  }

  if (/\b(him|his|men|mens|man|husband|brother|father|dad|groom|boyfriend)\b/.test(t)) patch.who = "men";
  if (/\b(her|women|womens|woman|wife|sister|mother|mom|bride|me|myself)\b/.test(t) && !patch.who) patch.who = "women";
  // A store that does not carry that gender (a men's tailor asked "for me") keeps the brief it has.
  if (patch.who && products.length && !products.some((p) => p.gender === patch.who)) delete patch.who;

  const have = new Set(products.map((p) => colourFamily(p.colour)));
  const colour = COLOUR_WORDS.find((c) => has(c));
  if (colour && have.has(colourFamily(colour))) patch.colour = colourFamily(colour);

  if (/less formal|more casual|simpler|tone it down|relaxed/.test(t)) refine = "less";
  else if (/more formal|dressier|fancier|grander|heavier/.test(t)) refine = "more";
  else if (/cheaper|lower price|less expensive|too expensive|too much/.test(t)) refine = "cheaper";
  else if (/(another|different|other) colou?r/.test(t)) refine = "colour";
  else if (/\b(more|others?|else|again|three more)\b/.test(t) && !Object.keys(patch).length) refine = "more";

  return { patch, refine, understood: !!refine || Object.keys(patch).length > 0 };
}

// What MIRVA says. Short, specific, never salesy.
export function line(key, x = {}) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  switch (key) {
    case "hello":
      return "What are we shopping for?";
    case "welcomeBack":
      return `Welcome back. I kept the ${x.name} for you.`;
    case "mood":
      return "Traditional, contemporary, or somewhere between?";
    case "budget":
      return "And what should I keep it under?";
    case "picked":
      return x.stretch
        ? "Two inside your budget, and one just over it that is worth seeing."
        : pick(["I’ve picked three. Tap one and I’ll put it on you.", "Three for you. Tap one to see it on."]);
    case "pickedAsleep":
      return "I’ve picked three. Turn on the mirror and tap one.";
    case "less":
      return "Easier, then. Try these.";
    case "more":
      return "Let’s dress it up.";
    case "cheaper":
      return "Kinder on the budget.";
    case "colour":
      return "Same idea, different colours.";
    case "three":
      return "Three more.";
    case "none":
      return "Nothing in the store fits all of that. Loosen one thing and I’ll look again.";
    case "putting":
      return pick(["One moment.", "Putting it on you."]);
    case "wearing":
      return x.unstitched
        ? "This one is sold as fabric. Here it is stitched, on you."
        : pick(["Turn a little. See how it falls.", "There. Take your time.", "This is it on you."]);
    case "kept":
      return "Kept. It will be here when you come back.";
    case "size":
      return `${x.size}. I’ll remember that.`;
    case "needMirror":
      return "Turn on the mirror and I’ll put this on you.";
    case "ended.cap":
      return "That was the full live session. Tap any look to bring it back.";
    case "ended.idle":
      return "I’ve paused the live look. Tap one to carry on.";
    case "ended.lost":
      return "The live look dropped. Tap a look to try again.";
    case "ended.user":
      return "Back to you. Tap a look whenever you like.";
    case "ended.away":
      return "I paused the live look while you were away. Tap Studio to carry on.";
    case "whichMode":
      return "A portrait of you in it, or live in the mirror?";
    case "awake":
      return "There you are.";
    case "unsure":
      return "Tell me the occasion, a budget or a colour, and I’ll narrow it down.";
    default:
      return "";
  }
}

// ---------- add-ons: the small things that finish a look ----------
const NEUTRALS = new Set(["black", "white", "beige", "brown", "grey", "gold", "silver"]);
const SHOE = /(sandal|heel|flat|pump|slide|khussa|shoe|mule|loafer|sneaker|trainer|boot|clog|flip.?flop)/i;
const BAG = /(bag|tote|clutch|wallet|pouch)/i;
const WRAP = /(dupatta|shawl|stole|scarf|cape)/i;
// What finishes a suit in a tailor's store. Their shelf name is trusted: a wallet is a wallet, not a bag.
const TAILORING = new Set(["tie", "pocketsquare", "cufflinks", "belt", "wallet", "socks"]);
// A tailor is a store with ties or pocket squares on its shelves. A belt or a wallet alone (a casual store has them
// too) does not make one.
const TAILOR_SHELF = new Set(["tie", "pocketsquare", "cufflinks"]);
// What a casual western piece is worn with, and finished by, once the garment itself is covered.
const BOTTOM_KINDS = new Set(["jeans", "shorts", "jogger", "trousers"]);
const BOTTOM_WORD = /\b(jeans?|trousers?|pants|chinos?|joggers?|shorts|jorts|cargos?|skirt|culottes|palazzo|leggings|tights)\b/i;

/** What an add-on is, whatever shelf the store filed it on. */
export function kindOf(a) {
  if (TAILORING.has(a.kind)) return a.kind;
  if (SHOE.test(a.name)) return "shoes";
  if (BAG.test(a.name)) return "bag";
  if (/dupatta/i.test(a.name)) return "dupatta";
  if (WRAP.test(a.name)) return "shawl";
  return a.kind;
}

const KIND_LABEL = {
  dupatta: "Dupatta", shawl: "Shawl", bottoms: "Trousers", tops: "Top", shoes: "Shoes", bag: "Bag", cap: "Cap", sunglasses: "Sunglasses", fragrance: "Fragrance", accessory: "Accessory",
  tie: "Tie", pocketsquare: "Pocket square", cufflinks: "Cufflinks", belt: "Belt", wallet: "Wallet", socks: "Socks",
};

/**
 * Up to three add-ons for a piece. One of each kind, chosen for what the piece lacks
 * and for colour: the same family, or a neutral that goes with anything.
 */
export function addOns(product, addons = [], max = 3) {
  if (!product || !addons.length) return [];
  const pool = addons.filter((a) => a.gender === product.gender);
  const fam = colourFamily(product.colour);
  const name = `${product.name} ${product.cut || ""}`;
  const hasDupatta = /3\s*-?\s*piece|dupatta|shawl/i.test(name);
  // A piece that is its own bottom, or comes with one (a co-ord set, a jumpsuit), needs none.
  const bottomOnly = BOTTOM_KINDS.has(garmentOf(product));
  const hasBottom = /\d\s*-?\s*piece|suit|dress|kaftan|shalwar|co-?ord|jumpsuit|tracksuit|\bset\b/i.test(name) || BOTTOM_WORD.test(name);
  const eastern = product.tradition !== "west";
  const tailor = pool.some((a) => TAILOR_SHELF.has(a.kind));
  // A casual western piece (a tee, a hoodie, a pair of jeans) is finished by the other half of the outfit, shoes and a
  // cap. It is never offered a dupatta or a shawl.
  const casual = !eastern && product.formality <= 2.5 && !tailor;

  // What this piece needs most, in order.
  const wants = [];
  if (!hasBottom) wants.push("bottoms");
  if (casual) {
    if (bottomOnly) wants.push("tops"); // jeans need something above them
    wants.push("shoes", "bag", "cap", "sunglasses", "belt", "fragrance");
  } else {
    if (eastern && !hasDupatta) wants.push("dupatta");
    if (!eastern || product.formality <= 3) wants.push("shawl");
    wants.push("shoes", "bag", "fragrance");
  }
  // A tailor's store (ties, pocket squares, belts on its shelves) finishes a suit with those. A store without them,
  // Sapphire among them, never takes this branch, so what it is offered does not move.
  if (tailor) {
    wants.length = 0;
    if (!hasBottom) wants.push("bottoms");
    if (/suit|blazer|jacket|waist\s?coat/i.test(name)) wants.push("tie", "pocketsquare", "belt");
    wants.push("wallet", "socks");
  }

  const score = (a) => {
    const c = colourFamily(a.colour || "");
    // A casual store has few of each add-on, so the pick also moves with the piece: not the same jeans under every tee.
    let s = casual ? hash(a.id + product.id) * 0.9 : hash(a.id) * 0.4;
    if (c && c === fam) s += 2;
    else if (NEUTRALS.has(c)) s += 1.4;
    else if (!c) s += 0.8; // a fragrance has no colour to clash
    if (a.price <= product.price * 0.6) s += 0.6; // an add-on should cost less than the piece
    return s;
  };
  const picks = [];
  for (const kind of [...new Set(wants)]) {
    if (picks.length >= max) break;
    if (kind === "shawl" && picks.some((k) => k.kind === "dupatta")) continue; // one wrap is enough
    const best = pool.filter((a) => kindOf(a) === kind).sort((x, y) => score(y) - score(x))[0];
    if (!best) continue;
    const c = colourFamily(best.colour || "");
    const why =
      kind === "bottoms" ? (casual ? "Worn with it" : "It needs a trouser")
      : kind === "tops" ? "Worn with it"
      : kind === "dupatta" ? "Finishes a two-piece"
      : c && c === fam ? `Picks up the ${fam}`
      : NEUTRALS.has(c) ? "A neutral that works"
      : kind === "fragrance" ? "The last touch"
      : "Goes with it";
    const label = kind === "bottoms" && /\bjeans\b/i.test(best.name) ? "Jeans" : KIND_LABEL[kind] || "Add-on";
    picks.push({ addon: best, kind, label, why });
  }
  return picks;
}
