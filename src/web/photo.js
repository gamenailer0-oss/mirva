// A shopper's own phone, from the code on a store's MIRVA mirror (/photo#<ticket>): she picks a photo from her gallery
// and it goes to that mirror. It is made smaller here, sent through the mirror's room in parts (lib/link.mjs, the
// "phone" side: it can hand over a photo and nothing else), put together on the mirror, and never stored on the way.
const PART = 48000; // characters of a part: the room passes messages up to 64,000
const LONGEST = 1600; // pixels on the photo's long side: plenty for a portrait, quick on a phone's data

const $ = (s) => document.querySelector(s);
const says = (text) => ($("#photoSays").textContent = text);

export function start() {
  // The code arrives after "#" and is kept for this tab only, so a reload still works and the address bar keeps nothing.
  let ticket = location.hash.slice(1);
  try {
    if (ticket) sessionStorage.setItem("mirva:photo", ticket);
    else ticket = sessionStorage.getItem("mirva:photo") || "";
  } catch {}
  if (location.hash) history.replaceState(null, "", location.pathname);
  if (!/^[A-Za-z0-9_-]+\.phone\.\d+\.[A-Za-z0-9_-]+$/.test(ticket)) return closed("This page opens from the code on a MIRVA mirror. Scan it there.");
  if (Number(ticket.split(".")[2]) < Date.now()) return closed("This code has run out. Scan the new one on the mirror.");
  $("#photoPick").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) await send(ticket, file);
  });
}

function closed(text) {
  $("#photoChoose").hidden = true;
  says(text);
}

async function send(ticket, file) {
  const choose = $("#photoChoose");
  choose.setAttribute("aria-disabled", "true");
  says("Getting your photo ready…");
  let blob;
  try {
    blob = await smaller(file);
  } catch {
    choose.removeAttribute("aria-disabled");
    return says("I couldn’t read that photo. Try another one.");
  }
  const preview = $("#photoPreview");
  preview.querySelector("img").src = URL.createObjectURL(blob);
  preview.hidden = false;
  says("Sending it to the mirror…");
  try {
    await deliver(ticket, await base64(blob));
    says("It’s on the mirror. Look up: choose a piece, and see yourself in it.");
    choose.textContent = "Choose another photo";
  } catch (e) {
    says(e.message);
  } finally {
    choose.removeAttribute("aria-disabled");
  }
}

// The long side brought down to LONGEST pixels, turned the right way up, as a JPEG.
async function smaller(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bmp = await createImageBitmap(file);
  }
  const scale = Math.min(1, LONGEST / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no picture"))), "image/jpeg", 0.86));
}

const base64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

// Into the mirror's room with the code's own ticket, the photo in parts, and the mirror's word that it has it.
function deliver(ticket, data) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2, 10);
    const parts = Math.ceil(data.length / PART);
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/link/socket?t=${encodeURIComponent(ticket)}`);
    let opened = false;
    const fail = (text) => (clearTimeout(timer), ws.close(), reject(new Error(text)));
    const timer = setTimeout(() => fail("The mirror didn’t answer. Check it is on, then try again."), 25000);
    ws.onopen = () => {
      opened = true;
      ws.send(JSON.stringify({ op: "photo-start", id, type: "image/jpeg", parts }));
      for (let i = 0; i < parts; i++) ws.send(JSON.stringify({ op: "photo-part", id, i, data: data.slice(i * PART, (i + 1) * PART) }));
    };
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.t === "peer" && m.side === "glass" && !m.here) fail("The mirror isn’t connected just now. Ask in the store, then try again.");
      if (m.id !== id) return;
      if (m.t === "photo-ok") (clearTimeout(timer), ws.close(1000), resolve());
      if (m.t === "photo-failed") fail("The mirror couldn’t read that photo. Try another one.");
    };
    ws.onerror = () => !opened && fail("This code has run out. Scan the new one on the mirror.");
  });
}
