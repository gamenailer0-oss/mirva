// Takes a snapshot of Sapphire's public catalogue and writes brands/sapphire/catalogue.json.
// Reads the same collection and product pages a shopper sees. Run: npm run snapshot
import { load } from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrompt, cleanDescription } from "../lib/prompt.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://pk.sapphireonline.pk";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const PER_COLLECTION = Number(process.env.PER_COLLECTION || 6);

// lane: how the stylist groups it. formality: 1 (everyday) to 5 (wedding).
const COLLECTIONS = [
  { slug: "rtw-formal", lane: "formal", formality: 5, tradition: "east" },
  { slug: "unstitched-festive", lane: "festive", formality: 5, tradition: "east", unstitched: true },
  { slug: "ready-to-wear-outfits", lane: "outfits", formality: 3, tradition: "east" },
  { slug: "rtw-smart-casual", lane: "smart", formality: 3, tradition: "east" },
  { slug: "rtw-fusion", lane: "fusion", formality: 3, tradition: "fusion" },
  { slug: "rtw-casual", lane: "casual", formality: 2, tradition: "east" },
  { slug: "three-piece-unstitched", lane: "unstitched", formality: 3, tradition: "east", unstitched: true },
  { slug: "dresses", lane: "west", formality: 3, tradition: "west" },
  { slug: "co-ord-sets", lane: "west", formality: 2, tradition: "west" },
  { slug: "women-tops", lane: "west", formality: 2, tradition: "west" },
  { slug: "mens-stitched", lane: "men", formality: 3, tradition: "east", gender: "men" },
];

const get = async (url) => {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tidy = (s) => (s || "").replace(/\s+/g, " ").trim();

function parseTiles(html) {
  const $ = load(html);
  return $(".product[data-pid]")
    .map((_, el) => {
      const $el = $(el);
      const img = $el.find("img.tile-image").first();
      const a = $el.find(".pdp-link a").first();
      return {
        id: $el.attr("data-pid"),
        name: tidy(a.text()),
        alt: tidy(img.attr("alt")),
        image: (img.attr("data-src") || img.attr("src") || "").replace(/\?.*$/, ""),
        path: a.attr("href"),
        price: Number($el.find(".value.cc-price").first().attr("content")) || null,
        season: tidy($el.find(".subtitle").first().text()),
      };
    })
    .get()
    .filter((t) => t.id && t.image && t.path && t.price);
}

function parseProduct(html) {
  const $ = load(html);
  const details = $("#nav-details .value.content").first();
  // Multi-piece suits list shirt, dupatta and trouser as separate blocks.
  const lines = (details.html() || "")
    .replace(/<\/(p|li|div|h\d)>|<br\s*\/?>/gi, "\n")
    .split("\n")
    .map((l) => tidy(load(`<i>${l}</i>`).text()))
    .filter(Boolean);
  const field = (label) => {
    const line = lines.find((l) => l.toLowerCase().startsWith(label.toLowerCase() + ":"));
    return line ? tidy(line.slice(label.length + 1)) : "";
  };
  const sizes = $(".pdp-sizes .size-item")
    .map((_, el) => {
      const $el = $(el);
      const label = tidy($el.find("span[data-stock-status], span").last().text());
      const status = tidy($el.find("span[data-stock-status]").attr("data-stock-status"));
      const out = $el.hasClass("qv-not-available") || /sold out/i.test(status);
      return /^(XXS|XS|S|M|L|XL|XXL|\d{1,2})$/i.test(label) ? { label: label.toUpperCase(), inStock: !out } : null;
    })
    .get()
    .filter((s, i, all) => all.findIndex((o) => o.label === s.label) === i);
  const images = [
    ...new Set(
      $("img")
        .map((_, el) => $(el).attr("data-src") || $(el).attr("src") || "")
        .get()
        .filter((s) => /master-catalog/.test(s) && !/sizeCharts/i.test(s))
        .map((s) => s.replace(/\?.*$/, "")),
    ),
  ];
  return {
    cut: lines.find((l) => !l.includes(":")) || "",
    colour: field("Colour") || field("Color"),
    fabric: field("Fabric"),
    description: tidy($("#nav-description .value.content").first().text()),
    sizes: sizes.some((z) => /[A-Z]/.test(z.label)) ? sizes.filter((z) => /[A-Z]/.test(z.label)) : sizes,
    images,
  };
}

const seen = new Set();
const products = [];
for (const col of COLLECTIONS) {
  let tiles = [];
  try {
    tiles = parseTiles(await get(`${ORIGIN}/collections/${col.slug}?sz=36`));
  } catch (e) {
    console.warn(`skip ${col.slug}: ${e.message}`);
    continue;
  }
  // A webcam mostly sees the upper body, so leave out pieces worn below the waist or sold as accessories.
  const SKIP = /\b(pants?|trousers?|skirt|shalwar|joggers?|culottes|jeans|shorts|leggings|tights|dupatta|shawl|stole|scarf)\b/i;
  const perName = new Map();
  const fresh = tiles
    .filter((t) => !seen.has(t.id))
    .filter((t) => /\b(suit|set|\d\s*piece)\b/i.test(t.name) || !SKIP.test(t.name))
    .filter((t) => {
      const n = (perName.get(t.name) || 0) + 1;
      perName.set(t.name, n);
      return n <= 2;
    })
    .slice(0, PER_COLLECTION);
  for (const t of fresh) {
    seen.add(t.id);
    let detail = { cut: "", colour: "", fabric: "", description: "", sizes: [], images: [] };
    try {
      detail = parseProduct(await get(ORIGIN + t.path));
    } catch (e) {
      console.warn(`  no detail for ${t.id}: ${e.message}`);
    }
    const p = {
      id: t.id,
      name: t.name,
      price: t.price,
      url: ORIGIN + t.path,
      image: t.image,
      images: detail.images.length ? detail.images.slice(0, 6) : [t.image],
      season: t.season,
      lane: col.lane,
      formality: col.formality,
      tradition: col.tradition,
      gender: col.gender || "women",
      unstitched: !!col.unstitched,
      cut: detail.cut,
      colour: detail.colour,
      fabric: detail.fabric,
      description: cleanDescription(detail.description),
      sizes: detail.sizes,
    };
    p.prompt = buildPrompt(p);
    products.push(p);
    console.log(`${col.slug.padEnd(24)} ${p.name.slice(0, 34).padEnd(34)} Rs.${p.price}  ${p.colour}/${p.fabric}`);
    await sleep(250);
  }
}

// Add-ons: the small things that finish a look. Suggested beside a garment, never tried on.
const ADDONS = [
  { slug: "dupattas-shawls", kind: "dupatta", gender: "women" },
  { slug: "accessories-scarves", kind: "scarf", gender: "women" },
  { slug: "rtw-bottoms", kind: "bottoms", gender: "women" },
  { slug: "womens-shoes", kind: "shoes", gender: "women" },
  { slug: "bags", kind: "bag", gender: "women" },
  { slug: "accessories", kind: "accessory", gender: "women" },
  { slug: "womens-perfumes", kind: "fragrance", gender: "women" },
  { slug: "man-perfumes", kind: "fragrance", gender: "men" },
];
const COLOUR_WORDS =
  /\b(black|white|off white|ivory|cream|beige|brown|tan|taupe|grey|gray|blue|navy|teal|green|olive|yellow|mustard|orange|rust|red|maroon|burgundy|pink|peach|purple|plum|lilac|gold|silver|multi)\b/i;
const addons = [];
for (const col of ADDONS) {
  let tiles = [];
  try {
    tiles = parseTiles(await get(`${ORIGIN}/collections/${col.slug}?sz=36`));
  } catch (e) {
    console.warn(`skip ${col.slug}: ${e.message}`);
    continue;
  }
  const names = new Set();
  for (const t of tiles) {
    if (seen.has(t.id) || names.has(t.name)) continue;
    if (addons.filter((a) => a.slug === col.slug).length >= 8) break;
    seen.add(t.id);
    names.add(t.name);
    const colour = (`${t.alt} ${t.name}`.match(COLOUR_WORDS)?.[1] || "").toLowerCase();
    addons.push({ id: t.id, name: t.name, price: t.price, url: ORIGIN + t.path, image: t.image, kind: col.kind, gender: col.gender, colour, slug: col.slug });
  }
  console.log(`${col.slug.padEnd(24)} ${addons.filter((a) => a.slug === col.slug).length} add-ons`);
  await sleep(250);
}
for (const a of addons) delete a.slug;

const out = join(ROOT, "brands", "sapphire", "catalogue.json");
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ takenAt: new Date().toISOString(), source: ORIGIN, products, addons }, null, 1));
console.log(`\n${products.length} products, ${addons.length} add-ons -> ${out}`);
