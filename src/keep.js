// Her own face, hair and shoes, laid back over the engine's portrait, from outlines the cloud found.
//
// Why: the engine redraws every face it is given. On 15 October 2026 real faces came back as strangers (39 to 54% of
// the face kept, by tools/eval/identity.mjs); laid back from her own photo they were 87 to 95%, the same as a
// dedicated try-on engine. The old way did this on the phone with a 16 MB model and up to 45 seconds of waiting, and
// a friend's Android simply never managed it. Now the outlines (SAM 3 on fal: her face, hair, figure and footwear,
// and the portrait's face, hair and footwear) come back with the portrait, and laying them is plain arithmetic on a
// half-size grid: no model, a tenth of a second, the same on every phone.
//
// What goes back from her photo:
//  - her face and hair, a touch wide, so no rim of the drawn hair shows round them;
//  - her own wall wherever the drawn head (often fuller hair) reaches past hers;
//  - her own shoes where the portrait has shoes too, and her floor round shoes the engine drew bigger.
// Never her neck or collar: those belong to the new garment. If the engine moved her head, nothing is laid back.

/** An outline as fal's SAM 3 sends it ("start length start length …", row-major), as 0/1 at w x h. */
export function decodeRLE(rle, w, h) {
  const m = new Uint8Array(w * h);
  if (!rle) return m;
  const n = (Array.isArray(rle) ? rle.join(" ") : String(rle)).trim().split(/\s+/);
  for (let i = 0; i + 1 < n.length; i += 2) {
    const a = Number(n[i]), b = Number(n[i + 1]);
    if (a >= 0 && b > 0) m.fill(1, a, Math.min(m.length, a + b));
  }
  return m;
}

/** A 0/1 mask at w x h, sampled (nearest) onto W x H. */
export function resample(m, w, h, W, H) {
  if (w === W && h === H) return m;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / H)) * w;
    for (let x = 0; x < W; x++) out[y * W + x] = m[sy + Math.min(w - 1, Math.floor(((x + 0.5) * w) / W))];
  }
  return out;
}

/** Grows a 0/1 (or 0/255) mask by r cells: a square neighbourhood, in two passes. */
export function grow(m, W, H, r) {
  if (r <= 0) return m;
  const pass = (src, horizontal) => {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let v = 0;
        for (let d = -r; d <= r && !v; d++) {
          const xx = horizontal ? x + d : x, yy = horizontal ? y : y + d;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) v = src[yy * W + xx];
        }
        out[y * W + x] = v;
      }
    return out;
  };
  return pass(pass(m, true), false);
}

/** Box-blurs 0..255 values by r cells, in two passes: the soft edge of what is laid back. */
export function blur(a, W, H, r) {
  if (r <= 0) return a;
  const pass = (src, horizontal) => {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let d = -r; d <= r; d++) {
          const xx = horizontal ? x + d : x, yy = horizontal ? y : y + d;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) (s += src[yy * W + xx]), n++;
        }
        out[y * W + x] = Math.round(s / n);
      }
    return out;
  };
  return pass(pass(a, true), false);
}

const either = (a, b) => {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] || (b && b[i]) ? 1 : 0;
  return out;
};
/** Middle and size of a mask's set cells: { x, y, n } or null. */
export function centre(m, W) {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < m.length; i++) if (m[i]) (sx += i % W), (sy += (i / W) | 0), n++;
  return n ? { x: sx / n, y: sy / n, n } : null;
}

export const MOVED = 0.35; // the drawn face may sit this far (of her face's width) from hers before it counts as moved
export const RESIZED = 1.6; // or be this much larger or smaller (by area)

/**
 * Where her own photo goes back over the portrait, as 0..255 on the W x H grid. `m` holds 0/1 masks on that grid:
 * herFace, herHair, herPerson, herFeet (her photo), drawnFace, drawnHair, drawnFeet (the portrait); feet may be
 * missing. Returns { alpha, how }: how is "kept", or "moved" / "noface" with alpha null (nothing to lay back).
 */
export function herAlpha(m, W, H) {
  const f0 = centre(m.herFace, W), f1 = centre(m.drawnFace, W);
  if (!f0 || f0.n < 20) return { alpha: null, how: "noface" };
  const width = Math.sqrt(f0.n); // a face is roughly as wide as the root of its area
  if (!f1 || Math.hypot(f1.x - f0.x, f1.y - f0.y) > width * MOVED || f1.n > f0.n * RESIZED || f1.n * RESIZED < f0.n) return { alpha: null, how: "moved" };
  const head = grow(either(m.herFace, m.herHair), W, H, 1);
  const drawnHead = grow(either(m.drawnFace, m.drawnHair), W, H, 3);
  // Her shoes go back whole or not at all: only when the portrait shows shoes where hers are (a floor-length hem
  // can hide them). Laid back one by one, a test came back with her own slide on one foot and a bare foot beside it.
  const feetNear = m.drawnFeet ? grow(m.drawnFeet, W, H, 6) : null;
  let feet = false;
  if (m.herFeet && feetNear) {
    let hers = 0, both = 0;
    for (let i = 0; i < m.herFeet.length; i++) if (m.herFeet[i]) (hers++, feetNear[i] && both++);
    feet = hers > 8 && both / hers > 0.2;
  }
  const drawnFeet = feet ? grow(m.drawnFeet, W, H, 1) : null;
  const take = new Uint8Array(W * H);
  const filled = new Uint8Array(W * H); // what of her old room was laid back (not her): the cut-out leaves it out
  for (let i = 0; i < take.length; i++) {
    const wall = !m.herPerson[i]; // in her photo, this pixel is the room behind her
    const room = (drawnHead[i] && wall) || (drawnFeet && drawnFeet[i] && wall && !m.herFeet[i]); // her wall round a drawn head (or her floor round drawn shoes) bigger than hers
    take[i] = head[i] || room || (feet && m.herFeet[i]) ? 255 : 0; // her face and hair, her own shoes
    filled[i] = room && !head[i] ? 1 : 0;
  }
  return { alpha: blur(take, W, H, 2), how: "kept", feet, filled };
}

/** Shrinks a 0/1 mask by r cells (what is left once its edge is worn away). */
export function shrink(m, W, H, r) {
  const inverse = Uint8Array.from(m, (v) => (v ? 0 : 1));
  return Uint8Array.from(grow(inverse, W, H, r), (v) => (v ? 0 : 1));
}

/**
 * The figure in the finished portrait (for a studio backdrop): the drawn figure and her own head, its edge pulled in a
 * cell before it is softened, so no fringe of the old wall (a street, a tree) clings to her hair.
 */
export function figureAlpha(m, W, H, filled = null) {
  const whole = either(either(m.drawnPerson, m.herFace), m.herHair);
  if (filled) for (let i = 0; i < whole.length; i++) if (filled[i]) whole[i] = 0; // the room laid back round a bigger drawn head is not her
  const fig = shrink(whole, W, H, 1);
  return blur(Uint8Array.from(fig, (v) => (v ? 255 : 0)), W, H, 1);
}

// --- in the browser ---------------------------------------------------------------------------------------------
const canvasOf = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};
const maskCanvas = (alpha, W, H) => {
  const c = canvasOf(W, H);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(W, H);
  for (let i = 0; i < alpha.length; i++) (img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255), (img.data[i * 4 + 3] = alpha[i]);
  ctx.putImageData(img, 0, 0);
  return c;
};
const toBlob = (c, q = 0.93) => new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("no picture"))), "image/jpeg", q));

/**
 * Lays her own face, hair and shoes from `herBlob` (the photo she sent) over `drawnBlob` (the engine's portrait),
 * using `masks` ({ her: {face, hair, person, feet}, drawn: {face, hair, feet, person?}, drawnSize? }: outlines as RLE;
 * the portrait's at `drawnSize` (the small copy they were found on) or the portrait's own size, hers at her photo's
 * size). Resolves { blob, how, m?, grid?, filled? }: blob is the portrait as it came unless how is "kept".
 */
export async function keepHer(herBlob, drawnBlob, masks) {
  const [her, drawn] = await Promise.all([createImageBitmap(herBlob), createImageBitmap(drawnBlob)]);
  try {
    const W = drawn.width, H = drawn.height;
    if (Math.abs(her.width / her.height - W / H) > 0.03) return { blob: drawnBlob, how: "shape" };
    const gw = Math.round(W / 2), gh = Math.round(H / 2); // the grid: half size is plenty for an outline with a soft edge
    const at = (rle, w, h) => (rle ? resample(decodeRLE(rle, w, h), w, h, gw, gh) : null);
    // the portrait's outlines were found on a small copy of it (masks.drawnSize), or on the portrait itself
    const [dw, dh] = masks.drawnSize || [W, H];
    const m = {
      herFace: at(masks.her.face, her.width, her.height),
      herHair: at(masks.her.hair, her.width, her.height),
      herPerson: at(masks.her.person, her.width, her.height),
      herFeet: at(masks.her.feet, her.width, her.height),
      drawnFace: at(masks.drawn.face, dw, dh),
      drawnHair: at(masks.drawn.hair, dw, dh),
      drawnFeet: at(masks.drawn.feet, dw, dh),
      drawnPerson: at(masks.drawn.person, dw, dh),
    };
    if (!m.herFace || !m.herPerson || !m.drawnFace) return { blob: drawnBlob, how: "nomask" };
    const { alpha, how, filled } = herAlpha(m, gw, gh);
    if (!alpha) return { blob: drawnBlob, how };
    const out = canvasOf(W, H);
    const ctx = out.getContext("2d");
    ctx.drawImage(drawn, 0, 0);
    const layer = canvasOf(W, H);
    const lctx = layer.getContext("2d");
    lctx.imageSmoothingQuality = "high";
    lctx.drawImage(her, 0, 0, W, H);
    lctx.globalCompositeOperation = "destination-in";
    lctx.drawImage(maskCanvas(alpha, gw, gh), 0, 0, W, H);
    ctx.drawImage(layer, 0, 0);
    return { blob: await toBlob(out), how: "kept", m, grid: [gw, gh], filled };
  } finally {
    her.close?.();
    drawn.close?.();
  }
}

/**
 * Her finished portrait on a quiet studio wall (for a busy room behind her): the figure is cut out along the cloud's
 * outline and set on a soft porcelain light. No engine draws anything again, so her face cannot change.
 */
export async function onStudio(blob, m, [gw, gh], filled = null) {
  if (!m?.drawnPerson) return null;
  const bmp = await createImageBitmap(blob);
  try {
    const W = bmp.width, H = bmp.height;
    const out = canvasOf(W, H);
    const ctx = out.getContext("2d");
    const wall = ctx.createRadialGradient(W * 0.5, H * 0.32, W * 0.08, W * 0.5, H * 0.42, H * 0.78);
    wall.addColorStop(0, "#f2f2f0");
    wall.addColorStop(0.55, "#e2e2df");
    wall.addColorStop(1, "#cfcfcb");
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, H);
    // a soft shadow where she stands
    const floor = ctx.createRadialGradient(W * 0.5, H * 0.95, 4, W * 0.5, H * 0.95, W * 0.42);
    floor.addColorStop(0, "rgba(40,40,44,.20)");
    floor.addColorStop(1, "rgba(40,40,44,0)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, H * 0.82, W, H * 0.18);
    const layer = canvasOf(W, H);
    const lctx = layer.getContext("2d");
    lctx.drawImage(bmp, 0, 0);
    lctx.globalCompositeOperation = "destination-in";
    lctx.imageSmoothingQuality = "high";
    lctx.drawImage(maskCanvas(figureAlpha(m, gw, gh, filled), gw, gh), 0, 0, W, H);
    ctx.drawImage(layer, 0, 0);
    return await toBlob(out);
  } finally {
    bmp.close?.();
  }
}
