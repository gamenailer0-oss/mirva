// The shape of MIRVA's store. Plain SQLite, so the same text builds the database on a laptop and on Cloudflare D1.
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
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT,
  action TEXT NOT NULL,
  target TEXT,
  ip TEXT
);
`;
