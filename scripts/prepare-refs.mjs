// Prepares the garment pictures for a Model-mode portrait, once per product, ahead of time.
//
// Why ahead of time: the garment photo is the same for every shopper, and cleaning it (hair and skin painted
// out, no face left) needs a 16 MB model that a phone should not have to download. So this runs the very same
// code the browser would run (src/reference.js, built into public/dist) inside a real Chrome, for every product of a
// brand, and writes the results next to the site: public/refs/<brand>/<productId>.jpg. The catalogue then says
//   ref: "/refs/<brand>/<productId>.jpg"   a clean reference, used as is
//   ref: null                               nothing clean could be made; the portrait is drawn from the description
//   (no ref)                                not prepared; the browser cleans the photo itself when asked
// plus refHow, how it was made (see cleanReference in src/reference.js).
//
//   node scripts/build.mjs                              (once; builds the browser code and fetches the models)
//   node scripts/prepare-refs.mjs sapphire              (every product that has no reference yet)
//   node scripts/prepare-refs.mjs sapphire --force      (all of them again)
//   node scripts/prepare-refs.mjs sapphire --only A,B   (just these product ids, even a pinned one)
//   By hand in the catalogue: refPin (a note: leave this product alone), refSkin "head" (keep hands and arms), "all".
//
// Needs Chrome and the puppeteer-core package. Neither is a dependency of MIRVA; this is a tool for the founder's
// machine. Set CHROME_PATH if Chrome is somewhere unusual, and MIRVA_PUPPETEER to a folder whose node_modules
// holds puppeteer-core (npm install puppeteer-core in any empty folder will do).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const brandId = args.find((a) => !a.startsWith("--"));
const force = args.includes("--force");
const only = args.includes("--only") ? new Set(String(args[args.indexOf("--only") + 1] || "").split(",").filter(Boolean)) : null;
const skin = args.includes("--skin") ? args[args.indexOf("--skin") + 1] : "head";
const SIDE = 1400; // pixels: the widest picture the image proxy serves

if (!brandId) {
  console.error("Usage: node scripts/prepare-refs.mjs <brand> [--force] [--only id,id] [--skin head|all]");
  process.exit(1);
}
const catalogueFile = join(ROOT, "brands", brandId, "catalogue.json");
if (!existsSync(catalogueFile)) {
  console.error(`There is no catalogue at brands/${brandId}/catalogue.json.`);
  process.exit(1);
}
for (const f of ["public/dist/reference.js", "public/models/selfie_multiclass_256x256.tflite", "public/models/blaze_face_short_range.tflite", "public/models/pose_landmarker_lite.task"])
  if (!existsSync(join(ROOT, f))) {
    console.error(`${f} is missing. Run: node scripts/build.mjs`);
    process.exit(1);
  }

// --- the tools -------------------------------------------------------------------
function findPuppeteer() {
  const tries = [process.env.MIRVA_PUPPETEER, ROOT].filter(Boolean);
  for (const dir of tries) {
    try {
      return createRequire(join(dir, "package.json"))("puppeteer-core");
    } catch {}
  }
  console.error("puppeteer-core was not found.\nInstall it in any folder (npm install puppeteer-core) and run again with MIRVA_PUPPETEER=<that folder>.");
  process.exit(1);
}
function findChrome() {
  const known = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const found = known.find((p) => existsSync(p));
  if (!found) {
    console.error("Chrome was not found. Set CHROME_PATH to chrome.exe (or the Chrome binary).");
    process.exit(1);
  }
  return found;
}
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });

const puppeteer = findPuppeteer();
const chrome = findChrome();
const cat = JSON.parse(readFileSync(catalogueFile, "utf8"));
// A product with refPin has been set by hand (say, a reference that gave a wrong face and is not yet re-verified): it is left
// alone unless it is named with --only. A product with refSkin ("head", "arms" or "all") overrides how skin is painted out.
const todo = cat.products.filter((p) => (only ? only.has(p.id) : !p.refPin && (force || p.ref === undefined)));
if (!todo.length) {
  console.log("Every product already has a reference. Use --force to make them again.");
  process.exit(0);
}

// A private copy of the server, on a spare port with an empty data folder and no Decart key: it only serves
// the built pages and the image proxy here, and can spend nothing.
const port = await freePort();
const data = mkdtempSync(join(os.tmpdir(), "mirva-refs-"));
const server = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env: { ...process.env, PORT: String(port), MIRVA_DATA: data, DECART_API_KEY: "", MIRVA_PUBLIC_ORIGIN: "", MIRVA_OPEN_MIRROR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let browser;
const counts = {};
try {
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("The local server did not start.")), 20000);
    server.stdout.on("data", (d) => String(d).includes("MIRVA is at") && (clearTimeout(t), res()));
    server.on("exit", (c) => rej(new Error(`The local server stopped (${c}).`)));
  });
  browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${port}/robots.txt`); // any plain same-origin page will do
  const outDir = join(ROOT, "public", "refs", brandId);
  mkdirSync(outDir, { recursive: true });
  let n = 0;
  for (const p of todo) {
    n++;
    let out;
    try {
      out = await page.evaluate(
        async (url, skin, side) => {
          const { cleanReference } = await import("/dist/reference.js");
          const res = await fetch(`/img?u=${encodeURIComponent(url)}&w=${side}`);
          if (!res.ok) return { error: `picture ${res.status}` };
          // The largest photo the store's site will give, cut down to the figure: a print or a line of embroidery is
          // then several times larger in what the engine is given. CPU: same answer on every machine.
          const r = await cleanReference(await res.blob(), { delegates: ["CPU"], skin, tight: true, maxSide: side });
          let b64 = null;
          if (r.blob) {
            const bytes = new Uint8Array(await r.blob.arrayBuffer());
            let s = "";
            for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            b64 = btoa(s);
          }
          return { how: r.how, cut: r.cut, b64 };
        },
        p.image,
        p.refSkin === "head" || p.refSkin === "all" ? p.refSkin : skin,
        SIDE,
      );
    } catch (e) {
      out = { error: String(e.message || e).split("\n")[0] };
    }
    const safe = p.id.replace(/[^A-Za-z0-9_-]/g, "_");
    if (out.b64) {
      writeFileSync(join(outDir, `${safe}.jpg`), Buffer.from(out.b64, "base64"));
      p.ref = `/refs/${brandId}/${safe}.jpg`;
      p.refHow = out.how;
    } else if (out.error) {
      console.log(`  ${p.id}: ${out.error} (left as it was)`);
      continue; // a picture that would not load says nothing about the garment; try again next time
    } else {
      p.ref = null;
      p.refHow = out.how;
    }
    counts[out.how] = (counts[out.how] || 0) + 1;
    console.log(`  ${String(n).padStart(2)}/${todo.length} ${p.id.padEnd(22)} ${out.how}${out.cut ? ` (from ${Math.round(out.cut * 100)}%)` : ""}`);
  }
  // Same layout the server writes: one space of indent, no final newline.
  writeFileSync(catalogueFile, JSON.stringify(cat, null, 1));
  console.log("\nDone.", Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", "));
  const none = cat.products.filter((p) => p.ref === null);
  if (none.length) console.log(`These have no garment picture, so the mirror shows the store's photo for them: ${none.map((p) => p.id).join(", ")}`);
} catch (e) {
  console.error(e.message || e);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server.kill();
  try {
    rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}
