// A question, as the people she trusts see it: who asks, the looks, one tap to answer. No app, no sign-in.
// Opened from WhatsApp more than anywhere, so it is built for a phone held in one hand.
import { $, el, api, money, plural, toast, fill, picture } from "./ui.js";

const code = location.pathname.split("/").pop();
const NAME = "mirva:voter";
const savedName = () => {
  try {
    return localStorage.getItem(NAME) || "";
  } catch {
    return "";
  }
};
const keepName = (v) => {
  try {
    localStorage.setItem(NAME, v);
  } catch {}
};
const tick = () => navigator.vibrate?.(12);
let board = null;
let polling = null;

export async function start() {
  const root = $("#board");
  try {
    board = await api("/api/board/" + code);
  } catch (e) {
    return gone(root);
  }
  draw(root);
  // While it is open, other people's answers arrive on their own.
  polling = setInterval(async () => {
    if (document.visibilityState !== "visible" || !board || board.closed || !board.voted) return;
    try {
      const fresh = await api("/api/board/" + code);
      if (fresh.total !== board.total || fresh.closed !== board.closed) ((board = fresh), draw(root));
    } catch {}
  }, 20000);
}

function gone(root) {
  fill(root, el("div", { class: "stack center" },
    el("h1", { class: "title", text: "This question has gone." }),
    el("p", { class: "lede", text: "It may have been closed, or the link was mistyped." }),
    el("a", { class: "btn", href: "/", text: "See what MIRVA is" }),
  ));
}

function closesIn(ms) {
  const hours = Math.round((ms - Date.now()) / 3600e3);
  if (hours <= 0) return "Closing now";
  if (hours < 24) return `Closes in ${plural(hours, "hour")}`;
  return `Closes in ${plural(Math.round(hours / 24), "day")}`;
}

function draw(root) {
  const b = board;
  const by = b.by;
  const done = !!b.voted || b.closed;
  const total = b.tally ? Object.values(b.tally).reduce((n, t) => n + t.votes, 0) : 0;
  const lead = b.tally ? Math.max(...Object.values(b.tally).map((t) => t.votes)) : 0;
  const chosen = b.decided && b.looks.find((l) => l.id === b.decided);

  const nameBox = el("input", { class: "input", id: "voterName", placeholder: `Your name, so ${by} knows it’s you`, maxLength: 30, autocomplete: "given-name", "aria-label": "Your name", value: b.myName || savedName() });

  const vote = async (look, extra = {}) => {
    const name = nameBox.value.trim();
    if (name) keepName(name);
    try {
      const out = await api(`/api/board/${code}/vote`, { look, name, ...extra });
      tick();
      board = { ...board, voted: out.voted, tally: out.tally, myName: out.myName, myNote: out.myNote, total: Object.values(out.tally).reduce((n, t) => n + t.votes, 0) };
      draw(root);
    } catch (e) {
      toast(e.message);
    }
  };

  const card = (l) => {
    const t = b.tally?.[l.id];
    const share = total && t ? t.votes / total : 0;
    const mine = b.voted === l.id;
    const leading = done && t && t.votes && t.votes === lead;
    return el("button", { class: "choice" + (mine ? " mine" : "") + (b.decided === l.id ? " won" : ""), type: "button", disabled: b.closed || l.gone, "aria-pressed": String(mine), onclick: () => vote(l.id) },
      el("div", { class: "shot" },
        picture({ src: l.portrait || l.image, alt: l.portrait ? `${by} in ${l.name}` : l.name, loading: "lazy" }),
        mine && el("span", { class: "badge", text: "Your choice" }),
        !mine && l.portrait && el("span", { class: "badge soft", text: `On ${by}` }),
        b.decided === l.id && el("span", { class: "badge good", text: `${by} chose this` }),
      ),
      el("b", { text: l.name }),
      !l.gone && el("span", { class: "meta num", text: [l.brandName, l.price ? money(l.price, l.currency) : ""].filter(Boolean).join(" · ") }),
      done && t && el("div", { class: "bar" + (leading ? " lead" : "") }, el("i", { style: `--v:${share}` })),
      done && t && el("span", { class: "meta", text: plural(t.votes, "vote") + (t.names.length ? " · " + t.names.join(", ") : "") }),
    );
  };

  // After answering: a word for her, and a name if she doesn't know who this is.
  const after = b.voted && !b.closed
    ? el("div", { class: "after-vote card" },
        !b.myName && el("div", { class: "field" }, el("span", { text: "Your name" }), nameBox),
        el("label", { class: "field" },
          el("span", { text: `A word for ${by}, if you like` }),
          el("textarea", { id: "note", class: "input", maxLength: 140, rows: 2, placeholder: "The green, definitely. It suits you.", value: b.myNote || "" }),
        ),
        el("button", { class: "btn small", type: "button", text: b.myNote ? "Update" : "Send", onclick: async (e) => {
          const note = $("#note").value.trim();
          e.currentTarget.setAttribute("aria-busy", "true");
          await vote(b.voted, { note });
          toast(note ? `Sent to ${by}.` : "Saved.");
        } }),
      )
    : null;

  fill(root,
    el("header", { class: "stack close center board-head" },
      el("p", { class: "kicker", text: `${by} asks` }),
      el("h1", { class: "title", text: b.title }),
      chosen
        ? el("p", { class: "lede", text: `${by} has decided: ${chosen.name}. Thank you for helping.` })
        : el("p", { class: "lede", text: b.closed ? (b.looks.length ? "Voting has closed. Here is how it went." : "Voting has closed.") : b.voted ? `Thank you. ${by} can see what you chose. Tap another to change your mind.` : "Tap the one you’d choose." }),
      !b.closed && el("span", { class: "badge soft", text: closesIn(b.closes) }),
    ),
    !b.voted && !b.closed && el("div", { class: "board-name" }, nameBox),
    el("div", { class: "choices n" + Math.min(b.looks.length, 4) }, b.looks.map(card)),
    after,
    el("footer", { class: "stack close center board-foot" },
      el("p", { class: "subtitle voice", text: "Choosing something yourself?" }),
      el("p", { class: "muted", text: "MIRVA picks three looks for the occasion and shows you in each one. Free." }),
      el("div", { class: "row center-row" },
        el("a", { class: "btn", href: b.looks[0]?.brand ? `/mirror?brand=${encodeURIComponent(b.looks[0].brand)}` : "/mirror", text: "Try MIRVA" }),
        el("a", { class: "link arrow", href: "/", text: "What is MIRVA " }),
      ),
    ),
  );
}

addEventListener("pagehide", () => clearInterval(polling));
