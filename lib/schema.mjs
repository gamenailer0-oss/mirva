// The shape of MIRVA's store. Plain SQLite, so the same text builds the database on a laptop and on Cloudflare D1.
// Tables added after the first deploy. They are in SCHEMA for a new database, and migrate() makes them on one
// that already exists (D1 is never rebuilt from SCHEMA once it holds data).
export const LATER = [
  `-- What a member or the founder is told: a vote came in, a question closes tomorrow, a store wrote in.
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  url TEXT,
  seen INTEGER NOT NULL DEFAULT 0
);`,
  `CREATE INDEX IF NOT EXISTS notes_user ON notes(user, at);`,
  `-- The phones that asked to be told. Only push services' own addresses are kept (lib/push.mjs).
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  agent TEXT
);`,
  `-- A pass a store's own website was given, to open the mirror for one of its shoppers (public/embed.js).
CREATE TABLE IF NOT EXISTS embed_passes (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  origin TEXT NOT NULL,
  at INTEGER NOT NULL
);`,
  `-- Shoppers who asked to hear when a MIRVA mirror opens near them, and which store they hope for.
CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  city TEXT NOT NULL,
  area TEXT,
  store TEXT,
  contact TEXT,
  user TEXT
);`,
  `-- A portrait made before she joined: held for half an hour so joining can keep it.
CREATE TABLE IF NOT EXISTS guest_shots (
  id TEXT PRIMARY KEY,
  guest TEXT NOT NULL,
  ip TEXT,
  brand TEXT NOT NULL,
  product TEXT NOT NULL,
  type TEXT NOT NULL,
  at INTEGER NOT NULL,
  claimed TEXT
);`,
  `CREATE INDEX IF NOT EXISTS guest_shots_guest ON guest_shots(guest, at);`,
  `-- A look on the mirror that her phone picks up by scanning the code on the glass ("don't want to wait?" and "share it
-- with your family"). Her portrait is stored only once a phone has opened the link, and everything goes after a day.
CREATE TABLE IF NOT EXISTS pickups (
  code TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  product TEXT NOT NULL,
  device TEXT,
  user TEXT,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  opened INTEGER,
  portrait INTEGER NOT NULL DEFAULT 0
);`,
  `-- A store's monthly bill, until a payment provider is connected: issued here, paid by transfer, marked paid at /hq.
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  period TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'Rs.',
  lines TEXT NOT NULL DEFAULT '[]',
  issued INTEGER NOT NULL,
  due INTEGER NOT NULL,
  paid INTEGER,
  method TEXT,
  ref TEXT,
  status TEXT NOT NULL DEFAULT 'due',
  UNIQUE (brand, period)
);`,
  `-- Where the cloth is in a store's own photo of a piece (SAM 3 outlines, lib/finish.mjs CLOTH), found once and kept,
-- so every phone can lay the piece on white without a model of its own (src/cloth.js). image: the photo outlined.
CREATE TABLE IF NOT EXISTS cloth (
  brand TEXT NOT NULL,
  product TEXT NOT NULL,
  image TEXT NOT NULL,
  masks TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (brand, product)
);`,
];

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('member','retailer','founder')),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pass TEXT NOT NULL,
  brand TEXT,
  tier TEXT NOT NULL DEFAULT 'member',
  tier_until INTEGER,
  profile TEXT NOT NULL DEFAULT '{}',
  consent TEXT NOT NULL DEFAULT '{}',
  created INTEGER NOT NULL,
  seen INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  agent TEXT
);
CREATE TABLE IF NOT EXISTS resets (
  hash TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS portraits (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand TEXT NOT NULL,
  product TEXT NOT NULL,
  type TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS looks (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand TEXT NOT NULL,
  product TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'Rs.',
  image TEXT,
  url TEXT,
  size TEXT,
  portrait TEXT,
  source TEXT NOT NULL DEFAULT 'home',
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS looks_user ON looks(user, created);
CREATE TABLE IF NOT EXISTS boards (
  code TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  looks TEXT NOT NULL,
  created INTEGER NOT NULL,
  closes INTEGER NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS votes (
  board TEXT NOT NULL REFERENCES boards(code) ON DELETE CASCADE,
  voter TEXT NOT NULL,
  look TEXT NOT NULL,
  name TEXT,
  created INTEGER NOT NULL,
  PRIMARY KEY (board, voter)
);
CREATE TABLE IF NOT EXISTS handoffs (
  code TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  device TEXT,
  payload TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  claimed TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  brand TEXT NOT NULL,
  device TEXT,
  visit TEXT,
  user TEXT,
  kind TEXT NOT NULL,
  product TEXT,
  value REAL,
  meta TEXT,
  sample INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS events_brand ON events(brand, at);
-- What a store's console counts: its own mirrors and the labelled sample, not members trying looks at home.
CREATE VIEW IF NOT EXISTS store_events AS SELECT * FROM events WHERE sample < 2;
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  brand TEXT,
  device TEXT,
  user TEXT,
  seconds REAL NOT NULL DEFAULT 0,
  usd REAL NOT NULL DEFAULT 0,
  sample INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS usage_at ON usage(at);
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  role TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  city TEXT,
  stores INTEGER,
  segment TEXT,
  plan TEXT,
  message TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT NOT NULL DEFAULT '',
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS retailers (
  brand TEXT PRIMARY KEY,
  plan TEXT NOT NULL,
  stores INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pilot',
  started INTEGER NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  brand TEXT NOT NULL,
  name TEXT NOT NULL,
  store TEXT,
  token TEXT,
  pair_code TEXT,
  pair_expires INTEGER,
  paired INTEGER,
  seen INTEGER,
  created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at INTEGER NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'waiting',
  decided INTEGER
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  user TEXT NOT NULL,
  at INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  what TEXT
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent INTEGER
);
-- Throttle counters, used where the server has no lasting memory of its own.
CREATE TABLE IF NOT EXISTS hits (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hits_key ON hits(key, at);
-- Stores loaded at the edge: the list lives here, each catalogue in the file store.
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
-- Small standing facts the founder's desk shows until they stop being true, for example that the try-on account is out of credit.
CREATE TABLE IF NOT EXISTS flags (
  key TEXT PRIMARY KEY,
  value TEXT,
  at INTEGER
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  target TEXT,
  ip TEXT
);
${LATER.join("\n")}
`;

// Columns added to tables that were already live: [table, column, definition].
export const COLUMNS = [
  ["boards", "occasion", "TEXT"],
  ["boards", "pictures", "TEXT NOT NULL DEFAULT 'mine'"],
  ["boards", "decided", "TEXT"],
  ["boards", "cover", "INTEGER NOT NULL DEFAULT 0"],
  ["boards", "reminded", "INTEGER"],
  ["votes", "note", "TEXT"],
];
// Made from the text of LATER and COLUMNS: any new table or column changes it, so migrate() always runs after one is added.
export const SCHEMA_VERSION = "s-" + [...JSON.stringify([LATER, COLUMNS])].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7).toString(36);

// Brings an existing database up to SCHEMA_VERSION. Cheap when it is already there: one read.
export async function migrate(db) {
  try {
    if ((await db.get("SELECT value FROM meta WHERE key = 'schema'"))?.value === SCHEMA_VERSION) return;
  } catch {}
  await db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  for (const sql of LATER) await db.run(sql.replace(/^--.*\n/gm, ""));
  const tables = [...new Set(COLUMNS.map(([t]) => t))];
  for (const table of tables) {
    const have = new Set((await db.all(`PRAGMA table_info(${table})`)).map((c) => c.name));
    for (const [t, column, definition] of COLUMNS) if (t === table && !have.has(column)) await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  await db.run("INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", SCHEMA_VERSION);
}
