// The store's piece alone, on white, from outlines the cloud found in the store's own photo.
//
// Why: the still engine copies whatever it sees in the garment picture. A store loaded from its website has no garment
// pictures made ahead (scripts/prepare-refs.mjs makes them for the built-in stores), so the phone used to cut each photo
// itself: a 16 MB model fetched first, and only the model's hair and skin painted out. Boutiques shoot in palaces, and
// the scene stayed: on 15 October 2026 Rang Rasiya's red curtain, left beside the model's shoulders, came back as a red
// yoke on a navy suit, and each try waited for the model. Now SAM 3 (lib/finish.mjs CLOTH) outlines the figure, face,
// hair, neck and skin once per piece; every phone lays the cloth on white from them. Only the piece's own box is
// worked on: the whole photo, worked whole, took 2.8 s on a processor slowed four times.
import { decodeRLE } from "./keep.js";

const ROOM = 0.06; // the picture keeps this much round the figure (of the figure's longer side), as the old cut did
const NARROWEST = 0.45; // and is never narrower than this share of its own height

/** A 0/1 mask grown by r in every direction (a square), in time that does not depend on r: running counts. */
export function spread(m, W, H, r) {
  const across = new Uint8Array(W * H), out = new Uint8Array(W * H);
  const run = new Int32Array(Math.max(W, H) + 1);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W; x++) run[x + 1] = run[x] + m[o + x];
    for (let x = 0; x < W; x++) across[o + x] = run[Math.min(W, x + r + 1)] - run[Math.max(0, x - r)] > 0 ? 1 : 0;
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) run[y + 1] = run[y] + across[y * W + x];
    for (let y = 0; y < H; y++) out[y * W + x] = run[Math.min(H, y + r + 1)] - run[Math.max(0, y - r)] > 0 ? 1 : 0;
  }
  return out;
}

/**
 * Where the cloth is. Returns { box, top, alpha } or null when no figure was found: `box` is the part of the photo to
 * send (the figure from just below the chin, with a little room), `alpha` 0..255 for each pixel of that box, softened
 * by one pixel. Pure, for tests.
 */
export function clothAlpha(m, W, H) {
  const person = decodeRLE(m.person, W, H);
  const face = decodeRLE(m.face, W, H);
  // Below the chin: the lowest row of the face, and a little more. No face found (a flat product shot): from the top.
  let chin = -1;
  for (let i = face.length - 1; i >= 0; i--) if (face[i]) { chin = Math.floor(i / W); break; }
  const top = chin < 0 ? 0 : Math.min(H - 1, chin + Math.round(H * 0.01));
  const head = spread(decodeRLE([m.face, m.hair, m.neck, m.skin].filter(Boolean).join(" "), W, H), W, H, Math.max(2, Math.round(Math.max(W, H) / 300)));
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = top; y < H; y++)
    for (let x = 0, i = y * W; x < W; x++, i++) {
      if (!person[i] || head[i]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return null; // no cloth found: the caller cuts the old way
  const room = Math.round(Math.max(x1 - x0, y1 - y0) * ROOM);
  let bx = Math.max(0, x0 - room), bw = Math.min(W, x1 + room + 1) - bx;
  const by = Math.max(0, y0 - room), bh = Math.min(H, y1 + room + 1) - by;
  if (bw < bh * NARROWEST) {
    const want = Math.min(W, Math.ceil(bh * NARROWEST));
    bx = Math.max(0, Math.min(W - want, Math.round(bx + bw / 2 - want / 2)));
    bw = want;
  }
  // The box's own alpha: cloth from the chin down, then a one-pixel soft edge (a 3 x 3 average).
  const hard = new Uint8Array(bw * bh);
  for (let y = Math.max(by, top); y < by + bh; y++)
    for (let x = bx, i = y * W + bx, j = (y - by) * bw; x < bx + bw; x++, i++, j++) hard[j] = person[i] && !head[i] ? 255 : 0;
  const alpha = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && xx >= 0 && yy < bh && xx < bw) (s += hard[yy * bw + xx]), n++;
        }
      alpha[y * bw + x] = Math.round(s / n);
    }
  return { alpha, top, box: { x: bx, y: by, width: bw, height: bh } };
}

/** The cloth from `photo` (the very picture the cloud outlined), on white, as a JPEG Blob; null if none was found. */
export async function clothOnly(photo, masks) {
  const bmp = await createImageBitmap(photo);
  try {
    const cut = clothAlpha(masks, bmp.width, bmp.height);
    if (!cut) return null;
    const { box, alpha } = cut;
    const c = document.createElement("canvas");
    c.width = box.width;
    c.height = box.height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    const px = ctx.getImageData(0, 0, box.width, box.height);
    const d = px.data;
    for (let i = 0, j = 0; i < alpha.length; i++, j += 4) {
      const a = alpha[i];
      if (a === 255) continue;
      d[j] = 255 - (((255 - d[j]) * a) >> 8);
      d[j + 1] = 255 - (((255 - d[j + 1]) * a) >> 8);
      d[j + 2] = 255 - (((255 - d[j + 2]) * a) >> 8);
    }
    ctx.putImageData(px, 0, 0);
    return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("no picture"))), "image/jpeg", 0.9));
  } finally {
    bmp.close?.();
  }
}
