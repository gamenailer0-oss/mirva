// Fills a fresh MIRVA with enough to look around: a demo shopper, a store user for the demo brand,
// a month of SAMPLE mirror activity, and a few SAMPLE enquiries. Everything it adds is marked as a sample.
//
//   node scripts/seed.mjs           add the demo accounts and sample data (safe to run twice)
//   node scripts/seed.mjs --clear   remove the sample activity and sample enquiries again
//
// The sign-ins it creates are written to .data/demo-sign-ins.txt, on this machine only.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, newId, newCode } from "../lib/db.mjs";
import { hashPassword } from "../lib/auth.mjs";
import { COST } from "../lib/plans.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.MIRVA_DATA || join(ROOT, ".data");
const BRAND = "sapphire";
const db = openDb(DATA);
const DAY = 86400e3;

if (process.argv.includes("--clear")) {
  const e = (await db.run("DELETE FROM events WHERE sample = 1")).changes;
  const u = (await db.run("DELETE FROM usage WHERE sample = 1")).changes;
  const l = (await db.run("DELETE FROM leads WHERE source = 'sample'")).changes;
  console.log(`removed ${e} sample events, ${u} sample usage rows, ${l} sample enquiries`);
  process.exit(0);
}

// --- demo sign-ins -------------------------------------------------------------
const file = join(DATA, "demo-sign-ins.txt");
const lines = [];
async function account(role, email, name, extra = {}) {
  if (await db.get("SELECT 1 FROM users WHERE email = ?", email)) return false;
  const password = newCode(14);
  await db.run("INSERT INTO users (id, role, email, name, pass, brand, consent, created) VALUES (?,?,?,?,?,?,?,?)", newId(), role, email, name, await hashPassword(password), extra.brand || null, JSON.stringify({ terms: Date.now() }), Date.now());
  lines.push(`${role.padEnd(9)} ${email.padEnd(28)} ${password}   ${extra.where}`);
  return true;
}
await account("member", "shopper@mirva.demo", "Demo Shopper", { where: "/account" });
await account("retailer", "store@mirva.demo", "Demo Store Manager", { brand: BRAND, where: "/console" });
if (lines.length) {
  const head = existsSync(file) ? readFileSync(file, "utf8") : "MIRVA demo sign-ins (made by scripts/seed.mjs). Test accounts only.\n\nrole      email                        password         where\n";
  writeFileSync(file, head + lines.join("\n") + "\n");
  console.log(`demo sign-ins written to ${file}`);
}

// --- the demo brand as a pilot store -----------------------------------------------
await db.run("INSERT INTO retailers (brand, plan, stores, status, started) VALUES (?,?,?,?,?) ON CONFLICT(brand) DO NOTHING", BRAND, "studio", 1, "demo", Date.now() - 30 * DAY);
if (!(await db.get("SELECT 1 FROM devices WHERE brand = ?", BRAND)))
  await db.run("INSERT INTO devices (id, brand, name, store, paired, seen, created) VALUES (?,?,?,?,?,?,?)", newId(9), BRAND, "Front mirror", "Demo store, Lahore", null, null, Date.now());

// --- a month of sample activity ------------------------------------------------------
if (Number((await db.get("SELECT COUNT(*) n FROM events WHERE sample = 1")).n) === 0) {
  const catalogue = JSON.parse(readFileSync(join(ROOT, "brands", BRAND, "catalogue.json"), "utf8")).products;
  // A small generator with a fixed seed, so the sample looks the same every time.
  let seed = 20261007;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (list, skew = 1) => list[Math.floor(Math.pow(rnd(), skew) * list.length)];
  const OCCASIONS = ["wedding", "wedding", "eid", "eid", "dinner", "work", "everyday", "everyday", "everyday"];
  const popular = [...catalogue].sort((a, b) => b.formality - a.formality || a.price - b.price);
  // Thousands of rows in one go: straight to the SQLite file, inside one transaction.
  const ev = db.raw.prepare("INSERT INTO events (at, brand, device, visit, kind, product, value, meta, sample) VALUES (?,?,?,?,?,?,?,?,1)");
  const use = db.raw.prepare("INSERT INTO usage (at, kind, brand, seconds, usd, sample) VALUES (?,?,?,?,?,1)");
  let visits = 0;
  db.raw.exec("BEGIN");
  try {
    for (let d = 30; d >= 1; d--) {
      const dayStart = Math.floor((Date.now() - d * DAY) / DAY) * DAY - 5 * 3600e3; // midnight in Lahore
      const weekday = new Date(dayStart + 12 * 3600e3).getUTCDay();
      const busy = weekday === 5 || weekday === 6 || weekday === 0 ? 1.6 : 1;
      const count = Math.round((16 + rnd() * 18) * busy * (1 + (30 - d) / 60)); // a slow climb over the month
      for (let i = 0; i < count; i++) {
        const visit = "s" + newId(6);
        // Evenings are busiest: 11:00 to 22:00, leaning late.
        let at = Math.round(dayStart + (11 + Math.pow(rnd(), 0.7) * 11) * 3600e3);
        const step = () => (at += Math.round(8000 + rnd() * 40000));
        ev.run(at, BRAND, null, visit, "visit", null, null, null);
        visits++;
        if (rnd() < 0.12) continue; // walked away at the first question
        ev.run(step(), BRAND, null, visit, "brief", null, null, pick(OCCASIONS));
        ev.run(step(), BRAND, null, visit, "looks_shown", null, 3, null);
        if (rnd() < 0.2) continue;
        const opened = 1 + Math.floor(rnd() * 3);
        let kept = false;
        for (let k = 0; k < opened; k++) {
          const p = pick(popular, 1.8);
          ev.run(step(), BRAND, null, visit, "look_open", p.id, null, null);
          if (rnd() < 0.72) {
            if (rnd() < 0.6) {
              ev.run(step(), BRAND, null, visit, "portrait", p.id, null, null);
              use.run(at, "portrait", BRAND, 0, COST.portraitUsd);
            } else {
              const seconds = Math.round(25 + rnd() * 70);
              ev.run(step(), BRAND, null, visit, "live_start", p.id, null, null);
              ev.run((at += seconds * 1000), BRAND, null, visit, "live_end", null, seconds, "user");
              use.run(at, "live", BRAND, seconds, seconds * COST.liveUsdPerSecond);
            }
            const out = (p.sizes || []).filter((s) => !s.inStock);
            if (out.length && rnd() < 0.3) ev.run(step(), BRAND, null, visit, "size_missed", p.id, null, pick(out).label);
            else if ((p.sizes || []).length && rnd() < 0.5) ev.run(step(), BRAND, null, visit, "size_pick", p.id, null, pick(p.sizes).label);
            if (rnd() < 0.2) ev.run(step(), BRAND, null, visit, "addon", p.id, null, pick(["Trousers", "Dupatta", "Shoes", "Bag"]));
            if (rnd() < 0.42) (ev.run(step(), BRAND, null, visit, "keep", p.id, null, null), (kept = true));
          }
        }
        if (kept && rnd() < 0.55) ev.run(step(), BRAND, null, visit, "send", null, 1, null);
      }
    }
    db.raw.exec("COMMIT");
  } catch (e) {
    db.raw.exec("ROLLBACK");
    throw e;
  }
  console.log(`added ${visits} sample visits for ${BRAND}`);
}

// --- sample enquiries ---------------------------------------------------------------------
if (Number((await db.get("SELECT COUNT(*) n FROM leads WHERE source = 'sample'")).n) === 0) {
  const rows = [
    ["Sample: Ayesha K.", "Sample Formal House", "Head of Retail", "ayesha@example.com", "Lahore", 6, "formal", "studio", "new", "We have two flagships in Gulberg and DHA. Fitting rooms queue on weekends."],
    ["Sample: Bilal R.", "Sample Chain Stores", "Operations", "bilal@example.com", "Lahore", 42, "chain", "assist", "contacted", "Interested in the tablet for staff. What does catalogue setup need from us?"],
    ["Sample: Hina S.", "Sample Boutique", "Owner", "hina@example.com", "Lahore", 1, "boutique", "boutique", "demo", "Most of my pieces are above Rs.25,000. Clients send photos to family before deciding."],
    ["Sample: Omar T.", "Sample Unstitched Label", "E-commerce", "omar@example.com", "Faisalabad", 14, "unstitched", "studio", "new", "Can it show an unstitched three-piece as a stitched suit?"],
  ];
  for (const [i, [name, company, role, email, city, stores, segment, plan, status, message]] of rows.entries())
    await db.run(
      "INSERT INTO leads (id, at, name, company, role, email, phone, city, stores, segment, plan, message, source, status, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      newId(), Date.now() - (i + 1) * 1.7 * DAY, name, company, role, email, "", city, stores, segment, plan, message, "sample", status, Date.now() - i * DAY,
    );
  console.log(`added ${rows.length} sample enquiries`);
}
db.close();
