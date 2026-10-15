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
- Design is MIRVA's own: dark glass, the halo (one arc of mercury light), Bodoni Moda + Jost, porcelain/noir. No
  gimmick graphics, no stock motion, only real MIRVA results as proof.
- The founder's phone number is never published on the site (the /hq WhatsApp switch is theirs to turn on).
- Sapphire, Lawrencepur and Outfitters are shown only as "concept demo by MIRVA"; no partnership is claimed.
- `docs/` (handbook, checklists) is git-ignored and private. Never put it in the repo.

## Secrets: never in chat, never in the repo
- Decart key, push keys: `.env`, `.data/push-keys*.json`, and Cloudflare Worker secrets only.
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
- **Tests**: `npm test` (197 as of 2026-10-15). A test comparing two clocks must allow seconds, not milliseconds.
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
  that has backslashes with the Write/Edit tools, then check the regex after patching.
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

## Presentation models (from 2026-10-15)
- Three AI-made models, the founder's choice, used wherever MIRVA shows results (home, store page, share cards,
  decks, brand book; never in the real mirror): a formal woman (Sapphire), a man (Lawrencepur and men's casual), a
  casual woman (Outfitters). Character sheets and clean starting photos: `tools/portrait-lab/models/`
  (`formal-base.png`, `man-base.png`, `casual-a.png`; poses: hands softly clasped, hand at the button with the other in
  a pocket and legs lightly crossed). Make a new piece on them with `node tools/portrait-lab/models/direct.mjs
  <store> <product id> <base> <out> [below=<colour>]`, then `scripts/showcase.mjs`. Ignore any "MENVA"/"AR menu" text
  on the sheets (a mistake on them).
- The head restore draws a visible box when hair is long (it pastes a square around the head that cuts across hair and
  neckline). Showcase pictures are made without it (`direct.mjs`); the restore itself needs fixing for real shoppers.
