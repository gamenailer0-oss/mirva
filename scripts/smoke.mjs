// A walk through a running MIRVA, wherever it runs:  node scripts/smoke.mjs https://your-address [setup-key]
// It makes one throwaway member, uses what a member can use, and removes the member again.
// It never starts a try-on, so it costs nothing. With a setup key it also checks the founder's desk.
const base = (process.argv[2] || "http://localhost:4310").replace(/\/+$/, "");
const setupKey = process.argv[3] || "";
let failed = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) failed++;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
};

function client() {
  const jar = new Map();
  return async (path, body, method) => {
    const res = await fetch(base + path, {
      method: method || (body === undefined ? "GET" : "POST"),
      redirect: "manual",
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), origin: base, cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie?.() || []) {
      const [pair] = line.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const type = res.headers.get("content-type") || "";
    return { status: res.status, headers: res.headers, data: type.includes("json") ? await res.json().catch(() => ({})) : await res.text() };
  };
}

const anon = client();
for (const page of ["/", "/membership", "/account", "/privacy", "/terms", "/retail", "/console", "/hq", "/mirror"]) {
  const r = await anon(page);
  ok(`page ${page}`, r.status === 200 && String(r.data).includes("<!doctype html>"), `${r.status}`);
}
const home = await anon("/");
ok("security headers on pages", !!home.headers.get("content-security-policy") && home.headers.get("x-content-type-options") === "nosniff");
ok("a missing page is a 404 page", (await anon("/no-such-page")).status === 404);
ok("the app bundle is served", (await anon("/dist/site.js")).status === 200);
ok("health", (await anon("/api/health")).data.ok === true);
const plans = await anon("/api/plans");
ok("plans", plans.data.retail?.studio?.monthly === 95000);
ok("signed out", (await anon("/api/me")).data.user === null);
ok("wardrobe needs a sign-in", (await anon("/api/wardrobe")).status === 401);
ok("the founder's desk is closed to strangers", (await anon("/api/hq/overview")).status === 401);

const member = client();
const stamp = Date.now().toString(36);
const mail = `smoke-${stamp}@example.com`;
const password = `smoke test ${stamp} passphrase`;
const joined = await member("/api/auth/join", { name: "Smoke Test", email: mail, password, agree: true });
ok("join", joined.status === 200 && joined.data.user?.email === mail, `${joined.status} ${joined.data.error || ""}`);
const me = await member("/api/me");
ok("me", me.data.user?.role === "member" && me.data.tier?.id === "member");
ok("profile", (await member("/api/me/profile", { sizes: { top: "M" } })).data.user?.profile?.sizes?.top === "M");
const brands = await member("/api/brands");
ok("store list", Array.isArray(brands.data), `${brands.data.length} open to the public`);
if (brands.data.length) {
  const store = await member("/api/brands/" + brands.data[0].id);
  const [a, b] = store.data.catalogue.products;
  const first = await member("/api/wardrobe", { brand: brands.data[0].id, product: a.id, size: "M" });
  const second = await member("/api/wardrobe", { brand: brands.data[0].id, product: b.id });
  ok("keep two looks", first.status === 200 && second.status === 200);
  const board = await member("/api/boards", { title: "Smoke", looks: [first.data.look.id, second.data.look.id] });
  ok("ask for opinions", /^[A-Z0-9]{10}$/.test(board.data.code || ""), board.data.error || "");
  const guest = client();
  ok("a guest sees the question", (await guest("/api/board/" + board.data.code)).data.looks?.length === 2);
  ok("a guest votes", (await guest(`/api/board/${board.data.code}/vote`, { look: first.data.look.id, name: "Guest" })).data.voted === first.data.look.id);
  ok("the board page opens", (await guest("/b/" + board.data.code)).status === 200);
}
const lead = await anon("/api/leads", { name: "Smoke Test", company: "Smoke Test Store", email: mail, stores: 1, source: "smoke test" });
ok("an enquiry is taken", !!lead.data.id, lead.data.error || "");
ok("export", (await member("/api/me/export", {})).data.account?.email === mail);
ok("delete the test member", (await member("/api/me/delete", { password })).status === 200);
ok("gone", (await member("/api/me")).data.user === null);

if (setupKey) {
  const founder = client();
  const fMail = process.argv[4] || "founder@mirva.local";
  const fPass = process.argv[5] || "";
  if (fPass) {
    const inn = await founder("/api/auth/signin", { email: fMail, password: fPass });
    ok("founder signs in", inn.status === 200, inn.data.error || "");
    const desk = await founder("/api/hq/overview");
    ok("founder's desk", desk.status === 200 && typeof desk.data.members?.total === "number");
    ok("the smoke enquiry is on the desk", (await founder("/api/hq/leads")).data.leads?.some((l) => l.source === "smoke test"));
  }
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
