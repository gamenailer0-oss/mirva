// Takes a snapshot of a Shopify store's public catalogue into brands/<id>/catalogue.json, from the store's own
// collections rather than the first 80 products the importer reads. Run:
//
//   node scripts/snapshot-shopify.mjs <domain> <collection handle> [more handles ...] [--id <brand id>]
//   node scripts/snapshot-shopify.mjs <domain> --profile <name>      (handles and rules from scripts/profiles/<name>.mjs)
//   node scripts/snapshot-shopify.mjs --prompts-only <brand id>      (no network: write the try-on sentences again)
//
// The mapping is the importer's own: it hands the store's products to readShopify (lib/shopify.mjs) and so gets the
// same id, name, price, url, image, images and prompt as a store loaded from a link. The one difference is where the
// list comes from. readShopify asks for https://<domain>/products.json?limit=80, so the products of the chosen
// collections are put in that answer, and nothing else about the importer changes.
//
// A profile (scripts/profiles/<name>.mjs) is for a store whose own words are worth reading more closely than the
// generic importer does (sizes, colour, cloth, cut), and for its add-ons. It exports:
//   handles:  collection handles for the garments           addons: [{ handle, kind }]
//   brandId:  the brand id (default: the domain, as the importer names it)
//   enrich(item, raw, ctx): the finished piece, or null to leave it out   (raw is the store's own product)
//   select(items): the pieces to keep, from every enriched piece
//   addon(item, raw, kind): the finished add-on, or null
//   selectAddons(list): the add-ons to keep
// Pictures prepared earlier (ref, refHow, refPin, refSkin) are kept when a piece is read again.
// brands/<id>/brand.json is only written when it does not exist yet; after that it is the founder's to edit.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildPrompt } from "../lib/prompt.mjs";
import { readShopify, storeDomain, storeId } from "../lib/shopify.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "Mozilla/5.0 (MIRVA prototype)";
const KEEP = ["ref", "refHow", "refPin", "refSkin"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(40000) });
      if (res.ok) return await res.json();
      last = new Error(`${res.status} ${url}`);
    } catch (e) {
      last = e;
    }
    await sleep(1500 * (i + 1));
  }
  throw last;
}

/** Every product of the named collections, once each, in the order the store lists them. */
export async function readCollections(domain, handles) {
  const seen = new Map();
  for (const handle of handles) {
    for (let page = 1; page < 10; page++) {
      const data = await getJson(`https://${domain}/collections/${handle}/products.json?limit=250&page=${page}`);
      const list = data.products || [];
      for (const p of list) if (!seen.has(p.id)) seen.set(p.id, { ...p, collections: [handle] });
      else seen.get(p.id).collections.push(handle);
      if (list.length < 250) break;
      await sleep(300);
    }
    console.log(`  ${handle.padEnd(48)} ${seen.size} so far`);
    await sleep(300);
  }
  return [...seen.values()];
}

/** The importer's mapping, applied to a list of raw products. Returns the mapped pieces (the store's own copy kept beside each). */
export async function mapProducts(domain, raw) {
  const real = globalThis.fetch;
  const wanted = `https://${domain}/products.json?limit=80`;
  globalThis.fetch = async (url, init) =>
    String(url) === wanted ? new Response(JSON.stringify({ products: raw }), { headers: { "content-type": "application/json" } }) : real(url, init);
  try {
    const { brand, catalogue } = await readShopify(domain);
    const byId = new Map(raw.map((p) => [String(p.id), p]));
    return { brand, items: catalogue.products.map((item) => ({ item, raw: byId.get(item.id) })) };
  } finally {
    globalThis.fetch = real;
  }
}

async function loadProfile(name) {
  const file = join(ROOT, "scripts", "profiles", `${name}.mjs`);
  if (!existsSync(file)) throw new Error(`There is no profile at scripts/profiles/${name}.mjs.`);
  return (await import(pathToFileURL(file).href)).default;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

// Same layout the server and prepare-refs write: one space of indent, no final newline.
const write = (file, data) => writeFile(file, JSON.stringify(data, null, 1));

async function promptsOnly(id) {
  const file = join(ROOT, "brands", id, "catalogue.json");
  const cat = await readJson(file);
  let changed = 0;
  for (const p of cat.products) {
    const next = buildPrompt(p);
    if (p.prompt !== next) (p.prompt = next, changed++);
  }
  await write(file, cat);
  console.log(`${cat.products.length} pieces, ${changed} sentences written again -> ${file}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--prompts-only")) return promptsOnly(args.find((a) => !a.startsWith("--")));
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const profileName = flag("--profile");
  const positional = args.filter((a, i) => !a.startsWith("--") && !["--id", "--profile"].includes(args[i - 1]));
  const domain = storeDomain(positional[0]);
  if (!domain) {
    console.error("Usage: node scripts/snapshot-shopify.mjs <domain> <collection handle> [...] [--id <brand id>] [--profile <name>]");
    process.exit(1);
  }
  const profile = profileName ? await loadProfile(profileName) : {};
  const handles = positional.length > 1 ? positional.slice(1) : profile.handles || [];
  if (!handles.length) throw new Error("Name at least one collection handle, or a profile that lists them.");
  const id = flag("--id") || profile.brandId || storeId(domain);
  const dir = join(ROOT, "brands", id);
  const file = join(dir, "catalogue.json");
  const before = existsSync(file) ? await readJson(file) : { products: [], addons: [] };
  const kept = new Map(before.products.map((p) => [p.id, { image: p.image, ...Object.fromEntries(KEEP.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])) }]));

  console.log(`Reading ${domain}`);
  const raw = await readCollections(domain, handles);
  const { brand, items } = await mapProducts(domain, raw);
  const ctx = { domain };
  let products = items.map(({ item, raw }) => (profile.enrich ? profile.enrich(item, raw, ctx) : item)).filter(Boolean);
  if (profile.select) products = profile.select(products);
  // The try-on sentence is written last, from the finished fields, by the same function the server uses.
  products = products.map((p) => {
    const { image, ...mine } = kept.get(p.id) || {};
    return { ...p, prompt: buildPrompt(p), ...(image === p.image ? mine : {}) }; // a picture prepared from another photograph is no longer true
  });

  let addons = before.addons || [];
  if (profile.addons?.length) {
    addons = [];
    const listed = new Map();
    for (const { handle, kind } of profile.addons)
      for (const p of await readCollections(domain, [handle])) if (!listed.has(p.id)) listed.set(p.id, { ...p, kind });
    const mapped = await mapProducts(domain, [...listed.values()]);
    for (const { item, raw } of mapped.items) {
      const a = profile.addon ? profile.addon(item, raw, raw.kind) : null;
      if (a) addons.push(a);
    }
    if (profile.selectAddons) addons = profile.selectAddons(addons);
  }

  await mkdir(dir, { recursive: true });
  if (!existsSync(join(dir, "brand.json"))) await write(join(dir, "brand.json"), { ...brand, id });
  await write(file, { takenAt: new Date().toISOString(), source: `https://${domain}`, products, addons });
  const by = {};
  for (const p of products) by[p.lane] = (by[p.lane] || 0) + 1;
  console.log(`\n${products.length} pieces ${JSON.stringify(by)}, ${addons.length} add-ons -> ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
