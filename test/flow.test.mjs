// The way through the mirror (the founder, 22 Oct 2026): a photo has Model alone, a live camera has both with Studio
// leading where live try-on can run, and whatever she taps first the next step is plain. The steps need a browser and are
// shot by tools/stores/flow-shots.mjs; what is held here is that the rules stay in the code.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/mirror.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const fn = (name) => main.slice(main.indexOf(`function ${name}(`), main.indexOf("\n}\n", main.indexOf(`function ${name}(`)) + 2);

test("a photo has Model alone: choosing a piece makes the portrait at once, and Studio is not offered", () => {
  const choose = fn("choose");
  const photo = choose.indexOf("if (onPhoto()) return modelShot(p);");
  assert.ok(photo > 0, "a photo goes straight to the portrait");
  assert.ok(photo < choose.indexOf('S.mode === "studio"'), "before any remembered Studio");
  assert.match(fn("setMode"), /if \(mode === "studio" && onPhoto\(\)\) mode = "model";/);
  assert.match(fn("syncGlass"), /studioBtn\.hidden = onPhoto\(\);/);
});

test("a live camera has both, and Studio leads only where live try-on can really run", () => {
  assert.match(main, /const liveHere = \(\) =>\s*!onPhoto\(\) && !!S\.config\?\.live && !noLive\(\) && !mustJoin\("live"\)/);
  assert.match(fn("syncGlass"), /\$\("#modes"\)\.dataset\.prefer = live \? "studio" : "model";/);
  assert.match(css, /\.modes\[data-prefer="studio"\] \[data-mode="studio"\] \{ order: -1; \}/);
  assert.match(fn("choose"), /caption\(line\(liveHere\(\) \? "whichModeLive" : "whichMode"\)\)/);
});

test("a piece chosen before the mirror is on waits on the wake screen, and the first visit is shown three steps", () => {
  assert.match(html, /id="wakePiece"/);
  assert.match(html, /<ol id="path" class="path"[^>]*hidden>/);
  for (const step of ["piece", "you", "wear"]) assert.match(html, new RegExp(`data-step="${step}"`));
  assert.match(fn("needMirror"), /S\.pending = p;\s*syncGlass\(\);/, "the panel folds and the piece shows");
  assert.match(fn("syncPath"), /localStorage\.setItem\(GUIDED, "1"\)/, "the steps go once her first look is on");
  assert.match(main, /for \(const b of \$\$\("#path button"\)\) b\.addEventListener\("click", \(\) => takeStep\(b\.dataset\.step\)\);/);
});
