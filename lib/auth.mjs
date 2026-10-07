// Accounts: password hashing, sessions, and the throttles that protect both.
import { scrypt, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { Buffer } from "node:buffer";
import { cookies } from "./http.mjs";

const kdf = promisify(scrypt);
const N = 1 << 15; // scrypt work factor: about 80 ms on a laptop
const MAXMEM = 96 * 1024 * 1024;
const PBKDF2_ROUNDS = 100000; // the most Cloudflare's runtime allows

const b64 = (bytes) => Buffer.from(bytes).toString("base64url");

// PBKDF2 through the web's own crypto, which every runtime has and which runs natively.
async function pbkdf2(password, salt, rounds) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return Buffer.from(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, key, 256));
}

// Two schemes. scrypt on a machine with memory to spare; PBKDF2 at the edge, where a request
// gets a few milliseconds of processor. A stored hash says which one made it, so both verify anywhere.
export async function hashPassword(password, scheme = "scrypt") {
  const salt = randomBytes(16);
  const plain = String(password).normalize("NFKC");
  if (scheme === "pbkdf2") return ["p1", PBKDF2_ROUNDS, b64(salt), b64(await pbkdf2(plain, salt, PBKDF2_ROUNDS))].join("$");
  const key = await kdf(plain, salt, 32, { N, r: 8, p: 1, maxmem: MAXMEM });
  return ["s1", N, b64(salt), b64(key)].join("$");
}

export async function verifyPassword(password, stored) {
  const [v, n, salt, hash] = String(stored || "").split("$");
  if (!salt || !hash || (v !== "s1" && v !== "p1")) return false;
  const want = Buffer.from(hash, "base64url");
  const plain = String(password).normalize("NFKC");
  const saltBytes = Buffer.from(salt, "base64url");
  let got;
  try {
    got = v === "p1" ? await pbkdf2(plain, saltBytes, Math.min(Number(n) || PBKDF2_ROUNDS, PBKDF2_ROUNDS)) : await kdf(plain, saltBytes, want.length, { N: Number(n) || N, r: 8, p: 1, maxmem: MAXMEM });
  } catch {
    return false;
  }
  return got.length === want.length && timingSafeEqual(got, want);
}

// A fixed hash to compare against when the email is unknown, so a miss takes as long as a hit.
const decoys = {};
export const decoyHash = async (scheme = "scrypt") => (decoys[scheme] ||= await hashPassword(randomBytes(12).toString("hex"), scheme));

const COMMON = new Set(["password", "password1", "password123", "1234567890", "qwertyuiop", "0123456789", "iloveyou12", "pakistan123", "mirva12345"]);
// Length over rules: ten characters, not a famous one, not the email itself.
export function passwordProblem(password, emailAddress = "") {
  const p = String(password || "");
  if (p.length < 10) return "Use at least ten characters.";
  if (p.length > 200) return "That password is too long.";
  if (COMMON.has(p.toLowerCase())) return "That one is too easy to guess.";
  if (emailAddress && p.toLowerCase() === emailAddress.toLowerCase()) return "Don't use your email as your password.";
  return "";
}

export const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

const COOKIE = "mirva_sid";
const DAY = 86400e3;
const LIFE = { member: 30 * DAY, retailer: 7 * DAY, founder: 7 * DAY };

/** Starts a session and returns the Set-Cookie line for it. Only the token's hash is stored. */
export async function startSession(db, user, request, secure) {
  const token = newToken();
  const now = Date.now();
  const life = LIFE[user.role] || DAY;
  await db.run("INSERT INTO sessions (hash, user, created, expires, agent) VALUES (?,?,?,?,?)", sha(token), user.id, now, now + life, String(request.headers.get("user-agent") || "").slice(0, 200));
  await db.run("UPDATE users SET seen = ? WHERE id = ?", now, user.id);
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(life / 1000)}${secure ? "; Secure" : ""}`;
}

export async function endSession(db, request, secure) {
  const token = cookies(request)[COOKIE];
  if (token) await db.run("DELETE FROM sessions WHERE hash = ?", sha(token));
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export async function currentUser(db, request) {
  const token = cookies(request)[COOKIE];
  if (!token || token.length > 100) return null;
  return (await db.get("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user WHERE s.hash = ? AND s.expires > ?", sha(token), Date.now())) || null;
}

// Sliding-window throttle kept in memory. Right for one process on one machine.
// At the edge there is no lasting memory, so the same three calls are answered from the database instead.
export function memoryLimiter() {
  const buckets = new Map();
  let calls = 0;
  const recent = (key, windowMs) => {
    const now = Date.now();
    if (++calls % 500 === 0) for (const [k, list] of buckets) if (!list.length || now - list[list.length - 1] > 3600e3) buckets.delete(k);
    const list = (buckets.get(key) || []).filter((t) => now - t < windowMs);
    buckets.set(key, list);
    return list;
  };
  return {
    async limit(key, max, windowMs) {
      const list = recent(key, windowMs);
      if (list.length >= max) return false;
      list.push(Date.now());
      return true;
    },
    // The same window, in two steps: ask first, and count only what went wrong.
    async blocked(key, max, windowMs) {
      return recent(key, windowMs).length >= max;
    },
    async strike(key) {
      const list = buckets.get(key) || [];
      list.push(Date.now());
      buckets.set(key, list);
    },
  };
}

export function databaseLimiter(db) {
  const count = async (key, windowMs) => Number((await db.get("SELECT COUNT(*) AS n FROM hits WHERE key = ? AND at > ?", key, Date.now() - windowMs))?.n) || 0;
  const strike = (key) => db.run("INSERT INTO hits (key, at) VALUES (?, ?)", key, Date.now());
  return {
    async limit(key, max, windowMs) {
      if ((await count(key, windowMs)) >= max) return false;
      await strike(key);
      return true;
    },
    blocked: async (key, max, windowMs) => (await count(key, windowMs)) >= max,
    strike,
    sweep: () => db.run("DELETE FROM hits WHERE at < ?", Date.now() - 2 * 3600e3),
  };
}
