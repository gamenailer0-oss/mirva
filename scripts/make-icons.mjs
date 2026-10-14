// Makes the pictures a phone and a link preview need, from MIRVA's own marks in public/brand:
// the app icons (for "Add to home screen"), the small monochrome badge a notification shows, and the
// default picture a shared MIRVA link carries.   MIRVA_PUPPETEER=<folder with puppeteer-core> node scripts/make-icons.mjs
//
// Needs Chrome and the puppeteer-core package, like scripts/prepare-refs.mjs. Run it again whenever a mark changes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const require = createRequire(path.join(process.env.MIRVA_PUPPETEER || ROOT, "package.json"));
const puppeteer = require("puppeteer-core");
const CHROME = process.env.CHROME_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));

const svg = (name) => fs.readFileSync(path.join(PUBLIC, "brand", name), "utf8");
// The badge: only the mark, white on nothing. Android paints it in its own colour.
const BADGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="10.5" y="9" width="11" height="17" rx="5.5" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M8 9.5Q16 2 24 9.5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`;

const jobs = [
  { out: "icons/icon-192.png", size: [192, 192], svg: svg("mirva-app-icon.svg") },
  { out: "icons/icon-512.png", size: [512, 512], svg: svg("mirva-app-icon.svg") },
  { out: "icons/maskable-512.png", size: [512, 512], svg: svg("mirva-app-icon-maskable.svg") },
  { out: "icons/apple-touch-icon.png", size: [180, 180], svg: svg("mirva-app-icon-maskable.svg") },
  { out: "icons/badge-96.png", size: [96, 96], svg: BADGE, transparent: true },
  { out: "share/mirva.jpg", size: [1200, 630], svg: svg("mirva-social-card.svg"), jpeg: true },
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
for (const job of jobs) {
  const [w, h] = job.size;
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  const body = job.svg.replace(/<svg /, `<svg style="display:block;width:${w}px;height:${h}px" `);
  await page.setContent(`<!doctype html><html><body style="margin:0;background:${job.transparent ? "transparent" : "#0b0d12"}">${body}</body></html>`);
  const file = path.join(PUBLIC, job.out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, type: job.jpeg ? "jpeg" : "png", quality: job.jpeg ? 86 : undefined, omitBackground: !!job.transparent, clip: { x: 0, y: 0, width: w, height: h } });
  console.log(job.out, fs.statSync(file).size, "bytes");
}
await browser.close();
console.log("Done. Seen by", pathToFileURL(PUBLIC).href);
