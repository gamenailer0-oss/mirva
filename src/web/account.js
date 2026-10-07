// A member's account: the door (join, sign in, reset), then the wardrobe, the opinions asked for, and the settings.
import { $, $$, el, api, money, plural, when, until, toast, whoAmI, busy, onSubmit, local, copy, fill, picture } from "./ui.js";

const root = () => $("#account");
const params = new URLSearchParams(location.search);
const claimCode = (location.pathname.match(/^\/claim\/([A-Za-z0-9]{8})$/) || [])[1] || "";
const S = { me: null, tab: "wardrobe", looks: [], boards: [], picking: false, picked: new Set() };

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
        el("label", { class: "check" }, el("input", { type: "checkbox", name: "agree" }), el("span", {}, "I agree to the ", el("a", { href: "/terms", target: "_blank", text: "terms" }), " and the ", el("a", { href: "/privacy", target: "_blank", text: "privacy notice" }), ".")),
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
          el("h1", { class: "title" }, greeting + ", ", el("em", { text: user.name.split(" ")[0] + "." })),
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
  );
  ({ wardrobe, opinions, you })[S.tab]();
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
          el("button", { class: "btn small", type: "button", text: "Make the link", onclick: (e) => busy(e.currentTarget, makeBoard) }),
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

async function makeBoard() {
  if (S.picked.size < 2) return toast("Choose at least two looks.");
  try {
    const board = await api("/api/boards", { title: "Which one?", looks: [...S.picked] });
    S.picking = false;
    S.picked.clear();
    S.tab = "opinions";
    await home();
    share(board.url);
  } catch (e) {
    toast(e.message);
  }
}

function share(url) {
  const message = `Help me choose. Tap the one you like: ${url}`;
  const sheet = el("dialog", { class: "sheet" },
    el("div", { class: "sheet-head" }, el("h2", { class: "subtitle", text: "Your link is ready." }), el("button", { class: "link muted", type: "button", text: "Close", onclick: () => sheet.close() })),
    el("div", { class: "stack close" },
      el("p", { class: "muted", text: "Anyone with this link can see these looks and vote, for three days. Send it only to people you'd show the photos to." }),
      el("input", { class: "input", readOnly: true, value: url, "aria-label": "Link", onfocus: (e) => e.target.select() }),
      el("div", { class: "row" },
        el("a", { class: "btn", href: "https://wa.me/?text=" + encodeURIComponent(message), target: "_blank", rel: "noopener", text: "Send on WhatsApp" }),
        el("button", { class: "btn ghost", type: "button", text: "Copy the link", onclick: () => copy(url) }),
      ),
    ),
  );
  sheet.addEventListener("close", () => sheet.remove());
  document.body.append(sheet);
  sheet.showModal();
}

// ---------------------------------------------------------------- opinions
function opinions() {
  const view = $("#view");
  if (!S.boards.length)
    return fill(view, 
      el("div", { class: "empty" },
        el("p", { class: "subtitle voice", text: "No questions asked yet." }),
        el("p", { class: "muted", text: "Pick two or more looks from your wardrobe and send one link to the people whose opinion you trust." }),
        el("button", { class: "btn", type: "button", text: "Go to the wardrobe", onclick: () => ((S.tab = "wardrobe"), (S.picking = S.looks.length > 1), home()) }),
      ),
    );
  const names = new Map(S.looks.map((l) => [l.id, l.name]));
  fill(view, 
    ...S.boards.map((b) => {
      const counts = b.looks.map((id) => ({ id, name: names.get(id) || "A look you let go", voters: b.votes.filter((v) => v.look === id) })).sort((a, z) => z.voters.length - a.voters.length);
      return el("div", { class: "boardrow" },
        el("div", {},
          el("div", { class: "row" }, el("b", { class: "subtitle", text: b.title }), el("span", { class: "badge " + (b.closed ? "soft" : "good"), text: b.closed ? "Closed" : until(b.closes) })),
          el("div", { class: "tally" },
            b.votes.length
              ? counts.map((c) => el("span", {}, el("b", { text: `${c.name}: ${c.voters.length}` }), c.voters.some((v) => v.name) ? " · " + c.voters.map((v) => v.name).filter(Boolean).join(", ") : ""))
              : el("span", { text: `No votes yet. Asked ${when(b.created)}.` }),
          ),
        ),
        !b.closed && el("div", { class: "row" },
          el("button", { class: "btn ghost small", type: "button", text: "Share", onclick: () => share(b.url) }),
          el("button", { class: "link muted", type: "button", text: "Close it", onclick: async () => (await api("/api/boards/close", { code: b.code }).catch((e) => toast(e.message)), home()) }),
        ),
      );
    }),
  );
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

  const data = el("div", { class: "card" },
    el("h2", { class: "subtitle", text: "Your data" }),
    el("p", { class: "muted", text: "Everything MIRVA holds about you is on this page. You can take a copy, or remove all of it." }),
    el("div", { class: "row" },
      el("button", { class: "btn ghost small", type: "button", text: "Download my data", onclick: (e) => busy(e.currentTarget, exportData) }),
      el("button", { class: "btn ghost small", type: "button", text: "Sign out", onclick: async () => (await api("/api/auth/signout", {}), (location.href = "/")) }),
    ),
    el("button", { class: "link muted", type: "button", text: "Delete my account", onclick: confirmDelete }),
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
