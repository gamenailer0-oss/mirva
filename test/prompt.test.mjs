import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, cleanDescription, modelShotPrompt, regionFor } from "../lib/prompt.mjs";

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
  assert.match(portrait, /^Substitute the outfit with a printed white charmeuse kaftan/);
  assert.match(portrait, /exactly as shown in the reference image/);
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

test("with no reference the garment is told in words alone", () => {
  const text = modelShotPrompt(kaftan, "portrait", { reference: false });
  assert.match(text, /^Substitute the outfit with a printed white charmeuse kaftan[^.]*\. Edit only the clothes/);
  assert.doesNotMatch(text, /reference/);
  assert.match(text, /Do not re-pose the person/);
});

test("the backdrop pass changes only the background, from the portrait, with no garment text", () => {
  const backdrop = modelShotPrompt(kaftan, "backdrop");
  assert.match(backdrop, /^Change only the background/);
  assert.match(backdrop, /light grey seamless studio backdrop/);
  assert.match(backdrop, /Do not touch the person/);
  assert.match(backdrop, /face, hair, skin tone, expression, pose and clothes stay exactly as they are/);
  assert.doesNotMatch(backdrop, /Substitute|reference/);
  assert.equal(modelShotPrompt(kaftan, "relight"), backdrop, "the old name still works");
  assert.equal(modelShotPrompt(kaftan, "backdrop", { reference: false }), backdrop);
});
