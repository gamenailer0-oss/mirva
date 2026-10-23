// Opens every public page in a real browser (phone size), follows every link on it, and reports what is broken: pages
// or files that do not answer 200, pictures that do not load, script errors, console errors and failed requests.
// External links are only asked (HEAD, then GET), never clicked. Costs nothing: no try-on is started.
//   node scripts/linkcheck.mjs [--live] [--external]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const base = args.includes("--live") ? "https://mirva.gamenailer0-1a9.workers.dev" : "http://localhost:4310";
const external = args.includes("--external");
const require = createRequire(path.resolve("tools/camera-lab/package.json"));
const puppeteer = require("puppeteer-core");
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));

const start = ["/", "/membership", "/mirrors", "/privacy", "/terms", "/retail", "/mirror", "/account", "/for/sapphire", "/no-such-page"];
// Pages a stranger may open but that are not meant to answer 200 without a sign-in or a code are listed here.
const expected = { "/no-such-page": 404 };
const seen = new Set(), queue = [...start], problems = [], externals = new Set();
const note = (where, what) => problems.push(`${where}: ${what}`);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
let here = "";
page.on("pageerror", (e) => note(here, `script error: ${String(e).slice(0, 160)}`));
// MediaPipe prints its own start-up notes ("INFO: Created TensorFlow Lite XNNPACK delegate") through console.error.
page.on("console", (m) => m.type() === "error" && !/Failed to load resource|^INFO: /.test(m.text()) && note(here, `console: ${m.text().slice(0, 160)}`));
page.on("requestfailed", (r) => !/favicon|analytics/.test(r.url()) && note(here, `request failed: ${r.url().replace(base, "")} (${r.failure()?.errorText})`));
page.on("response", (r) => {
  const u = r.url();
  if (u.startsWith(base) && r.status() >= 400 && !u.endsWith("/no-such-page") && !/\/api\//.test(u)) note(here, `${r.status()} ${u.replace(base, "")}`);
});

while (queue.length) {
  const p = queue.shift();
  if (seen.has(p)) continue;
  seen.add(p);
  here = p;
  const res = await page.goto(base + p, { waitUntil: "networkidle2", timeout: 45000 }).catch((e) => (note(p, `did not open: ${e.message}`), null));
  if (!res) continue;
  const want = expected[p] ?? 200;
  if (res.status() !== want) note(p, `answered ${res.status()} (expected ${want})`);
  await new Promise((r) => setTimeout(r, 600));
  // Pictures that never arrived (scrolled through so lazy ones are asked for).
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 700) await page.evaluate((y) => scrollTo(0, y), y), await new Promise((r) => setTimeout(r, 120));
  await new Promise((r) => setTimeout(r, 800));
  const found = await page.evaluate(() => ({
    links: [...document.querySelectorAll("a[href]")].map((a) => a.href),
    broken: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc).map((i) => i.currentSrc),
    // A link inside a closed sheet gets its address when the sheet opens; only links a visitor can see count.
    empty: [...document.querySelectorAll('a[href="#"], a:not([href])')].filter((a) => !a.getAttribute("role") && !a.onclick && !a.closest("dialog:not([open]), [hidden]")).map((a) => a.textContent.trim().slice(0, 40)),
  }));
  for (const src of found.broken) note(p, `picture did not load: ${src.replace(base, "")}`);
  for (const t of found.empty) note(p, `link goes nowhere: "${t}"`);
  for (const href of found.links) {
    const u = new URL(href);
    if (u.origin === new URL(base).origin) {
      if (/^\/(api|b|claim|img)\//.test(u.pathname) || u.pathname.startsWith("/console") || u.pathname.startsWith("/hq")) continue;
      if (!seen.has(u.pathname)) queue.push(u.pathname);
    } else if (/^https?:$/.test(u.protocol)) externals.add(u.href.split("#")[0]);
  }
}

if (external) {
  for (const u of externals) {
    let s = 0;
    for (const method of ["HEAD", "GET"]) {
      s = await fetch(u, { method, redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "user-agent": "Mozilla/5.0 MIRVA link check" } }).then((r) => r.status, () => 0);
      if (s && s < 400) break;
    }
    if (!s || s >= 400) note("external", `${s || "no answer"} ${u}`);
  }
}
await browser.close();
console.log(`Checked ${seen.size} pages${external ? ` and ${externals.size} outside links` : ""} on ${base}.`);
console.log(problems.length ? `${problems.length} problem(s):\n` + [...new Set(problems)].map((p) => "  - " + p).join("\n") : "Nothing broken.");
process.exitCode = problems.length ? 1 : 0;
