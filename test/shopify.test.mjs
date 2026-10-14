// Reading a store's public Shopify catalogue, with the network stood in for: plural product types, sizes past XL,
// and a size option that is not the first one.
import test from "node:test";
import assert from "node:assert/strict";
import { readShopify } from "../lib/shopify.mjs";

const variant = (o1, o2, available = true) => ({ option1: o1, option2: o2, title: `${o1} / ${o2}`, available, price: "2990.00" });
const product = (id, title, product_type, variants, options) => ({
  id,
  title,
  product_type,
  tags: [],
  body_html: "<p>Soft cotton.</p>",
  handle: title.toLowerCase().replace(/\W+/g, "-"),
  images: [{ src: `https://cdn.shopify.com/s/files/${id}.jpg?v=1` }],
  options,
  variants,
});

async function withStore(products, run) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/products.json")) return new Response(JSON.stringify({ products }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.includes("/meta.json")) return new Response(JSON.stringify({ name: "Casual Co", currency: "PKR" }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("not found", { status: 404 });
  };
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

test("plural product types are read as casual western wear, and sizes come from the option named Size", async () => {
  const sizeSecond = [{ name: "Color" }, { name: "Size" }];
  const out = await withStore(
    [
      product(1, "Graphic Tee", "TEES", [variant("Black", "S"), variant("Black", "M"), variant("Black", "2XL", false), variant("Black", "3XL")], sizeSecond),
      product(2, "Zip Hoodie", "SWEATSHIRTS", [variant("Grey", "XXXL"), variant("Grey", "L")], sizeSecond),
      product(3, "Oxford Shirt", "SHIRTS", [variant("M", "Blue")], [{ name: "Size" }, { name: "Color" }]),
    ],
    () => readShopify("casual.example.pk"),
  );
  const [tee, hoodie, shirt] = out.catalogue.products;
  assert.deepEqual(tee.sizes.map((s) => s.label), ["S", "M", "2XL", "3XL"], "2XL and 3XL are sizes too");
  assert.equal(tee.sizes.find((s) => s.label === "2XL").inStock, false);
  assert.deepEqual(hoodie.sizes.map((s) => s.label), ["XXXL", "L"]);
  assert.deepEqual(shirt.sizes.map((s) => s.label), ["M"], "a store that lists Size first still works");
  for (const p of [tee, hoodie]) {
    assert.equal(p.tradition, "west", p.name);
    assert.ok(p.formality <= 2.5, `${p.name} is casual (${p.formality})`);
  }
});
