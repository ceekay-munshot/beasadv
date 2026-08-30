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
import { dataPath, readJSON, writeIfChanged, refreshSeed, num, parseCompact, nowISO, monthLabel } from '../lib/store.mjs';
import { fetchDoc, extractStructured, scrapeAvailable } from '../lib/scrape.mjs';

const REVIEWS = dataPath('reviews.json');
const SOURCES = dataPath('manual/sources.json');
const CAP = 24;
const META = readJSON(dataPath('meta.json'), { brands: [] });
const nameOf = (id) => (META.brands.find((b) => b.id === id) || {}).name || id;

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
    ratingCount: { type: ['number', 'null'] },
    reviewCount: { type: ['number', 'null'] },
    title: { type: ['string', 'null'] },
  },
};

// Read a product's rating + rating VOLUME (the canonical count) from Amazon or
// Flipkart. Structured Firecrawl extraction first, then fill any still-missing
// field from a regex read of the raw page. Both paths use the same metric — the
// ratings count — so a structured↔fallback flip never changes it by ~10x.
async function readProduct(url) {
  if (!url || !scrapeAvailable()) return null;
  const j = (await extractStructured(url, SCHEMA)) || {};
  let count = num(j.ratingCount) ?? num(j.reviewCount); // prefer ratings volume
  let rating = num(j.rating);
  const title = j.title || null;
  if (count == null || rating == null) {
    const doc = await fetchDoc(url);
    const t = doc && (doc.html || doc.markdown);
    if (t) {
      if (count == null) {
        // Flipkart "1,23,456 Ratings & 12,345 Reviews" -> ratings volume;
        // Amazon "12,345 global ratings" / "12,345 ratings".
        const fk = t.match(/([\d,]+)\s*Ratings?\s*(?:&|and|,)?\s*[\d,]*\s*Reviews?/i);
        const cm = t.match(/([\d,]+)\s*(?:global ratings|ratings|reviews)/i);
        count = fk ? parseCompact(fk[1]) : cm ? parseCompact(cm[1]) : null;
      }
      // rating only from an explicit "X out of 5" — never a bare "5 ★", which
      // on Flipkart is a rating-distribution row, not the aggregate score.
      if (rating == null) { const rm = t.match(/([\d.]+)\s*out of\s*5/i); rating = rm ? num(rm[1]) : null; }
    }
  }
  if (count == null && rating == null) return null;
  return { count, rating, title };
}

// Amazon India search fallback: for a brand with no product URL, find the
// "<brand> water purifier" result with the most ratings and read it.
async function searchTopProduct(brandName) {
  if (!scrapeAvailable()) return null;
  const doc = await fetchDoc(`https://www.amazon.in/s?k=${encodeURIComponent(brandName + ' water purifier')}`);
  const html = doc && (doc.html || doc.markdown);
  if (!html) return null;
  const asins = [...new Set([...html.matchAll(/\/dp\/([A-Z0-9]{10})/g)].map((m) => m[1]))].slice(0, 3);
  let best = null;
  for (const asin of asins) {
    const p = await readProduct(`https://www.amazon.in/dp/${asin}`);
    if (p && num(p.count) != null && (!best || p.count > best.count)) best = { ...p, url: `https://www.amazon.in/dp/${asin}` };
  }
  return best;
}

// ---- run: gather fresh totals per brand ----------------------------------
const now = nowISO();
const freshTotal = {};
for (const id of Object.keys(data.byBrand)) {
  const src = sources.byBrand[id] || {};
  const b = data.byBrand[id];
  const attempted = scrapeAvailable(); // URL read or search fallback
  let amazon = null, flip = null, title = null;
  if (src.amazonUrl) amazon = await readProduct(src.amazonUrl);
  if (src.flipkartUrl) flip = await readProduct(src.flipkartUrl);
  // no configured product URL -> search Amazon for the flagship
  if (amazon == null && flip == null && !src.amazonUrl && !src.flipkartUrl) {
    amazon = await searchTopProduct(nameOf(id));
    if (amazon) console.log(`[reviews] ${id}: search fallback found ${amazon.url}`);
  }

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
  // only rewrite provenance when we attempted (keys present); a no-key run leaves it
  if (attempted) {
    data._provenance.byBrand[id] = {
      source: parts.length ? parts.join('+') : ((data._provenance.byBrand[id] || {}).source || 'last-good'),
      fetchedAt: now, ...(parts.length ? {} : { stale: true }),
    };
  }
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
if (anyFresh) { data._provenance.source = 'Amazon + Flipkart'; data._provenance.fetchedAt = now; }
else if (!data._provenance.source) { data._provenance.source = 'estimated'; data._provenance.fetchedAt = now; }

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

if (writeIfChanged(REVIEWS, data, lastGood)) {
  console.log(`[reviews] wrote reviews.json (source: ${data._provenance.source})`);
  refreshSeed();
} else {
  console.log('[reviews] no change vs last-good; nothing to write');
}
process.exit(0);
