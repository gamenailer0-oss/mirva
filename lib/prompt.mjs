// Turns catalogue facts into a try-on instruction in the shape Decart's VTON guide asks for:
// one action, one named region, then only what is visible on the garment.

const COLOURS =
  "black|white|off white|ivory|cream|beige|brown|tan|taupe|grey|gray|charcoal|blue|navy|teal|turquoise|green|olive|mint|yellow|mustard|orange|rust|red|maroon|burgundy|merlot|pink|tea pink|peach|purple|plum|lilac|mauve|gold|silver";
const COLOUR_RE = new RegExp(`\\b(${COLOURS})\\b`, "i");

// Marketing lead-ins such as "Elevate your style in our ..." say nothing about the garment.
const LEAD_IN = /^.{0,70}?\b(?:in|with|into|for|of)\s+(?:our|this|these)\s+/i;

export function cleanDescription(text) {
  let t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  t = t.split(/(?<=\.)\s+/)[0]; // the first sentence carries the garment
  t = t.replace(LEAD_IN, "").replace(/^(our|this|these|the|a|an)\s+/i, "");
  t = t.replace(/(\b.{8,40}?\b)\s+\1/gi, "$1"); // the copy sometimes repeats a phrase
  t = t.replace(/\.$/, "").trim();
  return t ? t[0].toLowerCase() + t.slice(1) : "";
}

const TOP_ONLY = /\b(top|blouse|tee|t-shirt|jumper|sweater|cardigan|hoodie|sweatshirt|jacket|blazer|coat|shrug|waistcoat|vest|shirt|kurta|kurti|tunic)\b/i;
const FULL_LOOK = /\b(\d\s*-?\s*piece|suit|kaftan|dress|co-?ord|jumpsuit|maxi|gown|abaya|outfit|peshwas)\b/i;

export function regionFor(p) {
  const hay = `${p.name} ${p.cut}`;
  if (FULL_LOOK.test(hay)) return "outfit";
  if (TOP_ONLY.test(hay)) return "upper body garment";
  return "outfit";
}

const article = (s) => (/^[aeiou]/i.test(s) ? "an" : "a");

export function buildPrompt(p) {
  const region = regionFor(p);
  const colour = p.colour && !/multi/i.test(p.colour) ? p.colour.toLowerCase() : "";

  // The brand's own sentence is the best description when it is a real one.
  let body = p.description || "";
  const wordy = body.split(" ").length >= 7;
  if (wordy && colour) {
    // The page's Colour field is entered per item; trust it over the copy when they disagree.
    const said = body.match(COLOUR_RE)?.[1];
    if (said && !colour.includes(said.toLowerCase()) && !said.toLowerCase().includes(colour)) {
      body = body.replace(COLOUR_RE, colour);
    }
  }
  if (!wordy) {
    const name = (p.name || "garment").replace(/^\d\s*piece\s*-\s*/i, "").toLowerCase();
    const cut = (p.cut || "").toLowerCase().replace(/unstitched.*$/, "").trim();
    body = [colour && !name.includes(colour) ? colour : "", name].filter(Boolean).join(" ");
    if (cut && cut.length < 90 && !cut.includes("%")) body += `, ${cut}`;
  }
  let prompt = `Substitute the ${region} with ${article(body)} ${body}`;
  if (p.unstitched) prompt += ", stitched and worn as a complete suit with the dupatta draped over one shoulder";
  prompt = prompt.replace(/\s+/g, " ").trim();
  if (prompt.length > 480) prompt = prompt.slice(0, 480).replace(/[,\s]+\S*$/, "");
  return prompt + ".";
}

// The Model shot: one still of the shopper wearing the piece, in her own pose, framing and light.
// Tested in docs/portrait-experiments.md. What the evidence says about the wording:
//  - The engine edits what it is given and never produced a new pose or a full-length figure from a half-length
//    frame, so the prompt does not ask for one. Asking for "fashion studio" photographs or flattering lighting
//    invited a redrawn, glamorous face, so it does not say those either.
//  - "Ignore any person in the reference" does nothing when a face is visible. The reference must be prepared so
//    that no face, hair or skin is in it (src/reference.js); the sentence is a second line of defence.
//  portrait:  the shopper's own frame plus a garment reference. Without a reference (none could be made
//             without the catalogue model showing) the garment is described in words alone.
//  backdrop:  the portrait again, with only the background replaced. No reference picture. ("relight" is the old name.)
const STAYS =
  "Edit only the clothes. Everything else in the picture stays exactly as it is: the person's face, hair, skin tone, expression, pose, body position, camera framing and the background. " +
  "Do not re-pose the person, do not zoom or crop differently, and do not change the background.";
const ONLY_THE_GARMENT = "The reference image shows only the garment: take the clothing from it and ignore any person, face, hair or skin that appears in it.";
// The wording proven on womenswear is kept word for word; a men's piece only swaps the pronoun.
const backdrop = (p) =>
  "Change only the background: replace it with a plain, softly lit, light grey seamless studio backdrop. Do not touch the person. " +
  `${p?.gender === "men" ? "His" : "Her"} face, hair, skin tone, expression, pose and clothes stay exactly as they are, with every colour, pattern and embroidery detail unchanged.`;

export function modelShotPrompt(p, mode = "portrait", { reference = true } = {}) {
  if (mode === "backdrop" || mode === "relight") return backdrop(p);
  const worn = buildPrompt(p).slice(0, -1);
  if (!reference) return `${worn}. ${STAYS}`;
  return `${worn}, exactly as shown in the reference image. ${STAYS} ${ONLY_THE_GARMENT}`;
}
