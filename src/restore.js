// The shopper's own head, put back on the portrait.
//
// Why: given a garment picture, the still engine redraws the whole person, and the head with it. Seventeen test
// portraits of one man (docs/tryon-research.md): every one made with a garment picture came back with another
// man's hair and face, whatever the picture and however it was cleaned; only a portrait made from words alone kept
// his own. No wording stops it. What the engine does keep is where everything is: the pose, the framing and the wall.
// So the head she walked in with is laid back over the head the engine drew, in the same place.
//
// How:
//  1. Find her head in the frame she sent (the pose model; the face detector when the pose model is away).
//  2. In a square around it, label the frame and the portrait: hair, face, neck, cloth, wall (the same model that
//     cleans the garment pictures).
//  3. Lay her own hair and face over the portrait. Where the drawn head is bigger than hers (bigger hair, mostly),
//     lay her own wall over it too, since the wall did not change. Her neck and collar are never laid back: the neck
//     and the collar belong to the new garment.
//  4. If the engine moved the head (it re-posed her after all), or anything else is in doubt, leave the portrait alone.
//
// `tight` is for a picture whose wall has changed (the studio backdrop pass): only her hair and face go back.
//
// The same holds for the garment in that second pass. Asked to change nothing but the wall, the engine still draws
// the whole picture again, and the clothes come back a little different: a bottle green suit came back emerald, and
// a line of embroidery moved. The first picture is the one made from the store's photo, so its figure is laid back
// over the second, a touch inside its own edge (restoreFigure). The new backdrop and the outline against it stay.
import { head } from "./vision.js";
import { load, labelsOf, grow, feather, canvasOf } from "./reference.js";

const N = 384; // the square around the head is labelled at this size
const BACKGROUND = 0, HAIR = 1, BODY_SKIN = 2, FACE_SKIN = 3, CLOTHES = 4, OTHERS = 5;
const WIDE = 3.2; // the square is this many head-widths across
const RING = 0.03; // her own wall is laid this far (of the square) around her head, to cover a fringe of drawn hair
const SPILL = 0.035; // and this far around the head the engine drew, wherever her picture has wall there
const DARKER = 0.72; // a leftover pixel this much darker than the drawn skin is beard, not neck
const REACH = 0.14; // how far down (of the square) a leftover pixel of the drawn head may look for what lies beneath it
const SOFT = 3; // pixels (at N) the edge fades over
const MOVED = 0.34; // the drawn face may sit this far (of a head-width) from hers before it counts as moved
const M = 512; // the whole picture is labelled at this size (its longer side) when the figure is laid back
const INSIDE = 0.006; // the figure goes back this far (of the longer side) inside its own edge
const TONE = 0.016; // the edge left as the second pass drew it takes the first picture's colour, averaged over this far
const WALL_NEAR = 18, WALL_FAR = 54; // how unlike the new backdrop (summed over red, green and blue) a pixel must be to count as her: not at all, and fully
const SAME = 0.8; // the two figures must share this much of their area, or the engine has moved her

const centreOf = (labels, label) => {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < labels.length; i++)
    if (labels[i] === label) {
      sx += i % N;
      sy += Math.floor(i / N);
      n++;
    }
  return n ? { x: sx / n, y: sy / n, n } : null;
};

/** Shrink a 0/1 mask by r pixels: what is left after its edge is worn away. */
function shrink(mask, r, W = N, H = N) {
  const inverse = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inverse[i] = mask[i] ? 0 : 1;
  const worn = grow(inverse, W, H, r);
  for (let i = 0; i < worn.length; i++) worn[i] = worn[i] ? 0 : 1;
  return worn;
}

/** Two box blurs of radius r over a field of numbers. */
function blur(src, W, H, r) {
  const pass = (from, len, lines, stride, step) => {
    const to = new Float32Array(from.length);
    const sums = new Float64Array(len + 1);
    for (let l = 0; l < lines; l++) {
      const base = l * stride;
      for (let i = 0; i < len; i++) sums[i + 1] = sums[i] + from[base + i * step];
      for (let i = 0; i < len; i++) {
        const lo = Math.max(0, i - r), hi = Math.min(len, i + r + 1);
        to[base + i * step] = (sums[hi] - sums[lo]) / (hi - lo);
      }
    }
    return to;
  };
  let a = src;
  for (let n = 0; n < 2; n++) a = pass(pass(a, W, H, W, 1), H, W, 1, W);
  return a;
}

/** The face the detector is surest of, as { x, y, width } in the canvas's pixels, or null. */
function faceIn(faces, canvas) {
  try {
    const best = faces
      .detect(canvas)
      .detections.filter((d) => d.boundingBox)
      .sort((a, b) => (b.categories?.[0]?.score ?? 0) - (a.categories?.[0]?.score ?? 0))[0];
    if (!best || (best.categories?.[0]?.score ?? 0) < 0.5) return null;
    const b = best.boundingBox;
    return { x: b.originX + b.width / 2, y: b.originY + b.height / 2, width: b.width * 1.15 };
  } catch {
    return null;
  }
}

/**
 * Lays the head from `original` (the frame the shopper sent) over `result` (the portrait that came back).
 * Both are Blobs. Resolves { blob, how }: how is "restored", or why the portrait was left as it came
 * ("shape", "notools", "nohead", "moved", "failed"); blob is then the portrait itself, untouched. Never throws.
 */
export async function restoreHead(original, result, { tight = false, debug = false } = {}) {
  const asItCame = (how, extra) => ({ blob: result, how, ...extra });
  let a, b;
  try {
    [a, b] = await Promise.all([createImageBitmap(original), createImageBitmap(result)]);
    const W = b.width, H = b.height;
    if (Math.abs(a.width / a.height - W / H) > 0.03) return asItCame("shape");
    const { segmenter, faces } = await load();
    if (!segmenter) return asItCame("notools");

    // Her frame at the portrait's size, and the portrait.
    const mine = canvasOf(W, H);
    mine.getContext("2d").drawImage(a, 0, 0, W, H);
    const out = canvasOf(W, H);
    const octx = out.getContext("2d");
    octx.drawImage(b, 0, 0);

    const at = (await head(mine)) || (faces && faceIn(faces, mine));
    if (!at) return asItCame("nohead");
    const side = Math.max(96, at.width * WIDE);
    const x = at.x - side / 2, y = at.y - at.width * 0.2 - side / 2;

    const square = (canvas) => {
      const c = canvasOf(N, N);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, N, N);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(canvas, x, y, side, side, 0, 0, N, N);
      return c;
    };
    const hers = labelsOf(segmenter, square(mine), N, N);
    const drawn = labelsOf(segmenter, square(out), N, N);
    if (!hers) return asItCame("failed");

    // Has the engine kept the head where it was? The middle of the face, hers against the drawn one.
    const f0 = centreOf(hers.labels, FACE_SKIN), f1 = drawn && centreOf(drawn.labels, FACE_SKIN);
    if (!f0 || f0.n < N * N * 0.004) return asItCame("nohead");
    const headPx = (at.width / side) * N;
    if (f1 && Math.hypot(f1.x - f0.x, f1.y - f0.y) > headPx * MOVED) return asItCame("moved");
    if (drawn && !f1) return asItCame("moved"); // no face where hers was: she was turned or re-framed

    // What goes back: her hair and face (and glasses or earrings, which the model calls "others", no lower than her chin).
    let chin = 0;
    for (let i = 0; i < hers.labels.length; i++) if (hers.labels[i] === FACE_SKIN) chin = Math.max(chin, Math.floor(i / N));
    const own = new Uint8Array(N * N);
    const wall = new Uint8Array(N * N);
    const over = new Uint8Array(N * N); // the head the engine drew: its hair and face, and any skin level with her face (an ear, a cheek)
    for (let i = 0; i < own.length; i++) {
      const k = hers.labels[i];
      const row = Math.floor(i / N);
      own[i] = k === HAIR || k === FACE_SKIN || (k === OTHERS && row <= chin) ? 1 : 0;
      wall[i] = k === BACKGROUND ? 1 : 0;
      const d = drawn ? drawn.labels[i] : BACKGROUND;
      over[i] = d === HAIR || d === FACE_SKIN || (d === BODY_SKIN && row < chin) ? 1 : 0;
    }
    const lay = new Uint8Array(N * N);
    if (tight) {
      // The wall is new, so nothing of her old wall may come along: only pixels that are head in both pictures, a
      // touch inside the edge. The outline of the hair stays as the engine drew it against the new backdrop.
      const both = new Uint8Array(N * N);
      for (let i = 0; i < both.length; i++) both[i] = own[i] && (!drawn || over[i]) ? 1 : 0;
      lay.set(shrink(both, 2));
    }
    else {
      // Her wall goes back too: in a ring round her head, and wherever the drawn head spills past hers (bigger hair,
      // mostly; the label map is coarse, so the spill is taken a little wide). Never over the new garment.
      const ring = grow(own, N, N, Math.round(N * RING));
      const spill = grow(over, N, N, Math.round(N * SPILL));
      for (let i = 0; i < lay.length; i++) lay[i] = own[i] || ((ring[i] || spill[i]) && wall[i] && drawn?.labels[i] !== CLOTHES) ? 1 : 0;

      // What is left of the drawn head lies over her neck or her collar (a longer chin, a fuller beard). Skin left
      // there reads as her neck and stays. Hair left there (the drawn beard) does not: each such pixel takes what the
      // portrait shows beneath it.
      if (drawn) {
        const px = square(out).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, N, N).data;
        const lum = (i) => 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
        // the drawn skin, from the upper half of the drawn face (no beard there)
        const tones = [];
        for (let i = 0; i < drawn.labels.length; i += 3) if (drawn.labels[i] === FACE_SKIN && Math.floor(i / N) < f1.y) tones.push(lum(i));
        tones.sort((p, q) => p - q);
        const skin = tones.length > 20 ? tones[tones.length >> 1] : 255;
        const left = new Uint8Array(N * N);
        let any = 0;
        for (let i = 0; i < left.length; i++) if (over[i] && !lay[i] && (drawn.labels[i] === HAIR || lum(i) < skin * DARKER)) (left[i] = 1), any++;
        if (any) {
          // Column by column: the strip of neck or collar under the leftover is drawn again, stretched upward to
          // her own chin, so the collar's opening and its edges carry on instead of ending in a block of one colour.
          // A sliver a few pixels wide (a wisp of drawn hair by the neck) is left alone: filled, it would be a pale streak.
          const solid = grow(shrink(left, 2), N, N, 2);
          for (let i = 0; i < left.length; i++) left[i] = left[i] && solid[i] ? 1 : 0;
          const wide = grow(left, N, N, 2);
          const hole = (i) => wide[i] && !lay[i];
          const fillPx = new Uint8ClampedArray(N * N * 4);
          const reach = Math.round(N * REACH);
          const floor = Math.min(N, Math.floor(((H - y) / side) * N)); // the picture ends here; below it the square is blank
          const edgeL = Math.max(0, Math.ceil((-x / side) * N)), edgeR = Math.min(N, Math.floor(((W - x) / side) * N));
          for (let cx = edgeL; cx < edgeR; cx++) {
            let cy = floor - 1;
            while (cy >= 0) {
              if (!hole(cy * N + cx)) {
                cy--;
                continue;
              }
              const bottom = cy;
              while (cy >= 0 && hole(cy * N + cx)) cy--;
              const top = cy + 1;
              const tall = bottom - top + 1;
              // the strip beneath: as tall as the leftover, so nothing is stretched more than twice
              let strip = 0;
              while (strip < Math.max(6, Math.min(tall, reach)) && bottom + 1 + strip < floor) strip++;
              if (strip >= 2) {
                const span = tall + strip;
                for (let r = 0; r < span; r++) {
                  const at = bottom + 1 + (r * (strip - 1)) / (span - 1);
                  const lo = Math.floor(at), hi = Math.min(bottom + strip, lo + 1), t = at - lo;
                  const p = (lo * N + cx) * 4, q = (hi * N + cx) * 4, o = ((top + r) * N + cx) * 4;
                  for (let c = 0; c < 3; c++) fillPx[o + c] = px[p + c] * (1 - t) + px[q + c] * t;
                  fillPx[o + 3] = 255;
                }
                continue;
              }
              // nothing beneath (the picture ends at her collar): take the nearest pixel to the side that is not leftover
              for (let r = top; r <= bottom; r++) {
                let from = -1;
                for (let d = 1; d < reach && from < 0; d++) {
                  if (cx - d >= edgeL && !hole(r * N + cx - d) && !lay[r * N + cx - d]) from = r * N + cx - d;
                  else if (cx + d < edgeR && !hole(r * N + cx + d) && !lay[r * N + cx + d]) from = r * N + cx + d;
                }
                if (from >= 0) fillPx.set([px[from * 4], px[from * 4 + 1], px[from * 4 + 2], 255], (r * N + cx) * 4);
              }
            }
          }
          const fill = canvasOf(N, N);
          fill.getContext("2d").putImageData(new ImageData(fillPx, N, N), 0, 0);
          octx.imageSmoothingQuality = "high";
          octx.drawImage(fill, x, y, side, side);
        }
      }
    }
    const alpha = feather(lay, N, N, SOFT);

    // Her pixels, cut to that shape, laid over the portrait.
    const mask = canvasOf(N, N);
    const mctx = mask.getContext("2d");
    const md = mctx.createImageData(N, N);
    for (let i = 0; i < alpha.length; i++) md.data[i * 4 + 3] = alpha[i];
    mctx.putImageData(md, 0, 0);
    const S = Math.round(side);
    const patch = canvasOf(S, S);
    const pctx = patch.getContext("2d");
    pctx.imageSmoothingQuality = "high";
    pctx.drawImage(mine, x, y, side, side, 0, 0, S, S);
    pctx.globalCompositeOperation = "destination-in";
    pctx.drawImage(mask, 0, 0, S, S);
    octx.drawImage(patch, x, y, side, side);

    const blob = await new Promise((resolve) => out.toBlob(resolve, "image/jpeg", 0.95));
    if (!blob) return asItCame("failed");
    return { blob, how: "restored", ...(debug ? { box: { x, y, side }, moved: f1 ? Math.hypot(f1.x - f0.x, f1.y - f0.y) / headPx : null } : {}) };
  } catch (e) {
    console.warn("The shopper's own head could not be put back; the portrait is shown as it came.", e);
    return asItCame("failed");
  } finally {
    a?.close?.();
    b?.close?.();
  }
}

/**
 * Lays the figure from `first` (the portrait as first made, from the store's photo) over `second` (the same portrait
 * after the backdrop pass). Both are Blobs. Resolves { blob, how }: how is "restored", or why the second picture was
 * left as it came ("shape", "notools", "moved", "failed"). Never throws.
 */
export async function restoreFigure(first, second, { debug = false } = {}) {
  const asItCame = (how, extra) => ({ blob: second, how, ...extra });
  let a, b;
  try {
    [a, b] = await Promise.all([createImageBitmap(first), createImageBitmap(second)]);
    const W = b.width, H = b.height;
    if (Math.abs(a.width / a.height - W / H) > 0.03) return asItCame("shape");
    const { segmenter } = await load();
    if (!segmenter) return asItCame("notools");

    const scale = Math.min(1, M / Math.max(W, H));
    const w = Math.round(W * scale), h = Math.round(H * scale);
    const small = (bmp) => {
      const c = canvasOf(w, h);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, w, h);
      return c;
    };
    const sa = small(a), sb = small(b);
    const was = labelsOf(segmenter, sa, w, h), now = labelsOf(segmenter, sb, w, h);
    if (!was || !now) return asItCame("failed");

    // Is she where she was? What the two figures share, against what either covers.
    const both = new Uint8Array(w * h);
    let shared = 0, either = 0;
    for (let i = 0; i < both.length; i++) {
      const p = was.labels[i] !== BACKGROUND, q = now.labels[i] !== BACKGROUND;
      if (p && q) (both[i] = 1), shared++;
      if (p || q) either++;
    }
    if (!either || shared / either < SAME) return asItCame("moved", debug ? { same: either ? shared / either : 0 } : {});

    const r = Math.max(2, Math.round(Math.max(w, h) * INSIDE));
    const alpha = feather(shrink(both, r, w, h), w, h, Math.max(1, r >> 1));
    const mask = canvasOf(w, h);
    const mctx = mask.getContext("2d");
    const md = mctx.createImageData(w, h);
    for (let i = 0; i < alpha.length; i++) md.data[i * 4 + 3] = alpha[i];
    mctx.putImageData(md, 0, 0);

    // The first picture, cut to that shape, over the second.
    const patch = canvasOf(W, H);
    const pctx = patch.getContext("2d");
    pctx.imageSmoothingQuality = "high";
    pctx.drawImage(a, 0, 0, W, H);
    pctx.globalCompositeOperation = "destination-in";
    pctx.drawImage(mask, 0, 0, W, H);
    const out = canvasOf(W, H);
    const octx = out.getContext("2d", { willReadFrequently: true });
    octx.drawImage(b, 0, 0);

    // The edge of the figure stays as the second pass drew it, so its outline sits cleanly on the new backdrop. But
    // that pass often lights her differently, and a rim of another shade would show round the garment. So the edge
    // takes the first picture's colour too: the difference between the two, averaged over a patch, is added to it.
    // The label map is coarse and runs a few pixels over the outline, so a pixel takes the correction only as far as
    // it is unlike the backdrop beside it; otherwise the backdrop would be tinted in a line round her.
    const pa = sa.getContext("2d").getImageData(0, 0, w, h).data, pb = sb.getContext("2d").getImageData(0, 0, w, h).data;
    const reach = Math.max(2, Math.round(Math.max(w, h) * TONE));
    const weight = new Float32Array(w * h);
    for (let i = 0; i < weight.length; i++) weight[i] = both[i];
    const share = blur(weight, w, h, reach);
    const near = feather(both, w, h, r); // 0..255: how much of the correction a pixel takes
    const tone = canvasOf(w, h);
    const tctx = tone.getContext("2d");
    const td = tctx.createImageData(w, h);
    for (let c = 0; c < 3; c++) {
      const diff = new Float32Array(w * h);
      for (let i = 0; i < diff.length; i++) diff[i] = both[i] ? pa[i * 4 + c] - pb[i * 4 + c] : 0;
      const soft = blur(diff, w, h, reach);
      for (let i = 0; i < diff.length; i++) td.data[i * 4 + c] = 128 + ((share[i] > 0.02 ? soft[i] / share[i] : 0) * (near[i] / 255)) / 2;
    }
    for (let i = 0; i < w * h; i++) td.data[i * 4 + 3] = 255;
    tctx.putImageData(td, 0, 0);
    // the new backdrop's colour beside each pixel: the second picture, averaged over its backdrop alone
    const open = new Float32Array(w * h);
    let n = 0;
    const mean = [0, 0, 0];
    for (let i = 0; i < open.length; i++)
      if (now.labels[i] === BACKGROUND) {
        open[i] = 1;
        n++;
        for (let c = 0; c < 3; c++) mean[c] += pb[i * 4 + c];
      }
    const room = blur(open, w, h, reach * 2);
    const wd = tctx.createImageData(w, h);
    for (let c = 0; c < 3; c++) {
      const seen = new Float32Array(w * h);
      for (let i = 0; i < seen.length; i++) seen[i] = open[i] ? pb[i * 4 + c] : 0;
      const soft = blur(seen, w, h, reach * 2);
      for (let i = 0; i < seen.length; i++) wd.data[i * 4 + c] = room[i] > 0.02 ? soft[i] / room[i] : n ? mean[c] / n : 255;
    }
    for (let i = 0; i < w * h; i++) wd.data[i * 4 + 3] = 255;
    const wallAt = canvasOf(w, h);
    wallAt.getContext("2d").putImageData(wd, 0, 0);

    const full = (canvas) => {
      const c = canvasOf(W, H);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(canvas, 0, 0, W, H);
      return ctx.getImageData(0, 0, W, H).data;
    };
    const shift = full(tone), wall = full(wallAt);
    const pic = octx.getImageData(0, 0, W, H);
    const d = pic.data;
    for (let i = 0; i < d.length; i += 4) {
      if (shift[i] === 128 && shift[i + 1] === 128 && shift[i + 2] === 128) continue;
      const unlike = Math.abs(d[i] - wall[i]) + Math.abs(d[i + 1] - wall[i + 1]) + Math.abs(d[i + 2] - wall[i + 2]);
      const hers = Math.min(1, Math.max(0, (unlike - WALL_NEAR) / (WALL_FAR - WALL_NEAR)));
      if (hers) for (let c = 0; c < 3; c++) d[i + c] += (shift[i + c] - 128) * 2 * hers; // clamped by the array
    }
    octx.putImageData(pic, 0, 0);

    octx.drawImage(patch, 0, 0);

    const blob = await new Promise((resolve) => out.toBlob(resolve, "image/jpeg", 0.95));
    if (!blob) return asItCame("failed");
    return { blob, how: "restored", ...(debug ? { same: shared / either } : {}) };
  } catch (e) {
    console.warn("The garment as first drawn could not be put back; the picture is shown as it came.", e);
    return asItCame("failed");
  } finally {
    a?.close?.();
    b?.close?.();
  }
}

/**
 * Fetches the models this needs and takes the first look, which is the slow one (the model is compiled for the
 * graphics chip, and the page can do nothing else meanwhile). Called while a portrait is being made, so the wait
 * hides it. Never throws.
 */
let warm = null;
export const warmRestore = () =>
  (warm ??= (async () => {
    try {
      const { segmenter } = await load();
      if (segmenter) labelsOf(segmenter, canvasOf(64, 64), 8, 8);
    } catch {}
  })());
