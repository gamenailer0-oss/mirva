// Notifications to a phone, through the browser's own push service (Web Push). No payload is sent: the push only
// wakes MIRVA's service worker, which asks MIRVA what is new and shows it. So nothing has to be encrypted for the
// push service, and nothing private ever passes through it. The only secret is MIRVA's own signing key (VAPID).
// Plain WebCrypto, so the same code signs on a laptop under Node and at Cloudflare's edge.

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const utf8 = (s) => new TextEncoder().encode(s);

// The push services browsers use. A subscription that points anywhere else is refused, so MIRVA's server
// can never be made to post to an address someone chose.
const SERVICES = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /^push\.services\.mozilla\.com$/];
export function pushEndpoint(v) {
  try {
    const u = new URL(String(v || ""));
    return u.protocol === "https:" && String(v).length < 1000 && SERVICES.some((re) => re.test(u.hostname)) ? u.href : "";
  } catch {
    return "";
  }
}

// A new pair of keys: the public half goes to browsers, the private half stays a secret.
export async function newPushKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return {
    publicKey: b64u(await crypto.subtle.exportKey("raw", pair.publicKey)),
    privateJwk: JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)),
  };
}

/**
 * publicKey   the VAPID public key, base64url, as browsers want it for subscribing
 * privateJwk  the private key as JSON (a JWK), kept secret
 * subject     who to tell if a push service has a problem with MIRVA (a mailto: or https: address)
 */
export function createPush({ publicKey, privateJwk, subject = "mailto:founder@mirva.local" } = {}) {
  if (!publicKey || !privateJwk) return { publicKey: "", send: async () => 0 };
  let signer = null;
  const key = async () =>
    (signer ||= crypto.subtle.importKey("jwk", typeof privateJwk === "string" ? JSON.parse(privateJwk) : privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]));
  const tokens = new Map(); // one signature per push service for most of a day

  async function token(audience) {
    const cached = tokens.get(audience);
    if (cached && cached.until > Date.now() + 60e3) return cached.jwt;
    const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
    const head = b64u(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
    const body = b64u(utf8(JSON.stringify({ aud: audience, exp, sub: subject })));
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await key(), utf8(`${head}.${body}`));
    const jwt = `${head}.${body}.${b64u(sig)}`;
    tokens.set(audience, { jwt, until: exp * 1000 });
    return jwt;
  }

  return {
    publicKey,
    // Wakes one subscription. Returns the push service's status: 201 is delivered, 404 and 410 mean it has gone.
    async send(endpoint, { ttl = 86400, urgency = "normal" } = {}) {
      const url = pushEndpoint(endpoint);
      if (!url) return 410;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { ttl: String(ttl), urgency, authorization: `vapid t=${await token(new URL(url).origin)}, k=${publicKey}`, "content-length": "0" },
          redirect: "manual",
          signal: AbortSignal.timeout(8000),
        });
        return res.status;
      } catch {
        return 0;
      }
    },
  };
}
