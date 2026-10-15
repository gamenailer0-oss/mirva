// The one way MIRVA goes live: `npm run ship`. Refuses if the test faces folder exists, then tests, deploys to
// Cloudflare, runs the live smoke test and pushes to GitHub. Stops at the first step that fails.
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

const LIVE = process.env.MIRVA_LIVE || "https://mirva.gamenailer0-1a9.workers.dev";
const step = (title, cmd) => {
  console.log(`\n== ${title}`);
  execSync(cmd, { stdio: "inherit" });
};
if (existsSync("public/_lab")) {
  console.error("public/_lab exists (test faces). Move it out before shipping.");
  process.exit(1);
}
const dirty = execSync("git status --porcelain").toString().trim();
if (dirty) console.log("Note: there are uncommitted changes; they will be deployed but not pushed:\n" + dirty);
step("Tests", "npm test --silent");
step("Deploy", "npm run cloud:deploy --silent");
step("Live smoke test", `node scripts/smoke.mjs ${LIVE}`);
step("Push", "git push -q origin main");
console.log("\nShipped.");
