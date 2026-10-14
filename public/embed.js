/* MIRVA for a store's own website: "Try it on" beside the product, opening the MIRVA mirror for that piece in a sheet.
 *
 *   <script src="https://<mirva address>/embed.js" data-store="yourstore" async></script>
 *
 * Put it anywhere in the theme (on Shopify: theme.liquid, before </body>). On a product page it finds the piece and
 * places the button after the add-to-cart form, or inside an element marked data-mirva-button. Optional:
 *   data-product="ID"      the piece, when the page cannot tell (or data-mirva-product="ID" on any element)
 *   data-theme="light"     a light button for a dark page
 * The store names its website in the MIRVA console first; MIRVA answers only the websites a store has named.
 */
(() => {
  const me = document.currentScript;
  const store = me && me.dataset.store;
  if (!store || window.__mirvaEmbed) return;
  window.__mirvaEmbed = true;
  const home = new URL(me.src).origin;
  const light = me.dataset.theme === "light";

  // ---- which piece is this page for
  const productId = () => {
    const marked = me.dataset.product || document.querySelector("[data-mirva-product]")?.getAttribute("data-mirva-product");
    if (marked) return String(marked);
    const shopify = window.ShopifyAnalytics?.meta?.product?.id || window.meta?.product?.id;
    if (shopify) return String(shopify);
    const woo = document.querySelector("form.cart [name=add-to-cart]")?.value || document.querySelector("form.cart [data-product_id]")?.getAttribute("data-product_id");
    if (woo) return String(woo);
    const post = document.body.className.match(/\bpostid-(\d+)\b/);
    return document.body.classList.contains("single-product") && post ? post[1] : "";
  };
  const spot = () => {
    const marked = document.querySelector("[data-mirva-button]");
    if (marked) return { into: marked };
    const form = document.querySelector('form[action*="/cart/add"]:not([action*="/cart/add.js"])') || document.querySelector("form.cart");
    return form ? { after: form } : null;
  };

  // ---- the button, in its own shadow so the theme's styles never reach it
  const MARK = '<svg viewBox="0 0 32 40" width="14" height="18" aria-hidden="true"><rect x="8" y="12" width="16" height="25" rx="8" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M3 13Q16 0 29 13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  function button(pid) {
    const host = document.createElement("div");
    host.setAttribute("data-mirva", "");
    host.style.margin = "12px 0";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 48px; padding: 0 22px;
        border-radius: 999px; cursor: pointer; font: 500 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: .14em; text-transform: uppercase;
        background: ${light ? "#f3f5f9" : "#0a0c11"}; color: ${light ? "#0a0c11" : "#f3f5f9"}; box-shadow: inset 0 0 0 1px ${light ? "rgba(10,12,17,.12)" : "rgba(255,255,255,.12)"}; transition: transform .15s ease, opacity .15s ease; }
      button:hover { transform: translateY(-1px); } button:active { transform: scale(.98); }
      button:focus-visible { outline: 2px solid ${light ? "#0a0c11" : "#8d95a6"}; outline-offset: 3px; }
      button[aria-busy="true"] { opacity: .6; pointer-events: none; }
      small { display: block; margin-top: 6px; text-align: center; font: 400 11px/1.3 system-ui, sans-serif; color: #8d95a6; letter-spacing: .02em; text-transform: none; }
    </style><button type="button">${MARK}<span>Try it on</span></button><small>See yourself in it, with MIRVA</small>`;
    const b = root.querySelector("button");
    b.addEventListener("click", () => open(pid, b));
    return host;
  }

  // ---- the sheet
  let sheet = null;
  async function open(pid, from) {
    if (sheet) return;
    from.setAttribute("aria-busy", "true");
    let pass;
    try {
      const res = await fetch(home + "/api/embed/session", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ store }), credentials: "omit" });
      pass = await res.json();
      if (!res.ok) throw new Error(pass.error || "MIRVA is resting.");
    } catch (e) {
      from.removeAttribute("aria-busy");
      from.querySelector("span").textContent = "Try again in a moment";
      console.warn("MIRVA:", e.message || e);
      return;
    }
    from.removeAttribute("aria-busy");
    const wide = matchMedia("(min-width: 700px)").matches;
    sheet = document.createElement("div");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", "Try it on with MIRVA");
    sheet.style.cssText = "position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:rgba(6,8,12,.72);opacity:0;transition:opacity .2s ease";
    const box = document.createElement("div");
    box.style.cssText = wide
      ? "position:relative;width:min(460px,94vw);height:min(860px,92vh);border-radius:24px;overflow:hidden;background:#06070a;box-shadow:0 40px 120px -30px rgba(0,0,0,.8)"
      : "position:relative;width:100vw;height:100dvh;background:#06070a";
    const frame = document.createElement("iframe");
    frame.src = pass.mirror + (pid ? "&p=" + encodeURIComponent(pid) : "");
    frame.title = "MIRVA mirror";
    frame.allow = "camera; fullscreen";
    frame.style.cssText = "border:0;width:100%;height:100%;display:block;background:#06070a";
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    close.style.cssText = "position:absolute;top:calc(10px + env(safe-area-inset-top));right:10px;z-index:2;width:40px;height:40px;border:0;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(10,12,17,.72);color:#f3f5f9;backdrop-filter:blur(8px)";
    box.append(frame, close);
    sheet.append(box);
    const scroll = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const shut = () => {
      if (!sheet) return;
      sheet.remove();
      sheet = null;
      document.documentElement.style.overflow = scroll;
      removeEventListener("keydown", onKey);
      from.focus();
    };
    const onKey = (e) => e.key === "Escape" && shut();
    close.addEventListener("click", shut);
    sheet.addEventListener("click", (e) => e.target === sheet && shut());
    addEventListener("keydown", onKey);
    document.body.append(sheet);
    requestAnimationFrame(() => (sheet.style.opacity = "1"));
    close.focus();
  }

  // ---- put it on the page (themes that build the product form late are given a moment)
  let tries = 0;
  const place = () => {
    if (document.querySelector("[data-mirva]")) return;
    const pid = productId();
    const where = spot();
    if (!where || (!pid && !where.into)) return void (++tries < 10 && setTimeout(place, 500));
    const b = button(pid);
    if (where.into) where.into.append(b);
    else where.after.insertAdjacentElement("afterend", b);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", place);
  else place();
})();
