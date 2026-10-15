// Brings MIRVA's typefaces onto MIRVA's own address: one less connection on a slow line, nothing asked of a third
// party, and the same letters offline.
//   node scripts/fonts.mjs        (writes public/fonts/*.woff2 and public/fonts/fonts.css)
// Newsreader is MIRVA's voice (headlines, look names, the stylist's lines): its optical sizes draw it fine when large and
// sturdier when small, so it stays readable on a phone where Bodoni's hairlines broke up. Albert Sans is everything she
// reads and taps. The wordmark keeps Bodoni Moda, cut down to the letters of MIRVA, so the mark itself never changes.
// All three are open fonts (SIL Open Font License), served here exactly as Google Fonts serves them.
import { writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "fonts");
// Newsreader in the weights MIRVA sets it in, each a file of its own that keeps the optical sizes: the home page needs
// only 400 and its italic (about the weight of Bodoni's two); the mirror's small look names also fetch 500. A file
// holding every weight at every size was 270 KB, too much on mobile data.
// One request for each weight: asked together, Google sends one file holding every weight.
const CSS = [
  "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;1,6..72,400&display=swap",
  "https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500&display=swap",
  "https://fonts.googleapis.com/css2?family=Albert+Sans:wght@300..700&display=swap",
];
const MARK = "https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@500&text=MIRVA%20&display=swap";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const KEEP = new Set(["latin", "latin-ext"]); // English and Roman Urdu; Urdu script gets its own face when it comes

const get = async (url) => new Uint8Array(await (await fetch(url, { headers: { "user-agent": UA } })).arrayBuffer());
await mkdir(OUT, { recursive: true });
for (const f of await readdir(OUT)) if (f.endsWith(".woff2")) await unlink(join(OUT, f));
const out = ["/* MIRVA's typefaces, served from MIRVA (scripts/fonts.mjs). SIL Open Font License. */"];

const css = (await Promise.all(CSS.map(async (u) => (await fetch(u, { headers: { "user-agent": UA } })).text()))).join("\n");
for (const [, subset, body] of css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*{([^}]*)}/g)) {
  if (!KEEP.has(subset)) continue;
  const family = body.match(/font-family:\s*'([^']+)'/)[1];
  const style = body.match(/font-style:\s*(\w+)/)[1];
  const weight = body.match(/font-weight:\s*([\d ]+);/)[1].trim().replace(/\s+/g, "-");
  const name = `${family.toLowerCase().replace(/\s+/g, "-")}-${style}-${weight}-${subset}.woff2`;
  const bytes = await get(body.match(/url\((https:[^)]+)\)/)[1]);
  await writeFile(join(OUT, name), bytes);
  out.push(`@font-face {${body.replace(/url\([^)]+\)/, `url(/fonts/${name})`).replace(/\s+/g, " ")}}`);
  console.log(name, bytes.byteLength, "bytes");
}

// The wordmark: only M, I, R, V, A and the space, so the mark costs a few hundred bytes.
const mark = await (await fetch(MARK, { headers: { "user-agent": UA } })).text();
const bytes = await get(mark.match(/url\((https:[^)]+)\)/)[1]);
await writeFile(join(OUT, "mirva-mark.woff2"), bytes);
out.push(`@font-face { font-family: 'MIRVA Mark'; font-style: normal; font-weight: 400 700; font-display: block; src: url(/fonts/mirva-mark.woff2) format('woff2'); }`);
console.log("mirva-mark.woff2", bytes.byteLength, "bytes");

await writeFile(join(OUT, "fonts.css"), out.join("\n") + "\n");
console.log("fonts.css written");
