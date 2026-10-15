// The cloud's share of a finished portrait, from fal.ai, as plain web requests (the same code on a laptop and at the edge).
//
//  - Outlines (SAM 3): her face, hair, figure and shoes in the photo she sent, and the face, hair and shoes in the
//    engine's portrait. The phone lays her own back from them (src/keep.js). Decart keeps the clothes best (it drapes a
//    dupatta, keeps kurta colours and textures) but redraws every face: real faces came back 39 to 54% kept; with her
//    own laid back, 86 to 98% (engine test of 15 October 2026, CLAUDE.md).
//  - FASHN v1.6: a dedicated try-on engine that keeps the face itself. The second engine: when Decart is out of credit
//    or down, and when Decart moved her head so nothing can be laid back. It stalled once for 164 s, so it has a hard
//    time limit like everything else here.
// The images go as data URIs (Buffer's base64 is native, so the edge's processor time stays tiny).
import { Buffer } from "node:buffer";

const FAL = "https://fal.run";
export const FAL_PRICE = { outline: 0.005, fashn: 0.075 }; // US$ a call (fal's list prices, October 2026)

// What is outlined, and in which words. Footwear asks for every match: two shoes are two things.
export const HER = { face: { prompt: "face" }, hair: { prompt: "hair" }, person: { prompt: "person" }, feet: { prompt: "footwear", all: true } };
export const DRAWN = { face: { prompt: "face" }, hair: { prompt: "hair" }, feet: { prompt: "footwear", all: true } };
export const DRAWN_STUDIO = { ...DRAWN, person: { prompt: "person" } }; // a busy wall: the figure is cut out onto a studio wall

const uri = (bytes, type) => `data:${type || "image/jpeg"};base64,${Buffer.from(bytes).toString("base64")}`;

async function call(key, model, input, timeout) {
  const res = await fetch(`${FAL}/${model}`, {
    method: "POST",
    headers: { authorization: `Key ${key}`, "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeout),
  });
  if (res.ok) return res.json();
  const body = await res.text().catch(() => "");
  // An empty account answers 402, or 403 "User is locked. Reason: TOP_UP" (seen 15 October 2026).
  const credit = res.status === 402 || /top_up|locked|balance|credit|quota/i.test(body);
  throw Object.assign(new Error(`${model}: ${res.status} ${body.slice(0, 160)}`), { status: res.status, credit, nothing: res.status === 422 });
}

/** One outline, as fal's run-length string ("" when there is nothing of that kind in the picture). */
export async function outline(key, image, { prompt, all = false }, timeout = 20000) {
  try {
    const j = await call(key, "fal-ai/sam-3/image-rle", { image_url: image, prompt, ...(all ? { return_multiple_masks: true, max_masks: 4 } : {}) }, timeout);
    return Array.isArray(j.rle) ? j.rle.join(" ") : String(j.rle || "");
  } catch (e) {
    if (e.nothing) return ""; // 422: "No masks generated" means there is none (no shoes in the picture)
    throw e;
  }
}

/** All the outlines in `wanted` of one picture, at once: { name: rle }. Throws if any call fails. */
export async function outlines(key, bytes, type, wanted, timeout) {
  const image = uri(bytes, type);
  const names = Object.keys(wanted);
  const found = await Promise.all(names.map((n) => outline(key, image, wanted[n], timeout)));
  return Object.fromEntries(names.map((n, i) => [n, found[i]]));
}

/** The second engine: her in the piece, her face kept by the engine itself. Resolves { bytes, type }. */
export async function fashn(key, { person, personType, reference, referenceType, category = "auto", timeout = 32000 }) {
  const j = await call(
    key,
    "fal-ai/fashn/tryon/v1.6",
    { model_image: uri(person, personType), garment_image: uri(reference, referenceType), category, mode: "balanced", garment_photo_type: "model", output_format: "jpeg", num_samples: 1, seed: 42 },
    timeout,
  );
  const url = j.images?.[0]?.url;
  if (!url) throw Object.assign(new Error("fashn: no picture"), { status: 502 });
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw Object.assign(new Error("fashn: picture " + res.status), { status: 502 });
  return { bytes: await res.arrayBuffer(), type: res.headers.get("content-type") || "image/jpeg" };
}

/** Which of FASHN's kinds a piece is, from what MIRVA knows of it: a top over her own trousers, trousers under her own top. */
export const fashnCategory = (product) => {
  const words = `${product.cut || ""} ${product.name || ""}`.toLowerCase();
  if (product.tradition === "west") {
    if (/\b(trouser|jean|pant|chino|short|skirt|jogger|cargo)/.test(words)) return "bottoms";
    if (/\b(dress|jumpsuit|co-?ord|set|suit)\b/.test(words)) return "auto";
    return "tops";
  }
  return "auto"; // an eastern suit is shown whole, as the store's photo shows it
};
