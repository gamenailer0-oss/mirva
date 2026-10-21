import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickLooks, parseAsk, addOns, budgetSteps, kindOf, colourFamily, line, OCCASIONS, MOODS } from "../src/stylist.js";

const cat = JSON.parse(readFileSync(new URL("../brands/sapphire/catalogue.json", import.meta.url), "utf8"));
const { products, addons } = cat;
const women = { who: "women" };

test("the Sapphire snapshot is usable", () => {
  assert.ok(products.length >= 40, "enough products");
  assert.ok(addons.length >= 20, "enough add-ons");
  for (const p of products) {
    assert.ok(p.id && p.name && p.price > 0 && p.image.startsWith("https://") && p.prompt.startsWith("Substitute"), `product ${p.id} is complete`);
    assert.ok(["women", "men"].includes(p.gender));
    assert.ok(p.formality >= 1 && p.formality <= 5);
  }
});

test("every brief returns three different looks", () => {
  for (const o of OCCASIONS)
    for (const m of MOODS) {
      const picks = pickLooks(products, { ...women, occasion: o.id, mood: m.id });
      assert.equal(picks.length, 3, `${o.id}/${m.id}`);
      assert.equal(new Set(picks.map((k) => k.product.id)).size, 3, "no repeats");
      assert.ok(picks.every((k) => k.product.gender === "women"));
    }
});

test("a budget is respected, and anything over it is flagged as a stretch", () => {
  const picks = pickLooks(products, { ...women, occasion: "wedding", mood: "traditional", budget: 12000 });
  for (const k of picks) assert.ok(k.stretch || k.product.price <= 12000, `${k.product.name} at ${k.product.price}`);
  const tight = pickLooks(products, { ...women, occasion: "wedding", mood: "traditional", budget: 3000 });
  assert.ok(tight.some((k) => k.stretch), "a tight budget produces a flagged stretch");
  for (const k of tight) assert.equal(k.stretch, k.product.price > 3000);
});

test("a wedding gets formal pieces when the budget allows", () => {
  const picks = pickLooks(products, { ...women, occasion: "wedding", mood: "traditional", budget: 40000 });
  assert.ok(picks.every((k) => k.product.formality >= 4), picks.map((k) => `${k.product.name}:${k.product.formality}`).join(", "));
});

test("shopping for him only shows menswear", () => {
  const picks = pickLooks(products, { who: "men", occasion: "eid", mood: "traditional" });
  assert.ok(picks.length > 0 && picks.every((k) => k.product.gender === "men"));
});

test("asking for three more does not repeat what was shown", () => {
  const brief = { ...women, occasion: "everyday", mood: "between" };
  const first = pickLooks(products, brief);
  const shown = new Set(first.map((k) => k.product.id));
  const second = pickLooks(products, brief, { shown });
  assert.ok(second.every((k) => !shown.has(k.product.id)));
});

test("a colour request is honoured", () => {
  const picks = pickLooks(products, { ...women, occasion: "work", mood: "contemporary", colour: "black" });
  assert.ok(picks.some((k) => colourFamily(k.product.colour) === "black"));
});

test("typed requests are understood", () => {
  assert.deepEqual(parseAsk("a walima under 15k, contemporary", products).patch, { occasion: "wedding", mood: "contemporary", budget: 15000 });
  assert.deepEqual(parseAsk("PKR 60,000 wedding traditional", products).patch, { occasion: "wedding", mood: "traditional", budget: 60000 });
  assert.equal(parseAsk("eid outfit for my husband", products).patch.who, "men");
  assert.equal(parseAsk("something for office in blue", products).patch.colour, "blue");
  assert.equal(parseAsk("less formal please", products).refine, "less");
  assert.equal(parseAsk("too expensive", products).refine, "cheaper");
  assert.equal(parseAsk("hello", products).understood, false);
  assert.equal(parseAsk("<script>alert(1)</script>", products).understood, false);
});

test("budget steps rise and suit the store's prices", () => {
  const steps = budgetSteps(products);
  assert.ok(steps.length >= 2);
  assert.deepEqual([...steps].sort((a, b) => a - b), steps);
  assert.ok(steps[0] >= Math.min(...products.map((p) => p.price)));
});

test("add-ons are one of each kind, right for the wearer, and never two wraps", () => {
  for (const p of products) {
    const picks = addOns(p, addons);
    assert.ok(picks.length <= 3);
    assert.equal(new Set(picks.map((k) => k.kind)).size, picks.length, `${p.name}: one of each kind`);
    assert.ok(picks.every((k) => k.addon.gender === p.gender), `${p.name}: right department`);
    assert.ok(!(picks.some((k) => k.kind === "dupatta") && picks.some((k) => k.kind === "shawl")), `${p.name}: one wrap`);
    assert.ok(picks.every((k) => k.why && k.label));
  }
});

test("a shirt sold alone is offered a trouser first", () => {
  const shirt = products.find((p) => /^Printed Khaddar Shirt$/.test(p.name));
  if (!shirt) return;
  assert.equal(addOns(shirt, addons)[0].kind, "bottoms");
});

test("an add-on is filed by what it is, whatever shelf it came from", () => {
  assert.equal(kindOf({ name: "Black Kitten Heels", kind: "accessory" }), "shoes");
  assert.equal(kindOf({ name: "Blue Tote Bag", kind: "accessory" }), "bag");
  assert.equal(kindOf({ name: "Printed Tissue Dupatta", kind: "dupatta" }), "dupatta");
  assert.equal(kindOf({ name: "Solid Shawl", kind: "dupatta" }), "shawl");
});

test("MIRVA has a line for every moment", () => {
  for (const key of ["hello", "mood", "budget", "picked", "pickedAsleep", "none", "putting", "wearing", "kept", "needMirror", "whichMode", "ended.cap", "ended.idle", "ended.lost", "ended.user", "ended.away", "unsure"])
    assert.ok(line(key, { name: "x", size: "M" }).length > 3, key);
});

// --- a size from the store's own chart ---------------------------------------------------------

test("a store's size chart is read one size to a line, and lines that make no sense are dropped", async () => {
  const { parseSizeChart } = await import("../src/stylist.js");
  const chart = parseSizeChart("L, 42-44, 36-38\nS, 34-36, 28-30\n\nnot a size\nM, 38 to 40, 32-34\nXL, 46\nXXL, 300-400\n, 30-32");
  assert.deepEqual(chart.map((r) => r.label), ["S", "M", "L", "XL"], "sorted by chest, nonsense left out");
  assert.deepEqual(chart[1], { label: "M", chest: [38, 40], waist: [32, 34] });
  assert.deepEqual(chart[3], { label: "XL", chest: [46, 46], waist: null }, "one number is a size of its own; the waist may be left out");
  assert.deepEqual(parseSizeChart(""), []);
  assert.deepEqual(parseSizeChart(null), []);
  assert.equal(parseSizeChart(Array.from({ length: 40 }, (_, i) => `S${i}, ${30 + i}`).join("\n")).length, 20, "never more than twenty sizes");
});

test("her size is the smallest that takes her chest, moved up for her waist, and never a guess outside the chart", async () => {
  const { parseSizeChart, sizeFor } = await import("../src/stylist.js");
  const chart = parseSizeChart("S, 34-36, 28-30\nM, 38-40, 32-34\nL, 42-44, 36-38");
  assert.equal(sizeFor(chart, { chest: 35 }), "S");
  assert.equal(sizeFor(chart, { chest: 37 }), "M", "between two sizes she takes the larger");
  assert.equal(sizeFor(chart, { chest: 39, waist: 33 }), "M");
  assert.equal(sizeFor(chart, { chest: 39, waist: 36 }), "L", "a waist that needs more moves her up");
  assert.equal(sizeFor(chart, { chest: 43, waist: 42 }), null, "past the largest waist: say so, do not guess");
  assert.equal(sizeFor(chart, { chest: 48 }), null, "above the chart");
  assert.equal(sizeFor(chart, { chest: 30 }), null, "below the chart");
  assert.equal(sizeFor(chart, { chest: 33 }), "S", "a little under the smallest still wears it");
  assert.equal(sizeFor([], { chest: 40 }), null);
  assert.equal(sizeFor(chart, {}), null);
});

// --- casual wear: Outfitters, and the casual occasions every store now has ---------------------------------------------
import { garmentOf, occasionsFor, moodMatters } from "../src/stylist.js";
const casual = JSON.parse(readFileSync(new URL("../brands/outfitters/catalogue.json", import.meta.url), "utf8"));
const tailor = JSON.parse(readFileSync(new URL("../brands/lawrencepur/catalogue.json", import.meta.url), "utf8"));

test("the Outfitters snapshot is a usable casual store for men and women", () => {
  assert.ok(casual.products.length >= 40, "enough pieces");
  for (const p of casual.products) {
    assert.ok(p.id && p.name && p.price > 0 && p.image.startsWith("https://") && p.prompt.startsWith("Substitute"), `piece ${p.id} is complete`);
    assert.equal(p.tradition, "west");
    assert.ok(p.formality >= 1 && p.formality <= 3, `${p.name} is casual`);
    assert.ok(p.sizes.length, `${p.name} has sizes`);
  }
  for (const who of ["women", "men"]) assert.ok(casual.products.filter((p) => p.gender === who).length >= 15, who);
});

test("every occasion a store can dress returns three different real pieces, in all three stores", () => {
  for (const [name, c] of [["sapphire", cat], ["lawrencepur", tailor], ["outfitters", casual]])
    for (const who of ["women", "men"]) {
      const mine = c.products.filter((p) => p.gender === who);
      if (!mine.length) continue;
      for (const o of occasionsFor(mine))
        for (const m of MOODS) {
          const picks = pickLooks(c.products, { who, occasion: o.id, mood: m.id });
          assert.equal(picks.length, 3, `${name}/${who}/${o.id}/${m.id}`);
          assert.equal(new Set(picks.map((k) => k.product.id)).size, 3, `${name}/${o.id}: no repeats`);
        }
    }
});

test("a casual store offers no wedding, and a formal one still has its weddings", () => {
  const ids = (c) => occasionsFor(c.products).map((o) => o.id);
  assert.ok(!ids(casual).includes("wedding"), "nothing at Outfitters is for a wedding");
  assert.ok(ids(casual).includes("university") && ids(casual).includes("weekend"));
  assert.ok(ids(cat).includes("wedding") && ids(cat).includes("eid"));
  assert.equal(moodMatters(casual.products), false, "one tradition throughout: no mood question");
  assert.equal(moodMatters(cat.products), true);
});

// Naqshi, Baroque and Agha Noor (21 Oct 2026): eastern wear throughout, chosen by hand from their own sites.
test("a store of eastern wear only is asked about weddings, Eid, dinners, work and every day, and dresses each", () => {
  for (const store of ["naqshi", "baroque", "agha-noor"]) {
    const c = JSON.parse(readFileSync(new URL(`../brands/${store}/catalogue.json`, import.meta.url), "utf8"));
    const ids = occasionsFor(c.products).map((o) => o.id);
    assert.deepEqual(ids, ["wedding", "eid", "dinner", "work", "everyday"], store);
    for (const p of c.products) {
      assert.ok(p.id && p.name && p.price > 0 && p.image.startsWith("https://cdn.shopify.com/") && p.prompt.startsWith("Substitute"), `${store} ${p.id} is complete`);
      assert.equal(p.tradition, "east");
      assert.ok(!p.sizes.length || p.sizes.filter((s) => s.inStock).length >= 3, `${store} ${p.name} has sizes to sell`);
    }
    for (const o of ids)
      for (const m of MOODS) {
        const picks = pickLooks(c.products, { who: "women", occasion: o, mood: m.id });
        assert.equal(new Set(picks.map((k) => k.product.id)).size, 3, `${store}/${o}/${m.id}: three different pieces`);
      }
  }
  // Naqshi's bridal (Rs.190,000 and more) sits far above its formals: the top budget step stops below that jump.
  const naqshi = JSON.parse(readFileSync(new URL("../brands/naqshi/catalogue.json", import.meta.url), "utf8"));
  assert.deepEqual(budgetSteps(naqshi.products), [20000, 40000, 80000]);
  assert.deepEqual(budgetSteps(cat.products), [7000, 12500, 15000], "Sapphire's steps are as they were");
});

test("casual occasions pick different garments, not three of one kind", () => {
  for (const occasion of ["university", "weekend", "travel", "friends"])
    for (const who of ["women", "men"]) {
      const kinds = pickLooks(casual.products, { who, occasion, mood: "contemporary" }).map((k) => garmentOf(k.product));
      assert.ok(new Set(kinds).size >= 2, `${who} ${occasion}: ${kinds.join(", ")}`);
    }
});

test("a tee is offered something below it, shoes and a cap, and never a dupatta or a shawl", () => {
  const tee = casual.products.find((p) => garmentOf(p) === "tee");
  const kinds = addOns(tee, casual.addons, 6).map((a) => a.kind);
  assert.ok(kinds.includes("bottoms"), kinds.join(", "));
  assert.ok(kinds.includes("shoes"));
  assert.ok(!kinds.includes("dupatta") && !kinds.includes("shawl"));
  const jeans = casual.products.find((p) => garmentOf(p) === "jeans");
  const withJeans = addOns(jeans, casual.addons, 6).map((a) => a.kind);
  assert.ok(withJeans.includes("tops") && !withJeans.includes("bottoms"), withJeans.join(", "));
});

test("garments are read from their names", () => {
  for (const [name, kind] of [["Black Basic Mock Neck T-Shirt", "tee"], ["Relaxed Fit Jeans", "jeans"], ["Oversized Hoodie", "hoodie"], ["Cotton Overshirt", "overshirt"], ["Knitted Co-Ord Set", "coord"], ["3 Piece - Embroidered Raw Silk Suit", "suit"], ["Linen Shirt", "shirt"]])
    assert.equal(garmentOf({ name }), kind, name);
});
