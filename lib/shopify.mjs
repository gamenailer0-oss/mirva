// Any Shopify store publishes /products.json. That is enough to dress MIRVA in a new brand.
import { buildPrompt, cleanDescription } from "./prompt.mjs";

const FORMAL = /\b(formal|festive|luxury|wedding|bridal|embroider|silk|chiffon|velvet|organza|couture|party)\b/i;
const CASUAL = /\b(casual|basic|printed|lawn|daily|everyday|tee|t-shirt|denim|lounge)\b/i;
const WEST = /\b(dress|jeans|tee|t-shirt|top|hoodie|sweater|jacket|blazer|skirt|western)\b/i;
const EAST = /\b(kurta|kurti|shalwar|kameez|dupatta|lawn|pret|unstitched|suit|peshwas|lehenga|sharara|saree|abaya|kaftan)\b/i;

// Follows a redirect only while it stays on the same store, with or without www. Each hop is read by
// hand and checked, because not every runtime can simply be told to refuse redirects.
async function sameSite(url, domain, headers, ms) {
  const bare = domain.replace(/^www\./, "");
  for (let hop = 0; hop < 3; hop++) {
    const res = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(ms) });
    if (res.status < 300 || res.status >= 400) return res;
    const next = new URL(res.headers.get("location") || "", url);
    if (next.protocol !== "https:" || next.host.replace(/^www./, "") !== bare) throw new Error("redirected elsewhere");
    url = next.href;
  }
  throw new Error("too many redirects");
}

export const storeDomain = (input) =>
  String(input || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
export const storeId = (domain) => domain.replace(/[^a-z0-9]+/g, "-");

/**
 * Reads a store's public catalogue. `reachable(host)` lets the host refuse addresses that
 * point back into its own network. Returns { brand, catalogue }; saving them is the caller's job.
 */
export async function readShopify(input, reachable = async () => true) {
  const domain = storeDomain(input);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || domain.length > 100) throw new Error("That does not look like a store address.");
  if (!(await reachable(domain))) throw new Error(`I couldn't reach ${domain}.`);
  const ua = { "user-agent": "Mozilla/5.0 (MIRVA prototype)", accept: "application/json" };
  let res;
  try {
    res = await sameSite(`https://${domain}/products.json?limit=80`, domain, ua, 12000);
  } catch {
    throw new Error(`I couldn't reach ${domain}.`);
  }
  if (!res.ok) throw new Error(`${domain} did not return a Shopify catalogue (${res.status}).`);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`${domain} is not a Shopify store I can read.`);
  }
  if (!Array.isArray(data.products) || !data.products.length) throw new Error("No products found there.");

  let shopName = domain.split(".")[0];
  let currency = "";
  try {
    const meta = await (await sameSite(`https://${domain}/meta.json`, domain, ua, 8000)).json();
    shopName = String(meta.name || shopName).slice(0, 60);
    currency = String(meta.currency || "").slice(0, 4);
  } catch {}

  const imageHosts = new Set();
  // Pictures may come only from Shopify's own CDN or the store's own address. A catalogue cannot
  // point the image proxy at some other server.
  const ownImage = (src) => {
    try {
      const host = new URL(src).host;
      return host === "cdn.shopify.com" || host === domain || host.endsWith("." + domain) || domain.endsWith("." + host);
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
      const sizes = [];
      for (const v of p.variants) {
        const label = String(v.option1 || v.title || "").toUpperCase();
        if (/^(XXS|XS|S|M|L|XL|XXL|\d{1,2}|SMALL|MEDIUM|LARGE)$/.test(label) && !sizes.some((s) => s.label === label))
          sizes.push({ label, inStock: !!v.available });
      }
      const item = {
        id: String(p.id),
        name: String(p.title).slice(0, 160),
        price: Math.round(Number(p.variants[0].price)) || 0,
        url: `https://${domain}/products/${p.handle}`,
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
