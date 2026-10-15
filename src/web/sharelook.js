// One kept look, sent to the family: a single picture with her portrait by MIRVA on the left and the store's own photo
// on the right, the piece, the store and the price under them. On a phone it goes into the share sheet (WhatsApp is
// one tap); where pictures cannot be shared (a laptop), WhatsApp opens with the words and the store's link.

const W = 1080, H = 1350, BAND = 190;
const load = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

// Draws `img` to fill the box, keeping the top of the picture (where the face is).
function cover(ctx, img, x, y, w, h, top = 0.12) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / s, sh = h / s;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = Math.max(0, Math.min(img.naturalHeight - sh, (img.naturalHeight - sh) * top));
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/** Resolves a JPEG File: { portrait, store } are same-site picture addresses (a blob: URL, /api/portrait/…, /img?…). */
export async function lookPicture({ portrait, store, name, brand, price }) {
  const [a, b] = await Promise.all([load(portrait), store ? load(store).catch(() => null) : null]);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#0a0c11";
  ctx.fillRect(0, 0, W, H);
  const half = b ? W / 2 - 3 : W;
  cover(ctx, a, 0, 0, half, H - BAND);
  if (b) cover(ctx, b, W / 2 + 3, 0, half, H - BAND, 0);
  // the two labels, small, at the foot of each picture
  ctx.font = "500 22px Jost, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  const tag = (text, x) => {
    const w = ctx.measureText(text).width + 36;
    ctx.fillStyle = "rgba(10,12,17,.78)";
    ctx.beginPath();
    ctx.roundRect(x, H - BAND - 64, w, 44, 22);
    ctx.fill();
    ctx.fillStyle = "#f3f5f9";
    ctx.fillText(text, x + 18, H - BAND - 42);
  };
  tag("ME, BY MIRVA", 24);
  if (b) tag("THE STORE'S PHOTO", W / 2 + 27);
  // the band: the piece, then the store and price, then MIRVA's mark
  ctx.fillStyle = "#f3f5f9";
  ctx.font = "italic 400 46px 'Bodoni Moda', Georgia, serif";
  ctx.fillText(fit(ctx, name, W - 96), 48, H - BAND + 62);
  ctx.fillStyle = "#a9b0c0";
  ctx.font = "400 28px Jost, system-ui, sans-serif";
  ctx.fillText([brand, price].filter(Boolean).join("  ·  "), 48, H - BAND + 122);
  ctx.textAlign = "right";
  ctx.font = "500 24px 'Bodoni Moda', Georgia, serif";
  ctx.fillText("M I R V A", W - 48, H - BAND + 122);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
  return new File([blob], "mirva-look.jpg", { type: "image/jpeg" });
}

function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 4 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

/** The words that go with it. */
export const lookWords = ({ name, brand, price, url }) =>
  `${name}${brand ? ` from ${brand}` : ""}${price ? `, ${price}` : ""}. On the left, me in it (made by MIRVA); on the right, the store's own photo. What do you think?${url ? `\n${url}` : ""}`;

/** Opens the share sheet with the picture, inside the tap that asked for it. Returns true when something opened. */
export async function shareLook(file, words) {
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: words });
      return true;
    } catch (e) {
      if (e?.name === "AbortError") return true; // she closed the sheet herself
    }
  }
  open(`https://wa.me/?text=${encodeURIComponent(words)}`, "_blank", "noopener");
  return true;
}
