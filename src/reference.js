// A garment photo with nothing of the catalogue model left in it.
//
// Why: the still-image engine copies whatever of the model it can see in the reference. A whole face
// is copied outright, part of a face gives a blend, and, the case a plain crop below the chin misses,
// hair and neck skin left on the shoulders are copied onto the shopper too (see docs/portrait-experiments.md).
// So the reference must hold cloth and nothing else.
//
// How, in order:
//  1. Find the person with the pose detector and cut just below the chin.
//  2. Segment the photo into hair, skin, clothes and background (MediaPipe, multiclass selfie model).
//     Paint every hair and skin pixel, grown a few pixels, with the colour of the backdrop. Cloth
//     pixels are never painted, so the garment's neckline and cuffs stay as the store shot them.
//  3. Look for a face in the result (MediaPipe face detector). If one is still there, cut below it and look again.
//  4. Without the segmenter: cut well below the hair instead. With no person found: only a photo in which
//     the face detector sees no face is a flat product shot and goes whole.
// A photo that still shows a face is never returned; the caller then describes the garment in words instead.
import { body } from "./vision.js";

const WASM = "/dist/mp";
const SEGMENTER_MODEL = "/models/selfie_multiclass_256x256.tflite";
const FACE_MODEL = "/models/blaze_face_short_range.tflite";

// Categories of the multiclass selfie model.
const BACKGROUND = 0, HAIR = 1, BODY_SKIN = 2, FACE_SKIN = 3, CLOTHES = 4, OTHERS = 5; // OTHERS: jewellery, glasses, bags

const GROW = 4; // pixels the paint reaches beyond the mask, into anything that is not cloth
const FEATHER = 2; // pixels the paint fades over
const BAND = 0.1; // the shoulder band, as a share of the photo's height
const SKIN_MATCH = 120; // how far (summed over red, green and blue) a pixel may be from her face colour and still be her skin
const ARM_LENGTH = 0.12; // how long (of the photo's height) a region of skin must be to count as an arm
const TORSO = 0.3; // how far below the shoulder line (of the photo's height) arms and hands are looked for
const DEEP = 0.13; // without the segmenter: cut this far (of the photo's height) below the shoulder line

let tools = null; // { segmenter, faces }, each null when its model would not load
let loading = null;

/** Loads both models once, from /models. GPU first, then CPU, as vision.js does for the pose model. */
function load(delegates = ["GPU", "CPU"]) {
  loading ??= (async () => {
    const found = { segmenter: null, faces: null };
    try {
      const { FilesetResolver, ImageSegmenter, FaceDetector } = await import("@mediapipe/tasks-vision");
      const files = await FilesetResolver.forVisionTasks(WASM);
      const make = async (create, path, extra) => {
        for (const delegate of delegates) {
          try {
            return await create(files, { baseOptions: { modelAssetPath: path, delegate }, runningMode: "IMAGE", ...extra });
          } catch (e) {
            if (delegate === delegates[delegates.length - 1]) console.warn(`Could not load ${path}.`, e);
          }
        }
        return null;
      };
      [found.segmenter, found.faces] = await Promise.all([
        make((f, o) => ImageSegmenter.createFromOptions(f, o), SEGMENTER_MODEL, { outputCategoryMask: true, outputConfidenceMasks: true }),
        make((f, o) => FaceDetector.createFromOptions(f, o), FACE_MODEL, { minDetectionConfidence: 0.35 }),
      ]);
    } catch (e) {
      console.warn("Picture preparation tools are unavailable.", e);
    }
    tools = found;
    return found;
  })();
  return loading;
}

// ---- small image helpers ------------------------------------------------------------

const canvasOf = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

/**
 * Per-pixel category labels at the photo's own size, and how likely each pixel is to be hair or skin
 * (0 to 255, the model's own confidence, which catches a lock of hair lying on a sleeve that the
 * single best label calls cloth). Null if the segmenter fails.
 */
function labelsOf(segmenter, source, W, H) {
  let result;
  try {
    result = segmenter.segment(source);
    const mask = result.categoryMask;
    if (!mask) return null;
    const small = mask.getAsUint8Array();
    const mw = mask.width, mh = mask.height;
    const labels = new Uint8Array(W * H);
    const soft = new Uint8Array(W * H);
    const conf = result.confidenceMasks?.length > FACE_SKIN ? [HAIR, BODY_SKIN, FACE_SKIN].map((k) => result.confidenceMasks[k].getAsFloat32Array()) : null;
    for (let y = 0; y < H; y++) {
      const sy = Math.min(mh - 1, Math.floor((y * mh) / H)) * mw;
      for (let x = 0; x < W; x++) {
        const j = sy + Math.min(mw - 1, Math.floor((x * mw) / W));
        labels[y * W + x] = small[j];
        if (conf) soft[y * W + x] = Math.min(255, (conf[0][j] + conf[1][j] + conf[2][j]) * 255);
      }
    }
    return { labels, soft };
  } catch (e) {
    console.warn("Segmentation failed.", e);
    return null;
  } finally {
    try {
      result?.close();
    } catch {}
  }
}

/** Grow a 0/1 mask by r pixels (a square window, done as two prefix-sum passes). */
function grow(mask, W, H, r) {
  const pass = (src, dst, len, lines, stride, step) => {
    const sums = new Int32Array(len + 1);
    for (let l = 0; l < lines; l++) {
      const base = l * stride;
      for (let i = 0; i < len; i++) sums[i + 1] = sums[i] + src[base + i * step];
      for (let i = 0; i < len; i++) dst[base + i * step] = sums[Math.min(len, i + r + 1)] - sums[Math.max(0, i - r)] > 0 ? 1 : 0;
    }
  };
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  pass(mask, tmp, W, H, W, 1);
  pass(tmp, out, H, W, 1, W);
  return out;
}

/** Soften a 0/1 mask into 0..255 alpha with two box blurs of radius r. */
function feather(mask, W, H, r) {
  let a = new Float32Array(W * H);
  for (let i = 0; i < a.length; i++) a[i] = mask[i] * 255;
  const blur = (src, len, lines, stride, step) => {
    const dst = new Float32Array(src.length);
    const sums = new Float64Array(len + 1);
    for (let l = 0; l < lines; l++) {
      const base = l * stride;
      for (let i = 0; i < len; i++) sums[i + 1] = sums[i] + src[base + i * step];
      for (let i = 0; i < len; i++) {
        const lo = Math.max(0, i - r), hi = Math.min(len, i + r + 1);
        dst[base + i * step] = (sums[hi] - sums[lo]) / (hi - lo);
      }
    }
    return dst;
  };
  for (let n = 0; n < 2; n++) a = blur(blur(a, W, H, W, 1), H, W, 1, W);
  return a;
}

/**
 * The colour of the backdrop in every row of the photo: the median of the background pixels in that row, and a few
 * rows around it, so paint over a foot takes the floor's colour and paint over a head takes the wall's. A fill the
 * colour of skin would read as skin to the engine, so a skin-toned backdrop (peach, tan) is painted a neutral grey.
 */
function backdropRows(rgba, labels, W, H) {
  const rows = new Array(H).fill(null);
  for (let y = 0; y < H; y++) {
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let n = 0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (labels[i] !== BACKGROUND) continue;
      for (let c = 0; c < 3; c++) hist[c][rgba[i * 4 + c]]++;
      n++;
    }
    if (n >= 12)
      rows[y] = hist.map((h) => {
        let seen = 0;
        for (let v = 0; v < 256; v++) if ((seen += h[v]) >= n / 2) return v;
        return 200;
      });
  }
  // rows with no backdrop in them (she fills the width) borrow from the nearest row that has some
  const known = rows.map((r, y) => (r ? y : -1)).filter((y) => y >= 0);
  if (!known.length) return rows.map(() => [200, 200, 200]);
  const filled = rows.map((r, y) => r || rows[known.reduce((best, k) => (Math.abs(k - y) < Math.abs(best - y) ? k : best), known[0])]);
  const SMOOTH = 6;
  return filled.map((_, y) => {
    const out = [0, 0, 0];
    let n = 0;
    for (let j = Math.max(0, y - SMOOTH); j <= Math.min(H - 1, y + SMOOTH); j++) {
      for (let c = 0; c < 3; c++) out[c] += filled[j][c];
      n++;
    }
    const [r, g, bl] = out.map((v) => v / n);
    const skinToned = r > g && g > bl && r - bl >= 30;
    if (skinToned) {
      const l = 0.299 * r + 0.587 * g + 0.114 * bl;
      return [l, l, l];
    }
    return [r, g, bl];
  });
}

const toBlob = (canvas) =>
  new Promise((resolve, reject) => canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("Could not prepare the garment picture."))), "image/jpeg", 0.9));

/**
 * The mask is coarse (the model sees 256 by 256 pixels), so a curl of hair lying on a sleeve is called cloth.
 * That curl is exactly what the still engine copies onto the shopper. So grow the hair outward, over pixels
 * that are the colour of this model's hair, a few steps at a time. If the growth runs on (the cloth is hair
 * coloured, say a black kurta), keep only the first steps: a thin band beside the hair is all it may take.
 */
function growHair(px, labels, base, W, H) {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let area = 0;
  for (let i = 0; i < labels.length; i++)
    if (labels[i] === HAIR) {
      for (let c = 0; c < 3; c++) hist[c][px[i * 4 + c]]++;
      area++;
    }
  if (area < 150) return 0;
  const hair = hist.map((h) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) if ((seen += h[v]) >= area / 2) return v;
    return 0;
  });
  // Close in brightness and in hue: dark brown hair is warm, a dark teal trim is not.
  const warm = hair[0] - hair[2], green = hair[1] - (hair[0] + hair[2]) / 2;
  const near = (i) => {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    return Math.abs(r - hair[0]) + Math.abs(g - hair[1]) + Math.abs(b - hair[2]) < 120 && Math.abs(r - b - warm) < 30 && Math.abs(g - (r + b) / 2 - green) < 30;
  };
  let cur = new Uint8Array(W * H);
  for (let i = 0; i < cur.length; i++) cur[i] = labels[i] === HAIR ? 1 : 0;
  let early = null;
  let added = 0;
  for (let round = 0; round < 10; round++) {
    const wide = grow(cur, W, H, 5);
    const next = cur.slice();
    let n = 0;
    for (let i = 0; i < next.length; i++)
      if (wide[i] && !cur[i] && labels[i] !== BACKGROUND && near(i)) {
        next[i] = 1;
        n++;
      }
    if (!n) break;
    added += n;
    cur = next;
    if (round === 2) early = cur;
  }
  if (added > area * 0.6 && early) cur = early; // ran on: the cloth looks like hair
  let total = 0;
  for (let i = 0; i < cur.length; i++)
    if (cur[i] && !base[i]) {
      base[i] = 1;
      total++;
    }
  return total;
}

/**
 * Are there bare arms? Skin below the shoulder line that forms a long region reaching up into the shoulder band is an arm
 * (or two) with nothing over it: a sleeveless piece. A hand, a bare forearm below a rolled sleeve, a patch of chest in a V
 * neckline are all short, or do not reach the shoulders. Returns the share of the photo the arms cover (0 when none).
 */
function bareArms(labels, W, H, headLimit) {
  const seen = new Uint8Array(W * H);
  const band = Math.min(H, headLimit + Math.round(H * BAND));
  let arms = 0;
  const stack = [];
  for (let start = headLimit * W; start < W * H; start++) {
    if (seen[start] || labels[start] !== BODY_SKIN) continue;
    let top = H, bottom = 0, area = 0;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop();
      const y = Math.floor(i / W), x = i - y * W;
      area++;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > headLimit ? i - W : -1, y < H - 1 ? i + W : -1])
        if (j >= 0 && !seen[j] && labels[j] === BODY_SKIN) {
          seen[j] = 1;
          stack.push(j);
        }
    }
    if (top < band && bottom - top >= H * ARM_LENGTH && area >= W * H * 0.0015) arms += area;
  }
  return arms / (W * H);
}

/** Median colour of the pixels carrying one label, or null if there are too few. */
function medianColour(px, labels, label) {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let n = 0;
  for (let i = 0; i < labels.length; i++)
    if (labels[i] === label) {
      for (let c = 0; c < 3; c++) hist[c][px[i * 4 + c]]++;
      n++;
    }
  if (n < 60) return null;
  return hist.map((h) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) if ((seen += h[v]) >= n / 2) return v;
    return 0;
  });
}

/** Paints hair and skin out of `ctx` (the whole photo). Returns how much was painted, or null if there was nothing to paint. */
function paintOut(ctx, { labels, soft }, W, H, { skin, shoulderY, softMin }) {
  const img = ctx.getImageData(0, 0, W, H);
  const px = img.data;
  const base = new Uint8Array(W * H);
  let count = 0, y0 = H, y1 = 0;
  // Everything above the shoulder line is head, neck and its jewellery: always painted. Below it, "head" keeps hands
  // and arms (a hand holding a bag is part of the picture, and painting it bites a hole in the bag); "all" paints every
  // pixel of skin; "auto" keeps them unless a lot of bare skin would be left, as with a sleeveless piece. That
  // was the one reference that gave a wrong face in the end-to-end runs: bare arms, shoulders and hands all showing.
  const headLimit = shoulderY != null ? Math.round(H * (shoulderY + 0.05)) : H;
  // When there are bare arms (see bareArms), skin is painted down to the waist. Legs and feet are left alone: they showed no
  // sign of leaking, and painting them only leaves holes.
  const torsoLimit = Math.min(H, headLimit + Math.round(H * TORSO));
  const leftover = skin === "auto" ? bareArms(labels, W, H, headLimit) * (W * H) : 0;
  const bare = leftover > 0;
  const everything = skin === "all";
  const skinLimit = everything ? H : skin === "auto" && bare ? torsoLimit : headLimit;
  // Skin-coloured cloth (orange, rust, peach) is sometimes called skin by the model. Below the shoulders, a pixel counts
  // as skin only if it is close in colour to this model's own face, or the sleeve would be painted away with the arm.
  const face = medianColour(px, labels, FACE_SKIN);
  const looksLikeHer = (i) => !face || Math.abs(px[i * 4] - face[0]) + Math.abs(px[i * 4 + 1] - face[1]) + Math.abs(px[i * 4 + 2] - face[2]) < SKIN_MATCH;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = labels[y * W + x];
      if (k === HAIR || k === FACE_SKIN || (k === BODY_SKIN && (y < headLimit || (y < skinLimit && looksLikeHer(y * W + x)))) || (k === OTHERS && y < headLimit) || (softMin < 255 && soft[y * W + x] >= softMin && y < headLimit)) {
        base[y * W + x] = 1;
        count++;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  if (count < 40) return null;
  count += growHair(px, labels, base, W, H);
  for (let i = 0; i < base.length; i++)
    if (base[i]) {
      const y = Math.floor(i / W);
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  // Grow into the backdrop and anything unlabelled, never into cloth.
  const wide = grow(base, W, H, GROW);
  const paint = new Uint8Array(W * H);
  for (let i = 0; i < paint.length; i++) paint[i] = base[i] || (wide[i] && labels[i] !== CLOTHES) ? 1 : 0;
  const alpha = feather(paint, W, H, FEATHER);
  const backdrop = backdropRows(px, labels, W, H);
  for (let i = 0; i < alpha.length; i++) {
    if (labels[i] === CLOTHES && !base[i]) continue; // cloth is left exactly as shot
    const a = alpha[i] / 255;
    if (a <= 0) continue;
    const [r, g, b] = backdrop[Math.floor(i / W)];
    px[i * 4] = px[i * 4] * (1 - a) + r * a;
    px[i * 4 + 1] = px[i * 4 + 1] * (1 - a) + g * a;
    px[i * 4 + 2] = px[i * 4 + 2] * (1 - a) + b * a;
  }
  ctx.putImageData(img, 0, 0);
  return { share: count / (W * H), rows: [y0 / H, y1 / H], skin: everything ? "all" : skinLimit > headLimit ? "arms" : "head", bareShare: +(leftover / (W * H)).toFixed(4) };
}

/** First row (as a fraction) where cloth begins, for photos where no pose was found. */
function clothTop(labels, W, H) {
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) if (labels[y * W + x] === CLOTHES) n++;
    if (n > W * 0.03) return Math.max(0, y / H - 0.02);
  }
  return 0;
}

/** For debugging: the label map in colour, and the hair-and-skin confidence in grey. */
async function viewsOf({ labels, soft }, W, H) {
  const palette = [[150, 150, 150], [220, 40, 40], [240, 200, 40], [250, 140, 40], [40, 90, 220], [40, 180, 90]];
  const a = canvasOf(W, H), b = canvasOf(W, H);
  const ia = a.getContext("2d").createImageData(W, H), ib = b.getContext("2d").createImageData(W, H);
  for (let i = 0; i < labels.length; i++) {
    const c = palette[labels[i]] || [0, 0, 0];
    ia.data.set([c[0], c[1], c[2], 255], i * 4);
    ib.data.set([soft[i], soft[i], soft[i], 255], i * 4);
  }
  a.getContext("2d").putImageData(ia, 0, 0);
  b.getContext("2d").putImageData(ib, 0, 0);
  return { labels: await toBlob(a), soft: await toBlob(b) };
}

const detectFaces = (faces, canvas) => {
  try {
    return faces.detect(canvas).detections.filter((d) => d.boundingBox).map((d) => ({ ...d.boundingBox, score: d.categories?.[0]?.score ?? 0 }));
  } catch {
    return null; // cannot tell
  }
};

/** Crop `canvas` from row `top` down. */
function cropTop(canvas, top) {
  const out = canvasOf(canvas.width, canvas.height - top);
  out.getContext("2d").drawImage(canvas, 0, top, canvas.width, canvas.height - top, 0, 0, out.width, out.height);
  return out;
}

/**
 * Prepares a garment photo.
 *
 * Resolves { blob, how, cut, painted }:
 *   how   "mask"        hair and skin painted out, cut below the chin, no face left
 *         "mask-deeper" the same, but a face was found and the cut went lower
 *         "deep-crop"   no segmenter: cut well below the hair, no face found
 *         "...-unchecked" added to any of the above when no face detector was there to check
 *         "flat"        no person at all: a product shot, sent whole
 *         "none"        nothing clean could be made (blob is null): describe the garment in words instead
 *   cut   how far down the original the picture now starts (0 to 1)
 *
 * Options: maxSide (pixels), skin "auto" | "head" | "all" (whether hands and arms below the shoulders are painted out too;
 * auto does so only when a lot of bare skin would be left),
 * delegates (default GPU then CPU; only the first call's choice is used), debug (adds trace, full, views).
 */
export async function cleanReference(blob, { maxSide = 900, skin = "auto", soft = 0.4, delegates, debug = false } = {}) {
  const bmp = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const W = Math.round(bmp.width * scale), H = Math.round(bmp.height * scale);
    const { segmenter, faces } = await load(delegates);
    const pose = await body(bmp); // undefined = cannot tell, null = looked and found nobody

    const work = canvasOf(W, H);
    const ctx = work.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(bmp, 0, 0, W, H);

    const trace = [];
    let views = null;
    const finish = async (canvas, how, cut, painted = null) => ({ blob: await toBlob(canvas), how, cut, painted, ...(debug ? { trace, full: await toBlob(work), views } : {}) });
    const giveUp = () => ({ blob: null, how: "none", cut: 1, painted: null, ...(debug ? { trace, views } : {}) });

    // Where the detector saw faces in the photo as the store shot it, before anything was painted.
    // Detectors give weak false positives on skin-coloured or patterned cloth, so a face only counts as "still
    // there" after painting if it sits where a real face was.
    const original = faces ? detectFaces(faces, work) : null;
    const strong = (f) => f.score >= 0.5;
    const seen = original ? original.filter((f) => f.score >= 0.35) : [];
    // The model's own face: the detection nearest the nose the pose found, else the surest one. Anything else
    // counts only when the detector is sure (another person in the shot).
    const nose = pose ? pose.noseY * H : null;
    const byScore = (a, b) => b.score - a.score;
    const mine = nose != null ? seen.filter((f) => Math.abs(f.originY + f.height / 2 - nose) < f.height * 0.8).sort(byScore)[0] : seen.filter(strong).sort(byScore)[0];
    const real = seen.filter((f) => f.score >= 0.8 || f === mine);
    const noFace = original && !seen.some(strong); // the detector looked and saw no face
    const biggest = mine || null;
    const where = (f, row = 0) => ({ x: f.originX + f.width / 2, y: f.originY + row + f.height / 2 });
    const insideReal = (f, row) => {
      const c = where(f, row);
      return real.some((o) => c.x > o.originX && c.x < o.originX + o.width && c.y > o.originY && c.y < o.originY + o.height);
    };

    // Where the chin and the shoulders are: from the pose, and from the face box when the pose is missing.
    const poseChin = pose && pose.shoulderY > pose.mouthY ? pose.mouthY + (pose.shoulderY - pose.mouthY) * 0.55 : null;
    const faceChin = biggest ? (biggest.originY + biggest.height * 1.2) / H : null;
    const chin = poseChin ?? faceChin; // the mask removes the head itself, so the pose leads and the face box only stands in
    const shoulder = pose ? pose.shoulderY : biggest ? (biggest.originY + biggest.height * 2) / H : null;

    if (debug) trace.push({ pose: pose && { mouthY: +pose.mouthY.toFixed(3), shoulderY: +pose.shoulderY.toFixed(3), noseY: +pose.noseY.toFixed(3) }, poseChin, faceChin, chin, shoulder, real: real.map((f) => [Math.round(f.originX), Math.round(f.originY), Math.round(f.width), Math.round(f.height), +f.score.toFixed(2)]), W, H });

    // Look for a face in the picture from row `top` down; cut deeper, up to three times, until none is left.
    const checked = async (top, how, painted) => {
      let from = top;
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = Math.min(H - 8, Math.round(from));
        const out = cropTop(work, row);
        const found = faces ? detectFaces(faces, out) : null;
        const left = found && found.filter((f) => insideReal(f, row));
        if (debug) trace.push({ from: row, seen: found && found.map((f) => [Math.round(f.originX), Math.round(f.originY), Math.round(f.width), Math.round(f.height), +f.score.toFixed(2)]), left: left && left.length });
        const label = attempt && how === "mask" ? "mask-deeper" : how;
        if (found === null) return await finish(out, `${label}-unchecked`, from / H, painted);
        if (!left.length) return await finish(out, label, from / H, painted);
        const f = left.reduce((a, b) => (b.height > a.height ? b : a));
        from = from + f.originY + f.height * 1.5; // below the chin, with room to spare
        if (from >= H * 0.8) break;
      }
      return giveUp();
    };

    // Path A: the segmenter is here. Paint hair and skin out, whatever the pose says.
    const seg = segmenter ? labelsOf(segmenter, bmp, W, H) : null;
    if (seg) {
      // A small figure is a few pixels to a 256 by 256 model, so look again at the head and shoulders alone.
      if (biggest && biggest.height < H * 0.25) {
        const rx = Math.max(0, Math.round(biggest.originX - biggest.width * 2));
        const ry = Math.max(0, Math.round(biggest.originY - biggest.height * 0.8));
        const rw = Math.min(W - rx, Math.round(biggest.width * 5));
        const rh = Math.min(H - ry, Math.round(biggest.height * 5));
        const crop = canvasOf(rw, rh);
        crop.getContext("2d").drawImage(work, rx, ry, rw, rh, 0, 0, rw, rh);
        const zoom = labelsOf(segmenter, crop, rw, rh);
        if (zoom)
          for (let y = 0; y < rh; y++)
            for (let x = 0; x < rw; x++) {
              seg.labels[(ry + y) * W + rx + x] = zoom.labels[y * rw + x];
              seg.soft[(ry + y) * W + rx + x] = zoom.soft[y * rw + x];
            }
      }
      if (debug) views = await viewsOf(seg, W, H);
      const painted = paintOut(ctx, seg, W, H, { skin, shoulderY: shoulder, softMin: Math.round(soft * 255) });
      if (!painted) {
        // Nothing to paint. Only a face detector can say there is nobody hiding in the picture.
        if (pose || biggest) return await checked(Math.round(H * (chin ?? 0)), "mask", null);
        return noFace ? await finish(work, "flat", 0) : giveUp();
      }
      const top = chin != null ? chin : clothTop(seg.labels, W, H);
      return await checked(Math.round(H * Math.min(0.5, top)), "mask", painted);
    }

    // Path B: no segmenter. A deep crop, and a face check where there is a detector.
    if (shoulder != null && (pose || biggest)) return await checked(Math.round(H * Math.min(0.6, Math.max(shoulder + DEEP, chin ?? 0))), "deep-crop", null);
    if (pose === null && original) {
      if (noFace) return await finish(work, "flat", 0);
    }
    return giveUp(); // nothing here can tell a person from a product
  } finally {
    bmp.close?.();
  }
}
