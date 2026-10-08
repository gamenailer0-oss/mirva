// The two calls MIRVA's server makes to the try-on engine, as plain web requests.
// (The browser uses Decart's own SDK for live video; the server only needs these.)
const BASE = "https://api.decart.ai";

const fail = async (res, what) => {
  const body = await res.text().catch(() => "");
  let detail = body;
  try {
    detail = JSON.parse(body).detail || body;
  } catch {}
  // `credit` is true when the account, not the request, is the problem: a 402, or a refusal whose own words
  // say credit, balance or quota. A busy engine (5xx, a timeout) never sets it.
  const credit = res.status === 402 || (res.status >= 400 && res.status < 500 && /credit|balance|quota/i.test(String(detail)));
  return Object.assign(new Error(`${what}: ${res.status} ${String(detail).slice(0, 200)}`), { status: res.status, credit });
};

/** A token the browser can use to start one live session, for the next minute, no longer than `seconds`. */
export async function liveToken(key, seconds) {
  const res = await fetch(`${BASE}/v1/client/tokens`, {
    method: "POST",
    headers: { "x-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ expiresIn: 60, constraints: { realtime: { maxSessionDuration: seconds } } }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw await fail(res, "token");
  return res.json(); // { apiKey, expiresAt }
}

/** One still: the person in `person`, edited by `prompt`, with an optional garment `reference`. */
export async function portrait(key, { prompt, person, reference }) {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("data", person, "person.jpg");
  if (reference) form.append("reference_image", reference, "garment.jpg");
  form.append("resolution", "720p");
  form.append("enhance_prompt", "false");
  const res = await fetch(`${BASE}/v1/generate/lucy-image-2`, { method: "POST", headers: { "x-api-key": key }, body: form, signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw await fail(res, "portrait");
  return { bytes: await res.arrayBuffer(), type: res.headers.get("content-type") || "image/png" };
}
