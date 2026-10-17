// The throttles that hold free portraits and spending: a burst can never slip past a limit, and a day-long limit still
// holds a day later, after the clean-up has run (until 2026-10-17 it became a two-hour limit at the edge).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../lib/db.mjs";
import { databaseLimiter, memoryLimiter } from "../lib/auth.mjs";

const DAY = 86400e3;
const fresh = () => {
  const dir = mkdtempSync(join(tmpdir(), "mirva-limit-"));
  const db = openDb(dir);
  return { db, limiter: databaseLimiter(db), done: () => (db.close(), rmSync(dir, { recursive: true, force: true })) };
};

test("ten requests at the same moment never get more than the limit through", async () => {
  const { limiter, done } = fresh();
  const passed = (await Promise.all(Array.from({ length: 10 }, () => limiter.limit("guest-day", 3, DAY)))).filter(Boolean).length;
  assert.ok(passed <= 3, `${passed} got through a limit of 3`);
  // One at a time, exactly the limit gets through, and the refused ones did not use up the allowance.
  let one = 0;
  for (let i = 0; i < 5; i++) if (await limiter.limit("guest-ip:a", 3, DAY)) one++;
  assert.equal(one, 3);
  done();
});

test("a refused try is not counted against the next one", async () => {
  const { db, limiter, done } = fresh();
  assert.equal(await limiter.limit("vote:x", 1, 3600e3), true);
  assert.equal(await limiter.limit("vote:x", 1, 3600e3), false);
  assert.equal(Number((await db.get("SELECT COUNT(*) AS n FROM hits WHERE key = 'vote:x'")).n), 1);
  done();
});

test("a day-long limit still holds after the clean-up has run", async () => {
  const { db, limiter, done } = fresh();
  await db.run("INSERT INTO hits (key, at) VALUES (?, ?)", "guest-day", Date.now() - 3 * 3600e3); // a free portrait three hours ago
  await limiter.sweep();
  assert.equal(await limiter.limit("guest-day", 1, DAY), false, "the morning's free portrait still counts in the afternoon");
  await db.run("INSERT INTO hits (key, at) VALUES (?, ?)", "old", Date.now() - 26 * 3600e3);
  await limiter.sweep();
  assert.equal(await db.get("SELECT 1 AS n FROM hits WHERE key = 'old'"), undefined, "counts older than a day are cleared");
  done();
});

test("on one machine too, a day-long count survives the tidy-up of idle counts", async () => {
  const limiter = memoryLimiter();
  assert.equal(await limiter.limit("guest-ip:b", 1, DAY), true);
  const real = Date.now;
  try {
    Date.now = () => real() + 2 * 3600e3; // two quiet hours later, other visitors come and go
    for (let i = 0; i < 600; i++) await limiter.limit("events:" + i, 300, 3600e3);
    assert.equal(await limiter.limit("guest-ip:b", 1, DAY), false);
  } finally {
    Date.now = real;
  }
});
