# MIRVA

The mirror that styles you. This folder holds the whole working system: the mirror itself,
the shopper's website and membership, the store's website and console, the founder's desk,
and the platform behind them.

The demo store is Sapphire, read from its public site. This is a concept demo and is not
affiliated with or endorsed by Sapphire, or by any store whose catalogue is loaded into it.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:4310 in Chrome.

```bash
npm run seed
```

adds two demo sign-ins and a month of clearly labelled sample activity, so the console has
something to show. `node scripts/seed.mjs --clear` removes the sample activity again.

## Where everything is

| Address | What it is | Who signs in |
| --- | --- | --- |
| `/` | The shopper's site | Nobody |
| `/membership` | What membership gives a shopper, and MIRVA Private | Nobody |
| `/account` | A member's wardrobe, the opinions she asked for, her data | Shopper |
| `/b/CODE` | A voting link she sent to family | Nobody |
| `/mirror` | The mirror: the stylist, portraits and live try-on | Nobody, a member, or a paired store mirror |
| `/retail` | The store's site: four kinds of store, pricing, the break-even sum, enquiries | Nobody |
| `/for/<store>` | A page MIRVA writes for one store from that store's own catalogue | Nobody |
| `/console` | A store's console: numbers, catalogue, mirrors, look and feel | Store user, or the founder |
| `/hq` | The founder's desk: enquiries, stores, members, outbox, log | Founder |
| `/privacy`, `/terms` | Drafts, marked as drafts | Nobody |

Sign-ins made on this machine are written to files, never printed:

- the founder's, on first start: `.data/first-run.txt`
- the demo shopper's and demo store user's, by `npm run seed`: `.data/demo-sign-ins.txt`

## Two ways to wear a look

| | Model | Studio |
| --- | --- | --- |
| What she gets | A studio portrait of herself in the piece | The piece on her in live video |
| How long | About 15 seconds | About 8 seconds to the first picture, then 2 to 5 seconds a swap |
| What it costs to make | About $0.02 | $0.02 a second |
| Engine | Decart `lucy-image-2` | Decart `lucy-vton-latest` over WebRTC |

In a store both are open to everyone. At home a free member has six portraits a month and no
live video, because nobody is paying for it there. Those allowances are in `lib/plans.mjs`.

## What is in the code

| Part | What it does | Where |
| --- | --- | --- |
| The glass | Camera or photo in, portrait or live try-on on top | `src/mirror.js` |
| Seeing | Framing, the walked-away pause, cropping the store model's face out of references | `src/vision.js` |
| The stylist | Occasion, mood and budget to three looks, and what goes with each. Rules, not a language model. | `src/stylist.js` |
| The tablet | The conversation, look cards, sizes, add-ons, kept looks | `src/main.js`, `public/mirror.html` |
| The line to the platform | Which mirror this is, what happened, the QR code to a phone | `src/link.js` |
| Shopper and store sites, the desks | Plain pages with small scripts, no framework | `public/site`, `public/retail`, `public/desk`, `src/web` |
| Design system | One stylesheet of tokens and parts the web pages share | `public/brand.css` |
| The platform | Accounts, wardrobes, voting boards, hand-off, pairing, events, enquiries, both desks' data | `lib/platform.mjs` |
| The store | One SQLite file, using Node's built-in SQLite | `lib/db.mjs`, data in `.data/` |
| Accounts | scrypt passwords, hashed session and reset tokens, throttles | `lib/auth.mjs` |
| Prices and allowances | Shopper tiers and store plans, in one place | `lib/plans.mjs` |
| Server | Decart tokens, portraits, catalogues, image proxy, pages. Listens on localhost only. | `server.mjs` |

## Bringing in another store

- **Any Shopify store:** type its address on `/retail` under "Your catalogue", or in `/hq` under Stores.
  MIRVA reads `/products.json`, re-skins the mirror, and writes that store's page at `/for/<store>`.
- **Sapphire again:** `npm run snapshot` re-reads its collections.
- **Anything else:** add `brands/<name>/brand.json` and `catalogue.json` in the same shape.

## Keeping the bill in hand

1. Nothing is spent on page load. A portrait or a session starts only when a look is tapped.
2. Each live session is capped by Decart itself (`MIRVA_SESSION_SECONDS`).
3. A live look pauses after `MIRVA_IDLE_SECONDS` without a tap, and after 8 seconds with nobody in the frame.
4. The server refuses more than `MIRVA_SESSIONS_PER_HOUR` sessions or `MIRVA_SHOTS_PER_HOUR` portraits.
5. A member's monthly allowance is checked on the server before anything is made.
6. Every portrait and live second is written to a ledger. The founder's desk shows the total.

## Running on Cloudflare

The same app runs at Cloudflare's edge, free to start: a Worker serves the pages and runs the
app, D1 holds the database, KV holds portraits and loaded catalogues. `worker/index.mjs` is the
entry and `wrangler.toml` the settings.

```bash
npm run cloud:dev      # the whole thing in Cloudflare's local simulator, at http://localhost:8788
npm run cloud:deploy   # build and publish
npm run smoke -- https://your-address   # walk a running MIRVA and report what works
```

One-time setup for a new Cloudflare account:

1. `npx wrangler login`
2. `npx wrangler d1 create mirva` and `npx wrangler kv namespace create FILES`, then put the two ids in `wrangler.toml`
3. `npm run cloud:schema` then `npx wrangler d1 execute mirva --remote --file worker/schema.sql`
4. `npx wrangler secret put DECART_API_KEY` (the try-on engine) and `npx wrangler secret put SETUP_KEY` (any long random text)
5. `npm run cloud:deploy`, open `/hq` on the new address, and set up the founder's sign-in with the setup key

What is different at the edge:

| | Laptop | Cloudflare |
| --- | --- | --- |
| Who may start a try-on | Anyone at the machine | Signed-in members (their monthly allowance) and paired store mirrors |
| Ceiling on a day's try-on cost | None | `MIRVA_DAILY_USD` in `wrangler.toml`, 5 dollars to begin with |
| Passwords | scrypt | PBKDF2, because a free edge request gets very little processor time |
| Throttles | In memory | In the database |
| The founder's first sign-in | Written to `.data/first-run.txt` | Made once at `/hq` with the setup key |

Still to connect before real customers rely on it: a sender for the outbox (welcome notes and
password-reset links wait at `/hq` until a person sends them), a payment provider (none;
`MIRVA_PAYMENTS` is off at the edge), a custom domain, and a lawyer's reading of `/privacy` and
`/terms`, which are drafts.

## Tests

```bash
npm test
```

102 tests. They cover the prompt builder, the stylist, and the server and platform over real
HTTP: accounts and their throttles, wardrobes kept apart between members, voting boards, the
hand-off from mirror to phone, pairing, the console and founder routes and who may call them,
security headers, cross-origin and DNS-rebinding requests, the image proxy, oversized bodies.

Checked by hand in the browser: every page at desktop and phone width, an axe accessibility
scan of each, the full member loop (sign in, portrait, keep, wardrobe, voting link, vote),
the console and founder desk, and loading a real store through "Your catalogue".

Not yet checked, because they need a real camera or a long wait: the camera countdown, the
camera picker, live Studio since the platform work, the three-minute cap, the idle pause and
the walked-away pause.

## Known limits

- The stylist is rule-based. It knows price, size and stock from the catalogue and nothing about taste beyond its rules.
- Sizes and stock are the store's online figures at snapshot time, not a branch's till. There is no link to a till.
- A portrait is a likeness. Fine embroidery and prints come out close, not exact.
- No email or WhatsApp is sent. Messages wait in the outbox.
- A store with no agreement behind it is shown as a concept demo, with a notice, and can be taken off the public list from the founder's desk.
- Payments are a test path only.
- The software counts sessions but does not yet bill extra ones or stop a fifth render in a session.
- Throttles live in memory, which suits one server process.
- The interface is in English. Urdu is not written yet.
- `scripts/build.mjs` copies the Decart SDK's worker file and the pose model beside the bundles. Without the worker a live session connects and bills but no video comes back.
