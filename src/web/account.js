// A member's account: the door (join, sign in, reset), then the wardrobe, the opinions asked for, and the settings.
import { $, $$, el, api, money, plural, when, until, toast, whoAmI, busy, onSubmit, local, copy, fill, picture, signOut } from "./ui.js";
import { askSheet, shareSheet } from "./ask.js";
import { pushState, turnOnPush } from "./notify.js";

const root = () => $("#account");
const params = new URLSearchParams(location.search);
const claimCode = (location.pathname.match(/^\/claim\/([A-Za-z0-9]{8})$/) || [])[1] || "";
const TABS = ["wardrobe", "opinions", "you"];
const S = { me: null, tab: TABS.includes(params.get("tab")) ? params.get("tab") : "wardrobe", looks: [], boards: [], picking: false, picked: new Set() };

export async function start() {
  S.me = await whoAmI(true);
  if (S.me.user && S.me.user.role !== "member") return (location.href = S.me.user.role === "founder" ? "/hq" : "/console");
  if (params.get("reset")) return door("reset");
  if (!S.me.user) return door(params.get("join") || claimCode ? "join" : "signin");
  if (claimCode) await claim(claimCode);
  await home();
}

// ---------------------------------------------------------------- the door
const field = (label, props, hint) => el("label", { class: "field" }, el("span", { text: label }), el("input", props), hint && el("span", { class: "hint", text: hint }));

async function door(mode) {
  let waiting = null;
  if (claimCode) waiting = await api("/api/handoff/" + claimCode).catch(() => null);

  const forms = {
    join: () =>
      el("form", { class: "form", novalidate: true },
        field("Your name", { name: "name", autocomplete: "name", required: true, maxLength: 80 }),
        field("Email", { name: "email", type: "email", autocomplete: "email", required: true, inputMode: "email" }),
        field("Password", { name: "password", type: "password", autocomplete: "new-password", required: true, minLength: 10 }, "Ten characters or more. A sentence works well."),
        el("label", { class: "check" }, el("input", { type: "checkbox", name: "agree" }), el("span", {}, "I am 18 or over, and I agree to the ", el("a", { href: "/terms", target: "_blank", text: "terms" }), " and the ", el("a", { href: "/privacy", target: "_blank", text: "privacy notice" }), ".")),
        el("label", { class: "check" }, el("input", { type: "checkbox", name: "updates" }), el("span", { text: "Tell me when a mirror opens near me." })),
        el("p", { class: "formnote", role: "alert" }),
        el("button", { class: "btn wide", type: "submit", text: waiting ? "Keep these looks" : "Open my wardrobe" }),
      ),
    signin: () =>
      el("form", { class: "form", novalidate: true },
        field("Email", { name: "email", type: "email", autocomplete: "email", required: true, inputMode: "email" }),
        field("Password", { name: "password", type: "password", autocomplete: "current-password", required: true }),
        el("p", { class: "formnote", role: "alert" }),
        el("button", { class: "btn wide", type: "submit", text: "Sign in" }),
        el("button", { class: "link muted", type: "button", text: "Forgot your password?", onclick: () => show("forgot") }),
      ),
    forgot: () =>
      el("form", { class: "form", novalidate: true },
        el("p", { class: "muted", text: "Enter your email. If it has an account, a link to choose a new password is sent to it." }),
        field("Email", { name: "email", type: "email", autocomplete: "email", required: true }),
        el("p", { class: "formnote", role: "alert" }),
        el("button", { class: "btn wide", type: "submit", text: "Send the link" }),
        el("button", { class: "link muted", type: "button", text: "Back to sign in", onclick: () => show("signin") }),
      ),
    reset: () =>
      el("form", { class: "form", novalidate: true },
        el("p", { class: "muted", text: "Choose a new password. Every device will be signed out, and this one signed back in." }),
        field("New password", { name: "password", type: "password", autocomplete: "new-password", required: true, minLength: 10 }, "Ten characters or more."),
        el("p", { class: "formnote", role: "alert" }),
        el("button", { class: "btn wide", type: "submit", text: "Save and sign in" }),
      ),
  };
  const handlers = {
    join: async (d) => enter(await api("/api/auth/join", { ...d, claim: claimCode })),
    signin: async (d) => enter(await api("/api/auth/signin", { ...d, claim: claimCode })),
    forgot: async (d, form) => {
      await api("/api/auth/forgot", d);
      const note = $(".formnote", form);
      note.classList.add("ok");
      note.textContent = "If that email has an account, MIRVA will send it a link to choose a new password. For now a person sends these, so allow a day.";
    },
    reset: async (d) => {
      await api("/api/auth/reset", { ...d, token: params.get("reset") });
      history.replaceState(null, "", "/account");
      await enter();
    },
  };

  const slot = el("div");
  const tabs = el("div", { class: "tabs", role: "tablist" },
    el("button", { type: "button", role: "tab", "data-mode": "join", text: "Join", onclick: () => show("join") }),
    el("button", { type: "button", role: "tab", "data-mode": "signin", text: "Sign in", onclick: () => show("signin") }),
  );
  function show(next) {
    mode = next;
    for (const b of $$("button", tabs)) b.setAttribute("aria-selected", String(b.dataset.mode === mode));
    tabs.hidden = mode === "reset";
    const form = forms[mode]();
    onSubmit(form, handlers[mode]);
    fill(slot, form);
    $("input", form)?.focus({ preventScroll: true });
  }

  fill(root(), 
    el("div", { class: "wrap gate" },
      el("div", { class: "stack" },
        el("p", { class: "kicker", text: waiting ? `From the mirror at ${waiting.brand}` : "Your wardrobe" }),
        el("h1", { class: "title" }, ...(waiting ? ["Your looks ", el("em", { text: "are waiting." })] : ["Everything you kept, ", el("em", { text: "in one place." })])),
        el("p", { class: "lede", text: waiting ? "Join, or sign in, and they go straight into your wardrobe." : "Looks from any MIRVA mirror, your sizes, and six portraits a month at home. Free." }),
        waiting && el("div", { class: "waiting" },
          el("ul", {}, waiting.looks.map((l) => el("li", {}, el("div", { style: "border-radius:10px" }, picture({ src: l.image, alt: "", loading: "lazy" })), el("span", { text: l.name })))),
          el("p", { class: "fine", style: "color:#c8cedb", text: `${plural(waiting.looks.length, "look")}, kept for you for fourteen days.` }),
        ),
      ),
      el("div", { class: "card gate-card" }, tabs, slot),
    ),
  );
  show(mode);
}

async function enter(result) {
  S.me = await whoAmI(true);
  if (S.me.user?.role !== "member") return (location.href = S.me.user?.role === "founder" ? "/hq" : "/console");
  if (location.pathname !== "/account" || location.search) history.replaceState(null, "", "/account");
  await home();
  if (result?.claimed?.added) toast(`${plural(result.claimed.added, "look")} from the mirror ${result.claimed.added === 1 ? "is" : "are"} in your wardrobe.`);
}

async function claim(code) {
  try {
    const out = await api("/api/claim", { code });
    toast(out.added ? `${plural(out.added, "look")} from the mirror ${out.added === 1 ? "is" : "are"} in your wardrobe.` : "Those looks were already here.");
  } catch (e) {
    toast(e.message);
  }
  history.replaceState(null, "", "/account");
}

// ---------------------------------------------------------------- home
async function home() {
  [{ looks: S.looks }, { boards: S.boards }] = await Promise.all([api("/api/wardrobe"), api("/api/boards")]);
  const { user, tier, usage } = S.me;
  const left = Math.max(0, tier.portraitsPerMonth - usage.portraits);
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const C = 2 * Math.PI * 26;

  fill(root(), 
    el("div", { class: "wrap" },
      el("div", { class: "me-head" },
        el("div", { class: "stack close" },
          el("p", { class: "kicker", text: `${tier.name} member · since ${new Date(user.joined).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}` }),
          el("div", { class: "row signed" },
            el("h1", { class: "title" }, greeting + ", ", el("em", { text: user.name.split(" ")[0] + "." })),
            el("button", { class: "link muted", type: "button", text: "Sign out", onclick: () => signOut() }),
          ),
        ),
        el("div", { class: "allow" },
          ring(left / tier.portraitsPerMonth, C),
          el("div", {}, el("b", { class: "num", text: `${left} of ${tier.portraitsPerMonth}` }), el("p", { class: "fine", text: "portraits left this month" })),
          el("a", { class: "btn small", href: "/mirror", text: "Open the mirror" }),
        ),
      ),
      el("div", { class: "me-tabs", role: "tablist" },
        ...[["wardrobe", `Wardrobe (${S.looks.length})`], ["opinions", `Opinions (${S.boards.length})`], ["you", "You"]].map(([id, label]) =>
          el("button", { type: "button", role: "tab", "data-tab": id, "aria-selected": String(S.tab === id), text: label, onclick: () => ((S.tab = id), (S.picking = false), S.picked.clear(), home()) }),
        ),
      ),
      el("div", { id: "view" }),
    ),
    appbar(),
  );
  ({ wardrobe, opinions, you })[S.tab]();
  if (S.tab === "opinions") api("/api/notes/seen", {}).catch(() => {});
}

// On a phone the account is an app: four places along the bottom, where the thumb is.
const ICONS = {
  mirror: '<rect x="8" y="5.5" width="8" height="14" rx="4"/><path d="M5 6.5Q12 0.5 19 6.5"/>',
  wardrobe: '<path d="M12 5.5a2 2 0 1 1 2 2c-.9 0-2 .7-2 1.6v.4"/><path d="M12 9.5 3.5 15.8c-.8.6-.4 1.7.6 1.7h15.8c1 0 1.4-1.1.6-1.7L12 9.5Z"/>',
  opinions: '<path d="M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-7l-4 3v-3H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5Z"/>',
  you: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1.2-3.3 3.9-5 7-5s5.8 1.7 7 5"/>',
};
function appbar() {
  const icon = (name) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = ICONS[name];
    return svg;
  };
  const tab = (id, label) =>
    el("button", { type: "button", class: "appbar-item", "aria-current": S.tab === id ? "page" : false, onclick: () => ((S.tab = id), (S.picking = false), S.picked.clear(), home(), scrollTo({ top: 0 })) }, icon(id), el("span", { text: label }), id === "opinions" && el("i", { class: "dot", id: "unseen", hidden: true }));
  const bar = el("nav", { class: "appbar", "aria-label": "Your MIRVA" },
    el("a", { class: "appbar-item", href: "/mirror" }, icon("mirror"), el("span", { text: "Mirror" })),
    tab("wardrobe", "Wardrobe"),
    tab("opinions", "Questions"),
    tab("you", "You"),
  );
  // New answers she has not seen yet
  if (S.tab !== "opinions")
    api("/api/notes")
      .then(({ unseen }) => {
        const dot = $("#unseen");
        if (dot && unseen) ((dot.hidden = false), (dot.textContent = unseen > 9 ? "9+" : String(unseen)));
      })
      .catch(() => {});
  return bar;
}

function ring(part, C) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 58 58");
  svg.setAttribute("class", "ring");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<circle cx="29" cy="29" r="26"/><circle class="left" cx="29" cy="29" r="26" stroke-dasharray="${C}" stroke-dashoffset="${C}"/>`;
  requestAnimationFrame(() => requestAnimationFrame(() => svg.lastChild.setAttribute("stroke-dashoffset", String(C * (1 - Math.min(1, Math.max(0, part)))))));
  return svg;
}

// ---------------------------------------------------------------- wardrobe
function wardrobe() {
  const view = $("#view");
  if (!S.looks.length)
    return fill(view, 
      el("div", { class: "empty" },
        el("p", { class: "subtitle voice", text: "Nothing kept yet." }),
        el("p", { class: "muted", text: "Open the mirror, try a look, and press Keep. It will be here when you come back." }),
        el("a", { class: "btn", href: "/mirror", text: "Open the mirror" }),
      ),
    );

  const grid = el("div", { class: "closet" }, S.looks.map(piece));
  const bar = S.picking
    ? el("div", { class: "askbar" },
        el("span", { id: "pickCount", text: pickLine() }),
        el("div", { class: "row" },
          el("button", { class: "link", type: "button", text: "Cancel", onclick: () => ((S.picking = false), S.picked.clear(), wardrobe()) }),
          el("button", { class: "btn small", type: "button", text: "Next", onclick: makeBoard }),
        ),
      )
    : null;
  fill(view, 
    el("div", { class: "row", style: "justify-content:space-between;margin-bottom:24px" },
      el("p", { class: "muted", text: S.picking ? "Tap the looks you can't choose between." : "Everything you kept, newest first." }),
      !S.picking && S.looks.length > 1 && el("button", { class: "btn ghost small", type: "button", text: "Ask for opinions", onclick: () => ((S.picking = true), wardrobe()) }),
    ),
    grid,
    bar,
  );
}

const pickLine = () => (S.picked.size < 2 ? "Choose at least two" : `${S.picked.size} chosen`);

function piece(look) {
  let showing = look.portrait ? "portrait" : "piece";
  const img = picture({ src: look.portrait || look.image, alt: look.portrait ? `Your portrait in ${look.name}` : look.name, loading: "lazy" });
  const flip = look.portrait && el("button", { class: "flip", type: "button", text: "See the piece", onclick: (e) => {
    e.stopPropagation();
    showing = showing === "portrait" ? "piece" : "portrait";
    img.src = showing === "portrait" ? look.portrait : look.image;
    flip.textContent = showing === "portrait" ? "See the piece" : "See it on you";
  } });
  const drop = el("button", { class: "link muted", type: "button", text: "Let it go", onclick: async (e) => {
    e.stopPropagation();
    if (drop.dataset.sure !== "1") return (drop.dataset.sure = "1"), (drop.textContent = "Sure? Tap again"), setTimeout(() => ((drop.dataset.sure = ""), (drop.textContent = "Let it go")), 3000);
    await api("/api/wardrobe/remove", { id: look.id }).catch((err) => toast(err.message));
    S.me = await whoAmI(true);
    await home();
  } });
  const card = el("article", { class: "piece" + (S.picked.has(look.id) ? " pick" : "") },
    el("div", { class: "shot" }, img, look.portrait && el("span", { class: "badge", text: "On you" }), !S.picking && flip, S.picking && el("span", { class: "tick", "aria-hidden": "true", text: S.picked.has(look.id) ? "✓" : "" })),
    el("b", { text: look.name }),
    el("span", { class: "meta num", text: [look.brandName, money(look.price, look.currency), look.size && "Size " + look.size].filter(Boolean).join(" · ") }),
    !S.picking && el("div", { class: "acts" }, look.url && el("a", { class: "link", href: look.url, target: "_blank", rel: "noopener", text: "At the store" }), drop),
  );
  if (S.picking) {
    card.tabIndex = 0;
    card.setAttribute("role", "checkbox");
    card.setAttribute("aria-checked", String(S.picked.has(look.id)));
    const pick = () => {
      S.picked.has(look.id) ? S.picked.delete(look.id) : S.picked.size < 6 && S.picked.add(look.id);
      wardrobe();
    };
    card.addEventListener("click", pick);
    card.addEventListener("keydown", (e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), pick()));
  }
  return card;
}

function makeBoard() {
  if (S.picked.size < 2) return toast("Choose at least two looks.");
  const looks = S.looks.filter((l) => S.picked.has(l.id));
  askSheet({
    looks,
    by: S.me.user.name.split(" ")[0],
    onMade: async () => {
      S.picking = false;
      S.picked.clear();
      S.tab = "opinions";
      await home();
    },
  });
}

// ---------------------------------------------------------------- opinions
let refresher = null;
function opinions() {
  const view = $("#view");
  clearInterval(refresher);
  if (!S.boards.length)
    return fill(view,
      el("div", { class: "empty" },
        el("p", { class: "subtitle voice", text: "No questions asked yet." }),
        el("p", { class: "muted", text: "Pick two or more looks from your wardrobe and send one link to the people whose opinion you trust. They answer with one tap, no app." }),
        S.looks.length > 1
          ? el("button", { class: "btn", type: "button", text: "Choose the looks", onclick: () => ((S.tab = "wardrobe"), (S.picking = true), home()) })
          : el("a", { class: "btn", href: "/mirror", text: "Open the mirror" }),
      ),
    );
  const tell = el("div", { class: "tell-line", hidden: true });
  pushState().then((state) => {
    if (state !== "off") return;
    fill(tell, el("p", { class: "muted", text: "Be told on this phone when someone answers." }), el("button", { class: "btn ghost small", type: "button", text: "Turn on", onclick: async () => (await turnOnPush()) && (tell.hidden = true) }));
    tell.hidden = false;
  });
  fill(view, tell, el("div", { class: "questions" }, S.boards.map(question)));
  // Answers arrive while she watches.
  if (S.boards.some((b) => !b.closed))
    refresher = setInterval(async () => {
      if (S.tab !== "opinions" || document.visibilityState !== "visible") return;
      try {
        const { boards } = await api("/api/boards");
        if (JSON.stringify(boards.map((b) => [b.code, b.total, b.closed, b.decided])) !== JSON.stringify(S.boards.map((b) => [b.code, b.total, b.closed, b.decided]))) {
          S.boards = boards;
          opinions();
        }
      } catch {}
    }, 10000);
}

function question(b) {
  const total = b.total;
  const lead = Math.max(0, ...Object.values(b.tally).map((t) => t.votes));
  const notes = b.votes.filter((v) => v.note);
  const status = b.decided ? el("span", { class: "badge good", text: "Decided" }) : b.closed ? el("span", { class: "badge soft", text: "Closed" }) : el("span", { class: "badge good", text: until(b.closes) });
  const act = async (path, body, done) => {
    try {
      await api(path, { code: b.code, ...body });
      ({ boards: S.boards } = await api("/api/boards"));
      opinions();
      done?.();
    } catch (e) {
      toast(e.message);
    }
  };
  return el("article", { class: "question" },
    el("div", { class: "q-head" },
      el("div", { class: "stack close" }, el("h3", { class: "subtitle", text: b.title }), el("div", { class: "row" }, status, el("span", { class: "fine", text: total ? plural(total, "answer") : `No answers yet · asked ${when(b.created)}` }), b.pictures === "store" && el("span", { class: "fine", text: "· store photos sent" }))),
    ),
    el("ul", { class: "q-looks" },
      b.looks.map((l) => {
        const t = b.tally[l.id] || { votes: 0, names: [] };
        const leading = total && t.votes === lead && t.votes > 0;
        return el("li", { class: (leading ? "lead" : "") + (b.decided === l.id ? " won" : "") },
          el("div", { class: "shot" }, picture({ src: l.portrait || l.image, alt: l.name, loading: "lazy" }), b.decided === l.id ? el("span", { class: "badge good", text: "Your choice" }) : leading && el("span", { class: "badge", text: "Leading" })),
          el("b", { text: l.name }),
          el("div", { class: "bar" + (leading ? " lead" : "") }, el("i", { style: `--v:${total ? t.votes / total : 0}` })),
          el("span", { class: "meta", text: plural(t.votes, "vote") + (t.names.length ? " · " + t.names.join(", ") : "") }),
        );
      }),
    ),
    notes.length > 0 && el("ul", { class: "q-notes" }, notes.map((v) => el("li", {}, el("b", { text: (v.name || "Someone") + ": " }), "“" + v.note + "”"))),
    el("div", { class: "row q-acts" },
      !b.closed && el("button", { class: "btn small", type: "button", text: "Send the link", onclick: () => shareSheet(b) }),
      !b.decided && b.looks.some((l) => !l.gone) && el("button", { class: "btn ghost small", type: "button", text: "Decide", onclick: () => decide(b, act) }),
      !b.decided && el("button", { class: "link", type: "button", text: b.closed ? "Open it again for a day" : "A day more", onclick: () => act("/api/boards/extend", { days: 1 }) }),
      !b.closed && el("button", { class: "link muted", type: "button", text: "Close it", onclick: () => act("/api/boards/close", {}) }),
      b.decided && el("button", { class: "link", type: "button", text: "See your choice", onclick: () => winner(b, b.looks.find((l) => l.id === b.decided)) }),
    ),
  );
}

// She chooses; voting stops, and everyone who opens the link sees her choice.
function decide(b, act) {
  const sheet = el("dialog", { class: "sheet" },
    el("div", { class: "sheet-head" }, el("h2", { class: "subtitle", text: "Which one is it?" }), el("button", { class: "link muted", type: "button", text: "Not yet", onclick: () => sheet.close() })),
    el("p", { class: "muted", text: "Voting stops, and the link shows what you chose." }),
    el("div", { class: "decide-grid" },
      b.looks.filter((l) => !l.gone).map((l) =>
        el("button", { class: "choice", type: "button", onclick: () => act("/api/boards/decide", { look: l.id }, () => (sheet.close(), winner(b, l))) },
          el("div", { class: "shot" }, picture({ src: l.portrait || l.image, alt: l.name })),
          el("b", { text: l.name }),
          el("span", { class: "meta", text: plural(b.tally[l.id]?.votes || 0, "vote") }),
        ),
      ),
    ),
  );
  sheet.addEventListener("close", () => sheet.remove());
  document.body.append(sheet);
  sheet.showModal();
}

// The chosen look, and the way to the store.
function winner(b, l) {
  if (!l) return;
  const sheet = el("dialog", { class: "sheet winner" },
    el("div", { class: "winner-shot" }, picture({ src: l.portrait || l.image, alt: l.name })),
    el("div", { class: "stack close" },
      el("p", { class: "kicker", text: "Your choice" }),
      el("h2", { class: "title", text: l.name }),
      el("p", { class: "muted num", text: [l.brandName, l.size && "Size " + l.size, money(l.price, l.currency)].filter(Boolean).join(" · ") }),
    ),
    el("div", { class: "stack close" },
      l.whatsapp && el("a", { class: "btn wide wa", href: `https://wa.me/${l.whatsapp}?text=${encodeURIComponent(`Salaam. I'd like ${l.name}${l.size ? ", size " + l.size : ""}. Is it in stock? (from MIRVA)`)}`, target: "_blank", rel: "noopener", text: `Message ${l.brandName} on WhatsApp` }),
      l.url && el("a", { class: l.whatsapp ? "btn ghost wide" : "btn wide", href: l.url, target: "_blank", rel: "noopener", text: `See it at ${l.brandName}` }),
      el("a", { class: "btn ghost wide", href: "/mirrors", text: "Find a MIRVA mirror" }),
      el("button", { class: "link muted", type: "button", text: "Close", onclick: () => sheet.close() }),
    ),
  );
  sheet.addEventListener("close", () => sheet.remove());
  document.body.append(sheet);
  sheet.showModal();
}

// ---------------------------------------------------------------- you
function you() {
  const { user, tier, usage, invite, payments } = S.me;
  const sizes = user.profile.sizes || {};

  const profile = el("form", { class: "card" },
    el("h2", { class: "subtitle", text: "You" }),
    field("Name", { name: "name", value: user.name, maxLength: 80, autocomplete: "name" }),
    el("div", { class: "sizes" },
      field("Top", { name: "top", value: sizes.top || "", maxLength: 6, placeholder: "M" }),
      field("Bottom", { name: "bottom", value: sizes.bottom || "", maxLength: 6, placeholder: "M" }),
      field("Shoe", { name: "shoe", value: sizes.shoe || "", maxLength: 6, placeholder: "38" }),
    ),
    el("p", { class: "fine", text: "A MIRVA mirror uses these to show what is in stock for you first." }),
    el("p", { class: "formnote", role: "alert" }),
    el("button", { class: "btn small", type: "submit", text: "Save" }),
  );
  onSubmit(profile, async (d) => {
    await api("/api/me/profile", { name: d.name, sizes: { top: d.top, bottom: d.bottom, shoe: d.shoe } });
    S.me = await whoAmI(true);
    toast("Saved.");
  });

  const privateBlock = () => {
    if (tier.id === "private") return el("p", { class: "muted", text: "You are a Private member. Your stylist hours and holds are arranged through the stores." });
    if (invite === "invited")
      return el("div", { class: "stack close" },
        el("p", { text: "There is a place for you in MIRVA Private." }),
        payments === "test"
          ? el("button", { class: "btn small", type: "button", text: "Accept (test payment)", onclick: async (e) => busy(e.currentTarget, async () => {
              await api("/api/checkout/test", {}).catch((err) => toast(err.message));
              S.me = await whoAmI(true);
              home();
            }) })
          : el("p", { class: "fine", text: "Payments are not connected yet. MIRVA will write to you." }),
        payments === "test" && el("p", { class: "fine", text: "Test mode. No money moves; this only shows how joining will work." }),
      );
    if (invite === "waiting") return el("p", { class: "muted", text: "You asked for an invitation to Private. If there's a place, it will appear here." });
    return el("a", { class: "link arrow", href: "/membership#private", text: "About MIRVA Private " });
  };

  const membership = el("div", { class: "card" },
    el("h2", { class: "subtitle", text: "Membership" }),
    el("div", { class: "row" }, el("span", { class: "badge", text: tier.name }), el("span", { class: "muted", text: tier.line })),
    el("p", { class: "fine num", text: `This month: ${usage.portraits} of ${tier.portraitsPerMonth} portraits used` + (tier.liveSecondsPerMonth ? `, ${Math.round(usage.liveSeconds / 60)} of ${tier.liveSecondsPerMonth / 60} live minutes.` : ".") }),
    privateBlock(),
  );

  // What she has removed, and when: her own record that it is gone.
  const gone = el("div", { hidden: true });
  api("/api/me/deleted")
    .then(({ deleted }) => {
      if (!deleted.length) return;
      const when = (at) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      fill(gone, el("p", { class: "kicker", style: "margin-top:8px", text: "Removed by you" }), el("ul", { class: "fine" }, deleted.slice(0, 12).map((d) => el("li", { text: `${d.portrait ? "A portrait and its look" : "A look"}: ${d.name}. Deleted ${when(d.at)}.` }))));
      gone.hidden = false;
    })
    .catch(() => {});

  const data = el("div", { class: "card" },
    el("h2", { class: "subtitle", text: "Your data" }),
    el("p", { class: "muted", text: "Everything MIRVA holds about you is on this page. You can take a copy, or remove all of it." }),
    el("div", { class: "row" },
      el("button", { class: "btn ghost small", type: "button", text: "Download my data", onclick: (e) => busy(e.currentTarget, exportData) }),
      el("button", { class: "btn ghost small", type: "button", text: "Sign out", onclick: () => signOut() }),
    ),
    el("button", { class: "link muted", type: "button", text: "Delete my account", onclick: confirmDelete }),
    gone,
  );

  fill($("#view"), el("div", { class: "settings" }, profile, membership, data));
}

async function exportData() {
  const copyOf = await api("/api/me/export", {});
  const link = el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(copyOf, null, 2)], { type: "application/json" })), download: "mirva-my-data.json" });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

function confirmDelete() {
  const form = el("form", { class: "form" },
    el("p", { class: "muted", text: "This removes your wardrobe, your portraits, the questions you asked and your account. It cannot be undone." }),
    field("Your password", { name: "password", type: "password", autocomplete: "current-password", required: true }),
    el("p", { class: "formnote", role: "alert" }),
    el("div", { class: "row" }, el("button", { class: "btn danger small", type: "submit", text: "Delete everything" }), el("button", { class: "link muted", type: "button", text: "Keep my account", onclick: () => sheet.close() })),
  );
  const sheet = el("dialog", { class: "sheet" }, el("div", { class: "sheet-head" }, el("h2", { class: "subtitle", text: "Delete your account?" })), form);
  onSubmit(form, async (d) => {
    await api("/api/me/delete", d);
    location.href = "/";
  });
  sheet.addEventListener("close", () => sheet.remove());
  document.body.append(sheet);
  sheet.showModal();
}
