// A board, as a guest sees it: a question, a few looks, one tap to answer.
import { $, el, api, money, plural, toast, fill, picture } from "./ui.js";

const code = location.pathname.split("/").pop();

export async function start() {
  const root = $("#board");
  let board;
  try {
    board = await api("/api/board/" + code);
  } catch (e) {
    return fill(root, el("div", { class: "stack center" }, el("h1", { class: "title", text: "This question has gone." }), el("p", { class: "lede", text: "The link may have been closed, or it was mistyped." }), el("a", { class: "btn", href: "/", text: "See what MIRVA is" })));
  }
  draw(root, board);
}

function draw(root, board) {
  const done = !!board.voted || board.closed;
  const total = board.tally ? Object.values(board.tally).reduce((a, t) => a + t.votes, 0) : 0;
  const name = el("input", { class: "input", placeholder: "Your name, so " + board.by + " knows who chose", maxLength: 30, autocomplete: "given-name", "aria-label": "Your name", value: localStorage.getItem("mirva:voter") || "" });

  const vote = async (look) => {
    try {
      localStorage.setItem("mirva:voter", name.value.trim());
      const out = await api(`/api/board/${code}/vote`, { look, name: name.value });
      draw(root, { ...board, voted: out.voted, tally: out.tally });
    } catch (e) {
      toast(e.message);
    }
  };

  fill(root, 
    el("div", { class: "stack close center" },
      el("p", { class: "kicker", text: `${board.by} asks` }),
      el("h1", { class: "title", text: board.title }),
      el("p", { class: "lede", text: board.closed ? (board.looks.length ? "Voting has closed. Here is how it went." : "Voting has closed.") : board.voted ? `Thank you. ${board.by} can see what you chose. Tap another to change your mind.` : "Tap the one you'd choose." }),
    ),
    el("div", { class: "choices" },
      board.looks.map((l) => {
        const t = board.tally?.[l.id];
        return el("button", { class: "choice" + (board.voted === l.id ? " mine" : ""), type: "button", disabled: board.closed, "aria-pressed": String(board.voted === l.id), onclick: () => vote(l.id) },
          el("div", { class: "shot" }, picture({ src: l.portrait || l.image, alt: l.portrait ? `${board.by} in ${l.name}` : l.name, loading: "lazy" }), board.voted === l.id && el("span", { class: "badge", style: "position:absolute;left:8px;top:8px", text: "Your choice" })),
          el("b", { text: l.name }),
          el("span", { class: "meta num", text: `${l.brandName} · ${money(l.price, l.currency)}` }),
          done && t && el("div", { class: "bar" }, el("i", { style: `--v:${total ? t.votes / total : 0}` })),
          done && t && el("span", { class: "meta", text: plural(t.votes, "vote") + (t.names.length ? " · " + t.names.join(", ") : "") }),
        );
      }),
    ),
    !board.closed && el("div", { class: "stack close center", style: "max-width:420px;width:100%" }, name),
    el("div", { class: "stack close center" },
      el("p", { class: "fine", text: "Made with MIRVA, the mirror that styles you." }),
      el("a", { class: "link arrow", href: "/", text: "See how it works " }),
    ),
  );
}
