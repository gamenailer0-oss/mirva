// Writes the database schema to worker/schema.sql, so Cloudflare D1 can be built from the same
// text the laptop's SQLite uses:  npx wrangler d1 execute mirva --remote --file worker/schema.sql
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA } from "../lib/schema.mjs";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "worker", "schema.sql");
// D1 reads a file statement by statement and does not take comments inside one.
const sql = SCHEMA.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim() + "\n";
writeFileSync(out, sql);
console.log(`wrote ${out} (${sql.split(";").length - 1} statements)`);
