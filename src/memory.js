// Style memory. In the prototype it lives in this browser only; nothing leaves the device.
// Kept looks belong to whoever is signed in on this browser, so two people sharing a laptop never see each other's.
let owner = "";
export const setOwner = (id) => void (owner = id || "");
const key = (brandId) => `mirva:memory:${brandId}${owner ? ":" + owner : ""}`;
const fresh = () => ({ visits: 0, size: null, saved: [], brief: null });
const MAX_KEPT = 8;

// A paired store mirror remembers nothing between shoppers: a kept look carries a small picture of her.
let storeMirror = false;
export const setStoreMirror = (on) => void (storeMirror = !!on);

export function load(brandId) {
  if (storeMirror) return forget(brandId), fresh();
  try {
    return { ...fresh(), ...(JSON.parse(localStorage.getItem(key(brandId))) || {}) };
  } catch {
    return fresh();
  }
}

export function store(brandId, memory) {
  try {
    memory.saved = memory.saved.slice(0, MAX_KEPT);
    if (storeMirror) return;
    localStorage.setItem(key(brandId), JSON.stringify(memory));
  } catch {
    // Storage full or blocked: keep working, just without memory.
  }
}

export function forget(brandId) {
  try {
    localStorage.removeItem(key(brandId));
  } catch {}
}

export const lastBrand = {
  get: () => {
    try {
      return localStorage.getItem("mirva:brand");
    } catch {
      return null;
    }
  },
  set: (id) => {
    try {
      localStorage.setItem("mirva:brand", id);
    } catch {}
  },
};
