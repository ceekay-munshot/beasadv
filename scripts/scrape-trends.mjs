#!/usr/bin/env node
// ---------------------------------------------------------------------------
// scrape-trends.mjs — refresh public/data/search-trends.json (Google Trends).
//
// Uses the unofficial Trends endpoints routed through Scrape.do (so Google sees
// a residential IP): explore -> find the TIMESERIES widget (token + request) ->
// widgetdata/multiline -> timelineData values. Both responses are prefixed with
// )]}' which is stripped before JSON.parse. The ~5y weekly series is downsampled
// to the 20 quarterly points search-trends.json already uses.
//
// Genuinely fragile: on any per-brand failure the brand's last-good/mock series
// is kept and marked best-effort/stale. Degrades with no SCRAPEDO_API_KEY,
// never writes null over a real series, and exits 0.
import { dataPath, readJSON, writeIfChanged, refreshSeed, num, nowISO } from '../lib/store.mjs';

const TRENDS = dataPath('search-trends.json');
const SOURCES = dataPath('manual/sources.json');

const data = readJSON(TRENDS);
if (!data || !data.byBrand || !Array.isArray(data.quarters)) { console.error('[trends] search-trends.json unreadable; exiting 0'); process.exit(0); }
const N = data.quarters.length;
const lastGood = JSON.parse(JSON.stringify(data));
const sources = readJSON(SOURCES, { byBrand: {} });
data._provenance = data._provenance || {};
data._provenance.byBrand = data._provenance.byBrand || {};

const KEY = process.env.SCRAPEDO_API_KEY;
const stripAnti = (s) => s.replace(/^\)\]\}'?,?\s*/, '');

async function scrapedoGet(targetUrl) {
  if (!KEY) throw new Error('no SCRAPEDO_API_KEY');
  const api = `https://api.scrape.do/?token=${KEY}&url=${encodeURIComponent(targetUrl)}`;
  const res = await fetch(api);
  if (!res.ok) throw new Error(`scrape.do HTTP ${res.status}`);
  return res.text();
}

async function trendsSeries(term) {
  const exploreReq = { comparisonItem: [{ keyword: term, geo: 'IN', time: 'today 5-y' }], category: 0, property: '' };
  const exploreUrl = `https://trends.google.com/trends/api/explore?hl=en-US&tz=-330&req=${encodeURIComponent(JSON.stringify(exploreReq))}`;
  const explore = JSON.parse(stripAnti(await scrapedoGet(exploreUrl)));
  const widget = (explore.widgets || []).find((w) => w.id === 'TIMESERIES');
  if (!widget) throw new Error('no TIMESERIES widget');
  const multiUrl = `https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=-330&req=${encodeURIComponent(JSON.stringify(widget.request))}&token=${encodeURIComponent(widget.token)}`;
  const multi = JSON.parse(stripAnti(await scrapedoGet(multiUrl)));
  const timeline = multi?.default?.timelineData || [];
  const points = timeline.map((t) => num(t.value && t.value[0]) ?? 0);
  if (!points.length) throw new Error('empty timeline');
  return points;
}

// average-downsample an arbitrary-length series to exactly n points
function downsample(arr, n) {
  if (!arr.length) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * arr.length) / n), b = Math.max(a + 1, Math.floor(((i + 1) * arr.length) / n));
    const slice = arr.slice(a, b);
    out.push(Math.round(slice.reduce((x, y) => x + y, 0) / slice.length));
  }
  return out;
}

async function refreshOne(term) {
  const raw = await trendsSeries(term);
  const series = downsample(raw, N);
  if (series.length !== N || series.every((v) => v === 0)) throw new Error('degenerate series');
  return series;
}

// ---- run ------------------------------------------------------------------
const now = nowISO();
let anyReal = false;
const attempted = !!KEY;
for (const id of Object.keys(data.byBrand)) {
  const term = (sources.byBrand[id] || {}).trendsTerm;
  if (!attempted) continue; // no SCRAPEDO key -> leave provenance as-is (no-op)
  if (!term) { data._provenance.byBrand[id] = { source: 'last-good', fetchedAt: now }; continue; }
  try {
    data.byBrand[id] = await refreshOne(term);
    data._provenance.byBrand[id] = { source: 'google-trends', fetchedAt: now };
    anyReal = true;
    console.log(`[trends] ${id}: refreshed from Google Trends`);
  } catch (e) {
    console.error(`[trends] ${id}: failed (${e.message}); keeping last-good`);
    data._provenance.byBrand[id] = { source: 'last-good', fetchedAt: now, stale: true };
  }
}
// category term
if (attempted) {
  try { data.category = await refreshOne('water purifier'); anyReal = true; }
  catch (e) { console.error(`[trends] category: failed (${e.message}); keeping last-good`); }
}
if (anyReal) { data._provenance.source = 'Google Trends (IN, 5y)'; data._provenance.fetchedAt = now; }
else if (!data._provenance.source) { data._provenance.source = 'estimated'; data._provenance.fetchedAt = now; }

// ---- never regress --------------------------------------------------------
let restored = 0;
for (const id of Object.keys(data.byBrand)) {
  const s = data.byBrand[id];
  if (!Array.isArray(s) || s.length !== N || s.some((v) => num(v) == null)) { data.byBrand[id] = lastGood.byBrand[id]; restored++; }
}
if (!Array.isArray(data.category) || data.category.length !== N || data.category.some((v) => num(v) == null)) data.category = lastGood.category;
if (restored) console.log(`[trends] restored ${restored} series from last-good`);

if (writeIfChanged(TRENDS, data, lastGood)) {
  console.log(`[trends] wrote search-trends.json (source: ${data._provenance.source})`);
  refreshSeed();
} else {
  console.log('[trends] no change vs last-good; nothing to write');
}
process.exit(0);
