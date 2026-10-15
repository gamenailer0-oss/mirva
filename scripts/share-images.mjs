// The pictures a shared MIRVA link carries (1200 by 630), drawn from real results in public/showcase:
//   share/home.jpg            the home page's preview
//   share/family-preview.jpg  a question as WhatsApp shows it (the same layout src/web/ask.js draws on her phone)
// Needs the local server running (for the fonts and pictures) and puppeteer-core, like scripts/showcase.mjs.
//   MIRVA_PUPPETEER=<folder> node scripts/share-images.mjs [http://localhost:4310]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] || "http://localhost:4310";
const require = createRequire(path.join(process.env.MIRVA_PUPPETEER || ROOT, "package.json"));
const puppeteer = require("puppeteer-core");
const CHROME = process.env.CHROME_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.goto(base + "/membership", { waitUntil: "networkidle2" });

const jobs = [
  { file: "share/home.jpg", kicker: "MIRVA", title: "The mirror that styles you.", line: "Three looks from a store's own rails, on you.", pics: ["/showcase/woman-khaddar.webp", "/showcase/man-suit.webp", "/showcase/woman-sweatshirt.webp"] },
  { file: "share/family-preview.jpg", kicker: "AYESHA ASKS", title: "Which one for the mehndi?", line: "Tap the one you'd choose.", pics: ["/showcase/woman-khaddar.webp", "/showcase/woman-rawsilk.webp", "/showcase/woman-sweatshirt.webp"] },
];
for (const job of jobs) {
  const b64 = await page.evaluate(async (job) => {
    const W = 1200, H = 630;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    const sky = g.createRadialGradient(W * 0.68, -80, 40, W * 0.68, 120, 900);
    sky.addColorStop(0, "#1d2232");
    sky.addColorStop(1, "#06070a");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    await Promise.all([document.fonts.load('400 56px "Newsreader"'), document.fonts.load('500 20px "Albert Sans"'), document.fonts.load('400 24px "Albert Sans"')]);
    const load = (src) => new Promise((done) => { const i = new Image(); i.onload = () => done(i); i.onerror = () => done(null); i.src = src; });
    const pics = await Promise.all(job.pics.map(load));
    const rounded = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    const area = { x: 470, y: 64, w: 670, h: 502 }, gap = 18, n = pics.length;
    const cw = Math.min(232, (area.w - gap * (n - 1)) / n), ch = Math.min(area.h, (cw * 16) / 9);
    const x0 = area.x + (area.w - (cw * n + gap * (n - 1))) / 2, y0 = area.y + (area.h - ch) / 2;
    pics.forEach((img, i) => {
      const x = x0 + i * (cw + gap);
      g.save();
      rounded(x, y0, cw, ch, 18);
      g.fillStyle = "#1b2030";
      g.fill();
      g.clip();
      if (img) {
        const s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
        g.drawImage(img, x + (cw - img.naturalWidth * s) / 2, y0, img.naturalWidth * s, img.naturalHeight * s);
      }
      g.restore();
      g.strokeStyle = "rgba(243,245,249,.16)";
      g.lineWidth = 1.5;
      rounded(x, y0, cw, ch, 18);
      g.stroke();
    });
    g.strokeStyle = "rgba(243,245,249,.55)";
    g.lineWidth = 3;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(area.x + 120, 46);
    g.quadraticCurveTo(area.x + area.w / 2, 4, area.x + area.w - 120, 46);
    g.stroke();
    const wrap = (words, width) => { const out = []; let line = ""; for (const w of words.split(/\s+/)) { const next = line ? line + " " + w : w; if (g.measureText(next).width > width && line) (out.push(line), (line = w)); else line = next; } if (line) out.push(line); return out; };
    g.fillStyle = "#9aa2b3";
    g.font = '500 19px "Albert Sans", sans-serif';
    g.letterSpacing = "4px";
    g.fillText(job.kicker, 64, 150);
    g.letterSpacing = "0px";
    g.fillStyle = "#f3f5f9";
    g.font = '400 54px "Newsreader", Georgia, serif';
    const lines = wrap(job.title, 370).slice(0, 4);
    lines.forEach((l, i) => g.fillText(l, 64, 222 + i * 62));
    g.fillStyle = "#c8cedb";
    g.font = '400 23px "Albert Sans", sans-serif';
    wrap(job.line, 360).forEach((l, i) => g.fillText(l, 64, 222 + lines.length * 62 + 26 + i * 32));
    g.strokeStyle = "#f3f5f9";
    g.lineWidth = 2;
    rounded(70, 548, 22, 34, 11);
    g.stroke();
    g.beginPath();
    g.moveTo(63, 551);
    g.quadraticCurveTo(81, 532, 99, 551);
    g.stroke();
    g.fillStyle = "#f3f5f9";
    g.font = '500 20px "Albert Sans", sans-serif';
    g.letterSpacing = "7px";
    g.fillText("MIRVA", 116, 573);
    return c.toDataURL("image/jpeg", 0.86).split(",")[1];
  }, job);
  const file = path.join(ROOT, "public", job.file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(b64, "base64"));
  console.log(job.file, fs.statSync(file).size, "bytes");
}
await browser.close();
