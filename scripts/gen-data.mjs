#!/usr/bin/env node
// ---------------------------------------------------------------------------
// gen-data.mjs — generates the mock dataset for the Brand Ad-Spend dashboard.
//
// Writes:
//   public/data/*.json     canonical mock data (served by the Worker / any http server)
//   public/js/seed.js      a classic <script> mirror of the same data, so the site
//                          also works when opened directly as a file:// URL, where
//                          browsers block fetch() of local files.
//
// This is a dev convenience only — the site needs no build step to run. Re-run
// with `node scripts/gen-data.mjs` after editing the anchors below.
// ---------------------------------------------------------------------------
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'public', 'data');
const JS_DIR = join(ROOT, 'public', 'js');
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(JS_DIR, { recursive: true });

// Deterministic tiny PRNG so output is stable across runs -------------------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 0) => { const p = 10 ** d; return Math.round(v * p) / p; };

// ---------------------------------------------------------------------------
// 1) meta — the 6 brands with fixed id / name / signature colour / group / quality
// ---------------------------------------------------------------------------
const BRANDS = [
  { id: 'aquaguard',   name: 'Aquaguard',     color: '#0ea5e9', group: 'Eureka Forbes',   quality: 'disclosed' },
  { id: 'eurekaforbes',name: 'Eureka Forbes', color: '#6366f1', group: 'Eureka Forbes',   quality: 'disclosed' },
  { id: 'kent',        name: 'Kent',          color: '#10b981', group: '',                 quality: 'snapshot'  },
  { id: 'livpure',     name: 'Livpure',       color: '#f59e0b', group: '',                 quality: 'estimated' },
  { id: 'pureit',      name: 'Pureit',        color: '#8b5cf6', group: 'A.O. Smith group', quality: 'estimated' },
  { id: 'aosmith',     name: 'AO Smith',      color: '#f43f5e', group: 'A.O. Smith group', quality: 'estimated' },
];
const IDS = BRANDS.map((b) => b.id);

const meta = {
  lastUpdated: '2026-08-29',
  category: 'India water purifiers',
  brands: BRANDS,
  // per-brand note explaining the spend-quality badge, shown on hover
  qualityNotes: {
    disclosed: 'From the company / parent audited annual report.',
    snapshot: 'From a point-in-time filing; not a full multi-year series.',
    estimated: 'Modelled estimate — no public brand-level disclosure.',
  },
};

// ---------------------------------------------------------------------------
// 2) spend — per brand, FY22..FY26: revenue, advertisement, sellingPromo, quality
//    (all figures Rs crore). Real anchors used exactly; the rest are plausible.
// ---------------------------------------------------------------------------
const YEARS = ['FY22', 'FY23', 'FY24', 'FY25', 'FY26'];
const S = (year, revenue, advertisement, sellingPromo, quality) =>
  ({ year, revenue, advertisement, sellingPromo, quality });

const spendRaw = {
  // Eureka Forbes Ltd (real): FY23 adv 76 / promo 114; FY24 adv 87 / promo 120;
  // FY25 A&SP total 259 (split est. 104/155); FY22 & FY26 estimated.
  eurekaforbes: [
    S('FY22', 2010, 70, 105, 'estimated'),
    S('FY23', 2080, 76, 114, 'disclosed'),
    S('FY24', 2189, 87, 120, 'disclosed'),
    S('FY25', 2436, 104, 155, 'estimated'),
    S('FY26', 2710, 120, 180, 'estimated'),
  ],
  // Aquaguard is Eureka Forbes' flagship brand — spend disclosed via the parent.
  aquaguard: [
    S('FY22', 2010, 70, 105, 'estimated'),
    S('FY23', 2080, 76, 114, 'disclosed'),
    S('FY24', 2189, 87, 120, 'disclosed'),
    S('FY25', 2436, 104, 155, 'estimated'),
    S('FY26', 2710, 120, 180, 'estimated'),
  ],
  // Kent (snapshot): FY23 rev 1084, FY24 rev 1178; ad spend ~9.5% of revenue.
  kent: [
    S('FY22', 980, 51, 42, 'estimated'),
    S('FY23', 1084, 57, 46, 'snapshot'),
    S('FY24', 1178, 62, 50, 'snapshot'),
    S('FY25', 1260, 66, 54, 'estimated'),
    S('FY26', 1350, 71, 57, 'estimated'),
  ],
  // Livpure: FY22 rev 216, FY23 rev 294 (loss-making); spend estimated.
  livpure: [
    S('FY22', 216, 13, 15, 'estimated'),
    S('FY23', 294, 17, 21, 'estimated'),
    S('FY24', 380, 22, 27, 'estimated'),
    S('FY25', 470, 27, 34, 'estimated'),
    S('FY26', 560, 33, 40, 'estimated'),
  ],
  // Pureit: ~Rs 293 cr turnover; estimated.
  pureit: [
    S('FY22', 250, 10, 10, 'estimated'),
    S('FY23', 270, 11, 11, 'estimated'),
    S('FY24', 293, 12, 11, 'estimated'),
    S('FY25', 310, 13, 12, 'estimated'),
    S('FY26', 330, 13, 13, 'estimated'),
  ],
  // AO Smith: ~Rs 500 cr band; estimated.
  aosmith: [
    S('FY22', 420, 15, 14, 'estimated'),
    S('FY23', 460, 16, 16, 'estimated'),
    S('FY24', 500, 18, 17, 'estimated'),
    S('FY25', 540, 19, 19, 'estimated'),
    S('FY26', 580, 21, 20, 'estimated'),
  ],
};
const spend = { years: YEARS, byBrand: spendRaw };

// ---------------------------------------------------------------------------
// 3) search-trends — 5 FY x 4 quarters, 0..100, summer (Apr-Jun => FY Q1) peaks
// ---------------------------------------------------------------------------
const FYq = [];
for (const fy of ['FY22', 'FY23', 'FY24', 'FY25', 'FY26']) for (const q of [1, 2, 3, 4]) FYq.push(`${fy} Q${q}`);
// seasonality by fiscal quarter: Q1 Apr-Jun (peak), Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar
const SEASON = { 1: 1.0, 2: 0.4, 3: 0.15, 4: 0.5 };
const searchParams = {
  aquaguard:    { base: 55, peak: 88, trend: 0.30 },
  kent:         { base: 52, peak: 84, trend: -0.15 },
  eurekaforbes: { base: 40, peak: 60, trend: 0.02 },
  pureit:       { base: 38, peak: 58, trend: -0.20 },
  aosmith:      { base: 30, peak: 45, trend: 0.20 },
  livpure:      { base: 20, peak: 35, trend: 0.50 },
};
function makeSearch(p, seed) {
  const rnd = mulberry32(seed);
  return FYq.map((label, i) => {
    const q = Number(label.slice(-1));
    const seasonal = SEASON[q];
    const noise = (rnd() - 0.5) * 6;
    const v = p.base + (p.peak - p.base) * seasonal + p.trend * i + noise;
    return round(clamp(v, 5, 100));
  });
}
const searchByBrand = {};
IDS.forEach((id, i) => { searchByBrand[id] = makeSearch(searchParams[id], 1000 + i); });
// generic "water purifier" category term — strong summer spikes
const category = FYq.map((label, i) => {
  const q = Number(label.slice(-1));
  const rnd = mulberry32(777 + i);
  return round(clamp(45 + (92 - 45) * SEASON[q] + 0.05 * i + (rnd() - 0.5) * 5, 5, 100));
});
const searchTrends = { quarters: FYq, byBrand: searchByBrand, category, categoryLabel: '“water purifier”' };

// ---------------------------------------------------------------------------
// 4) social — followers per platform + engagement rate + growth series
// ---------------------------------------------------------------------------
const socialAnchors = {
  aquaguard:    { youtube: 93600, instagram: 122000, facebook: 573000, engagementRate: 1.9 },
  eurekaforbes: { youtube: 90000, instagram: 118000, facebook: 560000, engagementRate: 1.5 },
  kent:         { youtube: 49600, instagram: 81000,  facebook: 1200000, engagementRate: 0.8 },
  livpure:      { youtube: 15600, instagram: 69000,  facebook: 150000, engagementRate: 2.4 },
  pureit:       { youtube: 22000, instagram: 11000,  facebook: 141000, engagementRate: 1.1 },
  aosmith:      { youtube: 12000, instagram: 15000,  facebook: 70000,  engagementRate: 1.3 },
};
const GROWTH_Q = ["Q1'25", "Q2'25", "Q3'25", "Q4'25", "Q1'26", "Q2'26", "Q3'26", "Q4'26"];
const social = { byBrand: {}, growthQuarters: GROWTH_Q };
IDS.forEach((id, i) => {
  const a = socialAnchors[id];
  const total = a.youtube + a.instagram + a.facebook;
  const rnd = mulberry32(2000 + i);
  const growthSeries = GROWTH_Q.map((_, j) => {
    const frac = 0.86 + 0.14 * (j / (GROWTH_Q.length - 1));
    return round((total * frac * (1 + (rnd() - 0.5) * 0.02)) / 1000, 1); // thousands
  });
  social.byBrand[id] = { ...a, total, growthSeries };
});

// ---------------------------------------------------------------------------
// 5) reviews — e-commerce review counts, ratings, flagship, review velocity
// ---------------------------------------------------------------------------
const reviewsAnchors = {
  aquaguard:    { amazonCount: 5200, flipkartCount: 3600, avgRating: 4.3, flagship: 'Aquaguard Aura RO+UV+MTDS',        velBase: 140, velTrend: 1.5 },
  eurekaforbes: { amazonCount: 2500, flipkartCount: 1700, avgRating: 4.2, flagship: 'Eureka Forbes AquaSure Delight',   velBase: 60,  velTrend: 0.4 },
  kent:         { amazonCount: 3500, flipkartCount: 2300, avgRating: 4.2, flagship: 'Kent Grand RO+UV+UF+TDS',          velBase: 95,  velTrend: -0.3 },
  livpure:      { amazonCount: 380,  flipkartCount: 220,  avgRating: 4.1, flagship: 'Livpure Glo RO+UV+Mineraliser',    velBase: 10,  velTrend: 1.2 },
  pureit:       { amazonCount: 4000, flipkartCount: 2700, avgRating: 4.2, flagship: 'Pureit Copper+ RO+UV+MF',          velBase: 70,  velTrend: 2.1 },
  aosmith:      { amazonCount: 1500, flipkartCount: 800,  avgRating: 4.3, flagship: 'A.O. Smith Z8 Hot RO',             velBase: 40,  velTrend: 1.0 },
};
const VEL_MONTHS = ["Sep'25","Oct'25","Nov'25","Dec'25","Jan'26","Feb'26","Mar'26","Apr'26","May'26","Jun'26","Jul'26","Aug'26"];
const reviews = { byBrand: {}, velocityMonths: VEL_MONTHS };
IDS.forEach((id, i) => {
  const a = reviewsAnchors[id];
  const rnd = mulberry32(3000 + i);
  // summer months (Apr-Jun) get a velocity bump
  const bump = { "Apr'26": 1.25, "May'26": 1.45, "Jun'26": 1.3 };
  const velocitySeries = VEL_MONTHS.map((m, j) => {
    const seasonal = bump[m] || 1;
    return round(clamp((a.velBase + a.velTrend * j) * seasonal * (1 + (rnd() - 0.5) * 0.15), 2, 500));
  });
  reviews.byBrand[id] = {
    amazonCount: a.amazonCount,
    flipkartCount: a.flipkartCount,
    totalCount: a.amazonCount + a.flipkartCount,
    avgRating: a.avgRating,
    flagship: a.flagship,
    velocitySeries,
    quality: 'estimated',
  };
});

// ---------------------------------------------------------------------------
// 6) ai-visibility — per brand per platform visibility, share of voice,
//    sentiment split, and sample "gap" questions where the brand is absent.
// ---------------------------------------------------------------------------
const PLATFORMS = ['chatgpt', 'claude', 'perplexity', 'gemini'];
const PLATFORM_LABELS = { chatgpt: 'ChatGPT', claude: 'Claude', perplexity: 'Perplexity', gemini: 'Gemini' };
const aiOverall = { kent: 78, aquaguard: 72, eurekaforbes: 66, pureit: 46, aosmith: 40, livpure: 28 };
const sentimentByBrand = {
  kent:         { pos: 70, neu: 22, neg: 8 },
  aquaguard:    { pos: 72, neu: 21, neg: 7 },
  eurekaforbes: { pos: 68, neu: 24, neg: 8 },
  pureit:       { pos: 62, neu: 28, neg: 10 },
  aosmith:      { pos: 66, neu: 26, neg: 8 },
  livpure:      { pos: 58, neu: 30, neg: 12 },
};
// small per-platform tilt (Perplexity leans review-heavy brands, etc.)
const platformTilt = {
  chatgpt:    { aquaguard: 3, kent: 2, eurekaforbes: 1, pureit: 0, aosmith: -1, livpure: 0 },
  claude:     { aquaguard: 1, kent: 4, eurekaforbes: 2, pureit: 1, aosmith: 2, livpure: -2 },
  perplexity: { aquaguard: 5, kent: -2, eurekaforbes: 3, pureit: 5, aosmith: -3, livpure: 2 },
  gemini:     { aquaguard: -2, kent: 5, eurekaforbes: -1, pureit: -2, aosmith: 1, livpure: 1 },
};
const gapsByBrand = {
  aquaguard: [
    'Cheapest RO purifier under ₹8,000?',
    'Best purifier for a rented 1BHK flat?',
    'Which purifier needs the least maintenance?',
  ],
  eurekaforbes: [
    'Best water purifier under ₹10,000?',
    'Which purifier is best for borewell water?',
    'Best budget RO for a small family?',
    'Most stylish purifier for a modern kitchen?',
  ],
  kent: [
    'Best purifier for travel or an RV?',
    'Most compact purifier for a tiny kitchen?',
  ],
  livpure: [
    'Best water purifier for hard water in Chennai?',
    'Which purifier is best for a family of 5?',
    'Most reliable RO brand for long-term use?',
    'Best purifier with the cheapest service plan?',
    'Top purifier for borewell / high-TDS water?',
    'Which brand has the best after-sales network?',
  ],
  pureit: [
    'Best premium purifier for hard water?',
    'Which purifier gives the best mineral retention?',
    'Best purifier for a large joint family?',
  ],
  aosmith: [
    'Best water purifier under ₹12,000?',
    'Which purifier is best for borewell water?',
    'Best RO for a family of 5?',
    'Most reliable purifier for hard water?',
    'Best budget purifier on Amazon?',
    'Which brand is easiest to get serviced in small towns?',
  ],
};
// share of voice within a platform = visibility normalised to sum 100 across brands
function shareMap(visMap) {
  const sum = IDS.reduce((s, id) => s + visMap[id], 0);
  const out = {};
  IDS.forEach((id) => { out[id] = round((visMap[id] / sum) * 100, 1); });
  return out;
}
const aiVisibility = { platforms: PLATFORMS, platformLabels: PLATFORM_LABELS, byBrand: {} };
// per-platform visibility maps
const perPlatformVis = {};
PLATFORMS.forEach((pf) => {
  perPlatformVis[pf] = {};
  IDS.forEach((id, i) => {
    const rnd = mulberry32(4000 + i + pf.length * 13);
    perPlatformVis[pf][id] = round(clamp(aiOverall[id] + (platformTilt[pf][id] || 0) + (rnd() - 0.5) * 5, 5, 96));
  });
});
const overallShare = shareMap(aiOverall);
const perPlatformShare = {};
PLATFORMS.forEach((pf) => { perPlatformShare[pf] = shareMap(perPlatformVis[pf]); });
IDS.forEach((id) => {
  const byPlatform = {};
  PLATFORMS.forEach((pf) => {
    byPlatform[pf] = {
      visibilityPct: perPlatformVis[pf][id],
      shareOfVoice: perPlatformShare[pf][id],
      sentiment: sentimentByBrand[id],
    };
  });
  aiVisibility.byBrand[id] = {
    overall: { visibilityPct: aiOverall[id], shareOfVoice: overallShare[id], sentiment: sentimentByBrand[id] },
    byPlatform,
    sampleGaps: gapsByBrand[id],
    quality: 'estimated',
  };
});

// ---------------------------------------------------------------------------
// Write everything
// ---------------------------------------------------------------------------
const files = {
  'meta.json': meta,
  'spend.json': spend,
  'search-trends.json': searchTrends,
  'social.json': social,
  'reviews.json': reviews,
  'ai-visibility.json': aiVisibility,
};
const seedObj = {};
for (const [name, obj] of Object.entries(files)) {
  const key = name.replace('.json', '');
  seedObj[key] = obj;
  writeFileSync(join(DATA_DIR, name), JSON.stringify(obj, null, 2) + '\n');
  console.log('wrote public/data/' + name);
}

const seedJs = `/* AUTO-GENERATED by scripts/gen-data.mjs — do not edit by hand.
 * A classic-script mirror of public/data/*.json so the dashboard also works when
 * index.html is opened directly as a file:// URL (browsers block fetch() there).
 * data.js prefers a live fetch and only falls back to this seed. */
window.__SEED__ = ${JSON.stringify(seedObj)};
`;
writeFileSync(join(JS_DIR, 'seed.js'), seedJs);
console.log('wrote public/js/seed.js');
console.log('done.');
