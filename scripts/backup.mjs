// A copy of the live database on this machine, dated: `npm run backup`. It holds shoppers' and stores' details, so it
// stays in backups/ (never committed) and on this laptop. Keep a few, delete old ones, and never send one anywhere.
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";

const day = new Date().toISOString().slice(0, 10);
mkdirSync("backups", { recursive: true });
const out = `backups/mirva-${day}.sql`;
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(npx, ["wrangler", "d1", "export", "mirva", "--remote", `--output=${out}`], { stdio: "inherit", shell: process.platform === "win32" });
console.log(`Saved ${out} (${Math.round(statSync(out).size / 1024)} KB). Portraits live in the FILES store and are not in it.`);
