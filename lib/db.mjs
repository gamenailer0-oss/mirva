// MIRVA's store: one SQLite file. Members, wardrobes, boards, mirrors, events, leads.
// Uses Node's built-in SQLite, so there is nothing to install and nothing to run beside the server.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { SCHEMA } from "./schema.mjs";



// The store speaks one small async language: get, all, run, batch. On a laptop that is this file,
// over Node's built-in SQLite. At the edge the same four calls go to Cloudflare D1 (see worker/).
export function openDb(dir) {
  mkdirSync(dir, { recursive: true });
  const raw = new DatabaseSync(join(dir, "mirva.db"));
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;");
  raw.exec(SCHEMA);
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = raw.prepare(sql)));
    return s;
  };
  const clean = (p) => p.map((v) => (v === undefined ? null : v));
  return {
    raw,
    get: async (sql, ...p) => stmt(sql).get(...clean(p)),
    all: async (sql, ...p) => stmt(sql).all(...clean(p)),
    run: async (sql, ...p) => {
      const r = stmt(sql).run(...clean(p));
      return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
    },
    // Several writes that must all land, or none.
    async batch(list) {
      raw.exec("BEGIN");
      try {
        for (const [sql, ...p] of list) stmt(sql).run(...clean(p));
        raw.exec("COMMIT");
      } catch (e) {
        raw.exec("ROLLBACK");
        throw e;
      }
    },
    close: () => raw.close(),
  };
}

export { newId, newCode, parse } from "./ids.mjs";
export { SCHEMA };
