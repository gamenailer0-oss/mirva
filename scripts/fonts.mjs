// Brings MIRVA's two typefaces (Bodoni Moda for MIRVA's voice, Jost for the interface) onto MIRVA's own address:
// one less connection on a slow line, nothing asked of a third party, and the same letters offline.
//   node scripts/fonts.mjs        (writes public/fonts/*.woff2 and public/fonts/fonts.css)
// Both are open fonts (SIL Open Font License), served here exactly as Google Fonts serves them.
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "fonts");
const CSS = "https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..700;1,6..96,400..600&family=Jost:wght@300..600&display=swap";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const KEEP = new Set(["latin", "latin-ext"]); // English and Roman Urdu; Urdu script gets its own face when it comes

const css = await (await fetch(CSS, { headers: { "user-agent": UA } })).text();
const blocks = [...css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*{([^}]*)}/g)];
await mkdir(OUT, { recursive: true });
const out = ["/* MIRVA's typefaces, served from MIRVA (scripts/fonts.mjs). SIL Open Font License. */"];
for (const [, subset, body] of blocks) {
  if (!KEEP.has(subset)) continue;
  const family = body.match(/font-family:\s*'([^']+)'/)[1];
  const style = body.match(/font-style:\s*(\w+)/)[1];
  const url = body.match(/url\((https:[^)]+)\)/)[1];
  const name = `${family.toLowerCase().replace(/\s+/g, "-")}-${style}-${subset}.woff2`;
  const bytes = new Uint8Array(await (await fetch(url, { headers: { "user-agent": UA } })).arrayBuffer());
  await writeFile(join(OUT, name), bytes);
  out.push(`@font-face {${body.replace(/url\([^)]+\)/, `url(/fonts/${name})`).replace(/\s+/g, " ")}}`);
  console.log(name, bytes.byteLength, "bytes");
}
await writeFile(join(OUT, "fonts.css"), out.join("\n") + "\n");
console.log("fonts.css written");
