// The shopper's site: quiet pages, with the account and the voting board loaded only where they are used.
import { $, $$, el, api, nav, reveal, whoAmI, toast, busy, connection, signOut, onSubmit } from "./ui.js";
import { registerWorker } from "./notify.js";
import { offerInstall } from "./install.js";

document.documentElement.classList.add("js");
nav();
reveal();
connection();
registerWorker();

const page = document.body.dataset.page;

// Signed in: the account link says where it goes, a quiet "Sign out" sits beside it, and the phone menu gets both.
whoAmI().then(({ user }) => {
  if (!user) return;
  // A member with something in her wardrobe is offered MIRVA on her home screen, once.
  if (user.role === "member" && page === "account") setTimeout(offerInstall, 4000);
  const label = user.role === "member" ? "Your wardrobe" : "Your desk";
  const href = user.role === "member" ? "/account" : user.role === "founder" ? "/hq" : "/console";
  $("#nav")?.classList.add("signed");
  for (const a of $$("[data-account]")) {
    a.textContent = label;
    a.href = href;
    a.after(el("button", { class: "link muted nav-out hide-s", type: "button", text: "Sign out", onclick: () => signOut() }));
  }
  $("#navLinks")?.append(
    el("a", { class: "menu-only", href, text: label }),
    el("button", { class: "menu-only", type: "button", text: "Sign out", onclick: () => signOut() }),
  );
});

if (page === "home") import("./home.js").then((m) => m.start());
if (page === "account") import("./account.js").then((m) => m.start());
if (page === "board") import("./board.js").then((m) => m.start());
if (page === "pickup") import("./pickup.js").then((m) => m.start());

// Membership: asking for an invitation to Private.
const ask = $("#askPrivate");
if (ask) {
  const note = $("#askNote");
  const say = (status) => {
    if (status === "waiting") (ask.hidden = true), (note.textContent = "You’re on the list. If there’s a place for you, the invitation will be in your account.");
    if (status === "invited") (ask.hidden = true), (note.textContent = "You have an invitation. Open your account to accept it.");
    if (status === "joined") (ask.hidden = true), (note.textContent = "You’re a Private member.");
  };
  whoAmI().then((me) => {
    if (!me.user) return (ask.textContent = "Join free, then ask"), ask.addEventListener("click", () => (location.href = "/account?join=1"));
    if (me.tier?.id === "private") return say("joined");
    say(me.invite);
    ask.addEventListener("click", () =>
      busy(ask, async () => {
        try {
          say((await api("/api/private/request", { note: $("#askWhy")?.value || "" })).status);
        } catch (e) {
          toast(e.message);
        }
      }),
    );
  });
}

// "Tell me when it opens": the home page and the mirrors page.
const wait = $("#waitForm");
if (wait)
  onSubmit(wait, async (d) => {
    const out = await api("/api/waitlist", d);
    const note = $(".formnote", wait);
    note.classList.add("ok");
    note.textContent = out.count > 1 ? `Done. You and ${out.count - 1} more in ${out.city} are waiting for one. We’ll tell you the day it opens.` : `Done. We’ll tell you the day one opens in ${out.city}.`;
    $("[type=submit]", wait).disabled = true;
  });
