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

test("a store that sells abroad is asked for its prices in its own money, not the visitor's", async () => {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    asked.push(u);
    // Like Saira Shakira's shop, read from outside Pakistan: dollars unless rupees are asked for.
    const price = u.includes("currency=PKR") ? "150000.00" : "542.00";
    if (u.includes("/products.json")) return new Response(JSON.stringify({ products: [product(9, "Zelina", "Pret", [{ option1: "M", title: "M", available: true, price }], [{ name: "Size" }])] }), { status: 200 });
    if (u.includes("/meta.json")) return new Response(JSON.stringify({ name: "AbroadCo", currency: "PKR" }), { status: 200 });
    return new Response("not found", { status: 404 });
  };
  try {
    const out = await readShopify("abroad.example.pk");
    assert.equal(out.catalogue.products[0].price, 150000);
    assert.equal(out.brand.currency, "Rs.");
    assert.equal(out.brand.name, "Abroad Co", "a name written as one word is read as its sign reads");
    assert.ok(asked.some((u) => u.includes("/products.json?limit=80&currency=PKR")));
  } finally {
    globalThis.fetch = real;
  }
});

test("a WooCommerce store is read through its Store API: prices in minor units, sizes from the size attribute", async () => {
  const real = globalThis.fetch;
  const woo = [
    {
      id: 501, name: "Embroidered Lawn Kurta &#8211; Green", permalink: "https://www.lawnhouse.pk/product/kurta-green/",
      prices: { price: "459000", currency_minor_unit: 2, currency_code: "PKR" },
      images: [{ src: "https://www.lawnhouse.pk/wp-content/uploads/kurta.jpg" }],
      categories: [{ name: "Pret" }], tags: [], short_description: "<p>Lawn, embroidered.</p>", is_in_stock: true,
      attributes: [{ name: "Size", terms: [{ name: "S" }, { name: "M" }, { name: "L" }] }],
    },
    {
      id: 502, name: "Picture From Elsewhere", permalink: "https://www.lawnhouse.pk/product/x/",
      prices: { price: "100000", currency_minor_unit: 2 }, images: [{ src: "https://evil.example.com/x.jpg" }], categories: [], attributes: [],
    },
  ];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/products.json")) return new Response("<html>not shopify</html>", { status: 404 });
    if (u.includes("/wp-json/wc/store/v1/products")) return new Response(JSON.stringify(woo), { status: 200, headers: { "content-type": "application/json" } });
    if (u.endsWith("/wp-json")) return new Response(JSON.stringify({ name: "Lawn House" }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("not found", { status: 404 });
  };
  try {
    const { brand, catalogue } = await readShopify("lawnhouse.pk");
    assert.equal(brand.name, "Lawn House");
    assert.equal(brand.currency, "Rs.");
    assert.equal(catalogue.products.length, 1, "a picture from another server is never taken");
    const [p] = catalogue.products;
    assert.equal(p.id, "501");
    assert.equal(p.name, "Embroidered Lawn Kurta – Green");
    assert.equal(p.price, 4590);
    assert.equal(p.url, "https://www.lawnhouse.pk/product/kurta-green/");
    assert.deepEqual(p.sizes.map((z) => z.label), ["S", "M", "L"]);
    assert.equal(p.tradition, "east");
  } finally {
    globalThis.fetch = real;
  }
});
