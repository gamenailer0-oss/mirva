// The store's site: proof first, their own catalogue in a minute, the pilot as the way in, the plans with their detail
// one tap away, an honest sum, and the page MIRVA prepares for one store from that store's public catalogue.
import { $, $$, el, api, money, nav, reveal, busy, onSubmit, fill, connection, picture } from "./ui.js";

document.documentElement.classList.add("js");
nav();
reveal();
connection();

const page = document.body.dataset.page;
if (page === "retail") retail();
if (page === "pitch") pitch();

// The founder's WhatsApp, only when the founder has switched it on at /hq. Until then the buttons stay hidden.
async function whatsapp(text) {
  const { whatsapp: number } = await api("/api/contact").catch(() => ({}));
  if (!number) return;
  for (const a of $$("[data-whatsapp]")) {
    a.href = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.hidden = false;
  }
}

// The same product, told the way each kind of store would recognise. The figures are starting points for the sum,
// not claims about anyone's business.
const SEGMENTS = {
  formal: {
    say: "The sale happens at the fitting room, and on a Saturday there is a queue for it. The mirror gives every shopper a first fitting without a room.",
    plan: "studio",
    sum: { stores: 1, visitors: 120, share: 15, conversion: 18, ticket: 22000 },
  },
  casual: {
    say: "Tees, jeans and jackets sell on volume, in the store and online. Assist on your own tablets, and a Try it on button on your website, reach every shopper.",
    plan: "assist",
    sum: { stores: 1, visitors: 300, share: 8, conversion: 25, ticket: 4500 },
  },
  chain: {
    say: "Forty stores, and a real stylist in four of them. Assist puts the same stylist on a tablet in every branch, on tablets you already own.",
    plan: "assist",
    sum: { stores: 40, visitors: 300, share: 3, conversion: 22, ticket: 6500 },
  },
  boutique: {
    say: "Your clients send a photo to their family before they decide, then go home to wait. MIRVA makes that photo, and the family answers while she is still with you.",
    plan: "studio",
    sum: { stores: 1, visitors: 25, share: 40, conversion: 20, ticket: 45000 },
  },
  unstitched: {
    say: "Nobody can try on a length of fabric. MIRVA shows each unstitched piece as a finished suit, on her, with the dupatta draped.",
    plan: "assist",
    sum: { stores: 6, visitors: 150, share: 12, conversion: 20, ticket: 9500 },
  },
};
const SHOWN = ["assist", "studio", "flagship"]; // Results is told in a line under them

const feeFor = (plan, stores) => (plan.monthlyFromTenth && stores >= 10 ? 9 * plan.monthly + (stores - 9) * plan.monthlyFromTenth : stores * plan.monthly);
const n = (x) => Number(x).toLocaleString("en-PK");

async function retail() {
  whatsapp("Hello, I run a store and I would like to see MIRVA on our catalogue.");
  const { retail: plans, extras, pilot } = await api("/api/plans");
  let touched = false;

  // ----- the pilot, from the one place its terms are kept
  if (pilot) $("#pilotFee").textContent = money(pilot.feePkr);

  // ----- plans: the decision on three cards, everything else behind "Every detail"
  const card = (p) =>
    el("article", { class: `plan${p.mirrors ? " glassy" : ""}`, "data-plan": p.id },
      el("span", { class: "badge", hidden: true, text: "Where you’d start" }),
      el("h3", { text: p.name }),
      el("p", { class: "fee num" }, money(p.monthly), el("small", { text: "a store, a month" + (p.monthlyFromTenth ? ` · ${money(p.monthlyFromTenth)} from the tenth store` : "") })),
      el("p", { class: "fit", text: p.fit }),
      el("ul", { class: "ticks" }, p.perks.slice(0, 3).map((t) => el("li", { text: t }))),
    );
  fill($("#plans-list"), ...SHOWN.map((id) => card(plans[id])));
  const r = plans.results;
  if (r) fill($("#resultsLine"), "Rather pay on results? ", el("b", { text: r.name }), `: ${money(r.monthly)} a store a month plus ${r.share * 100}% of the sales counted through MIRVA, never more than ${money(r.cap)} in all.`);
  const order = [...SHOWN, "results"].map((id) => plans[id]).filter(Boolean);
  const toStart = (p) => (p.install ? `${money(p.install)} installation and ${p.advanceMonths} months in advance` : "The first month. Nothing to install.");
  const rows = [
    ["A store, a month", (p) => money(p.monthly) + (p.share ? ` + ${p.share * 100}% of counted sales` : "")],
    ["Live minutes a month", (p) => (p.liveMinutes ? n(p.liveMinutes) : "With a mirror")],
    ["Portraits a month", (p) => n(p.portraits)],
    ["The mirror", (p) => p.hardware],
    ["To start", toStart],
    ["Agreement", (p) => (p.termMonths > 1 ? `${p.termMonths} months` : "Month to month")],
  ];
  fill($("#compareTable"),
    el("thead", {}, el("tr", {}, el("td"), order.map((p) => el("th", { scope: "col", text: p.name })))),
    el("tbody", {}, rows.map(([label, f]) => el("tr", {}, el("th", { scope: "row", text: label }), order.map((p) => el("td", { text: f(p) }))))),
  );
  $("#extraLine").textContent =
    `${money(extras.liveMinutePkr)} a live minute, in blocks of ${extras.liveBlockMinutes}, and only the blocks you agree to. Without them live Studio rests until the 1st and portraits carry on.` +
    (extras.portraitBlockPkr ? ` More portraits: ${money(extras.portraitBlockPkr)} for ${n(extras.portraitBlock)}.` : "");

  // ----- the sum: three numbers in front, the assumptions one tap away
  const calc = $("#calc");
  fill(calc.elements.plan, ...order.map((p) => el("option", { value: p.id, text: p.name })));
  const sum = () => {
    const v = Object.fromEntries(["stores", "visitors", "share", "conversion", "ticket", "margin"].map((k) => [k, Math.max(0, Number(calc.elements[k].value) || 0)]));
    const plan = plans[calc.elements.plan.value];
    const stores = Math.max(1, Math.round(v.stores));
    const users = Math.round(v.visitors * 30 * (v.share / 100)); // shoppers who use MIRVA, a store, a month
    const fee = feeFor(plan, stores);
    const buyers = users * stores * (v.conversion / 100);
    const perSale = v.ticket * (v.margin / 100);
    const needed = perSale > 0 ? fee / perSale : 0;
    const uplift = buyers > 0 ? (needed / buyers) * 100 : 0;
    const usable = perSale > 0 && buyers > 0;
    $("#rBreak").textContent = usable ? `+${uplift < 10 ? uplift.toFixed(1) : Math.round(uplift)}%` : "—";
    $("#rBreakLine").textContent = usable
      ? `more sales among the shoppers who use MIRVA pays for ${plan.name}: ${n(Math.ceil(needed))} extra sales a month across ${stores === 1 ? "the store" : `${stores} stores`}, beside the ${n(Math.round(buyers))} those shoppers make already.`
      : "Fill in the numbers to see it.";
    $("#rNote").textContent =
      `${plan.name} is ${money(fee)} a month here. ` +
      (users > plan.portraits ? `At these numbers more shoppers would use it than the plan has portraits for (${n(plan.portraits)}), so a larger plan would suit you better. ` : "") +
      (plan.share ? `Results also takes ${plan.share * 100}% of sales counted through MIRVA, left out here because it is only paid when those sales happen. ` : "") +
      "If nothing changed at all, the cost to you is the monthly fee. We won’t promise you an uplift; this shows how small it would have to be.";
  };
  calc.addEventListener("input", (e) => {
    if (e.target.name !== "plan") touched = true;
    sum();
  });

  // ----- which kind of store
  const choose = (id, animate = true) => {
    const s = SEGMENTS[id];
    for (const b of $$("[data-seg]")) b.setAttribute("aria-checked", String(b.dataset.seg === id));
    const say = $("#segSay");
    say.textContent = s.say;
    if (animate) (say.classList.remove("swap"), void say.offsetWidth, say.classList.add("swap"));
    for (const c of $$(".plan")) (c.classList.toggle("suggested", c.dataset.plan === s.plan), ($(".badge", c).hidden = c.dataset.plan !== s.plan));
    // On a phone the plans slide sideways: the one she'd start on is brought into view (the page itself never moves).
    const row = $("#plans-list");
    const pick = $(`.plan[data-plan="${s.plan}"]`, row);
    if (pick && row.scrollWidth > row.clientWidth)
      row.scrollTo({ left: row.scrollLeft + pick.getBoundingClientRect().left - row.getBoundingClientRect().left - parseFloat(getComputedStyle(row).paddingLeft), behavior: animate ? "smooth" : "auto" });
    const lead = $("#leadForm").elements;
    lead.segment.value = id;
    lead.plan.value = s.plan;
    if (!touched) {
      calc.elements.plan.value = s.plan;
      for (const [k, val] of Object.entries(s.sum)) calc.elements[k].value = val;
    }
    sum();
  };
  for (const b of $$("[data-seg]")) b.addEventListener("click", () => choose(b.dataset.seg));
  // Arrow keys move along the choices, as in any group of radio buttons.
  $(".seg-chips").addEventListener("keydown", (e) => {
    const all = $$("[data-seg]");
    const at = all.indexOf(document.activeElement);
    if (at < 0 || !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const next = all[(at + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length];
    next.focus();
    choose(next.dataset.seg);
  });
  choose("formal", false);

  // ----- your catalogue
  const form = $("#tryForm");
  const note = $("#tryNote");
  const clean = (v) => v.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const domain = clean($("#tryInput").value);
    if (!domain) return (note.textContent = "Type your store’s web address first.");
    note.textContent = "";
    busy($("button", form), async () => {
      try {
        const store = await api("/api/preview", { domain }, 40000);
        const { facts, currency } = await api("/api/pitch/" + store.id);
        $("#tryName").textContent = `${store.name} is in the mirror.`;
        $("#tryFacts").textContent = `${facts.products} pieces read from your public catalogue just now, from ${money(facts.priceMin, currency)} to ${money(facts.priceMax, currency)}.`;
        $("#tryMirror").href = `/mirror?brand=${store.id}`;
        $("#tryPitch").href = `/for/${store.id}`;
        $("#tryReady").hidden = false;
        $("#tryMirror").focus({ preventScroll: true });
      } catch (err) {
        note.textContent = err.message + " If your store is on another platform, write to us below and we will load it for you.";
      }
    });
  });

  // ----- talk to us
  const lead = $("#leadForm");
  onSubmit(lead, async (data) => {
    await api("/api/leads", data);
    fill(lead,
      el("div", { class: "sent" },
        el("p", { class: "kicker", text: "Sent" }),
        el("p", { class: "title voice", text: "Thank you." }),
        el("p", { class: "muted", text: "Your note is with the founder. You’ll hear back within two working days, with a time to see MIRVA on your own catalogue." }),
        el("a", { class: "link arrow", href: "#yours", text: "Or see it on your catalogue now " }),
      ),
    );
  });
}

// ---------------------------------------------------------------- the page for one store
async function pitch() {
  const id = location.pathname.split("/").pop();
  const main = $("#main");
  let data;
  try {
    data = await api("/api/pitch/" + id);
  } catch {
    return fill(main,
      el("section", { class: "p-hero band" },
        el("div", { class: "wrap stack" },
          el("h1", { class: "title", text: "We haven’t read this store’s catalogue yet." }),
          el("p", { class: "lede", text: "Type the store’s web address on the stores page and this page writes itself." }),
          el("a", { class: "btn", href: "/retail#yours", text: "Go to the stores page" }),
        ),
      ),
    );
  }
  const [{ pilot }, book] = await Promise.all([
    api("/api/plans").catch(() => ({})),
    data.brand.lookbook ? fetch(`/showcase/lookbook/${encodeURIComponent(id)}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
  ]);
  const days = pilot?.days || 60;
  const { brand, facts, pictures, currency, takenAt, chosenFrom } = data;
  const read = new Date(takenAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const rupees = (v) => money(v, currency);
  document.title = `Prepared for ${brand.name} — MIRVA`;
  document.documentElement.style.setProperty("--store", brand.accent || "#8d95a6");
  $("#navMirror").href = `/mirror?brand=${brand.id}`;
  $("#disclaimer").textContent = brand.invited
    ? `Prepared by MIRVA for ${brand.name}, from ${brand.name}’s public catalogue as it stood on ${read}. Prices and sizes are as the site showed them that day.`
    : `Prepared by MIRVA from ${brand.name}’s public catalogue, read on ${read}. MIRVA is not affiliated with or endorsed by ${brand.name}.`;

  // What the catalogue itself says. Each card appears only when the fact behind it is there.
  const noticed = [];
  if (facts.unstitched)
    noticed.push([`${facts.unstitched}`, `of the ${facts.products} pieces here are unstitched.`, "Nobody can try on fabric. MIRVA shows each one as a finished suit, on the shopper, with the dupatta draped."]);
  if (facts.sizesOut)
    noticed.push([`${facts.withGap}`, `pieces had at least one size sold out online, ${facts.sizesOut} sizes in all.`, "The mirror tells you which of those sizes shoppers asked for, so you know what a gap really cost."]);
  if (facts.formal)
    noticed.push([`${facts.formal}`, "formal and festive pieces.", "These are bought for an occasion and sent to family first. A portrait and a voting link do that inside the store."]);
  noticed.push([rupees(facts.priceMedian), "is your middle price.", facts.priceMedian >= 20000 ? "At this ticket a few extra sales a week cover a mirror. Start on Assist, and move to the mirror when you have seen it work." : facts.priceMedian < 8000 ? "At this ticket volume matters more than a mirror. Assist on tablets you already own, and a Try it on button on your website, reach every shopper." : "A mirror in your flagships and Assist everywhere else is where stores at this price usually start."]);
  if (facts.addons) noticed.push([`${facts.addons}`, "accessories, shoes and wraps.", "MIRVA suggests up to three with every look, each with a reason, and adds them to what she takes home."]);

  // Real portraits of the store's own pieces, made once for this page by MIRVA's engine on a made-up shopper.
  const looks = Array.isArray(book?.items) ? book.items.slice(0, 6) : [];
  fill(main,
    el("section", { class: "p-hero band" },
      el("div", { class: "wrap p-hero-grid" },
        el("div", { class: "stack" },
          el("p", { class: "kicker", "data-reveal": true, text: `Prepared for ${brand.name}` }),
          el("h1", { class: "display", "data-reveal": true, style: "--i:1" }, brand.name + ", ", el("em", { text: "in the mirror." })),
          el("p", { class: "lede", "data-reveal": true, style: "--i:2", text: chosenFrom > facts.products
            ? `We read your public catalogue on ${read} and chose ${facts.products} of its ${chosenFrom.toLocaleString("en-PK")} pieces, all in stock, from ${rupees(facts.priceMin)} to ${rupees(facts.priceMax)}. This is what MIRVA does with them.`
            : `We read your public catalogue on ${read}: ${facts.products} pieces, from ${rupees(facts.priceMin)} to ${rupees(facts.priceMax)}. This is what MIRVA would do with it.` }),
          el("div", { class: "row", "data-reveal": true, style: "--i:3" },
            el("a", { class: "btn", href: `/mirror?brand=${brand.id}`, text: `Open the mirror as ${brand.name}` }),
            el("a", { class: "btn ghost", href: "/retail#talk", text: "Talk to the founder" }),
          ),
        ),
        // The MIRVA mirror (the founder's design) with the store's own photos changing in its glass. It used to be an empty
        // pane with the store's name, which an owner read as broken (23 Oct 2026). Without pictures, the old pane stays.
        pictures.length >= 3
          ? el("figure", { class: "p-mirror", "data-reveal": true, style: "--i:2" },
              el("div", { class: "mirror-photo" },
                el("div", { class: "mirror-glass", "aria-label": `${brand.name}'s own photos, in the MIRVA mirror` },
                  pictures.slice(0, 3).map((p, i) => picture({ class: `g${i + 1}`, src: p.image, alt: "", loading: i ? "lazy" : "eager", decoding: "async" })),
                ),
                el("img", { class: "mirror-body", src: "/brand/mirva-mirror.webp", alt: "", width: 480, height: 1056 }),
              ),
              el("figcaption", { class: "fine" }, el("span", { class: "wm", text: brand.wordmark || brand.name.toUpperCase() }), " · your own photos, in the MIRVA mirror"),
            )
          : el("div", { class: "glass p-glass", "aria-hidden": "true", "data-reveal": true, style: "--i:2" },
              haloSvg(),
              el("div", { class: "tint" }),
              el("div", { class: "crest" }, el("span", { class: "wm", text: brand.wordmark || brand.name.toUpperCase() }), el("span", { class: "by", text: "styled by MIRVA" })),
            ),
      ),
    ),
    looks.length >= 2 &&
      el("section", { class: "section tight" },
        el("div", { class: "wrap" },
          el("div", { class: "head stack close" },
            el("p", { class: "kicker", "data-reveal": true, text: "Your pieces, on a shopper" }),
            el("h2", { class: "title", "data-reveal": true, style: "--i:1" }, "Made by MIRVA ", el("em", { text: "from your own photos." })),
          ),
          el("div", { class: "lookbook", "data-reveal": true },
            looks.map((l) =>
              el("figure", {},
                el("div", { class: "pair" },
                  el("img", { src: l.portrait, alt: `MIRVA portrait in ${brand.name}'s ${l.name}`, loading: "lazy", width: 360, height: 640 }),
                  l.image && el("img", { class: "store", src: l.image, alt: "Your photo of the same piece", loading: "lazy" }),
                ),
                el("figcaption", {}, el("b", { text: l.name }), el("span", { text: l.price ? rupees(l.price) : "" })),
              ),
            ),
          ),
          el("p", { class: "fine", style: "margin-top:16px", text: "Real results from MIRVA’s try-on, untouched; your photo of each piece sits in its corner. The shopper was made for this page by the same engine, so no real person is shown. A likeness, not a fitting." }),
        ),
      ),
    pictures.length > 2 &&
      el("section", { class: looks.length >= 2 ? "section tight band" : "section tight" },
        el("div", { class: "wrap stack" },
          el("p", { class: "kicker", "data-reveal": true, text: "From your own rails" }),
          el("div", { class: "rail", "data-reveal": true }, pictures.map((p) => el("figure", {}, el("div", { style: "border-radius:var(--r-md)" }, picture({ src: p.image, alt: p.name, loading: "lazy" })), el("figcaption", { text: `${p.name} · ${rupees(p.price)}` })))),
          el("p", { class: "fine", text: "Every one of these can be worn in the mirror today. Tap “Open the mirror” above." }),
        ),
      ),
    el("section", { class: "section tight" + (looks.length >= 2 ? "" : " band") },
      el("div", { class: "wrap" },
        el("div", { class: "head stack close" }, el("p", { class: "kicker", "data-reveal": true, text: "What we noticed" }), el("h2", { class: "title", "data-reveal": true, style: "--i:1" }, "Your catalogue, ", el("em", { text: "read as a stylist would." }))),
        el("div", { class: "noticed" }, noticed.map(([fig, what, so], i) => el("article", { class: "card", "data-reveal": true, style: `--i:${i}` }, el("p", { class: "fig num", text: fig }), el("p", { text: what }), el("p", { class: "muted", text: so })))),
      ),
    ),
    el("section", { class: "section tight dark" },
      el("div", { class: "wrap split" },
        el("div", { class: "stack" },
          el("p", { class: "kicker", "data-reveal": true, text: "The pilot" }),
          el("h2", { class: "title", "data-reveal": true, style: "--i:1" }, `${days === 60 ? "Sixty" : days} days. One store. `, el("em", { text: "Your money back if it misses." })),
          el("p", { class: "lede", "data-reveal": true, style: "--i:2", text: `We agree one target in writing before day one, and run MIRVA in one of your stores on your own tablets.${pilot ? ` ${money(pilot.feePkr)} in advance, returned in full if the target is missed.` : ""}` }),
          el("div", { class: "row", "data-reveal": true, style: "--i:3" }, el("a", { class: "btn", href: "/retail#talk", text: "Ask about a pilot" }), el("a", { class: "link arrow", href: "/retail#plans", text: "See the plans " })),
        ),
        el("ol", { class: "steps", "data-reveal": true, style: "--i:1" },
          el("li", {}, el("div", {}, el("b", { text: "Before day one." }), el("p", { class: "muted", text: "Your catalogue is already loaded. We agree the one target and set MIRVA up on your tablets." }))),
          el("li", {}, el("div", {}, el("b", { text: `Days 1 to ${days}.` }), el("p", { class: "muted", text: "You see the numbers every day in your console. We go through them with you every week." }))),
          el("li", {}, el("div", {}, el("b", { text: `Day ${days}.` }), el("p", { class: "muted", text: "A written result against the target. Hit, and you choose a plan. Missed, and the fee comes back." }))),
        ),
      ),
    ),
  );
  reveal(main);
}

function haloSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "halo breathe");
  svg.setAttribute("viewBox", "0 0 200 44");
  svg.innerHTML = '<path class="track" d="M14 38Q100 -8 186 38" pathLength="100"/><path class="arc" d="M14 38Q100 -8 186 38" pathLength="100"/>';
  return svg;
}
