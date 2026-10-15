// Asking the people she trusts. One sheet: the question, whose pictures go out, how long it stays open; then the
// link, with a picture of the looks made on her own phone, so WhatsApp shows it properly. Used by the account page
// and by the mirror itself.
import { el, api, toast, copy, money } from "./ui.js";
import { pushState, turnOnPush, iphoneOutsideApp } from "./notify.js";

const QUESTIONS = [
  ["Wedding", "Which one for the wedding?"],
  ["Eid", "Which one for Eid?"],
  ["Saturday", "Which one for Saturday?"],
  ["University", "Which one for university?"],
  ["Work", "Which one for work?"],
];

function sheetOf(...kids) {
  const sheet = el("dialog", { class: "sheet ask-sheet" }, ...kids);
  sheet.addEventListener("close", () => sheet.remove());
  sheet.addEventListener("click", (e) => e.target === sheet && sheet.close()); // a tap outside closes it
  document.body.append(sheet);
  sheet.showModal();
  return sheet;
}

const shotOf = (look, pictures) => (pictures === "mine" && look.portrait ? look.portrait : look.image);

/**
 * looks     wardrobe looks ({ id, name, image, portrait, brandName, price, currency }), two to six
 * by        her first name, for the picture
 * onMade    called with the new question once it exists
 */
export function askSheet({ looks, by = "", onMade = () => {} }) {
  const anyPortrait = looks.some((l) => l.portrait);
  let pictures = anyPortrait ? "mine" : "store";
  let days = 3;
  const question = el("input", { class: "input", maxLength: 80, value: QUESTIONS[0][1], "aria-label": "Your question", autocomplete: "off" });
  const strip = el("ul", { class: "ask-strip", "aria-label": "The looks you are asking about" });
  const drawStrip = () =>
    strip.replaceChildren(...looks.map((l) => el("li", {}, el("img", { src: shotOf(l, pictures), alt: l.name, loading: "lazy" }), el("span", { text: l.name }))));
  drawStrip();

  const choice = (name, value, label, line, on) =>
    el("label", { class: "ask-choice" },
      el("input", { type: "radio", name, value, checked: on, onchange: () => (name === "pictures" ? ((pictures = value), drawStrip()) : (days = Number(value))) }),
      el("span", {}, el("b", { text: label }), line && el("small", { text: line })),
    );

  const make = el("button", { class: "btn wide", type: "button", text: "Make the link" });
  const sheet = sheetOf(
    el("div", { class: "sheet-head" }, el("h2", { class: "subtitle", text: "Ask the people you trust" }), el("button", { class: "link muted", type: "button", text: "Close", onclick: () => sheet.close() })),
    el("div", { class: "ask-body" },
      strip,
      el("div", { class: "field" }, el("span", { text: "Your question" }), question),
      el("div", { class: "row ask-quick" }, QUESTIONS.map(([label, q]) => el("button", { class: "chip", type: "button", text: label, onclick: () => (question.value = q) }))),
      el("fieldset", { class: "ask-set" },
        el("legend", { class: "label", text: "What they see" }),
        anyPortrait && choice("pictures", "mine", "My portraits", "You, in each look.", pictures === "mine"),
        choice("pictures", "store", "The store's photos", "The pieces on the store's model. Your pictures stay with you.", pictures === "store"),
      ),
      el("fieldset", { class: "ask-set ask-days" },
        el("legend", { class: "label", text: "Open for" }),
        choice("days", "1", "A day", "", false),
        choice("days", "3", "Three days", "", true),
        choice("days", "7", "A week", "", false),
      ),
      el("p", { class: "fine", text: "Anyone with the link can see these looks and answer until it closes. Send it to people you'd show them to." }),
      el("div", { class: "ask-go" }, make),
    ),
  );

  make.addEventListener("click", async () => {
    if (make.getAttribute("aria-busy") === "true") return;
    make.setAttribute("aria-busy", "true");
    make.textContent = "Making the link…";
    try {
      const title = question.value.trim() || "Which one?";
      const board = await api("/api/boards", { title, looks: looks.map((l) => l.id), pictures, days });
      // The picture WhatsApp shows. If it cannot be made, the link still works with MIRVA's own picture.
      try {
        const blob = await drawCover({ title, by, looks, pictures });
        if (blob) await fetch(`/api/board/${board.code}/cover`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: blob });
      } catch {}
      sheet.close();
      onMade(board);
      shareSheet({ ...board, title });
    } catch (e) {
      toast(e.message);
      make.removeAttribute("aria-busy");
      make.textContent = "Make the link";
    }
  });
  question.focus({ preventScroll: true });
}

// Sending the link: WhatsApp first, the phone's own share sheet, a copy; then the offer to be told about answers.
export async function shareSheet(board) {
  const text = `${board.title} Tap the one you'd choose:`;
  const wa = "https://wa.me/?text=" + encodeURIComponent(`${text} ${board.url}`);
  const tell = el("div", { class: "ask-tell", hidden: true });
  const sheet = sheetOf(
    el("div", { class: "sheet-head" }, el("h2", { class: "subtitle", text: "Your link is ready." }), el("button", { class: "link muted", type: "button", text: "Close", onclick: () => sheet.close() })),
    el("div", { class: "ask-body" },
      el("a", { class: "btn wide wa", href: wa, target: "_blank", rel: "noopener", text: "Send on WhatsApp", autofocus: true }),
      navigator.share && el("button", { class: "btn ghost wide", type: "button", text: "Share another way", onclick: () => navigator.share({ title: board.title, text, url: board.url }).catch(() => {}) }),
      el("div", { class: "row ask-link" }, el("input", { class: "input", readOnly: true, value: board.url, "aria-label": "The link", onfocus: (e) => e.target.select() }), el("button", { class: "btn ghost small", type: "button", text: "Copy", onclick: () => copy(board.url) })),
      tell,
    ),
  );
  const state = await pushState();
  if (state === "off") {
    tell.append(el("button", { class: "link", type: "button", text: "Tell me on this phone when they answer", onclick: async (e) => {
      if (await turnOnPush()) (e.target.replaceWith(el("p", { class: "fine", text: "You'll be told here when someone answers." })));
    } }));
    tell.hidden = false;
  } else if (state === "unsupported" && iphoneOutsideApp()) {
    tell.append(el("p", { class: "fine", text: "On an iPhone, add MIRVA to your home screen (Share, then Add to Home Screen) to be told when someone answers." }));
    tell.hidden = false;
  }
}

// --- the link's picture ----------------------------------------------------------------
const load = (src) =>
  new Promise((done) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => done(img);
    img.onerror = () => done(null);
    img.src = src;
  });

function wrap(g, words, width) {
  const lines = [];
  let line = "";
  for (const w of words.split(/\s+/)) {
    const next = line ? line + " " + w : w;
    if (g.measureText(next).width > width && line) (lines.push(line), (line = w));
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function rounded(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 1200 by 630, the size every link preview expects: the question on dark glass, the looks beside it, MIRVA's halo.
export async function drawCover({ title, by, looks, pictures }) {
  const W = 1200, H = 630;
  const c = el("canvas", { width: W, height: H });
  const g = c.getContext("2d");
  if (!g) return null;
  const sky = g.createRadialGradient(W * 0.68, -80, 40, W * 0.68, 120, 900);
  sky.addColorStop(0, "#1d2232");
  sky.addColorStop(1, "#06070a");
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  try {
    await Promise.all([document.fonts.load('400 56px "Newsreader"'), document.fonts.load('500 20px "Albert Sans"'), document.fonts.load('400 24px "Albert Sans"')]);
  } catch {}
  const pics = await Promise.all(looks.slice(0, 4).map((l) => load(shotOf(l, pictures))));

  // The looks: tall cards on the right, top-aligned like a mirror's frame.
  const n = pics.length;
  const area = { x: 470, y: 64, w: 670, h: 502 };
  const gap = 18;
  const cw = Math.min(232, (area.w - gap * (n - 1)) / n);
  const ch = Math.min(area.h, cw * 4 / 3);
  const x0 = area.x + (area.w - (cw * n + gap * (n - 1))) / 2;
  const y0 = area.y + (area.h - ch) / 2;
  pics.forEach((img, i) => {
    const x = x0 + i * (cw + gap);
    g.save();
    rounded(g, x, y0, cw, ch, 18);
    g.fillStyle = "#1b2030";
    g.fill();
    g.clip();
    if (img) {
      const s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      const w = img.naturalWidth * s;
      g.drawImage(img, x + (cw - w) / 2, y0, w, img.naturalHeight * s); // top-aligned: faces stay in frame
    }
    g.restore();
    g.strokeStyle = "rgba(243,245,249,.16)";
    g.lineWidth = 1.5;
    rounded(g, x, y0, cw, ch, 18);
    g.stroke();
  });

  // The halo above them: MIRVA's one line of light.
  g.strokeStyle = "rgba(243,245,249,.55)";
  g.lineWidth = 3;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(area.x + 120, 46);
  g.quadraticCurveTo(area.x + area.w / 2, 4, area.x + area.w - 120, 46);
  g.stroke();

  // The question.
  g.fillStyle = "#9aa2b3";
  g.font = '500 19px "Albert Sans", "Avenir Next", sans-serif';
  if ("letterSpacing" in g) g.letterSpacing = "4px";
  g.fillText(`${(by || "Someone").toUpperCase()} ASKS`, 64, 150);
  if ("letterSpacing" in g) g.letterSpacing = "0px";
  g.fillStyle = "#f3f5f9";
  g.font = '400 54px "Newsreader", Georgia, serif';
  const lines = wrap(g, title, 370).slice(0, 4);
  lines.forEach((line, i) => g.fillText(line, 64, 222 + i * 62));
  g.fillStyle = "#c8cedb";
  g.font = '400 23px "Albert Sans", "Avenir Next", sans-serif';
  g.fillText("Tap the one you'd choose.", 64, 222 + lines.length * 62 + 26);

  // The mark: the oval mirror and its name.
  g.strokeStyle = "#f3f5f9";
  g.lineWidth = 2;
  rounded(g, 70, 548, 22, 34, 11);
  g.stroke();
  g.beginPath();
  g.moveTo(63, 551);
  g.quadraticCurveTo(81, 532, 99, 551);
  g.stroke();
  g.fillStyle = "#f3f5f9";
  g.font = '500 20px "Albert Sans", "Avenir Next", sans-serif';
  if ("letterSpacing" in g) g.letterSpacing = "7px";
  g.fillText("MIRVA", 116, 573);
  return new Promise((done) => c.toBlob(done, "image/jpeg", 0.86));
}

export const lookLine = (l) => [l.brandName, l.price ? money(l.price, l.currency) : ""].filter(Boolean).join(" · ");
