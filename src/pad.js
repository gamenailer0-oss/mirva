// The store's tablet and its mirror screen, joined (lib/link.mjs). The tablet holds the stylist and the catalogue; the
// screen is all glass. Each side keeps one line open to their room and comes back to it by itself when it drops (a
// tablet that slept, a connection that blinked). Messages are small JSON: the tablet sends what was tapped, the screen
// sends what the glass is doing.
import * as link from "./link.js";

const PAD_KEY = "mirva:pad";
let pad = null;
try {
  pad = JSON.parse(localStorage.getItem(PAD_KEY) || "null");
} catch {}

/** This tablet's pairing with its screen, if it has one: { pad, token, brand, name }. */
export const padOf = () => pad;

/** The tablet scanned its screen's code: it becomes that screen's own. */
export async function join(code) {
  const res = await fetch("/api/link/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }), signal: link.timeout(15000) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || "That code didn’t work. Show a new one on the mirror.");
  pad = out;
  try {
    localStorage.setItem(PAD_KEY, JSON.stringify(out));
  } catch {}
  return out;
}

/** The tablet lets its screen go (or the screen no longer knows it). */
export function forget() {
  pad = null;
  try {
    localStorage.removeItem(PAD_KEY);
  } catch {}
}

/**
 * One side's line to its room. `onMessage` gets what the other side sends, `onPeer(here)` says when it comes or goes,
 * `onState` says how the line itself is: "connecting", "open", "unpaired" (stop: pair again), "replaced" (a newer
 * screen or tablet took this one's place).
 */
export function openRoom({ side, onMessage, onPeer, onState }) {
  let ws = null;
  let tries = 0;
  let closed = false;
  let beat = 0;
  let waiting = 0;
  const headers = () => (side === "pad" && pad ? { "x-mirva-pad": `${pad.pad}.${pad.token}` } : link.auth());
  async function connect() {
    if (closed || ws) return;
    clearTimeout(waiting);
    onState?.("connecting");
    try {
      const res = await fetch("/api/link/ticket", { method: "POST", headers: { "content-type": "application/json", ...headers() }, body: "{}", signal: link.timeout(15000) });
      const out = await res.json().catch(() => ({}));
      if (res.status === 401) return onState?.("unpaired");
      if (!res.ok || !out.ticket) throw new Error(out.error || "no ticket");
      const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/link/socket?t=${encodeURIComponent(out.ticket)}`);
      ws = socket;
      socket.onopen = () => {
        tries = 0;
        onState?.("open");
        clearInterval(beat);
        beat = setInterval(() => socket.readyState === 1 && socket.send("ping"), 25e3); // keeps phone networks from dropping a quiet line
      };
      socket.onmessage = (e) => {
        if (e.data === "pong") return;
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.t === "peer") onPeer?.(!!m.here);
        else onMessage?.(m);
      };
      socket.onclose = (e) => {
        clearInterval(beat);
        if (ws === socket) ws = null;
        onPeer?.(false);
        if (e.code === 4000) return onState?.("replaced");
        retry();
      };
    } catch {
      ws = null;
      retry();
    }
  }
  function retry() {
    if (closed) return;
    onState?.("connecting");
    clearTimeout(waiting);
    waiting = setTimeout(connect, Math.min(15000, 800 * 2 ** tries++));
  }
  const again = () => !closed && !ws && ((tries = 0), connect());
  addEventListener("online", again);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && again());
  connect();
  return {
    send: (m) => ws?.readyState === 1 && (ws.send(JSON.stringify(m)), true),
    close() {
      closed = true;
      clearTimeout(waiting);
      ws?.close(1000);
    },
    get open() {
      return ws?.readyState === 1;
    },
  };
}
