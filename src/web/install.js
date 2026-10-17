// "Add MIRVA to your home screen". Offered once, after the first look she keeps (when it is worth something to her),
// never on arrival. Android Chrome shows its own prompt; an iPhone is told the two taps it takes.
let deferred = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e;
});

const ASKED = "mirva:install-asked";
const installed = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const iphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const asked = () => {
  try {
    return !!localStorage.getItem(ASKED);
  } catch {
    return true;
  }
};
const remember = () => {
  try {
    localStorage.setItem(ASKED, String(Date.now()));
  } catch {}
};

export function offerInstall() {
  if (installed() || asked() || !(deferred || iphone()) || document.querySelector(".install-card")) return;
  remember();
  const card = document.createElement("div");
  card.className = "install-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Add MIRVA to your home screen");
  const words = document.createElement("div");
  const title = document.createElement("b");
  title.textContent = "Keep MIRVA on your home screen";
  const line = document.createElement("span");
  line.textContent = deferred ? "Your wardrobe and your questions, one tap away, and a nudge when the family answers." : "Tap Share, then Add to Home Screen. Your wardrobe is one tap away, and you’ll be told when the family answers.";
  words.append(title, line);
  const acts = document.createElement("div");
  acts.className = "install-acts";
  const later = document.createElement("button");
  later.type = "button";
  later.className = "install-later";
  later.textContent = deferred ? "Not now" : "Got it";
  later.onclick = () => card.remove();
  acts.append(later);
  if (deferred) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "install-add";
    add.textContent = "Add";
    add.onclick = async () => {
      card.remove();
      deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
    };
    acts.append(add);
  }
  card.append(words, acts);
  document.body.append(card);
  setTimeout(() => card.isConnected && card.classList.add("in"), 30);
}
