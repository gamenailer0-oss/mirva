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
