import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, cleanDescription, modelShotPrompt, regionFor, withoutColours } from "../lib/prompt.mjs";

const base = { name: "Printed Khaddar Shirt", cut: "", colour: "Beige", fabric: "Khaddar", description: "", unstitched: false };

test("marketing lead-ins are stripped from descriptions", () => {
  assert.equal(
    cleanDescription("Elevate your style in our printed multi charmeuse kaftan featuring a round neckline. Pair it with heels."),
    "printed multi charmeuse kaftan featuring a round neckline",
  );
  assert.equal(cleanDescription("Steal the spotlight in our embroidered plum bedford A-line shirt."), "embroidered plum bedford A-line shirt");
  assert.equal(cleanDescription(""), "");
});

test("a repeated phrase in the store's copy is collapsed", () => {
  assert.equal(
    cleanDescription("Three-piece ensemble featuring a khaddar shirt paired with shirt paired with matching trousers."),
    "three-piece ensemble featuring a khaddar shirt paired with matching trousers",
  );
});

test("the right region of the body is named", () => {
  assert.equal(regionFor({ name: "3 Piece - Embroidered Raw Silk Suit", cut: "" }), "outfit");
  assert.equal(regionFor({ name: "Printed Charmeuse Kaftan", cut: "" }), "outfit");
  assert.equal(regionFor({ name: "Round-Neck Knit Top", cut: "" }), "upper body garment");
  assert.equal(regionFor({ name: "Embroidered Cotton Jacquard Kurta", cut: "" }), "upper body garment");
});

test("a prompt is one substitute action ending in a full stop", () => {
  const p = buildPrompt({ ...base, description: "printed beige khaddar straight shirt featuring a round neckline with slit" });
  assert.match(p, /^Substitute the upper body garment with a printed beige khaddar straight shirt/);
  assert.ok(p.endsWith("."));
  assert.equal((p.match(/Substitute/g) || []).length, 1);
});

test("a thin description falls back to colour and name", () => {
  assert.equal(buildPrompt({ ...base, name: "Knit Dress", colour: "Blue", description: "sweater Dress In Clean Yarn" }), "Substitute the outfit with a blue knit dress.");
});

test("the page's colour field wins when the copy disagrees", () => {
  const p = buildPrompt({ ...base, name: "3 Piece - Embroidered Velvet Suit", colour: "Mustard", description: "purple three-piece embroidered ensemble featuring a velvet shirt and dupatta" });
  assert.match(p, /a mustard three-piece/);
  assert.doesNotMatch(p, /purple/);
});

test("unstitched fabric is asked for stitched and worn", () => {
  const p = buildPrompt({ ...base, name: "3 Piece - Printed Cotton Suit", unstitched: true, description: "three-piece printed ensemble featuring a cotton shirt paired with matching trousers" });
  assert.match(p, /stitched and worn as a complete suit/);
});

test("prompts stay inside the engine's length limit", () => {
  const p = buildPrompt({ ...base, description: Array(120).fill("embroidered").join(" ") });
  assert.ok(p.length <= 500, `prompt is ${p.length} characters`);
});

const kaftan = { ...base, name: "Printed Charmeuse Kaftan", colour: "White", description: "printed white charmeuse kaftan featuring a round neckline" };

test("the Model shot edits only the clothes and keeps her face, pose, framing and background", () => {
  const portrait = modelShotPrompt(kaftan, "portrait");
  assert.match(portrait, /^Substitute the outfit with a printed charmeuse kaftan featuring a round neckline, exactly as shown in the reference image/);
  assert.match(portrait, /Edit only the clothes/);
  // everything that is hers stays: named one by one, so nothing is left to be redrawn
  for (const part of ["face", "hair", "skin tone", "expression", "pose", "camera framing", "background"]) assert.match(portrait, new RegExp(part), part);
  assert.match(portrait, /Do not re-pose the person/);
  assert.match(portrait, /do not change the background/);
});

test("the reference is described as the garment alone, and the person in it is to be ignored", () => {
  const portrait = modelShotPrompt(kaftan, "portrait");
  assert.match(portrait, /reference image shows only the garment/);
  assert.match(portrait, /ignore any person, face, hair or skin/);
});

test("the Model shot no longer asks for a new pose or a fashion-photograph look", () => {
  // Both invited the engine to redraw her (a new body, a glamorous face). See docs/portrait-experiments.md.
  for (const mode of ["portrait", "backdrop"]) {
    const text = modelShotPrompt(kaftan, mode);
    assert.doesNotMatch(text, /full-length|relaxed, elegant pose|fashion studio|flattering|relight/i, mode);
  }
});

// The store's photo is the only word on colour. A shade's name is often not what the photograph shows ("Espresso Brown"
// on a grey suit), and with both in hand the engine splits the difference. See docs/tryon-research.md.
test("a portrait's instruction names the piece and its cut, never its colour", () => {
  const suit = { name: "Espresso Brown Plain Tropical Exclusive 2-Piece Suit", cut: "two-piece suit", colour: "Espresso Brown", description: "espresso brown two-piece suit with a jacket and matching trousers" };
  const text = modelShotPrompt(suit, "portrait");
  assert.match(text, /^Substitute the outfit with a two-piece suit with a jacket and matching trousers, exactly as shown in the reference image: the same colours, the same print or pattern, the same embroidery, in the same places\./);
  assert.doesNotMatch(text.slice(0, text.indexOf("exactly as shown")), /brown|espresso/i);
  // the live try-on's own instruction is untouched: it still names the colour
  assert.match(buildPrompt(suit), /espresso brown two-piece suit/);
  // a piece with no description is built from its name, and its colour goes the same way
  const bare = modelShotPrompt({ name: "Khaddar Shirt", cut: "Straight", colour: "Tea Pink", description: "" }, "portrait");
  assert.match(bare, /^Substitute the upper body garment with a khaddar shirt, straight, exactly as shown/);
});

test("colour words are taken out cleanly, and words that only sound like colours are left", () => {
  assert.equal(withoutColours("orange & brown striped tweed ban-collar waistcoat with six buttons", "Orange & Brown"), "striped tweed ban-collar waistcoat with six buttons");
  assert.equal(withoutColours("black and white checked shirt with navy trim"), "checked shirt with trim");
  assert.equal(withoutColours("ivory kurta with gold-tone buttons and tea pink embroidery", "Ivory"), "kurta with buttons and embroidery");
  assert.equal(withoutColours("printed multi charmeuse kaftan featuring a round neckline", "Multi"), "printed charmeuse kaftan featuring a round neckline");
  assert.equal(withoutColours("dark royal blue kurta in navy with stone work and a rose print"), "kurta with stone work and a rose print");
  assert.equal(withoutColours("embroidered green bright raw silk peshwas and flared pants", "Green"), "embroidered bright raw silk peshwas and flared pants", "bright is a cloth here, not a shade");
  assert.equal(withoutColours("band collar shirt and trousers"), "band collar shirt and trousers");
});

test("every piece in every catalogue gets a clean, colourless instruction", async () => {
  const { readdirSync, readFileSync, existsSync } = await import("node:fs");
  const root = new URL("../brands/", import.meta.url);
  const colour = /\b(black|white|ivory|cream|beige|brown|grey|gray|blue|navy|green|red|pink|maroon|gold|yellow|orange|purple|multi|olive|charcoal|teal|rust|mustard|peach|plum|lilac|mauve|silver|tan|taupe)\b/i;
  let n = 0;
  for (const brand of readdirSync(root)) {
    const file = new URL(brand + "/catalogue.json", root);
    if (!existsSync(file)) continue;
    for (const p of JSON.parse(readFileSync(file, "utf8")).products) {
      const text = modelShotPrompt(p, "portrait");
      const head = text.slice(0, text.indexOf(", exactly as shown"));
      assert.doesNotMatch(head, colour, brand + " " + p.id);
      assert.doesNotMatch(head, /  | ,|with an? (,|with|and|featuring)\b|with an [^aeiou]|with a [aeiou]/i, brand + " " + p.id + ": " + head);
      n++;
    }
  }
  assert.ok(n > 100, "the catalogues were read");
});

test("the backdrop pass changes only the background, from the portrait, with no garment text", () => {
  const backdrop = modelShotPrompt(kaftan, "backdrop");
  assert.match(backdrop, /^Change only the background/);
  assert.match(backdrop, /light grey seamless studio backdrop/);
  assert.match(backdrop, /Do not touch the person/);
  assert.match(backdrop, /face, hair, skin tone, expression, pose and clothes stay exactly as they are/);
  assert.doesNotMatch(backdrop, /Substitute|reference/);
  assert.equal(modelShotPrompt(kaftan, "relight"), backdrop, "the old name still works");
});
