// The home page's "try it here": the mirror's own stylist (src/stylist.js), choosing three looks from a real store's
// rails as the reader taps an occasion. Nothing is made up for the page: the same rules, the same catalogue, the same
// reasons. Without a script, or without the catalogue, the page keeps the three painted cards it was sent with.
import { $, $$, el, fill } from "./ui.js";
import { OCCASIONS, pickLooks, occasionsFor } from "../stylist.js";

const pic = (url, w) => `/img?u=${encodeURIComponent(url)}&w=${w}`;
const FOR = { wedding: "a wedding", eid: "Eid", dinner: "a dinner", work: "work", everyday: "every day", university: "university", weekend: "the weekend", travel: "travel", friends: "a day out" };

// The films (made with AI). The portrait film in "How it works" is fetched only as it nears the screen and plays only
// while seen; with reduced motion or data saver it shows its picture and waits for a tap. The 12-second film opens from
// the hero. `/?hero=film` puts that film in the hero's place, so the founder can compare the two (not linked anywhere).
function films() {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches || navigator.connection?.saveData;
  // Their pictures are named in data-poster, so neither is fetched before the reader comes near it.
  const dress = (video) => video.dataset.poster && !video.poster && (video.poster = video.dataset.poster);
  const how = $(".how-film video");
  if (how) {
    if (still) how.controls = true;
    new IntersectionObserver(([e]) => e.isIntersecting && dress(how), { rootMargin: "600px 0px" }).observe(how);
    if (!still)
      new IntersectionObserver(([e]) => (e.isIntersecting ? how.play().catch(() => {}) : how.pause()), { rootMargin: "120px 0px" }).observe(how);
  }
  const box = $("#filmBox");
  const open = $(".film-open");
  if (box && open) {
    open.addEventListener("click", () => {
      const video = box.querySelector("video");
      dress(video);
      box.showModal();
      video.play().catch(() => {});
    });
    box.addEventListener("close", () => box.querySelector("video").pause());
    box.addEventListener("click", (e) => e.target === box && box.close());
  }
  if (new URLSearchParams(location.search).get("hero") === "film") {
    const figure = $(".oval-hero");
    const film = el("video", { src: "/film/mirva-12s.mp4", poster: "/film/mirva-12s.webp", width: 1280, height: 720, playsInline: true, loop: true, preload: "auto" });
    film.muted = true;
    if (still) film.controls = true;
    else film.autoplay = true;
    figure.replaceWith(el("figure", { class: "film-hero" }, film, el("figcaption", { class: "fine", text: "A film of the MIRVA mirror, made with AI." })));
    $(".hero-grid").classList.add("has-film");
    open?.remove();
  }
}

export async function start() {
  films();
  const box = $("#try");
  if (!box) return;
  let stores;
  try {
    stores = await (await fetch("/api/brands", { headers: { accept: "application/json" } })).json();
  } catch {
    return;
  }
  if (!Array.isArray(stores) || !stores.length) return;
  // The stores that said yes (`priority`: Naqshi, Baroque, Agha Noor) lead, and the first of them is open; the concept
  // stores follow, so formal, menswear and casual are all still a tap away.
  stores = stores.slice(0, 6);
  // "Now in the mirror": each of their cards gets three pictures from its own rails.
  // The three partners' pictures are written into the page itself, so they load with it; only an empty rail is filled.
  for (const rail of $$("[data-cover]:not(.real)")) {
    const store = stores.find((s) => s.id === rail.dataset.cover);
    if (!store?.cover?.length) continue;
    fill(rail, store.cover.slice(0, 3).map((src) => el("img", { src: pic(src, 360), alt: "", loading: "lazy", decoding: "async" })));
    rail.classList.add("real");
  }

  const state = { store: stores[0].id, occasion: "wedding" };
  const rails = new Map(); // store id -> its catalogue, asked for once
  const railsOf = (id) => {
    if (!rails.has(id))
      rails.set(
        id,
        fetch(`/api/brands/${id}`, { headers: { accept: "application/json" } }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("no catalogue")))),
      );
    return rails.get(id);
  };

  const pills = (node, items, key) =>
    fill(
      node,
      items.map((it) =>
        el("button", {
          class: "chip",
          type: "button",
          "aria-pressed": String(state[key] === it.id),
          text: it.label,
          onclick: () => {
            if (state[key] === it.id) return;
            state[key] = it.id;
            for (const b of $$("button", node)) b.setAttribute("aria-pressed", String(b.textContent === it.label));
            show();
          },
        }),
      ),
    );
  pills($("#tryStores"), stores.map((s) => ({ id: s.id, label: s.name })), "store");
  pills($("#tryOccasions"), OCCASIONS.map((o) => ({ id: o.id, label: o.label })), "occasion");

  let turn = 0;
  let shownFor = "";
  async function show() {
    const mine = ++turn;
    const store = stores.find((s) => s.id === state.store);
    $("#tryGo").href = `/mirror?brand=${encodeURIComponent(state.store)}&for=${encodeURIComponent(state.occasion)}`;
    let data;
    try {
      data = await railsOf(state.store);
    } catch {
      rails.delete(state.store);
      return;
    }
    if (mine !== turn) return; // a later tap has asked for something else
    const { brand, catalogue } = data;
    // Only the occasions this store can dress: a casual store has no wedding to offer.
    const fits = occasionsFor(catalogue.products);
    if (!fits.some((o) => o.id === state.occasion)) state.occasion = fits[0].id;
    if (shownFor !== state.store) ((shownFor = state.store), pills($("#tryOccasions"), fits.map((o) => ({ id: o.id, label: o.label })), "occasion"));
    $("#tryGo").href = `/mirror?brand=${encodeURIComponent(state.store)}&for=${encodeURIComponent(state.occasion)}`;
    const money = (n) => `${brand.currency || "Rs."}${Math.round(n).toLocaleString("en-PK")}`;
    const picks = pickLooks(catalogue.products, { occasion: state.occasion, who: brand.audience === "men" ? "men" : "women", formalityShift: 0 });
    if (!picks.length) return;
    $("#trySay").textContent = `Three for ${FOR[state.occasion] || "you"}, from ${store.name}.`;
    fill(
      $("#tryLooks"),
      picks.map((k, i) =>
        el(
          "li",
          { style: `--i:${i}` },
          el("span", { class: "shot" }, el("img", { src: pic(k.product.image, 420), alt: "", loading: "lazy", decoding: "async" }), i === 0 && el("span", { class: "badge", text: "My pick" })),
          el("b", { text: k.product.name }),
          el("span", { text: [money(k.product.price), k.why].filter(Boolean).join(" · ") }),
        ),
      ),
    );
    // The small pictures further down the page (the wardrobe, the vote) show the same three pieces.
    for (const node of $$("[data-pick]")) {
      const p = picks[Number(node.dataset.pick)]?.product;
      if (!p) continue;
      node.style.backgroundImage = `url("${pic(p.image, 240)}")`;
      node.classList.add("real");
    }
    for (const node of $$("[data-pick-name]")) {
      const p = picks[Number(node.dataset.pickName)]?.product;
      if (p) node.textContent = p.name;
    }
  }
  // The catalogue (about 70 KB) and the stylist's choosing wait until the demo is about a screen away, so the first
  // screen loads and paints without them (22 Oct 2026: two long tasks, 443 ms, on a mid-range phone at load).
  if (!("IntersectionObserver" in window)) return show();
  const near = new IntersectionObserver((seen) => seen.some((e) => e.isIntersecting) && (near.disconnect(), show()), { rootMargin: "900px 0px" });
  near.observe(box);
}
