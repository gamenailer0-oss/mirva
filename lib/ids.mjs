// Ids, codes people read off a screen, and safe JSON reading. No runtime-specific imports beyond crypto.
import { randomBytes, randomInt } from "node:crypto";

export const newId = (bytes = 12) => randomBytes(bytes).toString("base64url");

// Codes a person reads off a screen: no 0/O, 1/I/L.
const READABLE = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const newCode = (length = 8) => Array.from({ length }, () => READABLE[randomInt(READABLE.length)]).join("");

export const parse = (s, fallback = {}) => {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
};
