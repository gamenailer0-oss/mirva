// Small helpers every MIRVA web surface shares. No framework: the pages are documents first.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Builds an element. Text always goes in as text, never as markup.
export function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "style") node.style.cssText = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k in node && k !== "list" && k !== "form") node[k] = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...kids.flat(3).filter((k) => k !== false && k != null));
  return node;
}

// Replaces a node's children. A condition that came out false simply leaves nothing behind.
export const fill = (node, ...kids) => node.replaceChildren(...kids.flat(3).filter((k) => k !== false && k != null));

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const timeout = (ms) => {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const stop = new AbortController();
  setTimeout(() => stop.abort(), ms);
  return stop.signal;
};

// Every request gives up after 15 seconds. A GET that never got through, or met a server just out of
// reach, tries again twice. A POST is never repeated for the reader: it may already have happened.
const RETRY = [400, 1200];
// `wait` is how long to give the server; reading a whole store's catalogue needs more than most calls.
export async function api(path, body, wait = 15000) {
  const read = body === undefined;
  const init = read ? { headers: { accept: "application/json" } } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  for (let tries = 0; ; tries++) {
    let res;
    let data = {};
    try {
      const signal = timeout(wait);
      res = await fetch(path, { ...init, signal });
      data = await res.json().catch((e) => {
        if (signal.aborted) throw e;
        return {};
      });
    } catch {
      if (read && tries < RETRY.length) {
        await pause(RETRY[tries]);
        continue;
      }
      throw new Error(navigator.onLine === false ? "You're offline. Check the connection and try again." : "That took too long. Try again.");
    }
    if (read && tries < RETRY.length && [502, 503, 504].includes(res.status)) {
      await pause(RETRY[tries]);
      continue;
    }
    if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong. Try again."), { status: res.status, data });
    return data;
  }
}

// One bar across the top while the browser has no connection. Pages carry on; they catch up when it is back.
export function connection() {
  const show = () => $("#offline") || document.body.append(el("div", { id: "offline", class: "offline", role: "status", text: "You're offline. This page will catch up when the connection is back." }));
  addEventListener("offline", show);
  addEventListener("online", () => {
    const bar = $("#offline");
    if (!bar) return;
    bar.remove();
    toast("Back online.");
  });
  if (navigator.onLine === false) show();
}

// A picture that fails to arrive leaves the grey card behind, not a broken icon. The box keeps its size.
export function picture(props) {
  const img = el("img", props);
  img.addEventListener("error", () => ((img.style.visibility = "hidden"), img.parentElement?.classList.add("noimg")));
  img.addEventListener("load", () => ((img.style.visibility = ""), img.parentElement?.classList.remove("noimg")));
  return img;
}

export const money = (n, currency = "Rs.") => currency + Math.round(Number(n) || 0).toLocaleString("en-PK");
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function when(ms) {
  const days = Math.floor((Date.now() - ms) / 86400e3);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: days > 300 ? "numeric" : undefined });
}
export const until = (ms) => {
  const hours = Math.round((ms - Date.now()) / 3600e3);
  if (hours <= 0) return "closed";
  return hours < 24 ? `open for ${plural(hours, "more hour")}` : `open for ${plural(Math.round(hours / 24), "more day")}`;
};

let toastTimer;
export function toast(message) {
  let node = $("#toast");
  if (!node) document.body.append((node = el("div", { id: "toast", class: "toast", role: "status" })));
  node.textContent = message;
  requestAnimationFrame(() => node.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 3200);
}

// Sections come into view once, as the reader reaches them.
export function reveal(root = document) {
  const nodes = $$("[data-reveal]:not(.in)", root);
  if (!("IntersectionObserver" in window)) return nodes.forEach((n) => n.classList.add("in"));
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) (e.target.classList.add("in"), seen.unobserve(e.target));
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );
  nodes.forEach((n) => seen.observe(n));
}

export function nav() {
  const bar = $("#nav");
  if (!bar) return;
  const mark = () => bar.classList.toggle("scrolled", scrollY > (bar.classList.contains("on-dark") ? innerHeight * 0.72 : 8));
  addEventListener("scroll", mark, { passive: true });
  mark();
  const toggle = $(".nav-toggle", bar);
  toggle?.addEventListener("click", () => toggle.setAttribute("aria-expanded", String(bar.classList.toggle("open"))));
  $$(".nav-links a", bar).forEach((a) => a.addEventListener("click", () => (bar.classList.remove("open"), toggle?.setAttribute("aria-expanded", "false"))));
}

let mePromise;
export const whoAmI = (fresh = false) => (mePromise = !fresh && mePromise ? mePromise : api("/api/me").catch(() => ({ user: null })));

// Ends this browser's sign-in and goes to the front page. If the request fails the shopper is told, not left guessing.
export async function signOut(to = "/") {
  try {
    await api("/api/auth/signout", {});
  } catch (e) {
    return toast(e.message);
  }
  location.href = to;
}

// A button that shows it is working, and cannot be pressed twice.
export async function busy(button, work) {
  if (button.getAttribute("aria-busy") === "true") return;
  button.setAttribute("aria-busy", "true");
  try {
    return await work();
  } finally {
    button.removeAttribute("aria-busy");
  }
}

// Wires a form: collects named fields, shows the server's own sentence when something is wrong.
export function onSubmit(form, handler) {
  const note = $(".formnote", form);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = {};
    for (const f of form.elements) if (f.name) data[f.name] = f.type === "checkbox" ? f.checked : f.value;
    if (note) (note.textContent = ""), note.classList.remove("ok");
    busy($("[type=submit]", form), async () => {
      try {
        await handler(data, form);
      } catch (err) {
        if (note) note.textContent = err.message;
        else toast(err.message);
      }
    });
  });
}

export const local = ["localhost", "127.0.0.1"].includes(location.hostname);

export async function copy(textToCopy) {
  try {
    await navigator.clipboard.writeText(textToCopy);
    toast("Copied.");
  } catch {
    toast(textToCopy);
  }
}
