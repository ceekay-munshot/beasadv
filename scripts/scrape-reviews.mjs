#!/usr/bin/env node
// ---------------------------------------------------------------------------
// scrape-reviews.mjs — refresh public/data/reviews.json (Amazon + Flipkart).
//
// For each brand with an amazonUrl / flipkartUrl in sources.json, read the
// product page with Firecrawl JSON mode (rating / reviewCount / title), falling
// back to a markdown+regex read. Preserves reviews.json's shape (amazonCount /
// flipkartCount / totalCount / avgRating / flagship / velocitySeries per brand).
//
// When a fresh total is retrieved for any brand, one point is appended to every
// brand's velocitySeries (fresh total where available, else carry-forward) plus
// one velocityMonths label — so the series stay aligned and the "buzz" line
// grows over time; capped at 24 points. Never-regress guard; degrades with no
// keys (keeps last-good, exits 0).
import { dataPath, readJSON, writeJSON, refreshSeed, num, parseCompact, nowISO, monthLabel } from '../lib/store.mjs';
import { fetchDoc, extractStructured, scrapeAvailable } from '../lib/scrape.mjs';

const REVIEWS = dataPath('reviews.json');
const SOURCES = dataPath('manual/sources.json');
const CAP = 24;

const data = readJSON(REVIEWS);
if (!data || !data.byBrand) { console.error('[reviews] reviews.json unreadable; exiting 0'); process.exit(0); }
const lastGood = JSON.parse(JSON.stringify(data));
const sources = readJSON(SOURCES, { byBrand: {} });
data._provenance = data._provenance || {};
data._provenance.byBrand = data._provenance.byBrand || {};

const SCHEMA = {
  type: 'object',
  properties: {
    rating: { type: ['number', 'null'] },
    reviewCount: { type: ['number', 'null'] },
    title: { type: ['string', 'null'] },
  },
};

async function readProduct(url) {
  if (!url || !scrapeAvailable()) return null;
  let j = await extractStructured(url, SCHEMA);
  if (j && (num(j.reviewCount) != null || num(j.rating) != null)) {
    return { count: num(j.reviewCount), rating: num(j.rating), title: j.title || null };
  }
  // regex fallback
  const doc = await fetchDoc(url);
  const t = doc && (doc.html || doc.markdown);
  if (!t) return null;
  const cm = t.match(/([\d,]+)\s*(?:ratings|reviews|global ratings)/i);
  const rm = t.match(/([\d.]+)\s*out of\s*5/i);
  const count = cm ? parseCompact(cm[1]) : null;
  const rating = rm ? num(rm[1]) : null;
  if (count == null && rating == null) return null;
  return { count, rating, title: null };
}

// ---- run: gather fresh totals per brand ----------------------------------
const now = nowISO();
const freshTotal = {};
for (const id of Object.keys(data.byBrand)) {
  const src = sources.byBrand[id] || {};
  const b = data.byBrand[id];
  const attempted = scrapeAvailable() && (src.amazonUrl || src.flipkartUrl);
  let amazon = null, flip = null, title = null;
  if (src.amazonUrl) amazon = await readProduct(src.amazonUrl);
  if (src.flipkartUrl) flip = await readProduct(src.flipkartUrl);

  if (amazon && num(amazon.count) != null) b.amazonCount = num(amazon.count);
  if (flip && num(flip.count) != null) b.flipkartCount = num(flip.count);
  const rating = (amazon && num(amazon.rating) != null) ? num(amazon.rating)
    : (flip && num(flip.rating) != null) ? num(flip.rating) : null;
  if (rating != null) b.avgRating = rating;
  if (amazon && amazon.title) b.flagship = amazon.title;

  const gotFresh = (amazon && num(amazon.count) != null) || (flip && num(flip.count) != null);
  b.totalCount = (num(b.amazonCount) || 0) + (num(b.flipkartCount) || 0);
  if (gotFresh) freshTotal[id] = b.totalCount;

  const parts = [];
  if (amazon && num(amazon.count) != null) parts.push('amazon');
  if (flip && num(flip.count) != null) parts.push('flipkart');
  data._provenance.byBrand[id] = {
    source: parts.length ? parts.join('+') : (attempted ? 'last-good' : 'estimated'),
    fetchedAt: now, ...(attempted && !gotFresh ? { stale: true } : {}),
  };
}

// ---- append one aligned velocity point across ALL brands, if any fresh ----
const anyFresh = Object.keys(freshTotal).length > 0;
if (anyFresh) {
  for (const id of Object.keys(data.byBrand)) {
    const b = data.byBrand[id];
    const series = Array.isArray(b.velocitySeries) ? b.velocitySeries.slice() : [];
    const last = series.length ? series[series.length - 1] : (num(b.totalCount) || 0);
    series.push(freshTotal[id] != null ? freshTotal[id] : last);
    b.velocitySeries = series.slice(-CAP);
  }
  data.velocityMonths = [...(data.velocityMonths || []), monthLabel()].slice(-CAP);
  console.log(`[reviews] appended velocity point for ${Object.keys(freshTotal).length} fresh brand(s)`);
}
data._provenance.source = anyFresh ? 'Amazon + Flipkart' : 'estimated';
data._provenance.fetchedAt = now;

// ---- never regress --------------------------------------------------------
let restored = 0;
for (const id of Object.keys(data.byBrand)) {
  const g = lastGood.byBrand[id] || {};
  for (const f of ['amazonCount', 'flipkartCount', 'totalCount', 'avgRating']) {
    if (num(data.byBrand[id][f]) == null) { if (num(g[f]) != null) { data.byBrand[id][f] = g[f]; restored++; } }
  }
  if (!data.byBrand[id].flagship) data.byBrand[id].flagship = g.flagship;
  if (!Array.isArray(data.byBrand[id].velocitySeries) || !data.byBrand[id].velocitySeries.length) data.byBrand[id].velocitySeries = g.velocitySeries;
}
if (restored) console.log(`[reviews] restored ${restored} field(s) from last-good`);

writeJSON(REVIEWS, data);
console.log(`[reviews] wrote reviews.json (source: ${data._provenance.source})`);
refreshSeed();
process.exit(0);
