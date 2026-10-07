// One real portrait on a running MIRVA, as a throwaway member, then the member is removed.
// Costs about $0.02:  node scripts/live-portrait-check.mjs https://address path/to/person.jpg
const base = process.argv[2].replace(/\/+$/, "");
const { readFileSync } = await import("node:fs");
const person = new Blob([readFileSync(process.argv[3])], { type: "image/jpeg" });
let cookie = "";
const call = async (path, init = {}) => {
  const res = await fetch(base + path, { ...init, headers: { origin: base, cookie, ...(init.headers || {}) } });
  const set = res.headers.getSetCookie?.()[0];
  if (set) cookie = set.split(";")[0];
  return res;
};
const json = (path, body) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const stamp = Date.now().toString(36);
const password = `portrait check ${stamp} passphrase`;
const joined = await json("/api/auth/join", { name: "Portrait Check", email: `check-${stamp}@example.com`, password, agree: true });
console.log("join", joined.status);
const store = (await (await call("/api/brands")).json())[0];
const product = (await (await call("/api/brands/" + store.id)).json()).catalogue.products[0];
const reference = await (await call(`/img?u=${encodeURIComponent(product.image)}&w=768`)).blob();
const form = new FormData();
form.append("person", person, "person.jpg");
form.append("reference", new Blob([await reference.arrayBuffer()], { type: "image/jpeg" }), "garment.jpg");
form.append("brand", store.id);
form.append("product", product.id);
form.append("mode", "portrait");
const t = Date.now();
const shot = await call("/api/model-shot", { method: "POST", body: form });
const bytes = (await shot.arrayBuffer()).byteLength;
console.log("portrait", shot.status, shot.headers.get("content-type"), bytes, "bytes", ((Date.now() - t) / 1000).toFixed(1) + "s", "saved:", !!shot.headers.get("x-mirva-portrait"));
if (shot.status === 200) {
  const kept = await json("/api/wardrobe", { brand: store.id, product: product.id, portrait: shot.headers.get("x-mirva-portrait") });
  const look = (await kept.json()).look;
  const pic = await call(look.portrait);
  console.log("kept in wardrobe", kept.status, "portrait served", pic.status, (await pic.arrayBuffer()).byteLength, "bytes");
}
const me = await (await call("/api/me")).json();
console.log("portraits used this month", me.usage?.portraits);
console.log("removed test member", (await json("/api/me/delete", { password })).status);
