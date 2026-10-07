// The store's site: four ways in, a live preview on the visitor's own catalogue, plans, an honest sum,
// and the page MIRVA prepares for one store from that store's public catalogue.
import { $, $$, el, api, money, nav, reveal, busy, onSubmit, fill, connection, picture } from "./ui.js";

document.documentElement.classList.add("js");
nav();
reveal();
connection();

const page = document.body.dataset.page;
if (page === "retail") retail();
if (page === "pitch") pitch();

// The same product, told the way each kind of store would recognise. The figures are starting
// points for the calculator, not claims about anyone's business.
const SEGMENTS = {
  formal: {
    kicker: "Where the sale is lost",
    pain: "The sale happens at the fitting room, and on a Saturday there is a queue for it.",
    answer: "The mirror gives every shopper a first fitting without a room: three formal looks on her in about a minute, so the fitting room is kept for the one she means to buy.",
    points: ["Portraits in your formal pieces, lit to sell them", "Fewer fittings that end in nothing", "A record of what was tried and left behind"],
    plan: "studio",
    sum: { stores: 2, visitors: 120, share: 15, conversion: 18, ticket: 22000 },
  },
  chain: {
    kicker: "Where the sale is lost",
    pain: "You have forty stores, and a real stylist in four of them.",
    answer: "Assist puts the same stylist on a staff tablet and on the shopper's own phone in every branch: the same three questions, your catalogue, your sizes.",
    points: ["One standard of advice, whoever is on shift", "No new hardware: your own tablets", "The price falls from the tenth store"],
    plan: "assist",
    sum: { stores: 40, visitors: 300, share: 3, conversion: 22, ticket: 6500 },
  },
  boutique: {
    kicker: "Where the sale is lost",
    pain: "Your clients send a photograph to their family before they decide. Then they go home to wait for the answer.",
    answer: "MIRVA makes that photograph for them: a studio portrait in your piece, and one link their family can answer from the sofa. Part of what you pay depends on sales it leads to.",
    points: ["A portrait worth sending, made in fifteen seconds", "Family votes come back while she is still in the store", "A lower fee, plus 2% of matched sales"],
    plan: "boutique",
    sum: { stores: 1, visitors: 25, share: 40, conversion: 20, ticket: 45000 },
  },
  unstitched: {
    kicker: "Where the sale is lost",
    pain: "Nobody can try on a length of fabric.",
    answer: "MIRVA shows an unstitched three-piece as a finished suit, on the shopper, with the dupatta draped. She sees the garment before the tailor has seen the cloth.",
    points: ["Every unstitched piece shown stitched and worn", "The trouser and dupatta suggested with it", "Which prints are tried most, by occasion"],
    plan: "studio",
    sum: { stores: 6, visitors: 150, share: 12, conversion: 20, ticket: 9500 },
  },
};

const feeFor = (plan, stores) => (plan.monthlyFromTenth && stores >= 10 ? 9 * plan.monthly + (stores - 9) * plan.monthlyFromTenth : stores * plan.monthly);

async function retail() {
  const { retail: plans, extras } = await api("/api/plans");
  let segment = "formal";
  let touched = false;

  // ----- plans
  const card = (p) =>
    el("article", { class: "plan", "data-plan": p.id, "data-reveal": true },
      el("div", { class: "row", style: "justify-content:space-between" }, el("h3", { text: p.name }), el("span", { class: "badge", hidden: true, text: "Start here" })),
      el("p", { class: "fee num" }, money(p.monthly), el("small", { text: "a store, a month" + (p.monthlyFromTenth ? `. ${money(p.monthlyFromTenth)} from the tenth store.` : p.share ? `, plus ${p.share * 100}% of matched sales. Capped at ${money(p.cap)} in all.` : ".") })),
      el("p", { class: "muted small", text: p.fit }),
      el("dl", {},
        el("div", {}, el("dt", { text: "Sessions a month" }), el("dd", { class: "num", text: p.sessions.toLocaleString("en-PK") })),
        el("div", {}, el("dt", { text: "Setup, once" }), el("dd", { class: "num", text: p.setup ? money(p.setup) : "None" })),
        el("div", {}, el("dt", { text: "Hardware" }), el("dd", { text: p.hardware })),
      ),
    );
  fill($("#plans"), ...Object.values(plans).map(card));
  $("#extraLine").textContent = `${money(extras.sessionOverage)} a session, up to a monthly cap that you set. Catalogue imaging, if you want it: ${money(extras.imagingPerProduct)} a product a season.`;
  reveal($("#plans"));

  // ----- the sum
  const calc = $("#calc");
  fill(calc.elements.plan, ...Object.values(plans).map((p) => el("option", { value: p.id, text: p.name })));
  const sum = () => {
    const v = Object.fromEntries(["stores", "visitors", "share", "conversion", "ticket", "margin"].map((k) => [k, Math.max(0, Number(calc.elements[k].value) || 0)]));
    const plan = plans[calc.elements.plan.value];
    const stores = Math.max(1, Math.round(v.stores));
    const sessions = Math.round(v.visitors * 30 * (v.share / 100)); // a store, a month
    const over = Math.max(0, sessions - plan.sessions);
    const fee = feeFor(plan, stores) + over * extras.sessionOverage * stores;
    const buyers = sessions * stores * (v.conversion / 100);
    const perSale = v.ticket * (v.margin / 100);
    const needed = perSale > 0 ? fee / perSale : 0;
    const uplift = buyers > 0 ? (needed / buyers) * 100 : 0;
    const usable = perSale > 0 && buyers > 0;
    $("#rBreak").textContent = usable ? `+${uplift < 10 ? uplift.toFixed(1) : Math.round(uplift)}%` : "—";
    $("#rBreakLine").textContent = usable
      ? `more sales among the shoppers who use MIRVA. That is ${Math.ceil(needed).toLocaleString("en-PK")} extra sales a month across ${stores === 1 ? "the store" : `${stores} stores`}, beside the ${Math.round(buyers).toLocaleString("en-PK")} those shoppers already make.`
      : "Fill in the numbers to see it.";
    $("#rFee").textContent = money(fee);
    $("#rSessions").textContent = `${sessions.toLocaleString("en-PK")} of ${plan.sessions.toLocaleString("en-PK")}`;
    $("#rOneIn").textContent = usable ? `${Math.max(1, Math.round((sessions * stores) / needed)).toLocaleString("en-PK")} sessions` : "—";
    $("#rSetup").textContent = plan.setup ? money(plan.setup * stores) : "None";
    $("#rNote").textContent =
      (over ? `You would pass the allowance by ${over.toLocaleString("en-PK")} sessions a store, so the fee above includes ${money(over * extras.sessionOverage * stores)} for them. A larger plan may suit you better. ` : "") +
      (plan.share ? `Boutique also takes ${plan.share * 100}% of sales matched to MIRVA, which this sum leaves out because it is only paid when those sales happen. ` : "") +
      "If nothing changed at all, the cost to you is the monthly fee.";
  };
  calc.addEventListener("input", (e) => {
    if (e.target.name !== "plan") touched = true;
    sum();
  });

  // ----- four kinds of store
  const choose = (id, animate = true) => {
    segment = id;
    const s = SEGMENTS[id];
    for (const b of $$("[data-seg]")) b.setAttribute("aria-selected", String(b.dataset.seg === id));
    $("#segKicker").textContent = s.kicker;
    $("#segPain").textContent = s.pain;
    $("#segAnswer").textContent = s.answer;
    fill($("#segPoints"), ...s.points.map((t) => el("li", { text: t })));
    $("#segPlan").textContent = plans[s.plan].name;
    for (const c of $$(".plan")) (c.classList.toggle("suggested", c.dataset.plan === s.plan), ($(".badge", c).hidden = c.dataset.plan !== s.plan));
    $("#leadForm").elements.segment.value = id;
    if (!touched) {
      calc.elements.plan.value = s.plan;
      for (const [k, val] of Object.entries(s.sum)) calc.elements[k].value = val;
    }
    sum();
    if (animate) {
      const panel = $("#segPanel");
      panel.classList.remove("swap");
      void panel.offsetWidth;
      panel.classList.add("swap");
    }
  };
  for (const b of $$("[data-seg]")) b.addEventListener("click", () => choose(b.dataset.seg));
  choose(segment, false);

  // ----- your catalogue
  const form = $("#tryForm");
  const note = $("#tryNote");
  const word = $("#tryWord");
  const clean = (v) => v.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
  $("#tryInput").addEventListener("input", (e) => (word.textContent = (clean(e.target.value).split(".")[0] || "YOUR STORE").toUpperCase().slice(0, 18)));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const domain = clean($("#tryInput").value);
    if (!domain) return (note.textContent = "Type your store's web address first.");
    note.textContent = "";
    $("#tryHalo").setAttribute("class", "halo think");
    busy($("button", form), async () => {
      try {
        const store = await api("/api/preview", { domain }, 40000);
        const { facts, currency } = await api("/api/pitch/" + store.id);
        $("#tryName").textContent = `${store.name} is in the mirror.`;
        $("#tryFacts").textContent = `${facts.products} pieces read from your public catalogue just now, from ${money(facts.priceMin, currency)} to ${money(facts.priceMax, currency)}.`;
        $("#tryMirror").href = `/mirror?brand=${store.id}`;
        $("#tryPitch").href = `/for/${store.id}`;
        $("#tryWait").hidden = true;
        $("#tryReady").hidden = false;
        $("#tryMirror").focus({ preventScroll: true });
      } catch (err) {
        note.textContent = err.message + " If your store is not on Shopify, write to us below and we will load it for you.";
      } finally {
        $("#tryHalo").setAttribute("class", "halo breathe");
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
        el("p", { class: "muted", text: "Your note is with the founder. You'll hear back within two working days, with a time to see MIRVA on your own catalogue." }),
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
          el("h1", { class: "title", text: "We haven't read this store's catalogue yet." }),
          el("p", { class: "lede", text: "Type the store's web address on the stores page and this page writes itself." }),
          el("a", { class: "btn", href: "/retail#yours", text: "Go to the stores page" }),
        ),
      ),
    );
  }
  const { brand, facts, pictures, currency, takenAt } = data;
  const read = new Date(takenAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const rupees = (n) => money(n, currency);
  document.title = `Prepared for ${brand.name} — MIRVA`;
  document.documentElement.style.setProperty("--store", brand.accent || "#8d95a6");
  $("#navMirror").href = `/mirror?brand=${brand.id}`;
  $("#disclaimer").textContent = `Prepared by MIRVA from ${brand.name}'s public catalogue, read on ${read}. MIRVA is not affiliated with or endorsed by ${brand.name}.`;

  // What the catalogue itself says. Each card appears only when the fact behind it is there.
  const noticed = [];
  if (facts.unstitched)
    noticed.push([`${facts.unstitched}`, `of your ${facts.products} pieces are unstitched.`, "Nobody can try on fabric. MIRVA shows each one as a finished suit, on the shopper, with the dupatta draped."]);
  if (facts.sizesOut)
    noticed.push([`${facts.withGap}`, `pieces had at least one size sold out online, ${facts.sizesOut} sizes in all.`, "The mirror tells you which of those sizes shoppers asked for, so you know what a gap really cost."]);
  if (facts.formal)
    noticed.push([`${facts.formal}`, "formal and festive pieces.", "These are bought for an occasion and sent to family first. A studio portrait and a voting link do that inside the store."]);
  noticed.push([rupees(facts.priceMedian), "is your middle price.", facts.priceMedian >= 20000 ? "At this ticket a few extra sales a week cover a mirror. Studio fits, or Boutique if you run one or two stores." : facts.priceMedian < 8000 ? "At this ticket volume matters more than a mirror. Assist, on tablets you already own, reaches every branch." : "A mirror in your flagships and Assist everywhere else is where stores at this price usually start."]);
  if (facts.addons) noticed.push([`${facts.addons}`, "accessories, shoes and wraps.", "MIRVA suggests up to three with every look, each with a reason, and adds them to what she takes home."]);

  fill(main, 
    el("section", { class: "p-hero band" },
      el("div", { class: "wrap p-hero-grid" },
        el("div", { class: "stack" },
          el("p", { class: "kicker", "data-reveal": true, text: `Prepared for ${brand.name}` }),
          el("h1", { class: "display", "data-reveal": true, style: "--i:1" }, brand.name + ", ", el("em", { text: "in the mirror." })),
          el("p", { class: "lede", "data-reveal": true, style: "--i:2", text: `We read your public catalogue on ${read}: ${facts.products} pieces, from ${rupees(facts.priceMin)} to ${rupees(facts.priceMax)}. This is what MIRVA would do with it.` }),
          el("div", { class: "row", "data-reveal": true, style: "--i:3" },
            el("a", { class: "btn", href: `/mirror?brand=${brand.id}`, text: `Open the mirror as ${brand.name}` }),
            el("a", { class: "btn ghost", href: "/retail#talk", text: "Talk to the founder" }),
          ),
        ),
        el("div", { class: "glass p-glass", "aria-hidden": "true", "data-reveal": true, style: "--i:2" },
          haloSvg(),
          el("div", { class: "tint" }),
          el("div", { class: "crest" }, el("span", { class: "wm", text: brand.wordmark || brand.name.toUpperCase() }), el("span", { class: "by", text: "styled by MIRVA" })),
        ),
      ),
    ),
    pictures.length > 2 &&
      el("section", { class: "section tight" },
        el("div", { class: "wrap stack" },
          el("p", { class: "kicker", "data-reveal": true, text: "From your own rails" }),
          el("div", { class: "rail", "data-reveal": true }, pictures.map((p) => el("figure", {}, el("div", { style: "border-radius:var(--r-md)" }, picture({ src: p.image, alt: p.name, loading: "lazy" })), el("figcaption", { text: `${p.name} · ${rupees(p.price)}` })))),
          el("p", { class: "fine", text: "Every one of these can be worn in the mirror today. Tap “Open the mirror” above." }),
        ),
      ),
    el("section", { class: "section tight band" },
      el("div", { class: "wrap" },
        el("div", { class: "head stack close" }, el("p", { class: "kicker", "data-reveal": true, text: "What we noticed" }), el("h2", { class: "title", "data-reveal": true, style: "--i:1" }, "Your catalogue, ", el("em", { text: "read as a stylist would." }))),
        el("div", { class: "noticed" }, noticed.map(([fig, what, so], i) => el("article", { class: "card", "data-reveal": true, style: `--i:${i}` }, el("p", { class: "fig num", text: fig }), el("p", { text: what }), el("p", { class: "muted", text: so })))),
      ),
    ),
    el("section", { class: "section tight" },
      el("div", { class: "wrap split" },
        el("div", { class: "stack" },
          el("p", { class: "kicker", "data-reveal": true, text: "A first month together" }),
          el("h2", { class: "title", "data-reveal": true, style: "--i:1" }, "Thirty days. One store. ", el("em", { text: "A written result." })),
          el("p", { class: "lede", "data-reveal": true, style: "--i:2", text: "We agree what success means, in numbers, before the mirror goes in. On day thirty you have a short report and a decision to make." }),
          el("div", { class: "row", "data-reveal": true, style: "--i:3" }, el("a", { class: "btn", href: "/retail#talk", text: "Ask about a pilot" }), el("a", { class: "link arrow", href: "/retail#pricing", text: "See the plans " })),
        ),
        el("ol", { class: "steps", "data-reveal": true, style: "--i:1" },
          el("li", {}, el("div", {}, el("b", { text: "Before day one." }), el("p", { class: "muted", text: "Your catalogue is already loaded. We agree the measures and install the mirror." }))),
          el("li", {}, el("div", {}, el("b", { text: "Days 1 to 30." }), el("p", { class: "muted", text: "You see the numbers every day in your console. We go through them with you every week." }))),
          el("li", {}, el("div", {}, el("b", { text: "Day 30." }), el("p", { class: "muted", text: "A written result against what we agreed. Keep it, or we take the mirror away." }))),
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
