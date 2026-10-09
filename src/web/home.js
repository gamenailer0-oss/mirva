// The home page's "try it here": the mirror's own stylist (src/stylist.js), choosing three looks from a real store's
// rails as the reader taps an occasion. Nothing is made up for the page: the same rules, the same catalogue, the same
// reasons. Without a script, or without the catalogue, the page keeps the three painted cards it was sent with.
import { $, $$, el, fill } from "./ui.js";
import { OCCASIONS, pickLooks } from "../stylist.js";

const pic = (url, w) => `/img?u=${encodeURIComponent(url)}&w=${w}`;
const FOR = { wedding: "a wedding", eid: "Eid", dinner: "a dinner", work: "work", everyday: "every day" };

export async function start() {
  const box = $("#try");
  if (!box) return;
  let stores;
  try {
    stores = await (await fetch("/api/brands", { headers: { accept: "application/json" } })).json();
  } catch {
    return;
  }
  if (!Array.isArray(stores) || !stores.length) return;
  stores = stores.slice(0, 4);

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
  show();
}
