// Features tried on named accounts first (MIRVA_TRIALS): only the named accounts get them, and a bad setting gives none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { trialsFor } from "../lib/platform.mjs";

test("a trial reaches only the accounts named for it", () => {
  const of = trialsFor("three:abc, def; mirror:abc");
  assert.deepEqual(of({ id: "abc" }), ["three", "mirror"]);
  assert.deepEqual(of({ id: "def" }), ["three"]);
  assert.deepEqual(of({ id: "someone-else" }), []);
  assert.deepEqual(of(null), []);
  assert.deepEqual(trialsFor("")({ id: "abc" }), []);
  assert.deepEqual(trialsFor("three")({ id: "three" }), [], "a feature with no accounts reaches nobody");
});

test("the live setting names only the founder's habab account, for all three at once and the real mirror", () => {
  const line = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8").match(/^MIRVA_TRIALS = "(.*)"$/m)?.[1];
  assert.equal(line, "three:ofFemkEZc4e09IDa; mirror:ofFemkEZc4e09IDa; outfit:ofFemkEZc4e09IDa");
});
