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
export const RETAIL_PLANS = {
  assist: {
    id: "assist",
    name: "Assist",
    monthly: 35000,
    monthlyFromTenth: 25000,
    setup: 0,
    sessions: 300,
    hardware: "Your own tablets",
    fit: "Chain stores. The stylist on a staff tablet and the shopper's phone.",
  },
  studio: {
    id: "studio",
    name: "Studio",
    monthly: 95000,
    setup: 250000,
    sessions: 600,
    hardware: "Mirror, leased",
    fit: "Flagships and formal-wear stores. The mirror, plus Assist.",
  },
  flagship: {
    id: "flagship",
    name: "Flagship",
    monthly: 160000,
    setup: 400000,
    sessions: 1500,
    hardware: "65 inch mirror and two tablets, leased",
    fit: "The largest stores.",
  },
  boutique: {
    id: "boutique",
    name: "Boutique",
    monthly: 50000,
    share: 0.02,
    cap: 200000,
    setup: 150000,
    sessions: 400,
    hardware: "Mirror, leased",
    fit: "Owner-led stores with tickets above Rs.20,000.",
  },
};

export const EXTRAS = { sessionOverage: 90, imagingPerProduct: 150 };

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
  const plan = RETAIL_PLANS[planId];
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
  overageMax: 10000, // sessions past the allowance a store may agree to pay for
  perHour: 40, // try-ons one mirror may start in an hour
  liveFloorSeconds: 15, // a live look shorter than this is not worth starting
  meterSlackSeconds: 20, // what a live look's length may differ from the clock before the meter stops trusting the mirror
};

// How one shopper's visit at a store mirror is shaped. The page enforces it; the server only hands it over.
// retailers.settings.visit may change any of these for a store.
export const VISIT = { liveLooks: 4, liveSeconds: 240, portraits: 8, resetSeconds: 60, idleSeconds: 45 };
