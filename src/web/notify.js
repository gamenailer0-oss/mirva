// The phone side of notifications: MIRVA's service worker, and asking this phone to be told when someone answers.
// Android Chrome can be told straight away; an iPhone only once MIRVA is on its home screen.
import { api, toast } from "./ui.js";

export function registerWorker() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
}

const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

// Can this phone be told at all, and is it already?
export async function pushState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  const { key } = await api("/api/push/key").catch(() => ({ key: null }));
  if (!key) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  return sub ? "on" : "off";
}

// Asks once, at the moment it is worth it. Returns true when this phone will be told.
export async function turnOnPush() {
  try {
    const { key } = await api("/api/push/key");
    if (!key) return false;
    const reg = (await navigator.serviceWorker.getRegistration("/")) || (await registerWorker());
    if (!reg) return false;
    await navigator.serviceWorker.ready;
    if ((await Notification.requestPermission()) !== "granted") {
      toast("Notifications are off for MIRVA. You can turn them on in the browser’s site settings.");
      return false;
    }
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }));
    await api("/api/push/subscribe", { endpoint: sub.endpoint });
    return true;
  } catch (e) {
    toast(e.message || "This phone can't be told just now.");
    return false;
  }
}

// iPhones only take notifications from a site added to the home screen.
export const iphoneOutsideApp = () => /iPhone|iPad/.test(navigator.userAgent) && !navigator.standalone && !matchMedia("(display-mode: standalone)").matches;
