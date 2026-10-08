// Small HTTP helpers shared by every part of the server. They speak the web's own Request and
// Response, so the same code runs on a laptop under Node and on Cloudflare's edge.

export const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".tflite": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export const SECURITY = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(self), microphone=(), geolocation=(), payment=()",
  "cross-origin-resource-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
};

export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'", // the pose detector is WebAssembly
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "connect-src 'self' https://*.decart.ai wss://*.decart.ai https://fonts.googleapis.com https://fonts.gstatic.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// One address per surface. The shopper's site, the mirror, the store's site, and the two desks.
export const PAGES = {
  "/": "site/home.html",
  "/membership": "site/membership.html",
  "/account": "site/account.html",
  "/privacy": "site/privacy.html",
  "/terms": "site/terms.html",
  "/mirror": "mirror.html",
  "/retail": "retail/index.html",
  "/console": "desk/console.html",
  "/hq": "desk/hq.html",
};
export const PATTERNS = [
  [/^\/b\/[A-Z0-9]{10}$/, "site/board.html"],
  [/^\/claim\/[A-Za-z0-9]{8}$/, "site/account.html"],
  [/^\/for\/[a-z0-9-]+$/, "retail/pitch.html"],
];

export const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...SECURITY, "content-type": TYPES[".json"], "cache-control": "no-store", ...headers } });

// Reads a body with a hard size limit, whether or not the sender declared a length.
async function readCapped(request, max) {
  if (Number(request.headers.get("content-length") || 0) > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) (out.set(c, at), (at += c.byteLength));
  return out;
}

// Reads a small JSON body. Anything oversized or malformed becomes an empty object,
// so every route validates its own fields and nothing downstream sees a parse error.
export async function readBody(request, max = 1e5) {
  try {
    const bytes = await readCapped(request, max);
    if (!bytes || !bytes.byteLength) return {};
    const v = JSON.parse(new TextDecoder().decode(bytes));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

// A multipart form (the shopper's frame and the garment reference), with a size limit.
export async function readForm(request, max) {
  if (Number(request.headers.get("content-length") || 0) > max) throw Object.assign(new Error("That picture is too large."), { status: 413 });
  return request.formData();
}

export const cookies = (request) => {
  const out = {};
  for (const part of String(request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {}
  }
  return out;
};

// Field cleaners. Every value that reaches the database goes through one of these.
export const text = (v, max = 200) =>
  String(v ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
export const int = (v, lo, hi, fallback = lo) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
export const email = (v) => {
  const e = text(v, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : "";
};
