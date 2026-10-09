// What each plan costs and allows. One file, so a price change is one edit.
// Retail prices and the two shopper tiers come from the master strategy (pricing and membership sections).

export const USD_TO_PKR = 277;
export const COST = { portraitUsd: 0.02, liveUsdPerSecond: 0.02 };

// Shoppers. The free identity is the product; Private is a service tier, by invitation, to be tested later.
export const MEMBER_TIERS = {
  member: {
    id: "member",
    name: "MIRVA",
    price: 0,
    line: "Free, for good.",
    portraitsPerMonth: 6, // at most about Rs.33 a member a month at list price
    liveSecondsPerMonth: 0, // live Studio stays in stores, where the retailer pays for it
    wardrobe: 60,
    boards: 3,
    perks: [
      "Every look you keep, on your phone",
      "Your sizes remembered in every MIRVA store",
      "Six portraits a month at home",
      "Ask family and friends to vote before you buy",
    ],
  },
  private: {
    id: "private",
    name: "MIRVA Private",
    price: 30000,
    period: "year",
    byInvitation: true,
    line: "Rs.30,000 a year, by invitation.",
    portraitsPerMonth: 60,
    liveSecondsPerMonth: 120,
    wardrobe: 1000,
    boards: 50,
    perks: [
      "A booked hour with a stylist in partner stores",
      "First sight of collections that sell out",
      "Pieces held for you for 48 hours",
      "Alterations collected and delivered",
      "Sixty portraits a month, and live Studio at home",
    ],
  },
};

// Retailers, in rupees a store a month.
//
// Live video is what costs (about Rs.330 a minute against Rs.5.5 for a portrait), so a plan is an allowance of live
// minutes and portraits a month, not of "sessions". Assist is the way in: the stylist and portraits on tablets the store
// already owns. The mirror is the product: live Studio only happens there, and everything a store would show off comes
// with it. The mirror itself stays MIRVA's: the store pays an installation fee and the first months in advance, which
// covers the build, and MIRVA maintains it and takes it back if the store leaves.
export const RETAIL_PLANS = {
  assist: {
    id: "assist",
    name: "Assist",
    monthly: 25000,
    monthlyFromTenth: 20000,
    install: 0,
    advanceMonths: 1,
    termMonths: 1,
    mirrors: 0,
    liveMinutes: 0,
    portraits: 600,
    hardware: "Your own tablets",
    fit: "The way in. The stylist and portraits on a staff tablet and the shopper's phone.",
    perks: ["The stylist, on your own catalogue", "A portrait of the shopper in the piece", "Kept looks, the code to her phone and the family vote", "Month to month"],
  },
  studio: {
    id: "studio",
    name: "Mirror",
    monthly: 95000,
    install: 180000,
    advanceMonths: 3,
    termMonths: 12,
    mirrors: 1,
    liveMinutes: 70,
    portraits: 2500,
    hardware: "One oval mirror, ours to maintain",
    fit: "Formal wear, tailoring and any store with one place shoppers stop. Live Studio in the mirror, plus Assist.",
    perks: ["Live Studio: the piece on the shopper, in the mirror", "Your name and colours on the glass", "A training session and a weekend support line", "A place on the list of MIRVA mirrors"],
  },
  flagship: {
    id: "flagship",
    name: "Flagship",
    monthly: 195000,
    install: 360000,
    advanceMonths: 3,
    termMonths: 12,
    mirrors: 2,
    liveMinutes: 150,
    portraits: 6000,
    hardware: "Two oval mirrors and two tablets, ours to maintain",
    fit: "The largest stores. Two mirrors, and first sight of everything new.",
    perks: ["Everything in Mirror, twice", "The only MIRVA mirror in your category and area for six months", "A quarterly review of what shoppers tried and left", "New features first"],
  },
  results: {
    id: "results",
    name: "Results",
    monthly: 25000,
    share: 0.03,
    cap: 250000,
    install: 0,
    advanceMonths: 1,
    termMonths: 1,
    mirrors: 0,
    liveMinutes: 0,
    portraits: 600,
    hardware: "Your own tablets",
    fit: "Chains that would rather pay on sales. Assist, with the fee tied to what is counted at the till.",
    perks: ["Everything in Assist", "3% of sales counted through MIRVA, never more than the cap"],
  },
};
// A store signed on an older plan name is read as the plan that took its place.
const RENAMED = { boutique: "results" };
export const planOf = (id) => RETAIL_PLANS[RENAMED[id] || id] || null;

// Live minutes past the plan's own, bought in blocks, and catalogue imaging.
export const EXTRAS = { liveMinutePkr: 600, liveBlockMinutes: 20, imagingPerProduct: 150 };

// A tester is a member the founder has marked for unrestricted trying-on while the product is being
// proven. It is not offered to anyone and is not in the public list of tiers.
const TESTER = {
  ...MEMBER_TIERS.private,
  id: "tester",
  name: "MIRVA tester",
  line: "Unlimited, for testing.",
  unlimited: true,
  portraitsPerMonth: 100000,
  liveSecondsPerMonth: 100000,
};

export const tierOf = (user) => {
  if (!user) return MEMBER_TIERS.member;
  if (user.tier === "tester") return TESTER;
  if (user.tier === "private" && (!user.tier_until || user.tier_until > Date.now())) return MEMBER_TIERS.private;
  return MEMBER_TIERS.member;
};

// Monthly fee for a retailer with a number of stores on one plan.
export function monthlyFee(planId, stores = 1) {
  const plan = planOf(planId);
  if (!plan) return 0;
  const n = Math.max(1, Math.round(stores));
  if (plan.monthlyFromTenth && n >= 10) return 9 * plan.monthly + (n - 9) * plan.monthlyFromTenth;
  return n * plan.monthly;
}

export const monthStart = (now = Date.now()) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

// The start of the Pakistan day (UTC+5 all year) that `now` falls in, as a UTC millisecond stamp.
export const pktDayStart = (now = Date.now()) => Math.floor((now + 5 * 3600e3) / 86400e3) * 86400e3 - 5 * 3600e3;

// What a store's mirror may spend. A paired mirror is not held to a member's allowance, so these are its ceilings.
// The store can change the first two from its console (retailers.settings), inside the bounds here.
export const MIRROR = {
  dailyUsd: 8, // try-on spend one mirror may run up in a Pakistan day
  dailyUsdMin: 1,
  dailyUsdMaxRetailer: 20, // what a store may set for itself
  dailyUsdMaxFounder: 200,
  extraLiveMax: 600, // live minutes past its plan's that a store may agree to pay for in a month
  perHour: 40, // try-ons one mirror may start in an hour
  liveFloorSeconds: 15, // a live look shorter than this is not worth starting
  meterSlackSeconds: 20, // what a live look's length may differ from the clock before the meter stops trusting the mirror
};

// How one shopper's visit at a store mirror is shaped. The page enforces it; the server only hands it over.
// retailers.settings.visit may change any of these for a store.
export const VISIT = { liveLooks: 4, liveSeconds: 240, portraits: 8, resetSeconds: 60, idleSeconds: 45 };
