// The shopper's site: quiet pages, with the account and the voting board loaded only where they are used.
import { $, $$, api, nav, reveal, whoAmI, toast, busy, connection } from "./ui.js";

document.documentElement.classList.add("js");
nav();
reveal();
connection();

const page = document.body.dataset.page;

whoAmI().then(({ user }) => {
  for (const a of $$("[data-account]")) {
    if (!user) continue;
    a.textContent = user.role === "member" ? "Your wardrobe" : "Your desk";
    a.href = user.role === "member" ? "/account" : user.role === "founder" ? "/hq" : "/console";
  }
});

if (page === "account") import("./account.js").then((m) => m.start());
if (page === "board") import("./board.js").then((m) => m.start());

// Membership: asking for an invitation to Private.
const ask = $("#askPrivate");
if (ask) {
  const note = $("#askNote");
  const say = (status) => {
    if (status === "waiting") (ask.hidden = true), (note.textContent = "You're on the list. If there's a place for you, the invitation will be in your account.");
    if (status === "invited") (ask.hidden = true), (note.textContent = "You have an invitation. Open your account to accept it.");
    if (status === "joined") (ask.hidden = true), (note.textContent = "You're a Private member.");
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
