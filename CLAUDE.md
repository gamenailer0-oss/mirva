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
- Design is MIRVA's own: dark glass, the halo, Newsreader + Albert Sans, porcelain/noir, the marble room. No
  gimmick graphics, no stock motion, only real MIRVA results as proof. **The metal stays mercury silver** (the founder,
  23 Oct 2026: "don't delete the silver style"); bronze (`--bronze`) belongs to the MIRVA mirror object only. **Motion is poised** (the founder, 23 Oct: "slimy and squishy... we are making it for elite and
  elegant"): a press sinks 1 px (never a scale squash), moves 180–320 ms on `cubic-bezier(.4, 0, .2, 1)` with no tail
  or overshoot (`--spring` now holds that curve), panels hold firm at their ends (no rubber band), nothing in the
  interface breathes or pops. Only the mirror's halo clock (asleep, thinking) still moves on its own.
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

- **Taste skills** (installed 2026-10-17 from github.com/Leonxlnx/taste-skill, MIT, commit f624f37, read before
  installing): `design-taste-frontend` (`~/.claude/skills/taste-skill`: deals a researched direction, lints and
  screenshots a page with its own scripts; `assets.mjs` fetches public-domain pictures from museum archives),
  `redesign-existing-projects` and `high-end-visual-design`. Use them to judge and polish pages, never to replace
  MIRVA's identity: its own fonts, palette, halo and the frozen home page win over anything a taste skill deals.
- Plugins on the account (17 Oct): Sales, Social Media Skills, marketing, founder toolkit, PFD, Remotion.

## Secrets: never in chat, never in the repo
- Decart key, push keys: `.env`, `.data/push-keys*.json`, and Cloudflare Worker secrets only. The Decart key was replaced
  on 2026-10-16 by a new account's key (the founder pasted it in chat): set in `.env` with a script that prints nothing,
  then `node -e "<print it from .env>" | npx wrangler secret put DECART_API_KEY`, checked with one live portrait
  (`eng=decart`, 16 s) and the `tryon-credit` flag cleared itself. `.env` also holds
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
  The mirror's own screens on a phone (fake camera, no portrait, free): `node scripts/walk.mjs [--size phone|tablet|mirror] [--live]`.
- **Link check**: `node scripts/linkcheck.mjs [--live] [--external]` opens every public page on a phone, follows every
  link, picture and file, and lists what is broken (non-200s, pictures that never load, script and console errors,
  links that go nowhere). Free. Run it before calling any page work done.
- **Detail check** (taste skill's meter): `node ~/.claude/skills/taste-skill/scripts/inspect.mjs http://localhost:4310/`
  (overflow, headline lines, text sizes, contrast; screenshots in `.taste-skill/inspect/`). Its style bans (no kickers,
  no gradients, no shadows, no hairlines) are its house style, not MIRVA's: use it for measured faults only. After any
  copy change in the pages run `node scripts/typeset.mjs` (printer's punctuation in text only; `--check` to list).
- **Tests**: `npm test` (251 as of 2026-10-31). A test comparing two clocks must allow seconds, not milliseconds.
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
- **Morning check**: `npm run health` (live site, portraits by engine, spend, enquiries; counts only, read-only). A
  scheduled task "MIRVA morning check" runs it daily at 09:00 PKT. The founder's one page is `docs/START-HERE.md`.
- **Database copy**: `npm run backup` (into git-ignored `backups/`).
- **Live database question**: `npx wrangler d1 execute mirva --remote --json --command "SELECT …"` (read-only unless asked).
- After each finished piece: update memory notes and the founder's checklist `docs/update-checklist.md`.

## How the code is laid out
- One codebase, two hosts: `lib/app.mjs` + `lib/platform.mjs` run under `server.mjs` (laptop, SQLite, port 4310)
  and `worker/index.mjs` (Cloudflare Worker, D1, KV `FILES`, cron every 6 h). Restart the dev server after `lib/` changes.
- Front end: `src/main.js` (mirror), `src/web/*.js` (site, account, board, desk, retail, touch, sharelook), built by
  `scripts/build.mjs` into `public/dist/`. Styles: `public/brand.css` (all site pages), `public/styles.css` (mirror),
  `public/site/site.css`, `public/retail/retail.css`, `public/desk/desk.css`.
- Search: `INDEXED` in lib/http.mjs lists the public pages (served `/sitemap.xml`, a canonical link and og:url on each;
  robots.txt gets its Sitemap line); `{{origin}}` in a page becomes the site's own address; `public/llms.txt`. The
  Worker sends plain http to https first (301), since the site's address is read from an instance's first request.
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
- **"Still slow" after a fix, but the fix never ran** (2026-10-15): the founder's phone kept the mirror page it had open
  before the deploy, so the cloud cut was never asked (the `cloth` table held only Claude's own test row). Before judging
  a fix from a phone test, check the new code ran (here: rows in `cloth`, `hits` keys `cloth:%`), and tell the founder
  to close and reopen the page or app after every ship.
- **A portrait event's `value` leaves out the phone's preparation** (the garment picture, the old 16 MB cut): the
  shopper's real wait can be longer than the record says.
- **An engine out of credit looks like "slow" to the founder**: Decart ran out at 23:31 PKT on 2026-10-15 and FASHN made
  every portrait after (`eng=fashn` in `meta`; flag `tryon-credit` = `out`). First check on any "slow" or "wrong" report:
  `SELECT * FROM flags` and the last portraits' `meta`.
- **Store loads are limited to 6 an hour from one address** (`/api/preview`): reloading stores in bulk needs a wait.
  The importer asks a shop for prices in its own money (`?currency=`; a shop that sells abroad answered in dollars) and
  splits a name written as one word ("HussainRehar").

- **A decoration spilled past the phone's edge** (2026-10-17): the arch between sections was wider than the screen and the
  whole page laid out wider. `overflow-x: clip` on body did nothing on a phone (a body rule is handed to the viewport);
  it works on each section. After any decoration that reaches past its box, shoot the phone and check the page width.
- **The taste skill and the founder disagree** on gradients, shadows and small capital labels: the founder asked for
  depth ("buttons too flat") and keeps MIRVA's labels. The founder's words win; the skill's meter is still useful.
- **Studying other sites from this laptop**: the built-in browser's check was down, and in headless Chrome most luxury
  houses showed a bot check, a maintenance page or a cookie wall (Aesop, Jacquemus, Loro Piana, Toteme; Sabyasachi
  timed out); Elan rendered. Use `scratchpad/study.mjs`-style shots for public homepages only, and the taste skill's
  own study (`references/research.md`, 247 sites) for patterns.
- **Limits that leaked (found 2026-10-17 by the audit)**: the edge's limiter counted first and wrote second, so a burst
  of requests all passed while the count still read zero (several free portraits for one guest, or a daily ceiling
  overrun); and the clean-up deleted counts after two hours (edge) or one idle hour (laptop), so every day-long limit
  (15 free first portraits a day, 6 a phone a day, 120 new boutique pieces a day) was really a two-hour one. Now: write
  first, then count, take a refused try back; counts kept 25 hours (`KEEP_COUNTS_MS`); test/limiter.test.mjs holds both.
  Any new limit with a window longer than a day must raise `KEEP_COUNTS_MS`.
- **Text under 11 px** had crept into captions on pictures (9.5 px) and the glass crest (8 px). The floor now: 11 px for
  small capital labels, about 13 px for anything read. The words the front end writes (src/) now use ’ too (79 strings);
  new copy should be written with ’ “ ” from the start.
- **The backslash pitfall again, twice (2026-10-17):** a one-off script written through a bash heredoc lost a backslash
  from its character class (meant to exclude quote, backslash and newline; it excluded the letter n instead), so it
  changed only 15 of 79 strings. Then the `node -e` that wrote this very note mangled it the same way. Rewritten with
  the Write and Edit tools. No heredocs or `node -e` for anything holding a backslash, ever, even one-offs and notes.

- **The garment cleaner sees faces in embroidery on hanger shots** (Agha Noor, 21 Oct 2026): with no model in the photo
  it cut one shirt in half, painted a blue patch on a pink one and gave up on a third. A store that photographs on
  hangers or flat gets its whole photo as the garment picture; always look at `refsheet.mjs` before shipping a store.
  A model with raised arms is cut too low as well (Naqshi's Vilina): use a photo with a plain pose.
- **`scripts/walk.mjs` takes `--brand=<id>` with an equals sign**; `--brand naqshi` silently walks Sapphire.
- **A store's own catalogue copy needed reading, not trusting**: single-word names (Naqshi), codes (Baroque SF-/UF- for
  the same design stitched and unstitched), perfumes and kids' wear filed as suits (Agha Noor), typos ("Embroided",
  "Emerled green", "Off White."). Read every chosen piece's line before writing a catalogue.

- **Printed the demo passwords again (22 Oct 2026)**: a "masked" node one-liner missed the table layout of
  `.data/demo-sign-ins.txt`. Read sign-ins only inside a script that never prints them (`tools/stores/desk-shots.mjs`).
  The local demo accounts (store@ and shopper@mirva.demo) were reset with `node tools/stores/reset-demo.mjs` (`npm run
  seed` never changes an existing account).

- **A worker frees the page, not the graphics chip (23 Oct)**: the pose model moved into a worker still stalled the
  screen on the GPU delegate (shader warm-up shares the chip with the compositor). Heavy GPU work belongs on the CPU
  in a worker, or after the moment it would interrupt. Measure with `sheet-motion.mjs` at WAIT=1500 and WAIT=15000.
- **This laptop hides motion and lazy pictures from the built-in browser**: it reports reduced motion (no animation
  shows) and a hidden pane never starts lazy images (naturalWidth 0, looked like broken pictures). Judge motion and
  pictures in headless Chrome with `prefers-reduced-motion: no-preference` (scratchpad `mirror-concept/hero-shots.mjs`,
  `section-shots.mjs`), and scroll past a section before shooting it, or its reveal-on-scroll parts are still hidden.
- **A CSS filter on a box whose children animate is redrawn every frame**: a drop-shadow on the hero mirror would have
  re-blurred with every portrait fade. Shadows go inside the static drawing.
- **`.ticks li` is a two-column grid**: loose inline spans inside it became separate rows (the finishes line). Wrap
  mixed inline content in one span.
- **The founder's word for bad motion is "slimy and squishy"**: spring tails, squashing presses, rubber-band stretch,
  breathing loops and arcs that pop. Default to poise (see the design rule above).
- **Never redraw the founder's own design** (23 Oct): his mirror concept, redrawn as an SVG, was "awful". Use his
  pictures (made sharp if needed) and build around them. And adding something new never removes what is there: the
  bronze swap deleted the silver he liked. Add beside; ask before replacing a founder-chosen style.
- **Every file was "no-cache" with no tag, so every visit downloaded everything again** (found 23 Oct, from "lag"):
  now hashed pieces are immutable, pictures a day, the rest answers 304 (lib/app.mjs fileResponse; test in
  server.test.mjs). A file the app loads by name (the pose thread) gets a hashed name through esbuild `define`.
- **Pictures that wait for a script look broken on mobile data**: the partner cards waited for /api/brands. Fixed
  pictures go into the page's HTML; scripts fill only what is still empty.
- **A grid item that is itself a grid stretches its rows to the tallest neighbour** (align-content defaults to
  stretch): the shorter "How it works" steps pushed their titles down. Use `align-content: start`.
- **Git Bash rewrote "/" again** (a full-page shot got "Cannot navigate to invalid URL"): MSYS_NO_PATHCONV=1 on any
  command with a path argument.
- **Harvey was asked for as a "skill" but is a Python program** that sends mail and signs in to LinkedIn: read any
  repo before installing it, and install only the parts that are safe and useful (its playbooks).
- **Windows emptied the session scratchpad (found 30 Oct)**: the mirror cut-out scripts, the calculator's and the
  LinkedIn kit's sources ("session scratchpad" below) are gone; the published artifacts are safe (read them back with
  the Artifact tool). Tools worth keeping go in `tools/` (git-ignored, but on D:), sources in `docs/`.
- **The hero's glass was a rounded box, the mirror's glass a pebble** (the founder: "lines overlapping in mirror"):
  the portrait spilled past the line of light at three corners. The glass is now a clip-path traced from the
  photograph (`node tools/stores/glass-shape.mjs`); look at a cut-out with its parts taken apart
  (`tools/stores/mirror-closeup.mjs`), not only as a whole. Small marks on a picture (look dots) land on a face or
  hair at some widths: check every width (`tools/stores/hero-shots.mjs`).
- **`img.decode()` never settles for a hidden picture**: a shot script hung on it; race it with a timeout.
- **A stroke drawn with dash offset and `vector-effect: non-scaling-stroke` stops short when scaled up**: the
  standing ring's back was missing on a 1080 screen and fine on a phone. Animate transform and opacity instead.
- **`npm i` while a `wrangler dev` runs fails half-way (EBUSY) and breaks wrangler**: stop workerd first.
- **platform.mjs `denied` is set only by a sign-in check**: a handler without one returns `fail(…)`, never `denied`.
- **Store names come from how a shop names itself** ("beygumbano"): the founder can set it on a store's Look and feel
  page (`node tools/stores/rename-live.mjs <id> "<Name>"`).

- **Mistakes of 31 Oct (the night list)**:
  - Changed a helper's arguments (`shapeIt(field, value, plain)`) and missed its third caller (remove a mirror), so a
    test failed. When a helper's arguments change, grep every caller first.
  - Put a page-header test in safeguards.test.mjs, whose app serves no pages (`assets: null`), so it got the 404's DENY.
    Header tests for pages go in platform.test.mjs (a real server; see the embed test).
  - Read a montage wrongly and "found" a mirror flip that was not there. Checked the mirror's own canvas against a
    fixed feature of the source (her watch, the dupatta's side) and all was right: judge from the canvas, not a
    re-processed screenshot.
  - Ran `cd X && a & b & c &`: only `a` ran in X and the others failed. Use `(cd X && b) &` for each.
  - ffmpeg `drawtext` segfaults here (no fontconfig): write words in Chrome (endcard.mjs) instead.
  - In Flow, Enter after Escape left the prompt unsent: click "Start generation". A page script longer than 45 s times
    out the Chrome tool (the downloads still went through): keep each script short.
  - Veo prompts that did not say "no voices" may carry a murmur: those shots play the mirror takes' room tone.
  - The phone rules (below 980 px) still apply to a store screen that narrow: a new screen size needs its glass side shot.
  - **The blunder the founder caught**: a phone that had once scanned the tablet code (the founder used his phone as the
    tab) opened `/mirror` as the store's tablet every time after, "waiting for a mirror", because the joining was kept
    in localStorage and read on every start. Store features must never leak into the phone app: a device is the tablet
    only when opened as one (`?pad=CODE`, then its own address `?tablet`); `pad-walk.mjs` now checks the same device at
    plain `/mirror` is the phone app. Lesson: anything a store device remembers must be switched on by how the page is
    opened, not by what the browser happens to hold.
  - **wrangler 4.156 turned `pages project create` into a Worker deploy**: run inside D:/Mirva it read wrangler.toml and redeployed the live site (same committed code, smoke test passed, no harm). Run any Pages command from a folder outside the repo; wrangler looks for a config in every parent folder.

## Audit of 22 Oct 2026 (done the same day)
- Shipped: three-at-once off (MIRVA_TRIALS); portrait time said as about twenty seconds (home, /retail); changing store
  lets go of the old store's piece; Studio away from a store mirror says it is in MIRVA stores and makes the portrait
  (no join detour); console overview opens in plain words (src/web/desk.js inWords), five visit steps in one row, cost
  per try-on in the cost card, busiest hour in words, look-and-feel preview warm; HQ shows store names (table and
  forms) and its eight figures in two rows; home band headline two lines on a phone; site pearl warm (#f4f2ef).
- Founding team page v2 (warm palette, fitting-room portraits, three stores said yes, Rs.25,000 founding pilot, link to
  the Lahore Route). Its MP4 for WhatsApp (motion/team-intro) is still the old cool palette: re-record if wanted.
- Not a bug: the desks' side menu looks short only in full-page screenshots (it is sticky).
- The Dashboard artifact type reads a connector or an attached file; MIRVA's numbers live in D1, which no connector
  here reads, so a dashboard would be a stale snapshot. Offered instead: a weekly store report built from a snapshot
  once Naqshi, Baroque and Agha Noor have a week of visits. Shots of the desks: `node tools/stores/desk-shots.mjs console|hq`.
- Demo passwords reset after being printed (tools/stores/reset-demo.mjs; local only, live has no demo accounts).
- **The backtick pitfall, once more (22 Oct)**: a `node -e "…"` writing this very section held backticks, so bash ran
  the quoted command (the desk shots started). Notes and patches go through the Edit or Write tools, never node -e.

## Smooth on phones (22–23 Oct 2026, shipped 7d85026; the founder: "like butter, they stutter a bit")
- **The stutter was the pose model**: getting it ready for the graphics chip froze the mirror page for 6.9 s, 13 s after
  it opened (emulated mid-range phone), while she was choosing. It now runs in its own thread (src/pose-worker.js, a
  classic script built by scripts/build.mjs; src/vision.js `inThread`, the old page path kept as the fallback). Live:
  stalls in the first 20 s 7,559 ms → 165 ms. Lesson: measure long tasks for 20 s, not the 2.5 s after load.
- The phone panel no longer animates height and bottom (the whole screen, video and all, laid out every frame):
  src/main.js `morphSheet` slides the panel and scales the glass and dock from where they were (an interrupted move
  carries on); a finger slides a full-height panel (`--drag-h`, `--drag-y`). This laptop reports reduced motion, so the
  built-in browser shows no movement: measure with `node tools/stores/sheet-motion.mjs [--live]`.
- Rising text is hidden from the first paint (`@media (scripting: enabled)`, brand.css; shows itself after 4 s if the
  script never comes). The home demo loads its catalogue only when near. /for pages hold a screen's height while
  loading (CLS 0.152 → 0.009 live). The first-visit step ring breathes with transform.
- Free meters (tools/stores, local): `perf.mjs [--live] [--top] paths` (paint, shift, bytes before scrolling, scroll
  frames), `stalls.mjs [--live] [path]` (tasks over 50 ms for 20 s), `shifts.mjs [--live] path` (what moved),
  `sheet-motion.mjs [--live]`.

## The MIRVA mirror and poise (23 Oct 2026, shipped 7aa9df0)
- The founder's mirror concept (two picture sheets: a bronze pebble of smoked glass on a dark plinth, a line of warm
  light round the glass, finishes sand gold / matte black / pearl white, a pad on a stand beside it). Decided: keep the
  site and its marble room (the renders stand in the same warm room), add the mirror, take bronze as the metal.
- Home hero (shipped 042f699, after the founder called the drawn SVG mirror "awful"): a photograph of the founder's
  own mirror. Made sharp from the concept sheet's front view with fal nano-banana edit (scratchpad
  `mirror-concept/render.mjs`, US$0.04, chosen render kept in tools/portrait-lab/models/mirror-front-render.png), then
  `cutout.mjs`: crop, glass found by filling from its middle out to the line of light, glass 10–30% smoke, the wall
  removed by growing the glass outline ring by ring (body + soft halo) and a fading floor glow under the plinth →
  public/brand/mirva-mirror.webp (23 KB) and the glass box in percent for site.css `.mirror-glass`. Portraits sit
  behind the glass, placed from MIRVA's own pose landmarks (`landmarks.mjs`): head top at 8% of the glass, feet at
  95%, on the axis (`--h --w --l --t` per image). Only the women's showcase portraits have headroom; the men's touch
  the top edge, so the hero shows khaddar, raw silk and sweatshirt. Caption under the mirror.
- **The hero as the pitch (23 Oct, the founder: "make it self-explanatory... keep the bg in the mirror a light
  color")**: the portraits in the glass are now light-room ones (models moved into the day room with room.mjs `day`,
  then direct.mjs; public/showcase/day-khaddar|day-rawsilk|day-sweatshirt; faces kept 92–96%; placements from
  scratchpad `mirror-concept/landmarks-day.json`). The glass carries `.mg-ui` (MIRVA + the occasion at the top, look
  dots and an "Ask family" WhatsApp button at the foot, ink on the light room); wide screens (≥1100 px) get three
  labels beside the mirror (`.mirror-notes`: her own face, the store's own piece named per look, one link) and hide the
  caption under it; the copy gained the three steps and "Run a fashion store? See MIRVA on your own catalogue".
  A max-content caption inside the figure's grid stretched the whole mirror once: the figure's column is
  `minmax(0, 1fr)`. The link check now ignores MediaPipe's own "INFO:" console notes.
- /retail `#mirror`: the concept pictures cut by scratchpad `mirror-concept/crop.mjs` into public/retail/mirror/,
  labelled "a design concept". The concept's pad beside the mirror implies the two-screen link (pad drives mirror)
  that is NOT built (docs/mirror-hardware.md: unit one is a wall-set 55-inch screen). Never promise the pad or sizes.
- The pose model now reads on the processor in its thread (src/pose-worker.js): on the graphics chip its warm-up
  stalled the screen up to 1.1 s even from a worker. Panel moves now draw every step; live, the first two moves can
  still lose a few frames while the catalogue's pictures decode (next speed item).
- Still to do: the brand book artifact (bronze, the mirror, poise), the decks' metal, the hardware brief vs the concept.

## LinkedIn and Harvey (23 Oct 2026)
- **Sending by Claude in Chrome (asked 23 Oct, "later")**: the founder signs in to LinkedIn himself in Chrome; Claude
  shows each day's batch (who, which brand, the exact note) and sends only after a yes for that batch; at most 15
  requests a day at a human pace; messages only to people who accepted. LinkedIn's terms forbid automated tools and the
  account risk is the founder's (told). Never type the password; stop at any check or captcha.
- The founder asked to install Harvey (github.com/ethanplusai/harvey, MIT, commit 55866a1, read in full) and "do the
  whole thing on LinkedIn". Harvey is a Python program (no Python on this laptop) that sends cold email in a loop and
  logs into LinkedIn with a password only to search; LinkedIn's terms forbid that and its own playbook says so. Only its
  playbooks were installed, as the skill `harvey-sales` (`~/.claude/skills/harvey-sales`: SKILL.md, mirva.md with
  MIRVA's prices, proof and objections, playbooks/). Claude never signs in to LinkedIn or sends without a yes per text.
- **The LinkedIn kit** (private artifact, `db` tracker in collection `pipeline`, one doc per brand id: stage, person,
  note): https://claude.ai/artifact/2DCY79FScnLcUUA7GpCJbJ. Source in the session scratchpad `linkedin/kit/`; pictures
  (banner, logo, page cover, three post pictures) in git-ignored `docs/linkedin/`, drawn by scratchpad
  `linkedin/assets.html` + `shoot.mjs`. Read the tracker with ArtifactData `list` on `pipeline` to tell the founder who
  to answer next.
- **Kit v3, audited 23 Oct for the founder's first LinkedIn day (Sat 24 Oct)** with harvey-sales, the linkedin-growth and
  close-plan skills and a web check of LinkedIn's limits: free accounts get only 3–5 personal notes a month (200
  chars), so notes go to the warm five; messages start with the person; one person per brand; the carousel
  (docs/linkedin/mirva-carousel-how-it-works.pdf, 8 slides, scratchpad `linkedin/carousel.html` + `print.mjs`) is post
  1; a 15-minute visit script; the one-page founding pilot (docs/linkedin/mirva-founding-pilot.pdf, from
  `linkedin/one-pager.html`); a dated yes-to-live plan; the tracker gained next-touch dates and "due today".
  21 of 22 new demo pages loaded (Ethnic no longer readable); Sana Safinaz and Zainab Chottani left out (Karachi).
- **A store's demo page opens on the MIRVA mirror** with its own photos in the glass (src/web/retail.js `p-mirror`,
  retail.css); it was an empty dark pane an owner would read as broken. Check a page as an owner sees it before
  sending its link (scratchpad `mirror-concept/fullpage.mjs /for/<id> <live base>`).
- Demo pages for prospects: `node tools/stores/shopify-check.mjs <domains>` (Shopify or not, page live or not) and
  `node tools/stores/make-pages.mjs <domains>` (loads them into the live site at 6 an hour; started 23 Oct for 22
  Lahore brands). Not first: Mushq, Breakout, Narkin's (LookCheck clients), Karachi chains (docs/sales-playbook.md).
- The team film MP4 was re-recorded in the warm palette (motion/team-intro, 66 s, 5.5 MB) with scratchpad
  `team-record.mjs`.

## The mirror's way through (the founder, 22 Oct 2026; src/main.js `liveHere`, `syncPath`, `takeStep`, `storeFront`)
- A photo has Model alone (the portrait starts at once, Studio hidden); a live camera has both, Studio first and lit
  where live try-on can run for this visitor (`liveHere`: a store mirror, a member with live minutes), Model first
  elsewhere with Studio saying "In MIRVA stores". Whatever she taps first, the next step is plain: a piece chosen before
  the mirror is on waits on the wake screen ("Next, see yourself in…", the panel folds on a phone); a mirror turned on
  first asks for a piece. A first visit gets three steps at the top of the panel (`#path`: choose a piece, see
  yourself, wear it), gone after the first look (`mirva:guided` in localStorage; a store mirror shows them to every
  shopper after Start over). The catalogue opens on the store's shopfront; collections carry counts; cards say their
  cloth. Shots of every step, free: `node tools/stores/flow-shots.mjs --size=phone|laptop [--photo] [--fresh] [--brand=id] [--live]`.
  Home: "Now in the mirror" band (Naqshi, Baroque, Agha Noor) and the try-it demo leads with them. test/flow.test.mjs.

## Store limits set by HQ (23 Oct 2026, shipped bb79193; the founder: "a clean way not affecting the functionality")
- /hq → Stores → "Limit a store’s month": the most portraits and live minutes a store may use a month, whatever its
  plan allows. Kept in the store's `retailers.settings` as `capPortraits` / `capLiveMinutes` (absent = no limit);
  `POST /api/hq/retailers/caps` (founder only; a number sets it, null or "" takes it off, a field left out is kept;
  404 when the store has no plan yet). lib/platform.mjs `storeFrom` takes the smaller of plan and limit
  (`liveLimitOf`), so a limit only ever lowers what the plan gives: the mirror refuses with the same "store-portraits"
  / "store-live" it always used, 0 live minutes makes `/api/config` say no Studio, staff are never held. The month's
  answer gained `cap` (null when none); the founder gets "store-cap" ("has reached your limit") instead of
  "store-near"; the store's console says "set by MIRVA". test/safeguards.test.mjs holds it all.
- Shots of the desks with a limit set locally: scratchpad `caps-local.mjs <brand> <portraits|null> <live|null>`
  (signs in from .data, prints nothing secret), then `node tools/stores/desk-shots.mjs hq|console`.

## The store's tablet and its screen (30 Oct 2026, shipped 5e36fa6; the founder's plan: "the mirror shows a qr and the tablet beside it pairs with it")
- A paired store screen opens a room (lib/link.mjs): a Durable Object `MirrorRoom` at the edge (worker/index.mjs,
  wrangler.toml `ROOMS`, migration `rooms-1`, free plan: SQLite-backed, hibernating WebSockets, "ping" answered
  without waking) and an in-memory map in server.mjs (`ws` package). Each side joins with a ticket from
  `POST /api/link/ticket` (HMAC with the server's key, one minute; `app.checkLink`). Tables `pads`, `pad_codes`.
- The flow: the sleeping glass shows a QR (`#padCode`) only while the screen has no tablet; the tablet opens
  `/mirror?pad=CODE` (`POST /api/link/join`, one use, ten minutes) and becomes `data-side="pad"` (stylist +
  catalogue, a `#remote` bar with turn on / Model / Studio / Keep / Take off / Ask family); the screen becomes
  `data-side="glass"` (all glass, words sized for two metres). The tablet's taps are done on the screen by the
  screen's own buttons (src/main.js `FROM_PAD`), so try-on is unchanged; captions and events are relayed to the
  screen (`link.relayTo`); Start over on either side clears both. A tablet gone a minute: the screen shows its own
  stylist again. A new tablet: the store console's Mirrors page ("Connect a new tablet", QR sheet; "Let it go").
- **Refined 31 Oct (the founder: "operate everything from the tab", "no other brand", "a flow like our site")**: the
  tablet shows the site's three steps (read from the screen: `padPath`) and the mirror's own dock at its foot
  (`#padDock`: Turn on the mirror while asleep; Studio and Model; Keep, Take off, Ask family), the ask bar stays in place;
  she agrees on the tablet (`padWear` -> `agreed()`), the screen only shows the line for 1.5 s (`FROM_PAD.mode`); a
  tablet is `atStore()` like the screen (asked per shopper, nothing kept, no other store). A founder signed in on the
  mirror's laptop is still the mirror (`screenOf`). The screen asks for its code at once (`openGlassRoom` early).
- **Store glass, 31 Oct (the founder)**: with its tablet joined, the sleeping glass says "Wake MIRVA from the tablet
  beside it." instead of the button (`.wake-tablet`; a screen alone keeps its button). In place of "use a photo" a
  store's glass shows a code (`POST /api/link/photo`, a "phone" ticket good for ten minutes): her phone opens `/photo`
  (public/site/photo.html, src/web/photo.js), picks from her gallery, shrinks it (1600 px JPEG) and sends it in 48,000-
  character parts through the room; the "phone" side reaches only the screen and only `{"op":"photo…` messages pass
  (lib/link.mjs `audience`, `mayPass`). The screen puts it together (`photoStart`/`photoPart`) and uses it like a photo
  chosen on the mirror; sending it is her agreement; Start over sleeps the mirror when its picture is a photo.
- Checks: `node tools/stores/pad-walk.mjs` (local, fake camera, both sides shot, then a phone sends a photo), `node tools/stores/link-live-check.mjs`
  (live: adds a test mirror under Sapphire, pairs it and a tablet, relays through the Durable Object, removes it;
  31 Oct: tablet to screen ~0.25 s from Lahore). Tests in safeguards.test.mjs and server.test.mjs.
- Studio's first seconds: a ring of light spreads on the floor of the glass (`.stand`, transform + opacity) with
  "Stand in the light, arms a little away from you."; it warms when the pose check finds her in place
  (`me.place`), and the glass's foot words step aside meanwhile. vision.js `framing` also says "A step to the middle".
- The plan (hardware, shapes, webcam, LookCheck, an easy yes, next to build): the doc "MIRVA in a real store",
  https://claude.ai/artifact/FVT7zhC4NwJq1jREAw6RqD (private until shared from its Share menu).

## Speed at the edge (30 Oct 2026, shipped 2792fda, 327a706)
- The live D1 database is in Milan (EEUR): each read costs about 0.4 s from Pakistan. Keep reads off the hot path.
- A new isolate used to read 27 catalogues from KV one after another before answering anything, even `/`: now in
  parallel, and pages and files never wait for them (worker `storesFor`: read once, then looked at again at most
  every 30 s behind the answer; a store asked for by name that this isolate has not seen is read first).
  `/api/brands` reads hidden pieces once (`hiddenByStore`, kept 30 s), `/api/me` asks "is there a founder" once.
  Live: /api/brands 1.3 s -> 0.47 s, /api/me 1.1 -> 0.53, /api/config 0.85 -> 0.5 (plain files ~0.5 from here).
- **Desks (31 Oct)**: `db.many([[sql, ...p], …])` sends several reads in ONE trip (D1 batch at the edge; lib/db.mjs on
  the laptop); platform `many()`. The founder's desk made 18 reads one after another (5.3 s) and a console overview 21
  (6.4 s); now 3 and 2 trips (1.05 s and 0.75 s live), every console page 2 (0.75 s). Count trips locally with
  `node --no-warnings tools/stores/count-reads.mjs`, time them live with `node tools/stores/desk-speed.mjs <store>`.
  A new desk call reads in one go: never a read inside a loop or one `await` after another.
- wrangler 4.156; zod (under Decart's SDK) 4.6.7; npm audit 0. Oct 2026 checks: GitHub's GhostAction workflow attack
  (this repo has no workflows and no keys in it), PHP CVE-2026-109618/9 (MIRVA runs no PHP), Cloudflare's D1 free
  caps are enforced (5 M rows read, 100 k written a day) and Workers may be 64 MiB.

## The night list of 31 Oct 2026 (shipped 2c0a59f, e8c3152; the founder slept and gave every permission)
The founder's asks: test, then clear what slows us; realistic MIRVA hero videos in Flow (Veo / Omni), "no AI slop";
attack the site and fix what gives; a laptop stood on its side as a portrait mirror, run from the tablet; premium
clothes for the hero's models; a discussion (no build) on a bolder font and plain colours instead of marble; tasteful
improvements, few words; notes and mistakes here; a checklist at the end.
- **Attack** (`node tools/stores/attack.mjs`: a throwaway server on port 4398, no keys, temp data; `--live`: gentle
  read-only probes): hidden files, headers, cross-site, who-may-do-what, injection, stored scripts (puppeteer), SSRF
  through /img and /api/preview, odd bodies, rooms and forged tickets, sessions, load (3,000 page loads 200 at a time,
  1,000 store lists, 400 slow clients, password guessing). Local 106 held, live 55 held. A code review (subagent) found
  two real holes, fixed: holds and pick-ups (`/api/hold`, `/api/pickup`) took the store from the request, so any
  shopper's account could put holds in any store's console (now `realMirror`: that store's own mirror, the founder, or
  the "mirror" trial); `/api/preview` (load a store from its website, open to owners on /retail) now also has a day's
  ceiling across everyone (40, `preview:everyone`) so many addresses cannot fill the 200 store places; staff are not held.
  Known, left: on the laptop host the importer's private-address check is checked then fetched (DNS rebinding could slip
  between); the live Worker cannot reach private networks. Handoffs stay open (public pieces only, never in a console).
- **A screen stood on its side** (console → Mirrors → "Stands"; `?turn=right|left|right:screen|left:screen|upright` on
  one screen, kept in localStorage `mirva:turn`; "right" = its top edge went to the right; ":screen" = only the screen
  turned, a webcam of its own stands upright). Kept in `retailers.settings.turn[deviceId]` (lib/platform.mjs `TURNS`,
  `turnOf`), sent by /api/config even when someone is signed in on the screen (`screenOf` is exported for that).
  src/mirror.js `#drawTurned` turns the camera frame upright on the mirror's own canvas, so the glass, pose check,
  Model and Studio all get her standing (the upright path is untouched). src/main.js `standTurned`: a window that is
  still wide holds `/mirror?framed=1` in a tall iframe turned against the screen (styles.css `.turned-frame`); inside
  it every tall-screen rule holds. lib/app.mjs lets only MIRVA's own pages frame the mirror, and only with `framed`.
  Checks: `node tools/stores/turn-walk.mjs right|left [--os]` (fake camera that sees her sideways, shot as she sees it),
  `TURN=right node tools/stores/pad-walk.mjs` (turned screen + tablet + phone photo), `turn-flip-check.mjs` (reads the
  canvas). Also fixed for it: below 980 px the phone rules held the glass at 62% even with a tablet joined.
- **Hero clothes**: public/showcase/day-onaifa|day-pr1315|day-sf4635.webp (Naqshi Onaifa, Baroque PR-1315 chiffon,
  Baroque SF-4635 net), all on `room/formal-day.png` with direct.mjs (faces 92–97%). The casual model keeps her white
  sneakers under a formal (her own shoes are kept on purpose): formals go on the formal model. One placement for all
  three (`tools/stores/place-hero.mjs` reads head and axis identical). Shots: `LOOK=2 node tools/stores/hero-shots.mjs`,
  `node tools/stores/hero-mirror-phone.mjs 360`. The hero now names Naqshi and Baroque (the founder's checklist says
  ask them before naming them anywhere): the founder confirmed on 31 Oct that both are fine with it.
- **Videos** in `motion/hero-videos/` (never pushed: .git/info/exclude has motion/): Flow project
  https://flow.google.com/project/b93d2445-9471-44a9-9ebe-2390f4f315cd, founder's own sign-in in Chrome. takes/t01–t13
  (16:9) and v01–v02 (9:16), originals' names in names.txt (the hash in a download's name finds its tile); sheets/
  (four frames a take); films/mirva-hero.mp4 (31 s: mirror wakes, she walks in, taps the tablet, sees herself in
  emerald, zari close up, wears it, family on the phone, end card) and mirva-short.mp4 (12 s); `node
  motion/hero-videos/cut.mjs <film>` cuts them (0.6 s dissolves; shots of her face play the mirror takes' room tone,
  since a murmur in no language gives a film away); `endcard.mjs` draws the end card in MIRVA's fonts. Flaws found and
  cut around: t13 a ghost hand after 4.3 s and nonsense text on the tablet's header (blur it), v01/v02 her real self
  lifts a green dupatta after 3.3 s, t09 cuts to another shot. Flow's 1080p upscale is clearly sharper (one at a time,
  ~2–5 min each, one at a time; `bash motion/hero-videos/take-1080.sh` waits for the next one and files it by the id in
  its name). The founder asked for **Omni 1.1 Flash** for the rest (Flow's model list, 16:9/9:16 in the same menu): it
  followed "her real self stays in ivory, only the reflection wears it" where Veo had her lift a real dupatta, but its
  first reflections showed a CCTV dome on the fitting-room ceiling (named away: "plain ceiling, only two downlights, no
  cameras") and its takes come back all but silent (the cut lays the mirror takes' room tone under them).
  **Finished films** (motion/hero-videos/films/, 1080p from Flow's upscales with `cut.mjs <film> --hd`, 720p copies
  beside them for WhatsApp): mirva-hero-1080p.mp4 (32 s: mirror wakes, walk in, tablet tap (Omni t14), reflection,
  zari, wearing it, family, end card), mirva-short-1080p.mp4 (12 s), mirva-vertical-1080p.mp4 and -2 (10 s, Omni). Say
  they are AI-made when posting (each carries Google's SynthID mark); they show a concept, never a store that has one.
- **Live wake check**: the live mirror wakes after the 12 s cap in headless walks from this laptop because its line
  brings the pose files slowly (13 MB engine in 26 s, 5.8 MB model in 44 s, Cloudflare cache HIT); locally it is ready
  in a second. Headless live walks need `WAIT=60000` before judging the pose check (`tools/stores/pose-live-check.mjs`).
- **Type and ground** (discussion only, nothing built): https://claude.ai/artifact/DHJeDrrk1tA8t9Bf9qg9Mp (source
  docs/type-and-ground/, `node docs/type-and-ground/build.mjs`). Five wordmarks, four headline voices at phone width,
  three grounds; recommended: Bodoni Moda 600 wordmark, Newsreader one weight up, "marble as a place". Measured: the
  marble is 28/31 KB and lowers ink's contrast only 14.7 → 13.9 : 1, so the choice is taste.
- **Site polish, measured only** (link check clean; text meant to be read is ≥ 13 px on phones; the inspector's "+10%
  covered" is the calculator inside a closed disclosure): /mirrors now shows the mirror's design concept beside the
  waiting list and lists Naqshi, Baroque and Agha Noor (it still listed the three concept demos).

## Where things are
- Brand book (Design System artifact): https://claude.ai/artifact/5FEd4btv1XadDjTEpmXi45
- Store deck: https://claude.ai/artifact/VGtivpPzbe7YL7RdxxStcd · Team deck: https://claude.ai/artifact/Tb4VBmLUY83DTNdawGvjkU
- System map: https://claude.ai/artifact/8iXrBqwLk8MrMbUV3AH7Lt
- **Price calculator** (founder's own, private; 23 Oct): https://claude.ai/artifact/CNeJfKEiNftWJCp6wwg8KW. One store,
  the whole business, price a deal, costs and prices; defaults copied from lib/plans.mjs (keep them in step when a price
  or cost changes there). Source: session scratchpad `calc/index.html`; `calc/check.mjs` runs its sums on the defaults.
- Engine test (real-face results): https://claude.ai/artifact/AL1fa9LpWBfZ5V5M7riPtp
- **Founding team page** (intro film, eight seats, seat finder, 7-day missions, scorecard, first 30 days):
  https://claude.ai/artifact/3T6t6G6bLBuMA8z6YR6auk; its film as an MP4 for WhatsApp: `motion/team-intro/mirva-team-intro.mp4`
  (recorded frame by frame with `window.filmSeek(t)`; ffmpeg is installed). No shared answers: a page with a store
  is organisation-only, and the team is not in the founder's claude.ai organisation.
- **Five boutique pages** (unlisted, "not affiliated" footer), for walk-in visits: `/for/zarashahjahan-com`,
  `/for/hussainrehar-com`, `/for/sairashakira-com`, `/for/rangrasiya-com-pk`, `/for/sadaffawadkhan-com`; spares that load:
  Maryum N Maria, Ammara Khan, Republic Womenswear.
- **Beygum Bano** (30 Oct 2026, the founder: "add dynasty"): its "Dynasty, Untamed" collection showed at LAAM Fashion
  Week (24 Oct) but is not in its online shop yet; `/for/beygumbano-com` is its shop as it is (79 pieces, graphic
  sweatshirts and tees, Rs.7,500 to 9,350), renamed "Beygum Bano". Reload it when Dynasty goes online. (HSY also has a
  collection called "The Dynasty": six made-to-order bridal pieces, no prices online.)
- **Naqshi, Baroque, Agha Noor** (said yes, 21 Oct 2026; `invited: true`, `priority` 1 to 3): listed for everyone and
  first in the mirror's store list (lib/app.mjs /api/brands sorts by priority); a first visit to /mirror opens Naqshi;
  no notice, so "styled by MIRVA"; the frozen home page's demo skips them (src/web/home.js). Pages: `/for/naqshi`,
  `/for/baroque`, `/for/agha-noor` and `/mirror?brand=<id>`. Built in like Sapphire (worker BUILT_IN,
  committed brands/), chosen by hand from naqshiofficial.com (48 of 491), baroque.pk (49 of 789),
  pk.aghanoorofficial.com (46 of 636). Scripts and steps: `tools/stores/README.md` (pull, curate with skip lists,
  prepare-refs, refsheet). Garment pictures (public/refs/, not in git) are deployed from this laptop: redo them before a
  ship from a fresh copy. Agha Noor shoots its pret on hangers with no model: its garment pictures are the whole photo
  (`tools/stores/hanger-refs.mjs`, `refPin`), portraits keep the embroidery's place but leave the dupatta off and can
  run a shade brighter; its own model photos would do better (ask them). Live portrait checked: 20.4 s, face kept.
- **Lahore Route** (team sales playbook, 17 Oct 2026: staircase of five retailer steps by season, funnel, top 10 Lahore
  prospects with catalogue prices, channels, objections, three team pairs, Mon–Sat rhythm, gaps):
  https://claude.ai/artifact/5BiqCiGqdWpVpJaheyAXEa (source in the session scratchpad `route/`; private until shared).
- Motion experiments (local only, not to be pushed): `motion/`.
- **Short link** (31 Oct): https://mirva.pages.dev forwards every address (path and query kept, 302 so it can later point at a bought domain) to the live site. A Cloudflare Pages project "mirva" holding only `_redirects` (source tools/short-link/site). Deploy it from a folder OUTSIDE D:/Mirva (copy it to the scratchpad): `npx --prefix D:/Mirva wrangler pages deploy site --project-name mirva --branch main`. The browser then shows the long address; a domain of their own (mirva.pk or similar, the founder buys it) is the real fix.

## Open (suggested 2026-10-16, not built; the founder chooses)
- Founder: close and reopen the mirror after each ship; replace the pasted keys; share the team page from its Share menu
  before sending it. (Decart: a new account's key went live 2026-10-16 00:22 PKT; Decart makes portraits again.)
- (31 Oct) The mirror page starts fetching the 19 MB pose files 1.5 s after it opens (`warmUp`), even if she never
  turns the camera on: heavy on mobile data. Fetching them at the first tap of "Turn on the mirror" or a chosen piece
  would spare most visits; try-on is frozen, so the founder decides (measure first-look time on a slow line).
- Warm the cloud cut for the three looks while she reads them (src/main.js `S.step === "looks"` warms only pieces with a
  prepared `ref`): 2 to 4 s off a boutique piece's first tap, US$0.025 a piece once.
- Pre-cut each boutique's likely pieces before a store visit (~US$0.30 a store).
- Measure the upload sizes (her photo, the garment picture): on the Rang Rasiya tries 6 to 13 s went beyond the engine.

- **DECIDED 2026-10-17 (the founder; full list and build status in Claude's memory note `mirva-build-2026-10-17`):**
  keep the name MIRVA; team pay is confidential (never in a playbook); registration after the first pilot, then the
  startup application; trademark later; keys stay; live Studio is fast enough (Decart's fast mode, $0.04/s, live only,
  not used); FASHN performance 14.3 s vs balanced 16.8 s vs Decart ~16 s, so Decart stays; FASHN calls at once queue
  (three took 53-58 s). Team demos: the Team tier (lib/plans.mjs TEAM, set at /hq Members). SHIPPED 17 Oct: Team tier;
  MIRVA_TRIALS (wrangler.toml, "<feature>:<user id>"; /api/me sends `trials`) with "three" (all three looks at once)
  and "mirror" (/mirror?glass=real, black real-mirror version, her live picture as a corner window) on habab only; the
  phone "Ask your family" card during the wait. STILL TO BUILD: on the real mirror, scan-to-share QR, snap-and-stroll
  QR + "ready" signal on her phone (the hand-off must carry her portrait, stored only when she scans), double tap to
  hold 20 min (holds + console list); Complete the look (test); slow-phone uploads; artifacts. Original order:
  the team playbook additions; all three looks at once (founder's "habab" account only); the founder-only real-mirror
  version (black, her live picture as a small corner window, scan-to-share and snap-and-stroll QRs, double tap to hold
  20 min at the counter); a phone "Ask your family" pop-up and a ready signal on her phone; Complete the look in test;
  smaller uploads on slow phones; then update every artifact. Later: boutique speed-ups, lookbooks.
- **Asked 2026-10-17, waiting on the founder (nothing that costs money without a yes):** (1) a new name (ideas: Aarsi,
  Aina, Zeba, Mira; renaming is about half a day of code and text plus a new domain, best before the domain is bought and
  the first store signs); (2) "Complete the look": one or two small square tiles beside a single piece (top, trouser) from
  the same store, then one portrait of the whole outfit (two garments in one picture, or two passes); later "Make your
  own outfit"; for brands: add-on sales, merchandisers' own pairings, slow stock as the second piece, bundle offers,
  add-on rate in the console; (3) the 20-second wait in a busy store: snap and stroll (portraits go to her phone while she
  browses), all three looks made at once (3x the cost), hide her picture while it is made, live Studio as the in-store
  default; (4) faster live: pre-connect while she answers the stylist (needs Decart to confirm billing per connected
  second first), FASHN performance mode (untested, US$0.075).

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
  for the portrait's own (face, hair, footwear), lays her face, hair and shoes back (src/keep.js, ~0.1 s). **Her own
  room always stays** (founder's rule, 15 Oct: the studio wall made a shopper look pasted on; "natural helps"): the
  mirror never sends `studio`, and the server's studio path is only for old mirrors.
- **A store loaded from its website** has no garment pictures made ahead. The phone asks `/api/cloth/<store>/<piece>`:
  SAM 3 outlines the store's photo at 1000 px (person, face, hair, neck, skin; US$0.025, once a piece, kept in the
  `cloth` table), and src/cloth.js lays the cloth on white in its own box (0.77 s on a processor slowed 4x; the whole
  photo took 2.8 s). Before: the phone fetched the 16 MB model and painted out only hair and skin, so a boutique's
  scenery stayed (Rang Rasiya's red curtain came back as a red yoke on a navy suit). Western separates (cut at the
  waist by pose) still take the phone's old cut.
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
  wall +0.005, FASHN 0.075). The daily ceilings (wrangler.toml, lowered 15 Oct while there is no money): portraits US$2 (~36), live US$1, 15 free first portraits. Prices (lib/plans.mjs, 15 October): Assist Rs.30,000
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
- **The fitting room (2026-10-17, the founder: "not so depressing", "marble", "a fashion stylist's room")**: the models'
  starting photos were moved from the grey studio into one evening fitting room (smoky marble, brass rail of emerald,
  sapphire and crimson clothes, two wall lamps) with `tools/portrait-lab/models/room.mjs` (fal nano-banana edit, US$0.04;
  faces kept 82 to 93%; a ceiling camera it drew was painted out), then MIRVA's own engine was run again on them
  (`direct.mjs`, faces 87 to 96%), so the showcase stays real results. Sources in `tools/portrait-lab/models/room/`
  (`formal-room.png`, `man-room.png`, `casual-room.png`). The site is the same room: honed marble by day
  (`/brand/marble-light.webp`), smoky marble and lamplight at night (`.dark`), drawn by `node scripts/marble.mjs`;
  where a light room meets a dark one the later rises in an arch with a line of light (brand.css "the room"; sections
  clip sideways, since a rule on body is passed to the whole screen on phones). Neutrals are warm now (ink #14131a,
  marble #e9e5df, ivory panels #f9f6f1 (the founder found pure white harsh), night #0b0a0d); the metal is bronze since 23 Oct (it was mercury silver); the lamp
  (#e2c995) is light, never a fill. Buttons, chips and the glass controls have depth (a top highlight, a room-tinted
  shadow, sink when pressed; brand.css and styles.css "depth"); Studio carries a small live light. On a phone the
  mirror's panel follows the finger from anywhere on it and settles at mini / peek / full by speed (src/main.js
  `followFinger`: decided on the first touchmove, while the browser still lets the page take it; tested with CDP touches).
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
  stopped for every shopper. Now two ceilings: `MIRVA_DAILY_USD` live and `MIRVA_DAILY_PORTRAIT_USD` portraits
  (now $1 and $2). The founder and store users are never held, so they do not see the limit: test as a shopper too.
