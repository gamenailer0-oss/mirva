// The client's side of a Model-mode portrait: a cheap look at the camera frame before anything is paid for,
// the call to the server (with one polite retry when the studio is busy), and the cross-fade to the version on a
// studio backdrop. src/main.js decides what to do with each; none of it needs the camera or the pose model.

export const DIM_LINE = "It's dim where you are. Face a window or a lamp, then try again.";
export const BUSY_LINE = "The studio is busy. One more try.";
export const BACKDROP_LINE = "Now on a studio backdrop.";

// Below this mean brightness (0 to 255) a frame gives a murky portrait with muted cloth, and no later pass can
// fix it (measured: docs/portrait-experiments.md, a frame at 38 against a usable one at 104).
export const DIM = 60;
// Above this, the wall behind her is not plain and the portrait gets a second pass for a studio backdrop.
// Measured on 20 pictures: plain studio walls scored 0.2 to 1.7, rooms, brick, shelves and markets 4.5 to 17.
export const BUSY = 3;

/** Mean brightness of RGBA pixels, 0 to 255. */
export function meanLuma(rgba) {
  let sum = 0;
  const n = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  return n ? sum / n : 0;
}

/**
 * How busy the wall is: the mean edge strength (on a lightly smoothed picture) in the two bands beside the head,
 * the outer fifth of the frame at each side, top three-tenths. The worse side counts, so a bookshelf on one side
 * is enough. Plain walls, even grainy webcam ones, stay near zero; clutter does not.
 */
export function wallBusyness(rgba, w, h) {
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  const at = (x, y) => L[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const smooth = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) s += at(x + k, y + j);
      smooth[y * w + x] = s / 9;
    }
  const edge = (x0, x1) => {
    let sum = 0, n = 0;
    for (let y = 2; y < Math.min(h - 2, Math.ceil(h * 0.3)); y++)
      for (let x = Math.max(2, Math.floor(x0 * w)); x < Math.min(w - 2, Math.ceil(x1 * w)); x++) {
        sum += Math.abs(smooth[y * w + x + 1] - smooth[y * w + x - 1]) / 2 + Math.abs(smooth[(y + 1) * w + x] - smooth[(y - 1) * w + x]) / 2;
        n++;
      }
    return n ? sum / n : 0;
  };
  return Math.max(edge(0, 0.2), edge(0.8, 1));
}

/** A first look at a camera frame (a Blob): is it too dim, and is the wall behind her busy? Never throws. */
export async function lookAt(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 96 / Math.max(bmp.width, bmp.height));
    const w = Math.max(16, Math.round(bmp.width * scale)), h = Math.max(16, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const px = ctx.getImageData(0, 0, w, h).data;
    const luma = meanLuma(px);
    const edge = wallBusyness(px, w, h);
    return { luma, edge, dim: luma < DIM, busy: edge > BUSY };
  } catch {
    return { luma: null, edge: null, dim: false, busy: false }; // cannot tell: never stop a shopper on a failed check
  }
}

/**
 * Sends the form to /api/model-shot. A busy studio (a gateway time-out, or the server's own "busy") gets one more
 * try after a couple of seconds; anything else is the answer. Resolves { blob, saved } or throws an Error with the
 * server's words (kind "busy" when the second try was busy too, `status` when the server gave one).
 * The server meters only a call that returned a picture, so a retry costs nothing extra.
 */
export async function requestShot(form, { headers = {}, timeout, onBusy, wait = 2000, fetcher = fetch } = {}) {
  const once = async () => {
    const res = await fetcher("/api/model-shot", { method: "POST", body: form, headers, signal: timeout ? timeout(75000) : undefined });
    if (res.ok) return { blob: await res.blob(), saved: res.headers.get("x-mirva-portrait") || null };
    let body = null;
    try {
      body = await res.json();
    } catch {} // a gateway's own page is not JSON
    const busy = [502, 503, 504].includes(res.status) && (!body || body.busy === true);
    throw Object.assign(new Error(body?.error || "The portrait didn't come out."), { status: res.status, busy, limit: body?.limit });
  };
  try {
    return await once();
  } catch (e) {
    if (!e.busy) throw e;
  }
  onBusy?.();
  await new Promise((r) => setTimeout(r, wait));
  try {
    return await once();
  } catch (e) {
    if (e.busy) throw Object.assign(new Error("The studio is busy just now. Please try again in a little while."), { kind: "busy", status: e.status });
    throw e;
  }
}

/**
 * Fades the picture in `img` over to `url` and resolves true when it has. Resolves false, changing nothing, if the
 * new picture will not load. The old picture stays under the new one, so the glass is never empty and there is no spinner.
 */
export function crossfade(img, url, ms = 900) {
  return new Promise((resolve) => {
    const next = new Image();
    next.onload = () => {
      const ghost = img.cloneNode(false); // keeps the glass's own styling (it fills the glass)
      ghost.removeAttribute("id");
      ghost.classList.remove("unveil");
      ghost.hidden = false;
      ghost.src = url;
      ghost.style.cssText = `opacity:0;z-index:2;pointer-events:none;transition:opacity ${ms}ms ease`;
      img.after(ghost);
      void ghost.offsetWidth;
      ghost.style.opacity = "1";
      setTimeout(() => {
        img.src = url;
        ghost.remove();
        resolve(true);
      }, ms + 80);
    };
    next.onerror = () => resolve(false);
    next.src = url;
  });
}
