// A store's tablet and its mirror screen talk through a room named after the screen: a Durable Object on Cloudflare
// (worker/index.mjs MirrorRoom), a map in memory on the laptop (server.mjs). Each side joins with a ticket that
// /api/link/ticket signs: the room, the side ("glass" is the screen, "pad" the tablet), good for a minute.
const enc = new TextEncoder();
const sha = async (text) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
const keyOf = async (secret) => crypto.subtle.importKey("raw", await sha("mirva-link|" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
export const TICKET_TTL = 60e3;
export const SIDES = ["glass", "pad"];

/** "<room>.<side>.<expires>.<signature>" */
export async function linkTicket(secret, room, side, now = Date.now()) {
  const body = `${room}.${side}.${now + TICKET_TTL}`;
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await keyOf(secret), enc.encode(body)));
  return `${body}.${Buffer.from(sig).toString("base64url")}`;
}

/** { room, side } if the ticket is ours and still good, else null. */
export async function checkLinkTicket(secret, ticket, now = Date.now()) {
  const parts = String(ticket || "").split(".");
  if (parts.length !== 4) return null;
  const [room, side, expires, sig] = parts;
  if (!room || !SIDES.includes(side) || !(Number(expires) > now)) return null;
  let given;
  try {
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify("HMAC", await keyOf(secret), given, enc.encode(`${room}.${side}.${expires}`));
  return ok ? { room, side } : null;
}

/** The other side of a room. */
export const across = (side) => (side === "pad" ? "glass" : "pad");
