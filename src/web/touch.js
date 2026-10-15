// How MIRVA answers a hand, on every page: one thing open at a time, a tap outside closes it, Escape closes it, and a
// kept look flies to where it is kept. Only transforms and opacity move, so nothing here costs a frame.

const calm = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
let wired = false;

export function wireTouch() {
  if (wired) return;
  wired = true;

  // One sheet at a time: opening one closes any other that is open.
  const show = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function () {
    for (const d of document.querySelectorAll("dialog[open]")) if (d !== this) d.close();
    return show.call(this);
  };

  // A tap on the dim around a sheet closes it, as on a phone (not the sheet that asks before a picture is sent).
  document.addEventListener("click", (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDialogElement) || !d.open || d.dataset.stay !== undefined) return;
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
  });

  // One answer open at a time in a list of questions, and in any group of disclosures that sit together.
  document.addEventListener(
    "toggle",
    (e) => {
      const d = e.target;
      if (!(d instanceof HTMLDetailsElement) || !d.open || !d.parentElement) return;
      for (const o of d.parentElement.querySelectorAll(":scope > details[open]")) if (o !== d) o.open = false;
    },
    true,
  );

  // The menu on a phone closes when she taps anywhere else, or presses Escape.
  const closeMenu = () => {
    const nav = document.querySelector(".nav.open");
    if (!nav) return;
    nav.classList.remove("open");
    nav.querySelector(".nav-toggle")?.setAttribute("aria-expanded", "false");
  };
  document.addEventListener("click", (e) => !e.target.closest?.(".nav") && closeMenu());
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeMenu());
}

/** A picture of what she kept travels from where it was to where it is kept. */
export function flyTo(from, to) {
  if (!from || !to || !calm()) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const ghost = document.createElement("div");
  const src = from.tagName === "IMG" ? from.currentSrc || from.src : "";
  ghost.style.cssText = `position:fixed;z-index:200;left:${a.left}px;top:${a.top}px;width:${a.width}px;height:${a.height}px;border-radius:18px;overflow:hidden;pointer-events:none;background:#0a0c11 ${src ? `url("${src}") center 15%/cover` : ""};box-shadow:0 20px 60px -20px rgba(0,0,0,.6);transform-origin:0 0;will-change:transform,opacity`;
  document.body.append(ghost);
  const dx = b.left - a.left, dy = b.top - a.top, s = Math.min(b.width / a.width, b.height / a.height);
  ghost
    .animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 0.95 },
        { transform: `translate(${dx * 0.6}px,${dy * 0.6 - 30}px) scale(${(1 + s) / 2})`, opacity: 0.9, offset: 0.6 },
        { transform: `translate(${dx}px,${dy}px) scale(${s})`, opacity: 0.2 },
      ],
      { duration: 620, easing: "cubic-bezier(.32,.72,0,1)" },
    )
    .finished.then(() => ghost.remove(), () => ghost.remove());
  to.animate?.([{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }], { duration: 360, delay: 560, easing: "cubic-bezier(.32,.72,0,1)" });
}
