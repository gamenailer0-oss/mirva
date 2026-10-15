// The answer to a new mirror's portrait request: what happened (as JSON) and the picture, in one body.
// 4 bytes (big-endian) the length of the JSON, the JSON, then the picture's own bytes. No base64, so nothing grows.
// Shared by the server (lib/app.mjs) and the page (src/portrait.js), so it imports nothing.
export const SHOT_TYPE = "application/vnd.mirva.shot";

export function packShot(meta, bytes) {
  const head = new TextEncoder().encode(JSON.stringify(meta));
  const out = new Uint8Array(4 + head.length + bytes.byteLength);
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  out.set(new Uint8Array(bytes), 4 + head.length);
  return out;
}

/** The other side of packShot: { meta, picture } from the body's ArrayBuffer. */
export function unpackShot(buffer) {
  const n = new DataView(buffer).getUint32(0);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, n)));
  return { meta, picture: new Uint8Array(buffer, 4 + n) };
}
