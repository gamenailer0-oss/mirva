// Any Shopify store publishes /products.json, and any WooCommerce store its Store API. Either is enough to dress MIRVA
// in a new brand: a WooCommerce catalogue is read into Shopify's shape (wooAsShopify) and the same rules follow.
import { buildPrompt, cleanDescription } from "./prompt.mjs";

const FORMAL = /\b(formal|festive|luxury|wedding|bridal|embroider|silk|chiffon|velvet|organza|couture|party)\b/i;
// Plurals count: a store's product types are often "TEES" or "SWEATSHIRTS".
const CASUAL = /\b(casual|basic|printed|lawn|daily|everyday|tees?|t-?shirts?|hoodies?|sweatshirts?|polos?|joggers?|denim|lounge)\b/i;
const WEST = /\b(dress(?:es)?|jeans|tees?|t-?shirts?|tops?|hoodies?|sweatshirts?|sweaters?|cardigans?|jackets?|blazers?|skirts?|polos?|joggers?|shorts|western)\b/i;
const SIZE = /^(XXS|XS|S|M|L|XL|XXL|XXXL|[2-5]XL|\d{1,2}|SMALL|MEDIUM|LARGE)$/;
const EAST = /\b(kurta|kurti|shalwar|kameez|dupatta|lawn|pret|unstitched|suit|peshwas|lehenga|sharara|saree|abaya|kaftan)\b/i;

// Follows a redirect only while it stays on the same store, with or without www. Each hop is read by
// hand and checked, because not every runtime can simply be told to refuse redirects.
async function sameSite(url, domain, headers, ms) {
  const bare = domain.replace(/^www\./, "");
  for (let hop = 0; hop < 3; hop++) {
    const res = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(ms) });
    if (res.status < 300 || res.status >= 400) return res;
    const next = new URL(res.headers.get("location") || "", url);
    if (next.protocol !== "https:" || next.host.replace(/^www\./, "") !== bare) throw new Error("redirected elsewhere");
    url = next.href;
  }
  throw new Error("too many redirects");
}

// A product's own address (WooCommerce gives it whole) is kept only when it is on the store itself.
const sameStore = (u, domain) => {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && url.host.replace(/^www\./, "") === domain.replace(/^www\./, "");
  } catch {
    return false;
  }
};

export const storeDomain = (input) =>
  String(input || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
export const storeId = (domain) => domain.replace(/[^a-z0-9]+/g, "-");

// HTML entities WordPress leaves in names ("Silk &amp; Chiffon", "Kurta &#8211; Green").
const unentity = (v) =>
  String(v || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");

// One WooCommerce Store API product, as a Shopify product: the size attribute's terms become the variants.
export function wooAsShopify(p) {
  const minor = Number(p.prices?.currency_minor_unit ?? 2);
  const price = String(Number(p.prices?.price || 0) / 10 ** (Number.isFinite(minor) ? minor : 2));
  const size = (p.attributes || []).find((a) => /size/i.test(a?.name || ""));
  const terms = (size?.terms || []).map((t) => unentity(t.name));
  return {
    id: p.id,
    title: unentity(p.name),
    url: p.permalink,
    product_type: (p.categories || []).map((c) => unentity(c.name)).join(" "),
    tags: (p.tags || []).map((t) => unentity(t.name)),
    body_html: p.short_description || p.description || "",
    images: (p.images || []).map((i) => ({ src: i.src })),
    options: terms.length ? [{ name: "Size" }] : [],
    variants: terms.length ? terms.map((t) => ({ option1: t, available: p.is_in_stock !== false, price })) : [{ title: "Default", available: p.is_in_stock !== false, price }],
  };
}

async function readWoo(domain, ua) {
  const res = await sameSite(`https://${domain}/wp-json/wc/store/v1/products?per_page=80`, domain, ua, 12000);
  if (!res.ok) return null;
  const list = await res.json().catch(() => null);
  if (!Array.isArray(list) || !list.length) return null;
  let shopName = domain.split(".")[0];
  try {
    shopName = unentity((await (await sameSite(`https://${domain}/wp-json`, domain, ua, 8000)).json()).name || shopName).slice(0, 60);
  } catch {}
  return { products: list.map(wooAsShopify), shopName, currency: String(list[0].prices?.currency_code || "").slice(0, 4) };
}

/**
 * Reads a store's public catalogue. `reachable(host)` lets the host refuse addresses that
 * point back into its own network. Returns { brand, catalogue }; saving them is the caller's job.
 */
export async function readShopify(input, reachable = async () => true) {
  const domain = storeDomain(input);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || domain.length > 100) throw new Error("That does not look like a store address.");
  if (!(await reachable(domain))) throw new Error(`I couldn't reach ${domain}.`);
  const ua = { "user-agent": "Mozilla/5.0 (MIRVA prototype)", accept: "application/json" };
  let data = null;
  let reached = false;
  try {
    const res = await sameSite(`https://${domain}/products.json?limit=80`, domain, ua, 12000);
    reached = true;
    if (res.ok) data = await res.json().catch(() => null);
  } catch {}
  let shopName = domain.split(".")[0];
  let currency = "";
  if (Array.isArray(data?.products) && data.products.length) {
    try {
      const meta = await (await sameSite(`https://${domain}/meta.json`, domain, ua, 8000)).json();
      shopName = String(meta.name || shopName).slice(0, 60);
      currency = String(meta.currency || "").slice(0, 4);
    } catch {}
  } else {
    // Not Shopify: perhaps WooCommerce.
    const woo = await readWoo(domain, ua).catch(() => null);
    if (!woo && !reached) throw new Error(`I couldn't reach ${domain}.`);
    if (!woo) throw new Error(`${domain} isn't a Shopify or WooCommerce store I can read.`);
    data = { products: woo.products };
    shopName = woo.shopName;
    currency = woo.currency;
  }

  const imageHosts = new Set();
  // Pictures may come only from Shopify's own CDN or the store's own address. A catalogue cannot
  // point the image proxy at some other server.
  const ownImage = (src) => {
    try {
      const host = new URL(src).host;
      return host === "cdn.shopify.com" || /^i[0-3]\.wp\.com$/.test(host) || host === domain || host.endsWith("." + domain) || domain.endsWith("." + host);
    } catch {
      return false;
    }
  };
  const products = data.products
    .filter((p) => p.images?.length && p.variants?.length && ownImage(p.images[0].src))
    .map((p) => {
      const hay = `${p.title} ${p.product_type} ${(p.tags || []).join(" ")}`;
      const image = p.images[0].src.replace(/\?.*$/, "");
      imageHosts.add(new URL(image).host);
      // The size is the option named Size, wherever the store put it (many list Colour first).
      const at = (p.options || []).findIndex((o) => /^size$/i.test(o?.name));
      const sizes = [];
      for (const v of p.variants) {
        const label = String((at >= 0 ? v[`option${at + 1}`] : v.option1 || v.title) || "").trim().toUpperCase();
        if (SIZE.test(label) && !sizes.some((s) => s.label === label)) sizes.push({ label, inStock: !!v.available });
      }
      const item = {
        id: String(p.id),
        name: String(p.title).slice(0, 160),
        price: Math.round(Number(p.variants[0].price)) || 0,
        url: p.url && sameStore(p.url, domain) ? String(p.url) : `https://${domain}/products/${p.handle}`,
        image,
        images: p.images.slice(0, 6).filter((i) => ownImage(i.src)).map((i) => i.src.replace(/\?.*$/, "")),
        season: p.product_type || "",
        lane: FORMAL.test(hay) ? "formal" : WEST.test(hay) && !EAST.test(hay) ? "west" : CASUAL.test(hay) ? "casual" : "smart",
        formality: FORMAL.test(hay) ? 5 : CASUAL.test(hay) ? 2 : 3,
        tradition: EAST.test(hay) ? "east" : WEST.test(hay) ? "west" : "fusion",
        gender: /\b(men|man|mens|boys?)\b/i.test(hay) && !/\bwomen\b/i.test(hay) ? "men" : "women",
        unstitched: /unstitched/i.test(hay),
        cut: "",
        colour: "",
        fabric: "",
        description: cleanDescription(String(p.body_html || "").replace(/<[^>]+>/g, " ")),
        sizes,
      };
      item.prompt = buildPrompt(item);
      return item;
    })
    .filter((p) => p.price > 0);
  if (!products.length) throw new Error("No products with pictures and prices found there.");

  const brand = {
    id: storeId(domain),
    name: shopName,
    wordmark: shopName.toUpperCase(),
    byline: "styled by MIRVA",
    mood: "noir",
    accent: "#B08D57",
    currency: currency === "PKR" || !currency ? "Rs." : currency + " ",
    source: `https://${domain}`,
    imageHosts: [...imageHosts],
    enhancePrompt: true,
    imported: true,
    // Loaded from a link, so reachable by its link, and never listed for the public to browse.
    visibility: "unlisted",
    notice: `Concept demo built on ${shopName}'s public catalogue. Not affiliated with or endorsed by ${shopName}.`,
  };
  return { brand, catalogue: { takenAt: new Date().toISOString(), source: `https://${domain}`, products } };
}
