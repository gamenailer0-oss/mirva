// Her look from a MIRVA mirror, on her own phone: opened by scanning the code on the glass. While the portrait is made it
// waits here, so she can walk the store; when it is ready her phone buzzes and, if she asked, tells her. Then she can
// send this page to her family. The page and her portrait are deleted after a day.
import { $, el, api, money, fill } from "./ui.js";

const code = location.pathname.split("/").pop();
const WAIT_MS = 4 * 60e3;
let tellMe = false;

export async function start() {
  const root = $("#pickup");
  let look;
  try {
    look = await api(`/api/pickup/${code}/open`, {});
  } catch {
    return gone(root);
  }
  if (look.portrait) return ready(root, look, false);
  waiting(root, look);
  const began = Date.now();
  const poll = setInterval(async () => {
    if (Date.now() - began > WAIT_MS) return clearInterval(poll), late(root);
    try {
      const now = await api(`/api/pickup/${code}`);
      if (now.portrait) clearInterval(poll), ready(root, now, true);
    } catch {}
  }, 2500);
}

function waiting(root, look) {
  const can = "Notification" in window && Notification.permission !== "denied";
  const ask = can
    ? el("button", {
        class: "btn ghost",
        type: "button",
        text: Notification.permission === "granted" ? "I’ll tell you when it’s ready" : "Tell me when it’s ready",
        onclick: async (e) => {
          const ok = Notification.permission === "granted" || (await Notification.requestPermission()) === "granted";
          tellMe = ok;
          e.target.textContent = ok ? "I’ll tell you when it’s ready" : "I’ll buzz when it’s ready";
          e.target.disabled = true;
        },
      })
    : null;
  if (Notification?.permission === "granted") tellMe = true;
  fill(
    root,
    el("p", { class: "kicker", text: look.brand }),
    el("h1", { class: "title" }, "Being made, ", el("em", { text: "just for you." })),
    el(
      "figure",
      { class: "pickup-frame waiting" },
      look.look?.image ? el("img", { src: look.look.image, alt: `The store’s photo of ${look.look.name}` }) : null,
      el("span", { class: "pickup-halo", "aria-hidden": "true" }),
    ),
    el("p", { class: "lede", text: "Walk around the store if you like. This page shows your portrait the moment it’s ready, usually in about twenty seconds." }),
    ask,
  );
}

function ready(root, look, fresh) {
  const name = look.look?.name || "this look";
  const words = `Which one do you think? Me in ${name} from ${look.brand}:`;
  const share = async () => {
    if (navigator.share) {
      try {
        return await navigator.share({ title: `Me in ${name}`, text: words, url: location.href });
      } catch {
        return;
      }
    }
    location.href = `https://wa.me/?text=${encodeURIComponent(`${words} ${location.href}`)}`;
  };
  fill(
    root,
    el("p", { class: "kicker", text: look.brand }),
    el("h1", { class: "title" }, "You, ", el("em", { text: "in it." })),
    el("figure", { class: "pickup-frame" + (fresh ? " unveil" : "") }, el("img", { src: look.portrait, alt: `Your portrait in ${name}` })),
    el("p", { class: "pickup-name" }, el("b", { text: name }), look.look?.price ? el("span", { class: "num", text: money(look.look.price, look.currency) }) : null),
    el("div", { class: "row" }, el("button", { class: "btn", type: "button", text: "Send to my family", onclick: share })),
    el("p", { class: "fine", text: "A likeness, not a fitting. This page and your picture are deleted after a day." }),
  );
  if (!fresh) return;
  document.title = "Ready · your look — MIRVA";
  navigator.vibrate?.([90, 60, 90]);
  if (tellMe && document.visibilityState !== "visible") {
    const body = `${name}, from ${look.brand}. Tap to see it.`;
    navigator.serviceWorker?.getRegistration("/").then((reg) => (reg ? reg.showNotification("Your look is ready", { body, tag: "pickup-" + code, data: { url: location.href } }) : new Notification("Your look is ready", { body })));
  }
}

function late(root) {
  root.append(el("p", { class: "fine", text: "It’s taking longer than usual. Ask at the mirror, or open this page again in a minute." }));
}

function gone(root) {
  fill(root, el("h1", { class: "title", text: "This look has gone." }), el("p", { class: "lede", text: "Looks from the mirror last a day. Scan the code on the mirror for a new one." }), el("a", { class: "btn", href: "/", text: "What MIRVA is" }));
}
