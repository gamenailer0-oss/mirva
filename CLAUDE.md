# MIRVA: notes for Claude

MIRVA is an AI fitting mirror for Pakistani fashion stores (Lahore first). A shopper says the occasion, the stylist
picks three looks from the store's own catalogue, and she sees herself in each one: a **Model** portrait (~15 s) or
**Studio** live video (mirror only). She keeps looks, sends them to her family on WhatsApp, and the family votes.
Founder: Abdullah Shahzad (a project by MVP family; managed by Sarim Jahangir, assisted by Sana Faiz). Solo founder,
no funding: plan for one person plus Claude.

Live: https://mirva.gamenailer0-1a9.workers.dev · Repo (PUBLIC): github.com/gamenailer0-oss/mirva, branch `main`.

## The founder's standing rules (do not break)
- **Don't break what works.** The try-on (Model and Studio, head restore) and the home page `/` are frozen: change them
  only for a measured improvement, and say what was measured. The founder called the home page "perfect".
- Ask once, then act: the founder wants finished work, fast, in small shipped steps, without long waits. Plain words,
  no jargon. Before a big change, say in a few lines what you understood, then do it.
- Design is MIRVA's own: dark glass, the halo (one arc of mercury light), Newsreader + Albert Sans, porcelain/noir. No
  gimmick graphics, no stock motion, only real MIRVA results as proof.
- **Type (founder's choice, 2026-10-15):** Newsreader is the voice (`--serif`: headlines, look names, the stylist's
  lines), Albert Sans everything read and tapped (`--sans`), and the wordmark alone keeps Bodoni Moda (`--mark`, a
  1.4 KB file of the letters M I R V A). Bodoni and Jost were dropped for readability on phones: Bodoni's hairlines broke
  up at small sizes on dark glass, Jost's round "a" and short lowercase tired the eye. Fonts come from
  `node scripts/fonts.mjs` (one file per Newsreader weight, since a file of every weight is 270 KB). The comparison
  page: https://claude.ai/artifact/EAJTFBFD88LAB37gwRDt4S. Canvas pictures (share card, family card) must
  `document.fonts.load` before drawing.
- The founder's phone number is never published on the site (the /hq WhatsApp switch is theirs to turn on).
- Sapphire, Lawrencepur and Outfitters are shown only as "concept demo by MIRVA"; no partnership is claimed.
- `docs/` (handbook, checklists) is git-ignored and private. Never put it in the repo.

- **Ponytail** (skill, installed 2026-10-15 in `~/.claude/skills/ponytail*`, the original from DietrichGebert/ponytail):
  the smallest complete change, existing code and the platform first. It never outranks the rules above: the
  founder's asks for polish, motion and design are asked-for features, not extras to skip; tests and safeguards stay.

## Secrets: never in chat, never in the repo
- Decart key, push keys: `.env`, `.data/push-keys*.json`, and Cloudflare Worker secrets only. `.env` also holds
  `FAL_KEY` (fal.ai: SAM 3 outlines and FASHN, now part of every portrait; also a Worker secret, set with
  `node -e "<print the key from .env>" | npx wrangler secret put FAL_KEY`; topped up 2026-10-15; the key cannot read
  its balance, and a call dearer than what is left answers 403 "User is locked. Reason: TOP_UP"), `GEMINI_API_KEY` and
  `OPENAI_API_KEY` (no billing on either yet). All three were pasted in chat by the founder; they chose to replace them later.
- Sign-ins live in files only: `.data/first-run.txt` (local founder), `.data/demo-sign-ins.txt` (demo accounts),
  `.data/live-founder.txt` (live founder, reset 2026-10-15). Point the founder to the file; never print a password.
- When grepping files that hold passwords, hide values (a grep that prints a whole line will print the password).
- Test faces (including the founder's own photo) live only in `tools/portrait-lab/_lab`. **Never deploy while
  `public/_lab/` exists** (`npm run ship` refuses).

## Loops: the repeatable routines
- **Ship** (after any change that should go live): `npm run ship` = tests, deploy, live smoke test, push.
  Commit first; end commit messages with the Co-Authored-By line.
- **Look before calling a screen done**: start the dev server (preview `mirva`, port 4310), then
  `npm run look -- /retail /mirror` (add `--live` for the live site). Read the screenshots in `tools/shots/`.
- **Tests**: `npm test` (222 as of 2026-10-15). A test comparing two clocks must allow seconds, not milliseconds.
- **A live portrait, timed** (about US$0.06): `node tools/eval/live-shot.mjs <photo> sapphire PRWCASTV106W_999 [--studio]`
  prints the cloud's own times (engine, her outlines, saving) and the outline route's. The Chrome rig against the live
  site gets connection resets from this laptop; Node's fetch does not. Local portraits' records:
  `node tools/eval/local-shots.mjs 3`.
- **Engine test** (portrait engines side by side; about $0.17 a case on fal + $0.02 Decart), in `tools/portrait-lab/engines/`:
  `node bakeoff.mjs <round> [cases] [decart,fashn,kling]` (cases in `cases.mjs`; made-up shoppers in `synth/`, three
  hard ones `hard-*.png` from `shoppers.mjs`), `node keep.mjs <round>` (Decart + her own head and wall back, SAM 3
  masks), `node score.mjs <round>` (face kept), `node contact.mjs <round>` (a sheet to read), write
  `out/<round>/verdicts.json`, `node sheet.mjs <round>` and publish `out/<round>/sheet/index.html` with its `img/`.
  Round r1 is https://claude.ai/artifact/AL1fa9LpWBfZ5V5M7riPtp. Run one case first, then the rest.
- **Is it still her face?** `node tools/eval/kept-cli.mjs <her photo> <portrait…>` (lined-up faces compared pixel by
  pixel: the same photo 100%, her face kept or laid back 80 to 97%, another woman 34 to 55%).
- **How each portrait went**: the portrait event carries `meta` = `face=<kept|kept+studio|engine|retake|device-…>
  eng=<decart|fashn> shot=<s> e=<engine s> o=<her outlines s> fix=<phone's finish s>` and `value` = seconds.
  `SELECT datetime(at/1000,'unixepoch','+5 hours'), user, product, value, meta FROM events WHERE kind = 'portrait' ORDER BY at DESC LIMIT 30`.
- **Garment pictures for a store**: `MIRVA_PUPPETEER=D:/Mirva/tools/camera-lab node scripts/prepare-refs.mjs <store>`
  (`--only id,id` names products; a pinned product, `refPin`, is redone only when named: never pass pinned ids in bulk).
- **A real portrait test** (costs ~$0.02): `node tools/portrait-lab/restore/real2.mjs <store> <photo> <label> <product id>`
  with the synthetic shoppers in `tools/portrait-lab/synth/`.
- **Database copy**: `npm run backup` (into git-ignored `backups/`).
- **Live database question**: `npx wrangler d1 execute mirva --remote --json --command "SELECT …"` (read-only unless asked).
- After each finished piece: update memory notes and the founder's checklist `docs/update-checklist.md`.

## How the code is laid out
- One codebase, two hosts: `lib/app.mjs` + `lib/platform.mjs` run under `server.mjs` (laptop, SQLite, port 4310)
  and `worker/index.mjs` (Cloudflare Worker, D1, KV `FILES`, cron every 6 h). Restart the dev server after `lib/` changes.
- Front end: `src/main.js` (mirror), `src/web/*.js` (site, account, board, desk, retail, touch, sharelook), built by
  `scripts/build.mjs` into `public/dist/`. Styles: `public/brand.css` (all site pages), `public/styles.css` (mirror),
  `public/site/site.css`, `public/retail/retail.css`, `public/desk/desk.css`.
- Prices and allowances: `lib/plans.mjs` only (pilot: `PILOT`). Schema: `lib/schema.mjs` (`LATER` + `COLUMNS`; the
  version is a hash of them, so a new table always migrates).

## Mistakes made, so they are not made again
- **Shell heredocs strip backslashes** (`\d`, `\.`, `\/` came out as `d`, `.`, `/`) even with `<<'EOF'`. Write code
  that has backslashes with the Write/Edit tools, then check the regex after patching. Made again on 2026-10-15
  (`node -e` and `node - <<EOF` patches with `\n` and `\/`): any patch containing a backslash goes in a file written by Write.
- **A replacement put double quotes inside a double-quoted JS string** (`"500 22px "Albert Sans", …"`) and the build
  broke. When swapping a font name into code, check which quote the string uses.
- **The service worker kept everything under `/fonts/` cache-first**, so an installed phone would have kept the old
  fonts.css forever. It now keeps only `.woff2` files (new names when the letters change); bump `SHELL` when needed.
- **`String.replace` with a string turns `$$` into `$`**: an import `{ $, $$ }` became `{ $, $ }`. Use a function
  replacer `(…) => text`.
- **Git Bash rewrites `/path` arguments** (e.g. `/retail` became `C:/Program Files/Git/retail`): set `MSYS_NO_PATHCONV=1`.
- **`wrangler d1 execute --command` through `shell: true`** splits the SQL into words; use bash with a quoted
  `--command "…"`, and parse JSON from the first line starting with `[`. A first password reset silently did nothing
  because of this; always read back and test a sign-in after any live data change.
- **Schema version not bumped**: a new table (`embed_passes`) never reached the live database. Fixed by hashing the schema.
- **`for (… of $(…))`** loops over one element and throws: the console's Look and feel crashed. Use `$$`.
- **A preview that does not show what a setting changes looks broken** (mood changed the panel, the preview showed
  only the glass). Previews must show the part the setting affects.
- **CSS specificity**: `.from-rail .o1` lost to `.from-rail .oval img`; check specificity when one rule must win.
- **Inline `<span>` with width/aspect-ratio does nothing**: a folded card picture rendered as a 0-size box. Make it a block.
- **`content-visibility: auto` cards are not laid out for a frame or two** after they become visible: wait for a width.
- **Bulk `--only` overwrote a pinned garment picture**: exclude `refPin` products.
- **Printed demo passwords in tool output once**: never `cat` or wide-grep `.data/*.txt`.
- **Ran ahead on a long turn and the founder hit the usage limit**: ship in small committed steps so nothing is lost.
- This machine reports "reduce motion": a reduced-motion rule hid the hero portrait. Test with motion on and off.
- **A script that spends money must never be imported**: `sheet.mjs` imported the case list from `bakeoff.mjs`, whose
  top level runs paid engine calls. Shared data lives in its own module (`cases.mjs`).
- **The real2 rig saves the engine's own picture as an empty file** (`*-engine1.png`, 0 bytes): for the raw engine
  output call the engine directly (`bakeoff.mjs` or `models/direct.mjs`).
- **Made-up (AI) faces flatter every engine**: Decart kept them at 74 to 91%, while real faces came back as strangers
  on a friend's phone. Clothes, fit, speed and price can be judged on made-up shoppers; a face verdict needs a real face.
- **face-api's recognition score cannot tell our made-up South Asian women apart** (different women 0.38 to 0.55,
  "same"): use the lined-up face comparison (`tools/eval/identity.mjs` `faceKept`).
- **A local page screenshot without the viewport meta lays out at 980 px** and hides phone overflow: wrap it in the
  artifact skeleton's `<meta name=viewport …>` first. And grid children need `min-width: 0`, or a swiping row of
  pictures widens the whole page.
- **SAM 3 "clothing" masks miss parts of a garment** (a suit came back with bare arms and the old jeans): cut by
  "person" and face/hair instead. "head" swept in a friend's dupatta: use "face" and "hair" separately.
- **SAM 3 returns only its best match unless asked**: one of two slides came back. Footwear asks `return_multiple_masks`.
  "shoes" found nothing (422 "No masks generated") where "footwear" worked; a 422 means none, not a failure.
- **The backslash pitfall struck three more times** (a `\n` in a replacement became a real line break inside a quoted
  string; a backtick inside a template ended it; `\u0000` was mangled): patches with backslashes or backticks go in a
  file written by the Write tool, or straight through the Edit tool.
- **sharp's raw output of a one-channel picture came back as three channels** and a mask laid in stripes: use
  `.extractChannel(0)` and check `info.channels`.
- **The edge's free plan has about 10 ms of processing a request** (see `kdf: "pbkdf2"` in worker/index.mjs): no picture
  decoding or encoding there. The phone does the laying; the edge only passes pictures on (Buffer's base64 is native).
  KV on the free plan takes 1,000 writes a day: each member's or visitor's portrait is one write now.
- **The smoke test pinned the Mirror price** and blocked a ship after the prices changed; it reads lib/plans.mjs now. Five
  enquiries an hour from one address: several ships in an hour meet that limit (the test accepts it).

## Where things are
- Brand book (Design System artifact): https://claude.ai/artifact/5FEd4btv1XadDjTEpmXi45
- Store deck: https://claude.ai/artifact/VGtivpPzbe7YL7RdxxStcd · Team deck: https://claude.ai/artifact/Tb4VBmLUY83DTNdawGvjkU
- System map: https://claude.ai/artifact/8iXrBqwLk8MrMbUV3AH7Lt
- Motion experiments (local only, not to be pushed): `motion/`.

## Facts measured (so they are not re-measured)
- Portrait time is the engine's: on 2026-10-15 a portrait took 16.8 s on the glass, 16.2 s of it inside Decart.
  Everything on our side adds under a second. 480p instead of 720p saved only ~2.5 s and lost detail: kept 720p.
- Studio pre-connecting was not built: Decart's live billing per connected second is unconfirmed.
- The engine reads at most 963 characters of instruction (`PROMPT_MAX` in lib/prompt.mjs, held by a test for every
  product); a longer one is refused and no portrait is made. Mushq's long descriptions had been over it.
- 2026-10-15 batch of 8 across four body types (slim and plus-size women, slim and shorter heavier men;
  `tools/portrait-lab/restore/batch.mjs`, `sheet.mjs`): naming the colour of what the shopper already wears
  (src/worn.js) stopped a shirt turning his dark navy trousers into light blue jeans; "keep the person's own shoes"
  held for women's suits and kaftans; body shape and looseness held for every build. Still open: a men's kurta
  sometimes swaps his shoes for the store model's.
- **How a portrait is made (from 2026-10-15)**: the mirror sends `finish=cloud`. lib/app.mjs asks Decart for the portrait
  while fal's SAM 3 outlines her face, hair, figure and footwear (lib/finish.mjs `HER`); the answer (lib/shot.mjs: 4-byte
  length + JSON + picture) carries her outlines and a signed one-use pass; the phone sends a 360-px copy to `/api/outline`
  for the portrait's own (face, hair, footwear, + figure for a busy wall), lays her face, hair and shoes back
  (src/keep.js, ~0.1 s), and for a busy wall cuts her onto a studio wall 1.6 s after the unveil (no second drawing).
  Decart moved her head: a `retake` from FASHN. Decart out of credit or down: FASHN makes it. fal down or out of credit:
  the old restore on the phone (src/restore.js, its 16 MB model fetched only then). The server stores only the entry;
  the phone's finished picture is the file. Old mirrors get exactly the old answer. Before: a friend's Android showed the
  engine's face on all five tries, and the founder's slow line never finished two of three.
- **Live timings, 2026-10-15**: server 15.9 s (Decart 15.6, saving 0.3), the portrait's outlines 1.5 s from a 23 to 53 KB
  copy, about 21 s tap to finished portrait; Decart alone is the wait. Steps that were cut: Decart's 1.1 MB PNG sent four
  times to SAM (6.9 s; Decart ignores `output_format`), storing that PNG before answering (2.8 s). Never send her
  pictures through fal's storage upload: its links are public.
- **Real faces, 2026-10-15** (the founder's own test photo and a friend's street photo, with leave; kept only in
  `tools/portrait-lab/_lab` and `engines/out/real1`): Decart alone kept 39 to 54% of the face (strangers); with her own
  laid back 86 to 98%; FASHN 88 to 96% but broke on the founder's seated pose (his own black kurta left showing, his
  trousers not changed). So Decart + keep her is the main way and FASHN the second.
- **Cost of a portrait**: Decart US$0.02 + 7 outlines at US$0.005 = US$0.055 (a second from the same photo 0.035, a busy
  wall +0.005, FASHN 0.075). The daily portrait ceiling is US$6. Prices (lib/plans.mjs, 15 October): Assist Rs.30,000
  (Rs.25,000 from the 10th store, 600 portraits), Mirror Rs.110,000 (70 live min, 1,500 portraits), Flagship Rs.225,000
  (150 min, 3,500), Results Rs.25,000 + 3%, extra portraits Rs.3,000 per 100, pilot Rs.50,000; test/economics.test.mjs
  keeps every plan above 50% after try-on costs.
- **Engine test r1, 2026-10-15** (8 made-up shoppers, real Sapphire/Lawrencepur/Outfitters pieces, times from Lahore):
  Decart 14.5 s avg (max 18), face kept 85% avg; FASHN v1.6 balanced 12.3 s (max 13.7), 91%; Kling 11.9 s (max 13.4),
  91%; Decart + keep her (cloud, SAM 3 person/head masks, about +3 s) 91%. Clothes: Decart best on dupatta drape, kurta
  colour and stripes; FASHN and Kling best on prints and colours and keep her own shoes, but flatten a dupatta into a
  front panel and leave her old top showing in a lower neckline (3 of 8); Decart turned a dark teal shirt light blue and
  swapped a man's sneakers. FASHN quality mode took 24 s for no visible gain: use balanced. FASHN and Kling outputs are
  nearly identical. Best together: FASHN for single pieces and western wear, Decart + keep her for 3-piece suits with a
  dupatta (5 right, 3 close, 0 wrong of 8). Prices: Decart $0.02, + keep $0.035, Kling $0.07, FASHN $0.075 (fal).

## Presentation models (from 2026-10-15)
- Three AI-made models, the founder's choice, used wherever MIRVA shows results (home, store page, share cards,
  decks, brand book; never in the real mirror): a formal woman (Sapphire), a man (Lawrencepur and men's casual), a
  casual woman (Outfitters). Character sheets and clean starting photos: `tools/portrait-lab/models/`
  (`formal-base.png`, `man-base.png`, `casual-a.png`; poses: hands softly clasped, hand at the button with the other in
  a pocket and legs lightly crossed). Make a new piece on them with `node tools/portrait-lab/models/direct.mjs
  <store> <product id> <base> <out> [below=<colour>]`, then `scripts/showcase.mjs`. Ignore any "MENVA"/"AR menu" text
  on the sheets (a mistake on them).
- The head restore used to draw a box when hair was long (its square cut across the hair and neckline). Fixed
  2026-10-15 (src/restore.js: the square grows downward when hair reaches its foot, the paste fades over the last rows,
  her old wall is never laid lower than just below her chin); measured on real portraits, long hair now flows on.
- **The console showed zeros for weeks** because it counted only paired store mirrors: members' tries were saved as
  "at home" and hidden, and visitors who had not signed in were refused outright. Now every try is counted with where it
  happened (`events.sample`: 0 store mirror or staff, 1 seeded sample, 2 member on the MIRVA app, 3 visitor on the
  MIRVA app, 4 the store's website) and the console filters by place; sales, a pilot's target and the cost per try-on
  stay in-store (`store_events`). Lesson: when a number is zero, check what is filtered out before what is missing.
- **"Try-on is resting for today" for everyone but the founder (2026-10-15):** one $5 daily ceiling covered live video
  and portraits together; six live Studio sessions ($4.40, the founder's own tests count) used it up and portraits
  stopped for every shopper. Now two ceilings: `MIRVA_DAILY_USD` live ($5) and `MIRVA_DAILY_PORTRAIT_USD` portraits
  ($3). The founder and store users are never held, so they do not see the limit: test as a shopper too.
