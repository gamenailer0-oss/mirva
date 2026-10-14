// Outfitters' catalogue, read the way its own pages put it. Used by scripts/snapshot-shopify.mjs:
//
//   node scripts/snapshot-shopify.mjs outfitters.com.pk --profile outfitters
//
// Outfitters sells casual western wear. A product on its site is one style in several colours (Color, then Size), so
// one piece here is one style in one of its colours, with that colour's own photographs and the sizes of that colour.
// What the store says is kept as it says it (title, price, colours, sizes, stock, fit, cloth). What MIRVA adds is how
// the stylist should group a piece (lane, formality) and the plain sentence that asks the engine for it.
// Nothing is invented: where the store's text does not say a cloth or a fit, the field stays empty.
import { colourFamily } from "../../src/stylist.js";

// "Model" collections hold the pieces photographed on a person, which is what a try-on reference needs.
export const HANDLES = ["men-model", "women-model"];

// The small things that finish a look. The kind is settled from each product's own type (see addon()).
export const ADDON_SHELVES = [
  { handle: "men-footwear", kind: "shoes" },
  { handle: "women-footwear", kind: "shoes" },
  { handle: "men-accessories", kind: "accessory" },
  { handle: "accessories-women", kind: "accessory" },
  { handle: "men-model", kind: "garment" },
  { handle: "women-model", kind: "garment" },
];

// How many of each lane to keep, by gender: a balanced casual wardrobe of about fifty-six pieces.
const CAPS = {
  men: { tees: 5, polos: 3, shirts: 4, knitwear: 5, outerwear: 3, denim: 4, trousers: 4 },
  women: { tees: 5, shirts: 4, knitwear: 6, outerwear: 3, denim: 4, trousers: 4, dresses: 2 },
};
const ADDON_CAPS = {
  men: { shoes: 6, belt: 2, bag: 2, sunglasses: 3, tops: 5, bottoms: 5 },
  women: { shoes: 6, belt: 2, bag: 2, sunglasses: 3, cap: 1, tops: 5, bottoms: 5 },
};

// Set aside after looking at the photographs: a piece whose picture is not a clear front view of one garment on a person.
const EXCLUDE = new Set([
  "8229186994367", // Yellow Beige shacket: worn open over a checked shirt, which would be copied with it
  "8229185224895", // Black cardigan: worn open over a checked shirt
  "8526748876991", // Deep Maroon sweater: a black bag is held across the body in the front photographs
  "8526765818047", // Deep Blue denim shacket: worn open over a cream shirt
  "8411011580095", // Anthracite Grey shorts: the second pair of shorts in a small wardrobe
  "8298425090239", // Navy Blue pants: a tote bag hangs across the torso in the front photographs
]);
// Add-ons whose fifth picture is not the garment laid flat (a back view, a close-up of a pocket).
const ADDON_EXCLUDE = new Set(["8477216243903", "8539466072255", "8431515828415", "8277936177343"]);
// Which of the colour's photographs shows the garment best (0 = the first one, the default).
const IMAGE_AT = {
  "8526748287167": 3, // Antique White cardigan: the first photograph is the garment laid flat, the fourth is worn
};

// The store's names for shades that are not a colour word, in the plain colour its photograph shows.
const GLOSS = {
  skyway: "Light Blue",
  twilight: "Navy",
  "coconut milk": "Cream",
  "vanilla ice": "Cream",
  flamingo: "Pink",
  "powder coral": "Light Pink",
  "smoky grape": "Lilac",
  peanut: "Tan",
  caramel: "Tan",
  stone: "Beige",
  metal: "Grey",
  mink: "Brown",
  "anthracite grey": "Dark Grey",
};

// ---------- words ----------
const tidy = (t) => String(t || "").replace(/\s+/g, " ").trim();
const titleCase = (s) => String(s).toLowerCase().replace(/(^|[\s&/-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
const text = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0) % 1000;
};
// The store's title without the department it appends ("Crew Neck T-Shirt Men").
const titleOf = (raw) => tidy(raw.title).replace(/\s+(men|women)$/i, "");
const genderOf = (raw) => (raw.collections?.some((h) => /^(men|accessories-men)/.test(h)) ? "men" : "women");

// The cloth, from the composition line ("83% Rayon, 17% Nylon"). A blend is called a blend.
const DENIM = /\bjeans\b|(?<!non-)\bdenim\b/i; // "Non-Denim Shorts" are not denim
const SHAPE = /fit|leg|baggy|relaxed|oversized|straight|slim|skinny|flare|balloon|barrel|carrot|loose|boxy/i; // a title that already names the shape
const KIDS_SIZE = /\b\d{1,2}(?:-\d{1,2})?\s?[YM]\b/i;
const FIBRES = { cotton: "Cotton", polyester: "Polyester", viscose: "Viscose", rayon: "Rayon", tencel: "Tencel", tencil: "Tencel", acrylic: "Acrylic", nylon: "Nylon", linen: "Linen", poly: "Polyester" };
function fabricOf(body, title) {
  const m = String(body || "").match(/<li>\s*(\d{2,3})%\s*([A-Za-z]+)/i);
  const fibre = m && FIBRES[m[2].toLowerCase()];
  if (!fibre) return /\bjeans\b/i.test(title) ? "Denim" : "";
  const denim = DENIM.test(title);
  return Number(m[1]) >= 95 ? (denim ? "Cotton denim" : fibre) : `${fibre} blend`;
}
const fitOf = (body) => {
  const m = String(body || "").match(/FIT\s*:?\s*<\/strong>\s*([A-Za-z -]+)/i);
  return m ? m[1].trim().toLowerCase() : "";
};

// ---------- what each piece is ----------
// kind: the garment, from the store's own type and title. Null leaves the piece out.
function kindOf(raw) {
  const type = raw.product_type;
  const t = titleOf(raw);
  // Children's sizes (06-07Y, 3-6M) turn up in the department collections: this is a wardrobe for adults.
  if (raw.variants.some((v) => KIDS_SIZE.test(`${v.option1} ${v.option2}`))) return null;
  if (type === "SHORTS" && genderOf(raw) === "women") return null;
  if (/activewear|thong|tights|camisole|tank|sleeveless|vest|embellished|bodysuit|sunglass/i.test(`${type} ${t}`)) return null;
  const jacketLike = /jacket|trucker|cardigan|bomber/i.test(t);
  if (/super cropped|cropped/i.test(t) && !jacketLike) return null; // the shopper's own midriff is not part of a try-on
  if (type === "TEES" || type === "T-SHIRTS") return /polo/i.test(t) ? "polo" : "tee";
  if (type === "POLOS") return "polo";
  if (type === "SHIRTS" || type === "SHIRTS/BLOUSES") {
    if (/blazer/i.test(t)) return "blazer";
    if (/shacket|\bover ?shirt/i.test(t)) return "overshirt";
    return "shirt";
  }
  if (type === "SWEATSHIRTS") return /hoodie|zipper|zip-up|zip up|pull-?over/i.test(t) && !/sweatshirt/i.test(t) ? "hoodie" : "sweatshirt";
  if (type === "SWEATERS") return /cardigan/i.test(t) ? "cardigan" : "sweater";
  if (type === "OUTERWEAR") return /blazer/i.test(t) ? "blazer" : "jacket";
  if (type === "JEANS" || (type === "TROUSERS" && /jeans/i.test(t))) return /jorts/i.test(t) ? null : "jeans";
  if (type === "TROUSERS") return /jogger/i.test(t) ? "jogger" : "trousers";
  if (type === "SHORTS") return /jorts/i.test(t) ? null : "shorts";
  if (type === "DRESSES & JUMP SUITS") return /jumpsuit/i.test(t) ? null : "dress";
  return null;
}

const LANE = { tee: "tees", polo: "polos", shirt: "shirts", overshirt: "shirts", hoodie: "knitwear", sweatshirt: "knitwear", sweater: "knitwear", cardigan: "knitwear", jacket: "outerwear", blazer: "outerwear", jeans: "denim", trousers: "trousers", jogger: "trousers", shorts: "trousers", dress: "dresses" };

// How dressed up a piece is, on MIRVA's scale (1 sweatpants, 5 a wedding). Casual wear sits between 1 and 3.
function formalityOf(kind, t) {
  const x = t.toLowerCase();
  if (kind === "tee") return /graphic|slogan|washed|varsity|embroider|print|ringer|raglan/.test(x) ? 1.3 : /henley/.test(x) ? 1.8 : 1.6;
  if (kind === "polo") return /knit|resort|quarter|tipping/.test(x) ? 2.4 : 2.2;
  if (kind === "shirt") return /oxford|poplin|button up|button-up|button down|mandarin|linen|jacquard|textured/.test(x) ? 2.7 : /embroider|print|flowy|resort/.test(x) ? 2 : 2.3;
  if (kind === "overshirt") return 1.9;
  if (kind === "hoodie") return 1.2;
  if (kind === "sweatshirt") return /quarter|mock/.test(x) ? 1.5 : 1.2;
  if (kind === "sweater") return /quarter|mock|turtle|cable|polo/.test(x) ? 2.1 : 1.9;
  if (kind === "cardigan") return 2;
  if (kind === "blazer") return 3;
  if (kind === "jacket") return /faux leather|suede/.test(x) ? 2.3 : /corduroy|non denim|non-denim/.test(x) ? 2.2 : /denim|puffer|bomber|varsity|camouflage/.test(x) ? 1.8 : 2;
  if (kind === "jeans") return /baggy|wide|balloon|barrel|flared|carpenter|cargo|loose/.test(x) ? 1.7 : /skinny/.test(x) ? 2.1 : 2;
  if (kind === "jogger") return 1.3;
  if (kind === "shorts") return 1.2;
  if (kind === "trousers") return /cargo|carpenter|baggy|loose|washed|relaxed/.test(x) ? 1.8 : 2.4;
  return /t-shirt dress|a-line t-shirt|tiered/.test(x) ? 1.8 : 2.5; // dress
}

/** The colours of a product with what is left of each: [{ name, sizes: [{label, inStock}], image, price }] in the store's order. */
function coloursOf(raw) {
  const ci = raw.options.findIndex((o) => /colou?r/i.test(o.name));
  const si = raw.options.findIndex((o) => /^size$/i.test(o.name));
  const out = new Map();
  for (const v of raw.variants) {
    const name = ci >= 0 ? tidy(v[`option${ci + 1}`]) : "";
    if (!out.has(name)) out.set(name, { name, sizes: [], image: null, sku: v.sku, price: Math.round(Number(v.price)) || 0 });
    const c = out.get(name);
    if (v.featured_image?.src && !c.image) c.image = v.featured_image.src.replace(/\?.*$/, "");
    const label = si >= 0 ? tidy(v[`option${si + 1}`]).toUpperCase() : "";
    if (label && !c.sizes.some((s) => s.label === label)) c.sizes.push({ label, inStock: !!v.available });
  }
  return [...out.values()];
}
const left = (c) => c.sizes.filter((s) => s.inStock).length;

// The photographs of one colour. The store files them under the colour's own code in the file name, the same code that
// opens the variant's SKU (F2239-106-805-... is filed as F2239106805*.jpg). Only a colour's own photographs are used,
// never another colour's.
const skuKey = (sku) => String(sku || "").split(/[-/\s]/).slice(0, 3).join("").toLowerCase();
function picturesOf(raw, colour, colours = 1) {
  const all = raw.images.map((i) => i.src.replace(/\?.*$/, ""));
  const key = skuKey(colour.sku);
  const own = key.length >= 8 ? all.filter((u) => u.split("/").pop().toLowerCase().startsWith(key)) : [];
  if (own.length) return own.slice(0, 6);
  if (colour.image) return [colour.image];
  return colours === 1 ? all.slice(0, 6) : [];
}

// One colour of the style: one that is in stock, chosen from the id so the same input gives the same answer.
function pickColour(raw) {
  const have = coloursOf(raw).filter((c) => left(c) > 0);
  if (!have.length) return null;
  const roomy = have.filter((c) => left(c) >= Math.max(1, Math.ceil(Math.max(...have.map(left)) / 2)));
  const from = roomy.length ? roomy : have;
  return from[hash(String(raw.id)) % from.length];
}

const stock = (p) => (p.sizes.length ? p.sizes.filter((s) => s.inStock).length / p.sizes.length : 0);

/** The one sentence that says what the garment is, in the words the engine needs and nothing the store did not say. */
function describe({ colour, title, fit }) {
  const t = title.toLowerCase();
  const f = fit.replace(/\s+fit$/, "");
  const fitted = f && !SHAPE.test(t) ? ` in ${/^[aeiou]/.test(f) ? "an" : "a"} ${f} fit` : "";
  return `${colour.toLowerCase()} ${t}${fitted}`.replace(/\s+/g, " ").trim();
}

function enrich(item, raw) {
  const kind = kindOf(raw);
  if (!kind || EXCLUDE.has(item.id)) return null;
  const c = pickColour(raw);
  if (!c || !c.name || !c.price) return null;
  const title = titleOf(raw);
  // The store's own shade stays in the name. The colour field says it in a word the engine and the stylist both know.
  const shade = titleCase(c.name);
  const colour = GLOSS[c.name.toLowerCase()] || shade;
  const fit = fitOf(raw.body_html);
  const images = picturesOf(raw, c, coloursOf(raw).length);
  // A colour with only a few photographs has the garment laid flat and no one wearing it; a try-on needs it worn.
  if (images.length < 5) return null;
  const at = Math.min(IMAGE_AT[item.id] || 0, images.length - 1);
  const ordered = [images[at], ...images.filter((_, i) => i !== at)];
  // The cut line carries only what the title does not already say: the fit from the page's own Fit line.
  const cut = fit && !SHAPE.test(title) ? `${fit.replace(/\s+fit$/, "")} fit` : "";
  return {
    id: item.id,
    name: `${shade} ${title}`,
    price: c.price,
    url: item.url,
    image: ordered[0],
    images: ordered,
    season: raw.options.find((o) => /season/i.test(o.name))?.values?.[0] || "",
    lane: LANE[kind],
    formality: formalityOf(kind, title),
    tradition: "west",
    gender: genderOf(raw),
    unstitched: false,
    cut,
    colour,
    fabric: fabricOf(raw.body_html, title),
    description: describe({ colour, title, fit }),
    sizes: c.sizes,
    kind,
  };
}

/** A varied handful: spread over colours, fits and garments, in-stock pieces first. Same input, same answer. */
function varied(list, n) {
  const pool = [...list].sort((a, b) => stock(b) - stock(a) || String(a.id).localeCompare(String(b.id)));
  const out = [];
  const used = { colour: {}, kind: {}, word: {} };
  const word = (p) => p.name.toLowerCase().replace(/^.*?(washed out|slogan|graphic|embroidered|striped|checkered|ribbed|cable|textured|quilted|faux leather|suede|corduroy|denim|baggy|wide leg|straight|slim|relaxed|regular|balloon|barrel|flared|carpenter|cargo|jogger|hoodie|sweatshirt|polo|henley|crew neck|v-neck|button up|resort|oxford|poplin).*$/, "$1");
  while (out.length < n && pool.length) {
    let best = 0;
    let top = -Infinity;
    pool.forEach((p, i) => {
      const s = stock(p) * 2 - (used.colour[colourFamily(p.colour)] || 0) * 1.6 - (used.kind[p.kind] || 0) * 0.9 - (used.word[word(p)] || 0) * 1.4 - i * 0.005;
      if (s > top) (top = s, (best = i));
    });
    const [p] = pool.splice(best, 1);
    used.colour[colourFamily(p.colour)] = (used.colour[colourFamily(p.colour)] || 0) + 1;
    used.kind[p.kind] = (used.kind[p.kind] || 0) + 1;
    used.word[word(p)] = (used.word[word(p)] || 0) + 1;
    out.push(p);
  }
  return out;
}

function select(items) {
  const keep = [];
  for (const gender of Object.keys(CAPS))
    for (const lane of Object.keys(CAPS[gender])) keep.push(...varied(items.filter((p) => p.gender === gender && p.lane === lane), CAPS[gender][lane]));
  return keep.map(({ kind, ...p }) => p);
}

// ---------- add-ons ----------
const PLAIN_TOP = /^(crew neck|basic|v-neck|ringer|henley neck)?\s*(t-shirt|button up shirt|button-up shirt|poplin shirt|polo shirt)$|^(pullover |basic )?(hoodie|sweatshirt)$|^crew neck sweatshirt$/i;
const PLAIN_BOTTOM = /^(straight fit|regular fit|slim fit|relaxed fit|wide leg|straight|relaxed straight)\s+(jeans|trousers|pants)$|^(wide leg|straight fit|regular fit) (jeans|trousers|pants)$/i;

function addon(item, raw) {
  const type = raw.product_type;
  const title = titleOf(raw);
  const gender = genderOf(raw);
  const shelf = /footwear/.test(raw.collections?.[0] || "") ? "shoes" : /accessories/.test(raw.collections?.[0] || "") ? "accessory" : "garment";
  let kind = null;
  if (shelf === "shoes") kind = type === "CLOSED SHOES" ? "shoes" : null;
  else if (shelf === "accessory") kind = type === "BELTS & BRACES" ? "belt" : type === "BAGS" ? "bag" : /backpack/i.test(title) ? "bag" : type === "SUNGLASSES" ? "sunglasses" : type === "CAPS & HATS" ? "cap" : null;
  else if ((type === "TEES" || type === "SWEATSHIRTS" || type === "SHIRTS") && PLAIN_TOP.test(title)) kind = "tops";
  else if ((type === "JEANS" || type === "TROUSERS") && PLAIN_BOTTOM.test(title)) kind = "bottoms";
  if (!kind || !(ADDON_CAPS[gender][kind] > 0) || ADDON_EXCLUDE.has(item.id)) return null;
  const c = pickColour(raw);
  if (!c || !c.price) return null;
  const colour = titleCase(c.name || "");
  const named = kind === "tops" || kind === "bottoms" ? `${colour} ${title}` : title;
  const pictures = picturesOf(raw, c, coloursOf(raw).length);
  // A top or a pair of jeans on a card should be the garment alone. The store puts that picture, laid flat, fifth in a
  // colour's set; without one the add-on is left out. Shoes and accessories are one picture to begin with.
  const garment = kind === "tops" || kind === "bottoms";
  const image = garment ? (pictures.length >= 5 ? pictures[4] : null) : pictures[0];
  if (!image) return null;
  return { id: item.id, name: named, price: c.price, url: item.url, image, kind, gender, colour: (GLOSS[(c.name || "").toLowerCase()] || colour).toLowerCase() };
}

function selectAddons(list) {
  const out = [];
  for (const gender of Object.keys(ADDON_CAPS))
    for (const kind of Object.keys(ADDON_CAPS[gender])) {
      const names = new Set();
      const of = list.filter((a) => a.gender === gender && a.kind === kind && !names.has(a.name) && names.add(a.name));
      const used = {};
      let n = 0;
      while (n < ADDON_CAPS[gender][kind] && of.length) {
        let best = 0;
        let top = -Infinity;
        of.forEach((a, i) => {
          const s = -(used[colourFamily(a.colour)] || 0) * 1.5 - i * 0.01;
          if (s > top) (top = s, (best = i));
        });
        const [a] = of.splice(best, 1);
        used[colourFamily(a.colour)] = (used[colourFamily(a.colour)] || 0) + 1;
        out.push(a);
        n++;
      }
    }
  return out;
}

export default { brandId: "outfitters", handles: HANDLES, addons: ADDON_SHELVES, enrich, select, addon, selectAddons };
