// Turns real MIRVA results into the pictures the public pages show (public/showcase/*.webp), small enough for a slow line.
// The people in them are synthetic (made by MIRVA's own engine from an empty studio, tools/portrait-lab/restore/synth.mjs);
// the clothes are real pieces from the stores' public catalogues, put on them by MIRVA exactly as a shopper would see it.
//   MIRVA_PUPPETEER=<folder with puppeteer-core> node scripts/showcase.mjs <source.jpg|png> <name> [<source> <name> ...]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "showcase");
const require = createRequire(path.join(process.env.MIRVA_PUPPETEER || ROOT, "package.json"));
const puppeteer = require("puppeteer-core");
const CHROME = process.env.CHROME_PATH || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find((p) => fs.existsSync(p));
const pairs = process.argv.slice(2);
if (!pairs.length || pairs.length % 2) throw new Error("Give a source picture and a name, in pairs.");
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
for (let i = 0; i < pairs.length; i += 2) {
  const [src, name] = [pairs[i], pairs[i + 1]];
  const dataUrl = `data:image/${src.endsWith(".png") ? "png" : "jpeg"};base64,` + fs.readFileSync(src).toString("base64");
  for (const [suffix, width, quality] of [["", 720, 0.8], ["-s", 360, 0.78]]) {
    const out = await page.evaluate(async (dataUrl, width, quality) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = width;
      c.height = Math.round((img.naturalHeight / img.naturalWidth) * width);
      const g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/webp", quality);
    }, dataUrl, width, quality);
    const file = path.join(OUT, `${name}${suffix}.webp`);
    fs.writeFileSync(file, Buffer.from(out.split(",")[1], "base64"));
    console.log(path.relative(ROOT, file), fs.statSync(file).size, "bytes");
  }
}
await browser.close();
