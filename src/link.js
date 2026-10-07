// The mirror's line to the platform: who is standing here, what happened, and the way to a phone.
// Everything here is best-effort. If the line is down, the mirror still works.

const DEVICE_KEY = "mirva:device";
let device = null;
try {
  device = JSON.parse(localStorage.getItem(DEVICE_KEY) || "null");
} catch {}

/** Headers that tell the server which paired store mirror this is. */
export const auth = () => (device ? { "x-mirva-device": `${device.id}.${device.token}` } : {});
export const pairedTo = () => device;

/** A signal that fires after `ms`. Browsers without AbortSignal.timeout get a timer instead. */
export const timeout = (ms) => {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const stop = new AbortController();
  setTimeout(() => stop.abort(), ms);
  return stop.signal;
};

// Gives up after 15 seconds. The caller sometimes shows e.message to the shopper, so it is a plain sentence.
const post = async (path, body, keepalive = false) => {
  const signal = timeout(15000);
  let res;
  let data;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", ...auth() }, body: JSON.stringify(body), keepalive, signal });
    data = await res.json().catch((e) => {
      if (signal.aborted) throw e;
      return {};
    });
  } catch (e) {
    throw new Error(e?.name === "TimeoutError" || e?.name === "AbortError" ? "That took too long. Tap to try again." : "The connection dropped. Tap to try again.");
  }
  if (!res.ok) throw Object.assign(new Error(data.error || "That didn't work."), { status: res.status, data });
  return data;
};

/** A store's console hands out a six-character code. Entering it makes this screen that store's mirror. */
export async function pair(code) {
  const out = await post("/api/pair", { code });
  device = { id: out.device, token: out.token, brand: out.brand, name: out.name };
  localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  return device;
}

/** The signed-in member, if this is someone's own phone or laptop rather than a store mirror. */
export let member = null;
export async function whoIsHere() {
  try {
    const me = await (await fetch("/api/me", { headers: auth(), signal: timeout(15000) })).json();
    member = me.user?.role === "member" ? me : null;
  } catch {
    member = null;
  }
  return member;
}

// --- what happened at the mirror ---------------------------------------------
let brand = null;
let visit = null;
let queue = [];
let timer = 0;

export function setBrand(id) {
  flush();
  brand = id;
  visit = null;
}

/** A new shopper has stepped up: the next thing that happens starts a fresh visit. */
export function newVisit() {
  flush();
  visit = null;
}

export function track(kind, data = {}) {
  if (!brand) return;
  if (!visit) {
    visit = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    queue.push({ kind: "visit" });
  }
  queue.push({ kind, ...data });
  clearTimeout(timer);
  timer = setTimeout(flush, 1200);
}

export function flush(leaving = false) {
  clearTimeout(timer);
  if (!queue.length || !brand || !visit) return;
  const events = queue;
  queue = [];
  post("/api/events", { brand, visit, events }, leaving).catch(() => {});
}

/** Looks the shopper kept, parked on the server so a phone can collect them. Returns the link for the QR code. */
export const handoff = (brandId, looks) => post("/api/handoff", { brand: brandId, looks });

/** At home, a member's kept look goes straight into the wardrobe. */
export const saveLook = (look) => post("/api/wardrobe", look);
