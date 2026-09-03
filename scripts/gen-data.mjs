#!/usr/bin/env node
// ---------------------------------------------------------------------------
// gen-data.mjs — data tooling for the dashboard.
//
//   node scripts/gen-data.mjs              (default) refresh public/js/seed.js
//                                          to mirror whatever is on disk in
//                                          public/data/*.json. Missing data
//                                          files are bootstrapped from the mock
//                                          builders below; EXISTING files are
//                                          left untouched. This is what the
//                                          spend scraper calls after it writes
//                                          spend.json.
//
//   node scripts/gen-data.mjs --regen-mock  rebuild ALL mock data files from the
//                                          hardcoded builders, then refresh the
//                                          seed. Use only when you deliberately
//                                          want to regenerate the mock lanes;
//                                          it will overwrite real scraped spend.
//
// seed.js is a classic-script mirror of public/data/*.json so the site also
// works when index.html is opened directly as a file:// URL (browsers block
// fetch() of local files there). The site itself needs no build step.
// ---------------------------------------------------------------------------
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'public', 'data');
const JS_DIR = join(ROOT, 'public', 'js');
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(JS_DIR, { recursive: true });

const REGEN = process.argv.includes('--regen-mock') || process.argv.includes('--force');

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
// The 5 brands. We show AQUAGUARD (the brand), not the corporate parent; its
// spend is company-wide Eureka Forbes Ltd, noted via spendEntity/spendNote.
// ORIG_IDX preserves each brand's original position so the per-brand RNG seeds
// (and therefore the mock values) stay identical to what is committed, even
// though the former parent entry that used to sit at index 1 is gone.
// ---------------------------------------------------------------------------
const BRANDS = [
  { id: 'aquaguard', name: 'Aquaguard', color: '#0ea5e9', group: 'Eureka Forbes', quality: 'disclosed',
    spendEntity: 'Eureka Forbes Ltd', spendNote: 'Company-wide advertising & sales-promotion (brand parent)' },
  { id: 'kent', name: 'Kent', color: '#10b981', group: '', quality: 'snapshot' },
  { id: 'livpure', name: 'Livpure', color: '#f59e0b', group: '', quality: 'estimated' },
  { id: 'pureit', name: 'Pureit', color: '#8b5cf6', group: 'A.O. Smith group', quality: 'estimated' },
  { id: 'aosmith', name: 'AO Smith', color: '#f43f5e', group: 'A.O. Smith group', quality: 'estimated' },
];
const IDS = BRANDS.map((b) => b.id);
const ORIG_IDX = { aquaguard: 0, kent: 2, livpure: 3, pureit: 4, aosmith: 5 };

// ---- builders (mock data) -------------------------------------------------
function buildMeta() {
  return {
    lastUpdated: '2026-08-29',
    category: 'India water purifiers',
    brands: BRANDS,
    qualityNotes: {
      disclosed: 'From the company / parent audited annual report.',
      snapshot: 'From a point-in-time filing; not a full multi-year series.',
      estimated: 'Modelled estimate — no public brand-level disclosure.',
      'private-circle': 'From PrivateCircle / MCA filings for the unlisted entity.',
    },
  };
}

const YEARS = ['FY22', 'FY23', 'FY24', 'FY25', 'FY26'];
function buildSpend() {
  const S = (year, revenue, advertisement, sellingPromo, quality) => ({ year, revenue, advertisement, sellingPromo, quality });
  const byBrand = {
    // Aquaguard spend is company-wide Eureka Forbes Ltd (real FY23/FY24 splits).
    aquaguard: [
      S('FY22', 2010, 70, 105, 'estimated'),
      S('FY23', 2080, 76, 114, 'disclosed'),
      S('FY24', 2189, 87, 120, 'disclosed'),
      S('FY25', 2436, 104, 155, 'estimated'),
      S('FY26', 2710, 120, 180, 'estimated'),
    ],
    kent: [
      S('FY22', 980, 51, 42, 'estimated'),
      S('FY23', 1084, 57, 46, 'snapshot'),
      S('FY24', 1178, 62, 50, 'snapshot'),
      S('FY25', 1260, 66, 54, 'estimated'),
      S('FY26', 1350, 71, 57, 'estimated'),
    ],
    livpure: [
      S('FY22', 216, 13, 15, 'estimated'),
      S('FY23', 294, 17, 21, 'estimated'),
      S('FY24', 380, 22, 27, 'estimated'),
      S('FY25', 470, 27, 34, 'estimated'),
      S('FY26', 560, 33, 40, 'estimated'),
    ],
    pureit: [
      S('FY22', 250, 10, 10, 'estimated'),
      S('FY23', 270, 11, 11, 'estimated'),
      S('FY24', 293, 12, 11, 'estimated'),
      S('FY25', 310, 13, 12, 'estimated'),
      S('FY26', 330, 13, 13, 'estimated'),
    ],
    aosmith: [
      S('FY22', 420, 15, 14, 'estimated'),
      S('FY23', 460, 16, 16, 'estimated'),
      S('FY24', 500, 18, 17, 'estimated'),
      S('FY25', 540, 19, 19, 'estimated'),
      S('FY26', 580, 21, 20, 'estimated'),
    ],
  };
  return { years: YEARS, byBrand };
}

function buildSearch() {
  const FYq = [];
  for (const fy of YEARS) for (const q of [1, 2, 3, 4]) FYq.push(`${fy} Q${q}`);
  const SEASON = { 1: 1.0, 2: 0.4, 3: 0.15, 4: 0.5 };
  const params = {
    aquaguard: { base: 55, peak: 88, trend: 0.30 },
    kent: { base: 52, peak: 84, trend: -0.15 },
    pureit: { base: 38, peak: 58, trend: -0.20 },
    aosmith: { base: 30, peak: 45, trend: 0.20 },
    livpure: { base: 20, peak: 35, trend: 0.50 },
  };
  const make = (p, seed) => {
    const rnd = mulberry32(seed);
    return FYq.map((label, i) => {
      const q = Number(label.slice(-1));
      const v = p.base + (p.peak - p.base) * SEASON[q] + p.trend * i + (rnd() - 0.5) * 6;
      return round(clamp(v, 5, 100));
    });
  };
  const byBrand = {};
  IDS.forEach((id) => { byBrand[id] = make(params[id], 1000 + ORIG_IDX[id]); });
  const category = FYq.map((label, i) => {
    const q = Number(label.slice(-1));
    const rnd = mulberry32(777 + i);
    return round(clamp(45 + (92 - 45) * SEASON[q] + 0.05 * i + (rnd() - 0.5) * 5, 5, 100));
  });
  return { quarters: FYq, byBrand, category, categoryLabel: '“water purifier”' };
}

function buildSocial() {
  const anchors = {
    aquaguard: { youtube: 93600, instagram: 122000, engagementRate: 1.9 },
    kent: { youtube: 49600, instagram: 81000, engagementRate: 0.8 },
    livpure: { youtube: 15600, instagram: 69000, engagementRate: 2.4 },
    pureit: { youtube: 22000, instagram: 11000, engagementRate: 1.1 },
    aosmith: { youtube: 12000, instagram: 15000, engagementRate: 1.3 },
  };
  const GROWTH_Q = ["Q1'25", "Q2'25", "Q3'25", "Q4'25", "Q1'26", "Q2'26", "Q3'26", "Q4'26"];
  const byBrand = {};
  IDS.forEach((id) => {
    const a = anchors[id];
    const total = a.youtube + a.instagram;
    const rnd = mulberry32(2000 + ORIG_IDX[id]);
    const growthSeries = GROWTH_Q.map((_, j) => {
      const frac = 0.86 + 0.14 * (j / (GROWTH_Q.length - 1));
      return round((total * frac * (1 + (rnd() - 0.5) * 0.02)) / 1000, 1);
    });
    byBrand[id] = { ...a, total, growthSeries };
  });
  return { byBrand, growthQuarters: GROWTH_Q };
}

function buildReviews() {
  const anchors = {
    aquaguard: { amazonCount: 5200, flipkartCount: 3600, avgRating: 4.3, flagship: 'Aquaguard Aura RO+UV+MTDS', velBase: 140, velTrend: 1.5 },
    kent: { amazonCount: 3500, flipkartCount: 2300, avgRating: 4.2, flagship: 'Kent Grand RO+UV+UF+TDS', velBase: 95, velTrend: -0.3 },
    livpure: { amazonCount: 380, flipkartCount: 220, avgRating: 4.1, flagship: 'Livpure Glo RO+UV+Mineraliser', velBase: 10, velTrend: 1.2 },
    pureit: { amazonCount: 4000, flipkartCount: 2700, avgRating: 4.2, flagship: 'Pureit Copper+ RO+UV+MF', velBase: 70, velTrend: 2.1 },
    aosmith: { amazonCount: 1500, flipkartCount: 800, avgRating: 4.3, flagship: 'A.O. Smith Z8 Hot RO', velBase: 40, velTrend: 1.0 },
  };
  const VEL_MONTHS = ["Sep'25", "Oct'25", "Nov'25", "Dec'25", "Jan'26", "Feb'26", "Mar'26", "Apr'26", "May'26", "Jun'26", "Jul'26", "Aug'26"];
  const bump = { "Apr'26": 1.25, "May'26": 1.45, "Jun'26": 1.3 };
  const byBrand = {};
  IDS.forEach((id) => {
    const a = anchors[id];
    const rnd = mulberry32(3000 + ORIG_IDX[id]);
    const velocitySeries = VEL_MONTHS.map((m, j) => round(clamp((a.velBase + a.velTrend * j) * (bump[m] || 1) * (1 + (rnd() - 0.5) * 0.15), 2, 500)));
    byBrand[id] = {
      amazonCount: a.amazonCount, flipkartCount: a.flipkartCount, totalCount: a.amazonCount + a.flipkartCount,
      avgRating: a.avgRating, flagship: a.flagship, velocitySeries, quality: 'estimated',
    };
  });
  return { byBrand, velocityMonths: VEL_MONTHS };
}

function buildAI() {
  // Mock uses the two providers the AI engine actually queries (Bedrock Claude
  // + Mistral). scrape-ai.mjs replaces these placeholders with measured data.
  const PLATFORMS = ['claude', 'mistral'];
  const LABELS = { claude: 'Claude', mistral: 'Mistral' };
  const overall = { kent: 78, aquaguard: 72, pureit: 46, aosmith: 40, livpure: 28 };
  const sentiment = {
    kent: { pos: 70, neu: 22, neg: 8 }, aquaguard: { pos: 72, neu: 21, neg: 7 },
    pureit: { pos: 62, neu: 28, neg: 10 }, aosmith: { pos: 66, neu: 26, neg: 8 }, livpure: { pos: 58, neu: 30, neg: 12 },
  };
  const tilt = {
    claude: { aquaguard: 1, kent: 4, pureit: 1, aosmith: 2, livpure: -2 },
    mistral: { aquaguard: 4, kent: -1, pureit: 3, aosmith: -2, livpure: 2 },
  };
  const gaps = {
    aquaguard: ['Cheapest RO purifier under ₹8,000?', 'Best purifier for a rented 1BHK flat?', 'Which purifier needs the least maintenance?'],
    kent: ['Best purifier for travel or an RV?', 'Most compact purifier for a tiny kitchen?'],
    livpure: ['Best water purifier for hard water in Chennai?', 'Which purifier is best for a family of 5?', 'Most reliable RO brand for long-term use?', 'Best purifier with the cheapest service plan?', 'Top purifier for borewell / high-TDS water?', 'Which brand has the best after-sales network?'],
    pureit: ['Best premium purifier for hard water?', 'Which purifier gives the best mineral retention?', 'Best purifier for a large joint family?'],
    aosmith: ['Best water purifier under ₹12,000?', 'Which purifier is best for borewell water?', 'Best RO for a family of 5?', 'Most reliable purifier for hard water?', 'Best budget purifier on Amazon?', 'Which brand is easiest to get serviced in small towns?'],
  };
  const shareMap = (visMap) => {
    const s = IDS.reduce((t, id) => t + visMap[id], 0);
    const out = {}; IDS.forEach((id) => { out[id] = round((visMap[id] / s) * 100, 1); }); return out;
  };
  const perVis = {};
  PLATFORMS.forEach((pf) => {
    perVis[pf] = {};
    IDS.forEach((id) => {
      const rnd = mulberry32(4000 + ORIG_IDX[id] + pf.length * 13);
      perVis[pf][id] = round(clamp(overall[id] + (tilt[pf][id] || 0) + (rnd() - 0.5) * 5, 5, 96));
    });
  });
  const overallShare = shareMap(overall);
  const perShare = {}; PLATFORMS.forEach((pf) => { perShare[pf] = shareMap(perVis[pf]); });
  const byBrand = {};
  IDS.forEach((id) => {
    const byPlatform = {};
    PLATFORMS.forEach((pf) => { byPlatform[pf] = { visibilityPct: perVis[pf][id], shareOfVoice: perShare[pf][id], sentiment: sentiment[id] }; });
    byBrand[id] = {
      overall: { visibilityPct: overall[id], shareOfVoice: overallShare[id], sentiment: sentiment[id] },
      byPlatform, sampleGaps: gaps[id], quality: 'estimated',
    };
  });
  return { platforms: PLATFORMS, platformLabels: LABELS, byBrand };
}

// ---------------------------------------------------------------------------
const BUILDERS = {
  'meta.json': buildMeta, 'spend.json': buildSpend, 'search-trends.json': buildSearch,
  'social.json': buildSocial, 'reviews.json': buildReviews, 'ai-visibility.json': buildAI,
};
const ORDER = ['meta.json', 'spend.json', 'search-trends.json', 'social.json', 'reviews.json', 'ai-visibility.json'];

for (const name of ORDER) {
  const p = join(DATA_DIR, name);
  if (REGEN || !existsSync(p)) {
    writeFileSync(p, JSON.stringify(BUILDERS[name](), null, 2) + '\n');
    console.log((REGEN ? 'regenerated ' : 'bootstrapped ') + 'public/data/' + name);
  }
}

// Build seed.js by MIRRORING whatever is on disk (so it reflects scraped data).
const seedObj = {};
for (const name of ORDER) seedObj[name.replace('.json', '')] = JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8'));
const seedJs = `/* AUTO-GENERATED by scripts/gen-data.mjs — do not edit by hand.
 * A classic-script mirror of public/data/*.json so the dashboard also works when
 * index.html is opened directly as a file:// URL (browsers block fetch() there).
 * data.js prefers a live fetch and only falls back to this seed. */
window.__SEED__ = ${JSON.stringify(seedObj)};
`;
writeFileSync(join(JS_DIR, 'seed.js'), seedJs);
console.log('wrote public/js/seed.js (mirror of public/data/*.json)');
console.log('done.');
