// The two desks. A store's console: what happened at its mirrors, its catalogue, its mirrors, its look.
// The founder's desk: enquiries, stores, members, the messages waiting to be sent, and what it all costs.
import { $, $$, el, api, money, plural, when, toast, busy, onSubmit, copy, local, fill, connection, picture } from "./ui.js";

connection();
const desk = document.body.dataset.desk; // "console" | "hq"
const root = $("#desk");
const S = { me: null, tab: "", brand: "", brands: [], days: 30, filter: "all" };
const TABS = desk === "hq"
  ? [["today", "Today"], ["enquiries", "Enquiries"], ["stores", "Stores"], ["members", "Members"], ["outbox", "Outbox"], ["log", "Log"]]
  : [["overview", "Overview"], ["catalogue", "Catalogue"], ["mirrors", "Mirrors"], ["look", "Look and feel"]];

const num = (n) => Math.round(Number(n) || 0).toLocaleString("en-PK");
const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "—");
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
const stamp = (ms) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const work = () => $("#work");

const mark = () =>
  el("a", { class: "brandmark", href: desk === "hq" ? "/hq" : "/console", "aria-label": "MIRVA" }, svg('<rect x="8" y="12" width="16" height="25" rx="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 13Q16 0 29 13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>', "0 0 32 40"), el("span", { text: "MIRVA" }));
function svg(inner, viewBox, cls = "") {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  node.setAttribute("viewBox", viewBox);
  node.setAttribute("aria-hidden", "true");
  if (cls) node.setAttribute("class", cls);
  node.innerHTML = inner;
  return node;
}
const field = (label, control) => el("label", { class: "field" }, el("span", { text: label }), control);
const head = (title, ...right) => el("div", { class: "work-head" }, el("h1", { text: title }), el("div", { class: "row" }, right));
const panel = (title, ...kids) => el("section", { class: "panel" }, el("h2", { text: title }), kids);
const tile = (label, value, small, i = 0) => el("div", { class: "tile", style: `--i:${i}` }, el("span", { class: "k", text: label }), el("b", { class: "v", text: value }), small && el("small", { text: small }));
const empty = (text) => el("p", { class: "muted", text });
function hbars(items, format = num) {
  const top = Math.max(1, ...items.map((x) => x.value));
  return el("div", { class: "hbars" }, items.map((x) => el("div", {}, el("span", { text: x.label }), el("b", { text: format(x.value) + (x.note ? "  " + x.note : "") }), el("i", { style: `--v:${x.value / top}` }))));
}
// Bars for one series and a line for another, on a shared scale. Enough for a month of days.
function chart(days, barKey, lineKey) {
  if (!days.length) return empty("Nothing yet in this period.");
  const W = 640, H = 170, pad = 22;
  const top = Math.max(1, ...days.map((d) => Math.max(d[barKey] || 0, lineKey ? d[lineKey] || 0 : 0)));
  const step = (W - 8) / days.length;
  const y = (v) => H - pad - (v / top) * (H - pad - 8);
  const bars = days.map((d, i) => `<rect class="bar" x="${(4 + i * step + step * 0.14).toFixed(1)}" y="${y(d[barKey] || 0).toFixed(1)}" width="${(step * 0.72).toFixed(1)}" height="${(H - pad - y(d[barKey] || 0)).toFixed(1)}" rx="2"/>`).join("");
  const line = lineKey ? `<path class="line" d="${days.map((d, i) => `${i ? "L" : "M"}${(4 + i * step + step / 2).toFixed(1)} ${y(d[lineKey] || 0).toFixed(1)}`).join("")}"/>` : "";
  const label = (i) => new Date(days[i].date + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const marks = [0, Math.floor(days.length / 2), days.length - 1].filter((v, i, a) => a.indexOf(v) === i);
  const texts = marks.map((i) => `<text x="${(4 + i * step + step / 2).toFixed(1)}" y="${H - 5}" text-anchor="${i === 0 ? "start" : i === days.length - 1 ? "end" : "middle"}">${label(i)}</text>`).join("");
  return svg(`<line class="axis" x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}"/>${bars}${line}${texts}<text x="0" y="10">${num(top)}</text>`, `0 0 ${W} ${H}`, "chart");
}

start().catch((e) => fill(root, el("div", { class: "door" }, el("p", { text: e.message }))));

async function start() {
  const { user, setup } = await api("/api/me");
  if (!user) return desk === "hq" && setup ? firstRun() : door();
  if (user.role === "member") return door("That sign-in belongs to a shopper. This desk is for stores.");
  if (desk === "hq" && user.role !== "founder") return void (location.href = "/console");
  S.me = user;
  if (desk === "console") {
    S.brands = (await api("/api/console/brands")).brands;
    const asked = new URLSearchParams(location.search).get("brand");
    S.brand = S.brands.some((b) => b.id === asked) ? asked : S.brands.find((b) => b.id === "sapphire")?.id || S.brands[0]?.id || "";
  }
  fill(root, 
    el("div", { class: "shell" },
      el("aside", { class: "side" },
        mark(),
        el("p", { class: "where", text: desk === "hq" ? "Founder's desk" : "Store console" }),
        el("nav", { "aria-label": "Sections" }, TABS.map(([id, label]) => el("button", { type: "button", "data-tab": id, onclick: () => go(id) }, el("span", { text: label }), el("span", { class: "count", hidden: true })))),
        el("div", { class: "who" },
          el("b", { text: S.me.name }),
          el("span", { text: S.me.email }),
          desk === "console" && S.me.role === "founder" && el("a", { class: "link muted", href: "/hq", text: "Founder's desk" }),
          el("button", { class: "link muted", type: "button", style: "text-align:left", text: "Sign out", onclick: async () => (await api("/api/auth/signout", {}), location.reload()) }),
        ),
      ),
      el("main", { class: "work", id: "work", tabIndex: -1 }),
    ),
  );
  go(location.hash.slice(1));
}

function go(tab) {
  if (!VIEWS[tab]) tab = TABS[0][0];
  S.tab = tab;
  history.replaceState(null, "", location.pathname + location.search + "#" + tab);
  for (const b of $$(".side nav button")) b.dataset.tab === tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current");
  VIEWS[tab]().catch((e) => fill(work(), head("Something went wrong"), empty(e.message)));
}
const count = (tab, n) => {
  const badge = $(`.side nav button[data-tab="${tab}"] .count`);
  if (badge) (badge.textContent = n), (badge.hidden = !n);
};

// At the edge there is no file to read the founder's first sign-in from. The founder makes it here,
// once, with the setup key that was stored as a secret when MIRVA was deployed.
function firstRun() {
  const form = el("form", { class: "form", novalidate: true },
    field("Setup key", el("input", { name: "key", type: "password", autocomplete: "off", required: true })),
    field("Your email", el("input", { name: "email", type: "email", autocomplete: "username", required: true })),
    field("A password for the desk", el("input", { name: "password", type: "password", autocomplete: "new-password", required: true, minLength: 10 })),
    el("p", { class: "formnote", role: "alert" }),
    el("button", { class: "btn wide", type: "submit", text: "Open the desk" }),
  );
  onSubmit(form, async (d) => {
    await api("/api/setup", d);
    location.reload();
  });
  fill(root,
    el("div", { class: "door" },
      el("div", { class: "card" },
        mark(),
        el("div", { class: "stack close" },
          el("p", { class: "kicker", text: "Founder's desk" }),
          el("h1", { class: "title", text: "Set it up." }),
          el("p", { class: "muted", text: "This happens once. The setup key is the one saved when MIRVA was deployed. Ten characters or more for the password." }),
        ),
        form,
      ),
    ),
  );
}

function door(message) {
  const form = el("form", { class: "form", novalidate: true },
    field("Email", el("input", { name: "email", type: "email", autocomplete: "username", required: true })),
    field("Password", el("input", { name: "password", type: "password", autocomplete: "current-password", required: true })),
    el("p", { class: "formnote", role: "alert" }),
    el("button", { class: "btn wide", type: "submit", text: "Sign in" }),
  );
  onSubmit(form, async (d) => {
    await api("/api/auth/signin", d);
    location.reload();
  });
  fill(root, 
    el("div", { class: "door" },
      el("div", { class: "card" },
        mark(),
        el("div", { class: "stack close" },
          el("p", { class: "kicker", text: desk === "hq" ? "Founder's desk" : "Store console" }),
          el("h1", { class: "title", text: "Sign in." }),
          message && el("p", { class: "muted", text: message }),
        ),
        form,
        local && el("p", { class: "fine", text: desk === "hq" ? "On this machine, the founder's sign-in is in the file .data/first-run.txt." : "On this machine, the demo store's sign-in is in the file .data/demo-sign-ins.txt (run npm run seed to make it)." }),
        el("a", { class: "link muted", href: desk === "hq" ? "/" : "/retail", text: "Back to the site" }),
      ),
    ),
  );
}

const VIEWS = {
  // =================================================================== a store's console
  async overview() {
    const o = await api(`/api/console/overview?brand=${S.brand}&days=${S.days}`);
    const f = o.funnel;
    const name = S.brands.find((b) => b.id === S.brand)?.name || S.brand;
    const spend = Object.fromEntries(o.spend.byKind.map((k) => [k.kind, k]));
    const peak = Math.max(1, ...o.hours.map((h) => h.visits));
    const byHour = new Map(o.hours.map((h) => [Number(h.hour), h.visits]));
    fill(work(), 
      head(name,
        S.brands.length > 1 && el("select", { class: "input", style: "min-height:34px;padding:4px 12px;width:auto", "aria-label": "Store", onchange: (e) => ((S.brand = e.target.value), go("overview")) }, S.brands.map((b) => el("option", { value: b.id, text: b.name, selected: b.id === S.brand }))),
        [7, 30, 90].map((d) => el("button", { class: "chip" + (S.days === d ? " on" : ""), type: "button", text: `${d} days`, onclick: () => ((S.days = d), go("overview")) })),
      ),
      o.sample && el("p", { class: "sample", text: "Sample numbers. The seed script added a month of made-up visits so you can see the console at work. Real visits are counted beside them." }),
      el("div", { class: "tiles" },
        tile("Stepped up", num(f.visits), "shoppers who began", 0),
        tile("Saw three looks", num(f.briefed), pct(f.briefed, f.visits) + " of those", 1),
        tile("Tried one on", num(f.tried), pct(f.tried, f.visits) + " of all", 2),
        tile("Kept a look", num(f.kept), pct(f.kept, f.tried) + " of those who tried", 3),
        tile("Sent to a phone", num(f.sent), pct(f.sent, f.kept) + " of those who kept", 4),
        tile("Cost per try-on", money(o.spend.perVisitPkr), "what the pictures cost you", 5),
      ),
      el("div", { class: "grid2" },
        panel("Day by day", chart(o.byDay, "visits", "tries"), el("div", { class: "legend" }, el("span", {}, el("i", { class: "soft" }), "Stepped up"), el("span", {}, el("i"), "Try-ons"))),
        panel("From stepping up to taking it home", hbars([{ label: "Stepped up", value: f.visits }, { label: "Saw three looks", value: f.briefed }, { label: "Tried one on", value: f.tried }, { label: "Kept a look", value: f.kept }, { label: "Sent it to a phone", value: f.sent }])),
      ),
      el("div", { class: "grid2" },
        panel("Tried most",
          o.top.length
            ? el("div", { class: "rows" }, o.top.slice(0, 8).map((p) => el("div", { class: "rowitem" }, p.image ? el("div", { style: "border-radius:6px" }, picture({ src: p.image, alt: "", loading: "lazy" })) : el("span"), el("div", {}, el("div", { text: p.name }), el("div", { class: "sub", text: `${money(p.price)} · kept ${pct(p.keeps, p.tries)} of the time` })), el("b", { class: "num", text: `${num(p.tries)} tries` }))))
            : empty("No try-ons yet in this period."),
        ),
        panel("Asked for, and not on the rail",
          el("p", { class: "lead", text: o.missed.length ? "Sizes shoppers chose that were sold out." : "Nobody asked for a size you didn't have." }),
          o.missed.length ? el("div", { class: "rows" }, o.missed.map((m) => el("div", { class: "rowitem plain" }, el("div", {}, el("div", { text: m.name }), el("div", { class: "sub", text: `Size ${m.size} · ${money(m.price)}` })), el("b", { class: "num", text: plural(m.asks, "ask") })))) : null,
        ),
      ),
      el("div", { class: "grid3" },
        panel("What they came for", o.occasions.length ? hbars(o.occasions.map((x) => ({ label: cap(x.occasion), value: x.n }))) : empty("No occasions chosen yet.")),
        panel("When they come",
          el("div", { class: "hours", role: "img", "aria-label": "Visits by hour of the day" }, Array.from({ length: 24 }, (_, h) => el("i", { class: (byHour.get(h) || 0) === peak ? "peak" : "", style: `height:${Math.round(((byHour.get(h) || 0) / peak) * 100)}%`, title: `${h}:00, ${num(byHour.get(h) || 0)} visits` }))),
          el("div", { class: "hours-axis" }, el("span", { text: "midnight" }), el("span", { text: "noon" }), el("span", { text: "11 pm" })),
        ),
        panel("What it cost to run",
          el("dl", { class: "kv" },
            el("dt", { text: "Portraits" }), el("dd", { class: "num", text: `${num(spend.portrait?.n)} · ${money((spend.portrait?.usd || 0) * 277)}` }),
            el("dt", { text: "Live looks" }), el("dd", { class: "num", text: `${num((spend.live?.seconds || 0) / 60)} min · ${money((spend.live?.usd || 0) * 277)}` }),
            el("dt", { text: "Together" }), el("dd", { class: "num", text: money(o.spend.pkr) }),
            o.plan && [el("dt", { text: "Plan" }), el("dd", { text: `${o.plan.name}, ${plural(o.plan.stores, "store")} (${o.plan.status})` })],
            o.plan && [el("dt", { text: "Sessions" }), el("dd", { class: "num", text: `${num(f.tried)} of ${num(o.plan.sessions)} in the allowance` })],
            o.plan && [el("dt", { text: "Fee" }), el("dd", { class: "num", text: `${money(o.plan.monthly)} a month` })],
          ),
        ),
      ),
    );
  },

  async catalogue() {
    const c = await api(`/api/console/catalogue?brand=${S.brand}`);
    const rows = (q) =>
      c.products
        .filter((p) => !q || p.name.toLowerCase().includes(q))
        .map((p) => {
          const toggle = el("button", { class: "switch", type: "button", role: "switch", "aria-checked": String(!p.hidden), "aria-label": `Show ${p.name} in the mirror`, onclick: async () => {
            try {
              await api("/api/console/catalogue/hide", { brand: S.brand, product: p.id, hidden: !p.hidden });
              p.hidden = !p.hidden;
              toggle.setAttribute("aria-checked", String(!p.hidden));
              tr.classList.toggle("off", p.hidden);
            } catch (e) {
              toast(e.message);
            }
          } });
          const tr = el("tr", { class: p.hidden ? "off" : "" },
            el("td", {}, p.image && el("div", { style: "border-radius:5px" }, picture({ src: p.image, alt: "", loading: "lazy" }))),
            el("td", {}, p.name, p.unstitched && el("span", { class: "badge soft", style: "margin-left:8px", text: "Unstitched" })),
            el("td", { class: "n", text: money(p.price) }),
            el("td", { text: p.sizesOut.length ? p.sizesOut.join(", ") : "—" }),
            el("td", { class: "n", text: num(p.tries) }),
            el("td", { class: "n", text: num(p.keeps) }),
            el("td", {}, toggle),
          );
          return tr;
        });
    const body = el("tbody", {}, rows(""));
    fill(work(), 
      head("Catalogue", el("input", { class: "input", style: "min-height:40px;width:240px", type: "search", placeholder: "Find a piece", "aria-label": "Find a piece", oninput: (e) => fill(body, ...rows(e.target.value.trim().toLowerCase())) })),
      el("p", { class: "muted", style: "margin-bottom:20px", text: `${c.products.length} pieces, read from your public site on ${new Date(c.brand.takenAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}. Switch a piece off and the mirror stops offering it.` }),
      el("div", { class: "tbl-wrap" }, el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ["Picture", "Piece", "Price", "Sold out online", "Tries", "Kept", "In the mirror"].map((t, i) => el("th", { scope: "col", class: [2, 4, 5].includes(i) ? "n" : "" }, i ? t : el("span", { class: "sr", text: t }))))), body)),
    );
  },

  async mirrors() {
    const { devices } = await api(`/api/console/devices?brand=${S.brand}`);
    const add = el("form", { class: "toolbar" },
      field("Name of the mirror", el("input", { name: "name", placeholder: "Front mirror", maxLength: 40, required: true })),
      field("Which store", el("input", { name: "store", placeholder: "Gulberg flagship", maxLength: 60 })),
      el("button", { class: "btn small", type: "submit", text: "Add a mirror" }),
    );
    onSubmit(add, async (d) => {
      await api("/api/console/devices", { ...d, brand: S.brand });
      go("mirrors");
    });
    const card = (d) =>
      el("section", { class: "panel" },
        el("div", { class: "row", style: "justify-content:space-between" },
          el("div", {}, el("div", { class: "lead", text: d.name }), el("div", { class: "muted small", text: d.store || "No store named" })),
          el("span", { class: "badge " + (d.paired ? "good" : "warn"), text: d.paired ? (d.seen ? `Seen ${when(d.seen)}` : "Paired") : "Not paired yet" }),
        ),
        d.pair_code && el("div", { class: "stack close" },
          el("p", { class: "muted small", text: "On the mirror's own browser, open this address. The code works once, for thirty minutes." }),
          el("p", { class: "code", text: d.pair_code }),
          el("p", { class: "mono", text: d.pairUrl }),
          el("button", { class: "btn ghost small", type: "button", style: "justify-self:start", text: "Copy the address", onclick: () => copy(d.pairUrl) }),
        ),
        el("div", { class: "row" },
          el("button", { class: "link", type: "button", text: d.paired ? "Unpair and make a new code" : "New code", onclick: async () => (await api("/api/console/devices/code", { id: d.id }).catch((e) => toast(e.message)), go("mirrors")) }),
          el("button", { class: "link muted", type: "button", text: "Remove", onclick: async (e) => {
            if (e.target.dataset.sure !== "1") return (e.target.dataset.sure = "1"), void (e.target.textContent = "Sure? Tap again");
            await api("/api/console/devices/remove", { id: d.id }).catch((err) => toast(err.message));
            go("mirrors");
          } }),
        ),
      );
    fill(work(), 
      head("Mirrors"),
      el("p", { class: "muted", style: "margin-bottom:20px;max-width:62ch", text: "A mirror is any screen with a camera and a browser. Pairing ties it to your store, so its try-ons are counted here and nobody else's screen can spend on your account." }),
      add,
      devices.length ? el("div", { class: "grid2" }, devices.map(card)) : empty("No mirrors yet. Add one above."),
    );
  },

  async look() {
    const { brand } = await api(`/api/console/catalogue?brand=${S.brand}`);
    const state = { mood: brand.mood || "porcelain", accent: brand.accent || "#0C1018", byline: brand.byline || "styled by MIRVA" };
    const glass = el("div", { class: "glass", "aria-hidden": "true" },
      svg('<path class="track" d="M14 38Q100 -8 186 38" pathLength="100"/><path class="arc" d="M14 38Q100 -8 186 38" pathLength="100"/>', "0 0 200 44", "halo breathe"),
      el("div", { class: "crest" }, el("span", { class: "wm", text: brand.name.toUpperCase() }), el("span", { class: "by", id: "lfBy", text: state.byline })),
      el("span", { class: "pill", id: "lfPill", text: "On you" }),
    );
    const paint = () => {
      const pill = $("#lfPill", glass);
      pill.style.background = state.accent;
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(state.accent.slice(i, i + 2), 16));
      pill.style.color = r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#0a0c11" : "#fff";
      $("#lfBy", glass).textContent = state.byline;
      for (const b of $("[data-mood-set]", form)) b.classList.toggle("on", b.dataset.moodSet === state.mood);
    };
    const form = el("form", { class: "panel form" },
      el("h2", { text: "How MIRVA dresses for you" }),
      el("div", { class: "field" }, el("span", { text: "Mood of the tablet" }), el("div", { class: "row" }, ["porcelain", "noir"].map((m) => el("button", { class: "chip", type: "button", "data-mood-set": m, text: cap(m), onclick: () => ((state.mood = m), paint()) })))),
      field("Your colour", el("input", { type: "color", name: "accent", value: state.accent, style: "padding:4px;height:50px", oninput: (e) => ((state.accent = e.target.value), paint()) })),
      field("The line under your name", el("input", { name: "byline", value: state.byline, maxLength: 40, oninput: (e) => ((state.byline = e.target.value), paint()) })),
      el("p", { class: "fine", text: "The glass itself is always dark. Your colour marks what the shopper is wearing and the one button that matters." }),
      el("p", { class: "formnote", role: "alert" }),
      el("button", { class: "btn small", type: "submit", style: "justify-self:start", text: "Save" }),
    );
    onSubmit(form, async () => {
      await api("/api/console/brand", { brand: S.brand, ...state });
      toast("Saved. Mirrors pick it up the next time they load.");
    });
    fill(work(), head("Look and feel"), el("div", { class: "lookfeel" }, form, glass));
    paint();
  },

  // =================================================================== the founder's desk
  async today() {
    const o = await api("/api/hq/overview");
    count("enquiries", o.leads.new);
    count("outbox", o.waiting.outbox);
    count("members", o.waiting.invites);
    const days = [...o.usage.reduce((m, r) => m.set(r.date, { date: r.date, usd: (m.get(r.date)?.usd || 0) + r.usd }), new Map()).values()].map((d) => ({ ...d, pkr: Math.round(d.usd * 277) }));
    const needs = [
      o.leads.new && `${plural(o.leads.new, "new enquiry", "new enquiries")} to answer.`,
      o.waiting.invites && `${plural(o.waiting.invites, "member")} asking about Private.`,
      o.waiting.outbox && `${plural(o.waiting.outbox, "message")} written and not sent. No email sender is connected yet.`,
      !o.system.live && "No Decart key is loaded, so try-on is off.",
      o.system.openMirror && "The mirror is open to anyone who can reach this address. Fine on this laptop. Set MIRVA_OPEN_MIRROR=0 before it goes online.",
      o.system.payments === "test" && "Payments are in test mode. No money can move.",
    ].filter(Boolean);
    fill(work(), 
      head("Today"),
      el("div", { class: "tiles" },
        tile("New enquiries", num(o.leads.new), `${num(o.leads.contacted + o.leads.demo)} in conversation`, 0),
        tile("Stores in pilot", num(o.pilots), `${num(o.leads.won)} won, ${num(o.leads.lost)} lost`, 1),
        tile("Monthly revenue", money(o.mrr), "from stores marked live", 2),
        tile("Members", num(o.members.total), `${num(o.members.week)} joined this week`, 3),
        tile("Looks kept", num(o.members.looks), `${num(o.members.votes)} votes on ${num(o.members.boards)} questions`, 4),
        tile("Try-on spend, 30 days", money(o.spend.pkr), `$${o.spend.usd.toFixed(2)} at list price`, 5),
      ),
      el("div", { class: "grid2" },
        panel("Needs you", el("ul", { class: "warns" }, needs.length ? needs.map((t) => el("li", { text: t })) : el("li", { class: "ok", text: "Nothing is waiting." }))),
        panel("Real try-on spend, day by day", chart(days, "pkr"), el("p", { class: "fine", text: "In rupees, at Decart's list price. Sample activity is left out." })),
      ),
      el("div", { class: "grid2" },
        panel("Stores", o.retailers.length ? el("div", { class: "rows" }, o.retailers.map((r) => el("div", { class: "rowitem plain" }, el("div", {}, el("div", { text: r.name }), el("div", { class: "sub", text: `${cap(r.plan)} · ${plural(r.stores, "store")} · ${r.status}` })), el("b", { class: "num", text: money(r.monthly) })))) : empty("No stores yet.")),
        panel("The system",
          el("dl", { class: "kv" },
            el("dt", { text: "Try-on" }), el("dd", { text: o.system.live ? `On · ${o.system.model}` : "Off" }),
            el("dt", { text: "Live session cap" }), el("dd", { text: `${o.system.sessionSeconds} seconds, pauses after ${o.system.idleSeconds} idle` }),
            el("dt", { text: "Payments" }), el("dd", { text: cap(o.system.payments) }),
            el("dt", { text: "Address" }), el("dd", { class: "mono", text: o.system.origin }),
            el("dt", { text: "Catalogues loaded" }), el("dd", { text: o.system.brands.join(", ") }),
          ),
        ),
      ),
    );
  },

  async enquiries() {
    const { leads, statuses } = await api("/api/hq/leads");
    count("enquiries", leads.filter((l) => l.status === "new").length);
    const shown = leads.filter((l) => S.filter === "all" || l.status === S.filter);
    const card = (l) => {
      const notes = el("textarea", { "aria-label": "Notes", placeholder: "Notes for yourself", value: l.notes });
      const save = async (patch) => {
        try {
          await api("/api/hq/leads/update", { id: l.id, notes: notes.value, ...patch });
          toast("Saved.");
          if (patch.status) go("enquiries");
        } catch (e) {
          toast(e.message);
        }
      };
      return el("article", { class: "panel lead-card" },
        el("div", { class: "stack close" },
          el("div", { class: "row" }, el("h2", { text: l.company }), l.source === "sample" && el("span", { class: "badge soft", text: "Sample" })),
          el("p", { class: "muted small", text: [l.name, l.role, l.city, l.stores && plural(l.stores, "store"), l.plan && cap(l.plan), when(l.at)].filter(Boolean).join(" · ") }),
          el("p", { class: "small" }, el("a", { href: `mailto:${l.email}`, text: l.email }), l.phone && "  ·  ", l.phone && el("a", { href: `https://wa.me/${l.phone.replace(/[^0-9]/g, "")}`, target: "_blank", rel: "noopener", text: l.phone })),
          l.message && el("p", { class: "msg", text: l.message }),
        ),
        el("div", { class: "stack close" },
          el("div", { class: "statusrow", role: "group", "aria-label": "Stage" }, statuses.map((s) => el("button", { class: "chip" + (l.status === s ? " on" : ""), type: "button", text: s, onclick: () => save({ status: s }) }))),
          el("div", { class: "field" }, notes),
          el("button", { class: "btn ghost small", type: "button", style: "justify-self:start", text: "Save notes", onclick: () => save({}) }),
        ),
      );
    };
    fill(work(), 
      head("Enquiries", ["all", ...statuses].map((s) => el("button", { class: "chip" + (S.filter === s ? " on" : ""), type: "button", style: "text-transform:capitalize", text: s === "all" ? `All (${leads.length})` : `${s} (${leads.filter((l) => l.status === s).length})`, onclick: () => ((S.filter = s), go("enquiries")) }))),
      shown.length ? el("div", { class: "leads" }, shown.map(card)) : empty("Nothing at this stage."),
    );
  },

  async stores() {
    const o = await api("/api/hq/overview");
    const { retail: plans } = await api("/api/plans");
    const brandOptions = () => o.system.brands.map((id) => el("option", { value: id, text: id }));
    const load = el("form", { class: "toolbar" }, field("Load a store's catalogue (its Shopify address)", el("input", { name: "domain", placeholder: "store.com", required: true })), el("button", { class: "btn small", type: "submit", text: "Load it" }), el("p", { class: "formnote", role: "alert", style: "flex-basis:100%" }));
    onSubmit(load, async (d) => {
      const s = await api("/api/preview", d, 40000);
      toast(`${s.name} is loaded.`);
      go("stores");
    });
    const plan = el("form", { class: "panel form" },
      el("h2", { text: "Set a store's plan" }),
      el("div", { class: "form-2" },
        field("Store", el("select", { name: "brand" }, brandOptions())),
        field("Plan", el("select", { name: "plan" }, Object.values(plans).map((p) => el("option", { value: p.id, text: `${p.name} · ${money(p.monthly)}` })))),
        field("Number of stores", el("input", { name: "stores", type: "number", min: 1, max: 5000, value: 1 })),
        field("Stage", el("select", { name: "status" }, ["demo", "pilot", "live", "paused"].map((s) => el("option", { value: s, text: cap(s) })))),
      ),
      el("p", { class: "formnote", role: "alert" }),
      el("button", { class: "btn small", type: "submit", style: "justify-self:start", text: "Save" }),
    );
    onSubmit(plan, async (d) => {
      await api("/api/hq/retailers", d);
      go("stores");
    });
    const user = el("form", { class: "panel form" },
      el("h2", { text: "Give someone at a store a console sign-in" }),
      el("div", { class: "form-2" }, field("Store", el("select", { name: "brand" }, brandOptions())), field("Their name", el("input", { name: "name", required: true, maxLength: 80 })), field("Their email", el("input", { name: "email", type: "email", required: true }))),
      el("p", { class: "formnote", role: "alert" }),
      el("button", { class: "btn small", type: "submit", style: "justify-self:start", text: "Create the sign-in" }),
    );
    onSubmit(user, async (d) => {
      const made = await api("/api/hq/retailers/user", d);
      const sheet = el("dialog", { class: "sheet" },
        el("div", { class: "sheet-head" }, el("h2", { class: "subtitle", text: "Pass this on by hand." })),
        el("div", { class: "stack close" },
          el("p", { class: "muted", text: "This password is shown once and is not stored anywhere you can read it again." }),
          el("p", { class: "mono", text: made.email }),
          el("p", { class: "code", style: "font-size:18px;letter-spacing:.08em", text: made.password }),
          el("div", { class: "row" }, el("button", { class: "btn small", type: "button", text: "Copy the password", onclick: () => copy(made.password) }), el("button", { class: "link muted", type: "button", text: "Done", onclick: () => sheet.close() })),
        ),
      );
      sheet.addEventListener("close", () => (sheet.remove(), go("stores")));
      document.body.append(sheet);
      sheet.showModal();
    });
    const byBrand = new Map(o.retailers.map((r) => [r.brand, r]));
    fill(work(), 
      head("Stores"),
      load,
      el("div", { class: "tbl-wrap", style: "margin-bottom:12px" },
        el("table", { class: "tbl" },
          el("thead", {}, el("tr", {}, ["Store", "Plan", "Stores", "Stage", "A month", "Console users", "Open"].map((t, i) => el("th", { scope: "col", class: i === 2 || i === 4 ? "n" : "", text: t })))),
          el("tbody", {}, o.system.brands.map((id) => {
            const r = byBrand.get(id);
            return el("tr", {},
              el("td", { text: r?.name || id }),
              el("td", { text: r ? cap(r.plan) : "—" }),
              el("td", { class: "n", text: r ? num(r.stores) : "—" }),
              el("td", {}, r ? el("span", { class: "badge " + (r.status === "live" ? "good" : "soft"), text: r.status }) : "Catalogue only"),
              el("td", { class: "n", text: r ? money(r.monthly) : "—" }),
              el("td", { text: r?.users.map((u) => u.email).join(", ") || "—" }),
              el("td", {}, el("a", { href: `/console?brand=${id}`, text: "Console" }), " · ", el("a", { href: `/for/${id}`, text: "Their page" }), " · ", el("a", { href: `/mirror?brand=${id}`, text: "Mirror" })),
            );
          })),
        ),
      ),
      el("div", { class: "grid2" }, plan, user),
      o.system.stores &&
        panel("Who can open each store's mirror",
          el("p", { class: "muted small", style: "max-width:62ch", text: "Listed: anyone can find and open it. By link only: it opens for people who have its address, and is not offered to the public. A store that has not agreed to a demo belongs in the second group." }),
          el("div", { class: "rows" }, o.system.stores.map((s) => el("div", { class: "rowitem plain" },
            el("div", {}, el("div", { text: s.name }), el("div", { class: "sub", text: s.id })),
            el("select", { class: "input", style: "min-height:40px;width:auto;padding:4px 12px", "aria-label": `Who can open ${s.name}`, onchange: async (e) => {
              try {
                await api("/api/hq/stores/visibility", { brand: s.id, visibility: e.target.value });
                toast("Saved.");
              } catch (err) {
                toast(err.message);
              }
            } }, [["public", "Listed"], ["unlisted", "By link only"]].map(([v, t]) => el("option", { value: v, text: t, selected: (s.visibility || "public") === v }))),
          ))),
        ),
    );
  },

  async members() {
    const [{ members }, { invites }] = await Promise.all([api("/api/hq/members"), api("/api/hq/invites")]);
    const waiting = invites.filter((i) => i.status === "waiting");
    count("members", waiting.length);
    const decide = async (id, decision) => (await api("/api/hq/invites/decide", { id, decision }).catch((e) => toast(e.message)), go("members"));
    fill(work(), 
      head("Members"),
      waiting.length > 0 && panel("Asking about Private",
        el("div", { class: "rows" }, waiting.map((i) => el("div", { class: "rowitem plain" },
          el("div", {}, el("div", { text: `${i.name} · ${i.email}` }), el("div", { class: "sub", text: `${plural(i.looks, "look")} kept · asked ${when(i.at)}${i.note ? " · “" + i.note + "”" : ""}` })),
          el("div", { class: "row" }, el("button", { class: "btn small", type: "button", text: "Invite", onclick: () => decide(i.id, "invite") }), el("button", { class: "link muted", type: "button", text: "Not now", onclick: () => decide(i.id, "decline") })),
        ))),
      ),
      el("div", { class: "tbl-wrap", style: "margin-top:12px" },
        el("table", { class: "tbl" },
          el("thead", {}, el("tr", {}, ["Name", "Email", "Tier", "Joined", "Last seen", "Looks kept"].map((t, i) => el("th", { scope: "col", class: i === 5 ? "n" : "", text: t })))),
          el("tbody", {}, members.length ? members.map((m) => el("tr", {}, el("td", { text: m.name }), el("td", { text: m.email }), el("td", {}, el("span", { class: "badge " + (m.tier === "private" ? "" : "soft"), text: m.tier })), el("td", { text: when(m.created) }), el("td", { text: m.seen ? when(m.seen) : "—" }), el("td", { class: "n", text: num(m.looks) }))) : el("tr", {}, el("td", { colSpan: 6, text: "No members yet." }))),
        ),
      ),
    );
  },

  async outbox() {
    const { outbox } = await api("/api/hq/outbox");
    count("outbox", outbox.filter((m) => !m.sent).length);
    fill(work(), 
      head("Outbox"),
      el("p", { class: "muted", style: "margin-bottom:20px;max-width:62ch", text: "Nothing is sent from MIRVA yet. These are the messages it would have sent. Until an email sender is connected, copy the ones that matter and send them yourself." }),
      outbox.length
        ? el("div", { class: "panel" }, outbox.map((m) => el("div", { class: "outmsg" + (m.sent ? " sent" : "") },
            el("div", { class: "row", style: "justify-content:space-between" }, el("b", { text: m.subject }), el("span", { class: "muted small", text: `${m.channel === "founder" ? "to you" : "to " + m.recipient} · ${stamp(m.at)}` })),
            el("pre", { text: m.body }),
            !m.sent && el("div", { class: "row" }, el("button", { class: "btn ghost small", type: "button", text: "Copy", onclick: () => copy(m.body) }), el("button", { class: "link muted", type: "button", text: m.channel === "founder" ? "Read" : "Mark as sent", onclick: async () => (await api("/api/hq/outbox/sent", { id: m.id }), go("outbox")) })),
          )))
        : empty("Nothing has been written yet."),
    );
  },

  async log() {
    const { audit } = await api("/api/hq/audit");
    fill(work(), 
      head("Log"),
      el("p", { class: "muted", style: "margin-bottom:20px", text: "The last 200 things that changed an account, a store or a mirror." }),
      el("div", { class: "tbl-wrap" }, el("table", { class: "tbl" }, el("thead", {}, el("tr", {}, ["When", "What", "About", "Who", "From"].map((t) => el("th", { scope: "col", text: t })))), el("tbody", {}, audit.map((a) => el("tr", {}, el("td", { text: stamp(a.at) }), el("td", { text: a.action }), el("td", { text: a.target || "—" }), el("td", { class: "mono", text: a.actor || "—" }), el("td", { class: "mono", text: a.ip || "—" })))))),
    );
  },
};
