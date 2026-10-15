// What she is already wearing, read from her own photo: the colour of her trousers under a top she tries, or of her top
// over trousers she tries. It is named to the engine (lib/prompt.mjs WORN_COLOURS) so it keeps them, and afterwards the
// portrait is checked: if her own half came back a different colour, the portrait is made once more.
import { body } from "./vision.js";
import { WORN_COLOURS } from "../lib/prompt.mjs";

const W = 240; // her photo is read at this width: enough for a colour, cheap to read

// sRGB to CIE Lab, for distances that match what the eye sees.
function lab([r, g, b]) {
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const PALETTE = Object.entries(WORN_COLOURS).map(([name, rgb]) => [name, lab(rgb)]);
const nameOf = (l) => PALETTE.reduce((best, c) => (dist(c[1], l) < dist(best[1], l) ? c : best))[0];

async function pixels(blob) {
  const bmp = await createImageBitmap(blob);
  const h = Math.round((bmp.height / bmp.width) * W);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, W, h);
  return { bmp, ctx, h };
}

// The mean colour, in Lab, of the boxes (shares of the picture).
function mean(ctx, h, boxes) {
  let r = 0, g = 0, b = 0, n = 0;
  for (const [x0, y0, x1, y1] of boxes) {
    const x = Math.max(0, Math.round(x0 * W)), y = Math.max(0, Math.round(y0 * h));
    const w = Math.min(W - x, Math.round((x1 - x0) * W)), hh = Math.min(h - y, Math.round((y1 - y0) * h));
    if (w < 2 || hh < 2) continue;
    const d = ctx.getImageData(x, y, w, hh).data;
    for (let i = 0; i < d.length; i += 4) (r += d[i]), (g += d[i + 1]), (b += d[i + 2]), n++;
  }
  return n ? lab([r / n, g / n, b / n]) : null;
}

// Where her own half is, from her pose: her thighs below the hips, or her chest between the shoulders and the hips.
function boxesFor(pose, half) {
  if (!pose?.hips || !(pose.hipY > pose.shoulderY)) return null;
  const torso = pose.hipY - pose.shoulderY;
  if (half === "below") {
    const y0 = pose.hipY + torso * 0.15, y1 = Math.min(0.97, pose.hipY + torso * 0.55);
    return [pose.hipLX, pose.hipRX].map((x) => [x - 0.025, y0, x + 0.025, y1]);
  }
  return [[pose.shoulderX - 0.05, pose.shoulderY + torso * 0.25, pose.shoulderX + 0.05, pose.hipY - torso * 0.15]];
}

/** Reads her photo. Resolves { half, name, lab, boxes } for the half she keeps, or null when it cannot tell. */
export async function readWorn(photo, half) {
  try {
    const { bmp, ctx, h } = await pixels(photo);
    const boxes = boxesFor(await body(bmp), half);
    const l = boxes && mean(ctx, h, boxes);
    return l ? { half, name: nameOf(l), lab: l, boxes } : null;
  } catch {
    return null;
  }
}

/** True when the portrait shows her own half in a clearly different colour from her photo. */
export async function wornChanged(worn, portrait) {
  if (!worn) return false;
  try {
    const { ctx, h } = await pixels(portrait);
    const l = mean(ctx, h, worn.boxes);
    return !!l && dist(l, worn.lab) > 26;
  } catch {
    return false;
  }
}
