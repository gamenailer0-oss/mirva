// Printer's punctuation in the pages' own words: ’ for an apostrophe, “ ” for quotes, … for three dots.
// Only text between tags is touched: never a tag, an attribute, a script, a style or code. Safe to run again.
//   node scripts/typeset.mjs [--check]   (--check lists what it would change and exits 1 if anything would)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const files = [
  ...fs.readdirSync(path.join(ROOT, "public/site")).filter((f) => f.endsWith(".html")).map((f) => `public/site/${f}`),
  ...fs.readdirSync(path.join(ROOT, "public/retail")).filter((f) => f.endsWith(".html")).map((f) => `public/retail/${f}`),
  "public/mirror.html",
];
const LEAVE = /(<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<code[\s\S]*?<\/code>|<pre[\s\S]*?<\/pre>|<!--[\s\S]*?-->|<[^>]+>)/i;

export function typeset(text) {
  return text
    .replace(/(\p{L})'(\p{L})/gu, "$1’$2") // it's, store's, you'd
    .replace(/(\p{L}s)'(?=[\s.,;:!?)]|$)/gu, "$1’") // the stores' rails
    .replace(/(^|[\s(\[—–-])"(?=\S)/gu, "$1“")
    .replace(/(\S)"(?=[\s.,;:!?)\]—–-]|$)/gu, "$1”")
    .replace(/\.\.\./g, "…");
}

let changed = 0;
for (const rel of files) {
  const file = path.join(ROOT, rel);
  const html = fs.readFileSync(file, "utf8");
  const parts = html.split(LEAVE);
  const out = parts.map((part, i) => (i % 2 ? part : typeset(part))).join("");
  if (out === html) continue;
  changed++;
  if (check) console.log("would change", rel);
  else fs.writeFileSync(file, out), console.log("set", rel);
}
if (check && changed) process.exit(1);
