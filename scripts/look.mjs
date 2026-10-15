// Screenshots of pages, to look at before calling a screen done: `npm run look -- /retail /mirror`.
// Phone (390 wide) and laptop (1366), full page, into tools/shots/. Add --live to shoot the live site.
// Needs puppeteer-core from tools/camera-lab and Chrome installed (this laptop has both).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const base = args.includes("--live") ? "https://mirva.gamenailer0-1a9.workers.dev" : "http://localhost:4310";
const pages = args.filter((a) => a.startsWith("/"));
if (!pages.length) pages.push("/");
const require = createRequire(path.resolve("tools/camera-lab/package.json"));
const puppeteer = require("puppeteer-core");
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));
const OUT = path.resolve("tools/shots");
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
for (const [name, w, h, mobile] of [["phone", 390, 844, true], ["laptop", 1366, 800, false]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  page.on("pageerror", (e) => console.log(`  ${name} page error:`, String(e).slice(0, 200)));
  for (const p of pages) {
    await page.goto(base + p, { waitUntil: "networkidle2" });
    const total = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < total; y += h * 0.7) await page.evaluate((y) => scrollTo(0, y), y), await new Promise((r) => setTimeout(r, 150));
    await page.evaluate(() => scrollTo(0, 0));
    const file = path.join(OUT, `${name}${p.replace(/[^a-z0-9]+/gi, "-") || "-home"}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${name} ${p}: ${total}px -> ${path.relative(process.cwd(), file)}`);
  }
}
await browser.close();
