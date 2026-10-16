// How the live MIRVA did in the last day, in plain words: `npm run health`. Reads the live database (read-only) and opens
// the home page. Prints no names, emails or phone numbers: only counts. Run by the daily "MIRVA morning check" task.
import { execFileSync } from "node:child_process";

const SITE = "https://mirva.gamenailer0-1a9.workers.dev";
const since = Date.now() - 24 * 3600e3;
const wrangler = "node_modules/wrangler/bin/wrangler.js";

// No shell: a shell splits the SQL into words (see CLAUDE.md, mistakes).
function ask(sql, tries = 3) {
  try {
    return once(sql);
  } catch (e) {
    if (tries <= 1) throw e;
    return ask(sql, tries - 1); // the database's address answers a failed fetch now and then
  }
}
function once(sql) {
  const out = execFileSync(process.execPath, [wrangler, "d1", "execute", "mirva", "--remote", "--json", "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out.slice(out.indexOf("[")))[0].results;
}

const warn = [];
const t0 = Date.now();
const home = await fetch(SITE + "/").then((r) => r.status, () => 0);
const homeS = ((Date.now() - t0) / 1000).toFixed(1);
if (home !== 200) warn.push(`The site did not open (answer ${home || "none"}).`);

const flags = ask("SELECT key, value FROM flags");
if (flags.some((f) => f.key === "tryon-credit")) warn.push("Decart is OUT OF CREDIT: FASHN is making every portrait (slower, dearer). Top up Decart.");

const shots = ask(`SELECT CASE WHEN meta LIKE '%eng=fashn%' THEN 'FASHN' WHEN meta LIKE '%eng=decart%' THEN 'Decart' ELSE 'other' END AS eng, COUNT(*) AS n, ROUND(AVG(value), 1) AS s, MAX(value) AS worst FROM events WHERE kind = 'portrait' AND at >= ${since} GROUP BY eng`);
const spend = ask(`SELECT kind, ROUND(SUM(usd), 2) AS usd FROM usage WHERE at >= ${since} GROUP BY kind`);
const [{ n: leads }] = ask(`SELECT COUNT(*) AS n FROM leads WHERE at >= ${since}`);
const [{ n: wait }] = ask(`SELECT COUNT(*) AS n FROM waitlist WHERE at >= ${since}`);
const [{ n: cuts }] = ask(`SELECT COUNT(*) AS n FROM cloth WHERE at >= ${since}`);

const total = shots.reduce((a, r) => a + r.n, 0);
const usd = spend.reduce((a, r) => a + (Number(r.usd) || 0), 0);
if (shots.some((r) => r.eng === "FASHN" && r.n > 2)) warn.push("FASHN made more than two portraits: check Decart.");
if (shots.some((r) => r.s > 30)) warn.push("Portraits averaged over 30 seconds on one engine.");
if (usd > 1.6) warn.push(`Spend is close to the daily ceiling ($${usd.toFixed(2)} of $3).`);

console.log(`MIRVA, last 24 hours (${new Date().toLocaleString("en-PK", { timeZone: "Asia/Karachi" })} Pakistan time)`);
console.log(`- Site: ${home === 200 ? "open" : "NOT OPEN"}, home page in ${homeS} s`);
console.log(`- Portraits: ${total}${total ? " (" + shots.map((r) => `${r.eng} ${r.n}, avg ${r.s} s, slowest ${Math.round(r.worst)} s`).join("; ") + ")" : ""}`);
console.log(`- Spent on try-on: $${usd.toFixed(2)}${spend.length ? " (" + spend.map((r) => `${r.kind} $${r.usd}`).join(", ") + ")" : ""}`);
console.log(`- New store enquiries: ${leads} · mirror waitlist sign-ups: ${wait} · boutique pieces cut: ${cuts}`);
console.log(warn.length ? "NEEDS YOU:\n" + warn.map((w) => "  * " + w).join("\n") : "All well. Nothing needs you.");
