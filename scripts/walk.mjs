// Walks the mirror on a phone (or a tablet / mirror screen) with a fake camera and shoots each step, so its screens can
// be looked at before calling them done. No portrait is asked for, so it costs nothing.
//   node scripts/walk.mjs [--live] [--size phone|tablet|mirror] [--brand sapphire]   -> tools/shots/walk-<size>-<n>.png
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const base = args.includes("--live") ? "https://mirva.gamenailer0-1a9.workers.dev" : "http://localhost:4310";
const size = opt("size", "phone");
const brand = opt("brand", "sapphire");
const [w, h, mobile] = { phone: [390, 844, true], tablet: [820, 1180, true], mirror: [1080, 1920, false] }[size];
const require = createRequire(path.resolve("tools/camera-lab/package.json"));
const puppeteer = require("puppeteer-core");
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));
const OUT = path.resolve("tools/shots");
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${path.resolve("tools/camera-lab/portrait.mjpeg")}`],
});
const page = await browser.newPage();
await page.setViewport({ width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
page.on("pageerror", (e) => console.log("page error:", String(e).slice(0, 200)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const shot = async (label) => {
  const file = path.join(OUT, `walk-${size}-${n++}-${label}.png`);
  await page.screenshot({ path: file });
  console.log(path.relative(process.cwd(), file));
};
const click = async (sel) => {
  const el = await page.$(sel);
  if (!el || !(await el.isVisible())) return console.log("  (not shown:", sel + ")"), false;
  await el.click();
  return true;
};

await page.goto(`${base}/mirror?brand=${brand}`, { waitUntil: "networkidle2" });
await wait(1200);
await shot("start");
if (await click("#wakeBtn")) await wait(4000), await shot("camera");
const chip = await page.$("#chips button");
if (chip) await chip.click(), await wait(2500), await shot("looks");
if (await click('[data-tab="catalogue"]')) await wait(2500), await shot("catalogue");
await browser.close();
