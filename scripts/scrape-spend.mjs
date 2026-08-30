#!/usr/bin/env node
// ---------------------------------------------------------------------------
// scrape-spend.mjs — refresh public/data/spend.json from primary sources.
//
//   Aquaguard (Eureka Forbes Ltd, LISTED)  screener.in -> annual-report PDF ->
//                                          Firecrawl -> LLM extraction of the
//                                          "Advertisement" / "Selling & Sales
//                                          Promotion" Other-Expenses lines.
//   Kent                                   screener/DRHP if reachable, else the
//                                          manual PrivateCircle file.
//   Livpure / Pureit / AO Smith (UNLISTED) manual PrivateCircle file only.
//
// Degrades gracefully: with NO secrets it makes no network calls, keeps the
// last-good committed values, and exits 0. A source that is *attempted* and
// fails keeps last-good and marks those rows stale. It NEVER writes null over a
// real number. After writing spend.json it runs gen-data.mjs to refresh seed.js.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { completeJSON, llmAvailable } from '../lib/llm.mjs';
import { fetchDoc, scrapeAvailable } from '../lib/scrape.mjs';
import { openScreenerSession } from '../lib/screener.mjs';
import { writeIfChanged, refreshSeed } from '../lib/store.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEND_PATH = join(ROOT, 'public', 'data', 'spend.json');
const PC_PATH = join(ROOT, 'public', 'data', 'manual', 'private-circle.json');
const SOURCES_PATH = join(ROOT, 'public', 'data', 'manual', 'sources.json');
const NOW = new Date().toISOString();
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

// ---- load last-good -------------------------------------------------------
let data;
try {
  data = JSON.parse(readFileSync(SPEND_PATH, 'utf8'));
  if (!data || !data.years || !data.byBrand) throw new Error('bad shape');
} catch (e) {
  console.error(`[spend] cannot read spend.json (${e.message}); nothing safe to do, exiting 0`);
  process.exit(0);
}
const lastGood = JSON.parse(JSON.stringify(data)); // deep clone as the floor
data._provenance = data._provenance || {};
let pc = { byBrand: {} };
try { if (existsSync(PC_PATH)) pc = JSON.parse(readFileSync(PC_PATH, 'utf8')); }
catch (e) { console.error(`[spend] private-circle.json unreadable: ${e.message}`); }
let sources = { byBrand: {} };
try { if (existsSync(SOURCES_PATH)) sources = JSON.parse(readFileSync(SOURCES_PATH, 'utf8')); }
catch (e) { console.error(`[spend] sources.json unreadable: ${e.message}`); }
const srcFor = (id) => (sources.byBrand && sources.byBrand[id]) || {};

const rowsOf = (id) => data.byBrand[id] || (data.byBrand[id] = []);
const rowFor = (id, year) => rowsOf(id).find((r) => r.year === year);
const setProv = (id, p) => { data._provenance[id] = { ...(data._provenance[id] || {}), ...p }; };

// merge {year,revenue?,advertisement?,sellingPromo?} entries onto a brand,
// keeping last-good for any field the source doesn't provide (never null).
function mergeYears(id, entries, quality) {
  let touched = 0;
  for (const e of entries || []) {
    const r = rowFor(id, e.year);
    if (!r) continue;
    let changed = false;
    for (const f of ['revenue', 'advertisement', 'sellingPromo']) {
      if (num(e[f]) != null) { r[f] = num(e[f]); changed = true; }
    }
    if (changed || quality) { r.quality = quality || r.quality; delete r.stale; touched++; }
  }
  return touched;
}
function markStale(id) {
  // A disclosed row is a permanent audited fact — never flip it to stale on a
  // failed re-extraction. Only non-disclosed rows show as last-good/stale.
  for (const r of rowsOf(id)) if (r.quality !== 'disclosed') r.stale = true;
  // drop any prior sourceDoc so a failed refresh never shows a misleading source
  setProv(id, { stale: true, fetchedAt: NOW, sourceDoc: null, note: 'Latest refresh could not confirm; showing last-good.' });
}

// ---- 1) Unlisted peers via PrivateCircle ---------------------------------
for (const id of ['livpure', 'pureit', 'aosmith']) {
  const entries = pc.byBrand && pc.byBrand[id];
  if (!entries || !entries.length) { console.log(`[spend] ${id}: no PrivateCircle entry, keeping estimate`); continue; }
  const n = mergeYears(id, entries, 'private-circle');
  setProv(id, { sourceDoc: 'PrivateCircle / MCA', note: 'Unlisted entity financials', fetchedAt: NOW, quality: 'private-circle' });
  console.log(`[spend] ${id}: applied PrivateCircle (${n} year(s))`);
}

// ---- shared session (opened lazily, once) --------------------------------
let session = null;
const getSession = async () => (session ||= await openScreenerSession());

// ---- LLM extraction of a P&L doc -----------------------------------------
const EXTRACT_SCHEMA = {
  type: 'object', required: ['years'],
  properties: {
    years: {
      type: 'array', items: {
        type: 'object', required: ['year'],
        properties: {
          year: { type: 'string' }, revenue: { type: ['number', 'null'] },
          advertisement: { type: ['number', 'null'] }, sellingPromo: { type: ['number', 'null'] },
        },
      },
    },
  },
};
const EXTRACT_SYSTEM = 'You read Indian company financial statements and extract exact figures in ₹ crore. Output numbers only (no units/commas). Use null when a figure is not present in the text.';
function extractPrompt(entity, markdown) {
  return `From the financial document below for ${entity}, extract for each fiscal year you can find (label FY22..FY26):\n` +
    `- revenue: total "Revenue from Operations" (₹ crore)\n` +
    `- advertisement: the "Advertisement" line under Other Expenses (₹ crore)\n` +
    `- sellingPromo: the "Selling and Sales Promotion" / "Sales Promotion" line under Other Expenses (₹ crore)\n` +
    `Return {"years":[{"year","revenue","advertisement","sellingPromo"}]}. Use null for anything not clearly stated.\n\n` +
    `--- DOCUMENT ---\n${String(markdown).slice(0, 90000)}`;
}
// rating-agency / non-annual-report PDFs to never treat as an annual report
const RATINGS_RE = /careratings|crisil|icra|rating|ratings/i;
function findPdfLinks(html) {
  if (!html) return [];
  const out = [];
  const re = /href="([^"]+\.pdf[^"]*)"/gi; let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out
    .filter((u) => !RATINGS_RE.test(u))
    .sort((a, b) => (/(annual|financial|report)/i.test(b) ? 1 : 0) - (/(annual|financial|report)/i.test(a) ? 1 : 0));
}
const abs = (base, href) => { try { return new URL(href, base).href; } catch { return href; } };

// read one PDF and LLM-extract its P&L years, or null
async function tryExtractPdf(entity, pdf) {
  const doc = await fetchDoc(pdf);
  const md = doc && (doc.markdown || doc.html);
  if (!md) return null;
  const { data: out } = await completeJSON({ prompt: extractPrompt(entity, md), system: EXTRACT_SYSTEM, schema: EXTRACT_SCHEMA });
  if (out && Array.isArray(out.years) && out.years.some((y) => num(y.advertisement) != null || num(y.sellingPromo) != null || num(y.revenue) != null)) return out.years;
  return null;
}

// ---- 2) Aquaguard (Eureka Forbes Ltd) ------------------------------------
async function extractListed({ id, entity, query, knownCompanyPath, annualReportUrl }) {
  if (!scrapeAvailable() || !llmAvailable()) {
    console.log(`[spend] ${id}: no scrape/LLM keys — not attempted, keeping last-good`);
    return { attempted: false };
  }
  try {
    let extracted = null, sourceDoc = null;
    // 1) explicit annual-report URL first (needs no browser)
    if (annualReportUrl) {
      const years = await tryExtractPdf(entity, annualReportUrl);
      if (years) { extracted = years; sourceDoc = annualReportUrl; }
      else console.log(`[spend] ${id}: annualReportUrl yielded nothing; trying Screener discovery`);
    }
    // 2) Screener discovery (best-effort; ratings PDFs excluded)
    if (!extracted) {
      const s = await getSession();
      let companyUrl = knownCompanyPath ? 'https://www.screener.in' + knownCompanyPath : null;
      const hits = await s.searchCompany(query);
      if (hits.length) {
        const hit = hits.find((h) => new RegExp(entity.split(' ')[0], 'i').test(h.name)) || hits[0];
        if (hit && hit.url) companyUrl = 'https://www.screener.in' + hit.url;
      }
      if (companyUrl) {
        const pageHtml = await s.fetchRenderedHtml(companyUrl);
        const pdfs = findPdfLinks(pageHtml).map((h) => abs(companyUrl, h));
        for (const pdf of pdfs.slice(0, 3)) { const years = await tryExtractPdf(entity, pdf); if (years) { extracted = years; sourceDoc = pdf; break; } }
      }
    }
    if (!extracted) throw new Error('no usable figures from annual report or Screener');
    const n = mergeYears(id, extracted, 'disclosed');
    for (const r of rowsOf(id)) delete r.stale; // successful refresh clears stale
    setProv(id, { sourceDoc, note: 'Company-wide Advertisement + Selling & Sales Promotion (Other Expenses)', fetchedAt: NOW, quality: 'disclosed', stale: false });
    console.log(`[spend] ${id}: extracted ${n} year(s) from ${sourceDoc}`);
    return { attempted: true, ok: true };
  } catch (e) {
    console.error(`[spend] ${id}: extraction failed (${e.message}); keeping last-good, marking stale`);
    markStale(id);
    return { attempted: true, ok: false };
  }
}

// ---- run ------------------------------------------------------------------
// Aquaguard (Eureka Forbes Ltd): the annual report is a SCANNED image PDF that
// cannot be text-extracted, so a live re-extraction can only ever fail and would
// wrongly mark the audited figures stale. Treat the committed FY22–FY26 values as
// curated-authoritative — skip live extraction and pin a static provenance.
for (const r of rowsOf('aquaguard')) delete r.stale;
data._provenance.aquaguard = {
  sourceDoc: 'Eureka Forbes Annual Report FY2023-24, Note 30 (Advertisement + Selling & Sales Promotion); FY25 per company disclosure',
  note: 'Curated from audited filings — scanned AR, not machine-extractable',
  quality: 'disclosed',
};
console.log('[spend] aquaguard: curated-authoritative (scanned AR not machine-extractable); skipped live extraction');

// Kent: attempt listed extraction; else fall back to PrivateCircle
{
  const res = await extractListed({ id: 'kent', entity: 'Kent RO Systems', query: 'Kent RO Systems', annualReportUrl: srcFor('kent').annualReportUrl });
  if (!res.ok) {
    const entries = pc.byBrand && pc.byBrand.kent;
    if (entries && entries.length) {
      const n = mergeYears('kent', entries, 'snapshot');
      setProv('kent', { sourceDoc: 'PrivateCircle / MCA', note: 'Kent RO Systems Ltd (snapshot)', fetchedAt: NOW, quality: 'snapshot' });
      // PrivateCircle fallback is a valid source, so clear the stale flag it set
      for (const r of rowsOf('kent')) if (entries.some((e) => e.year === r.year)) delete r.stale;
      console.log(`[spend] kent: fell back to PrivateCircle (${n} year(s))`);
    } else if (res.attempted) {
      console.log('[spend] kent: no PrivateCircle fallback; last-good kept (stale)');
    }
  }
}

if (session) await session.close();

// ---- never regress: no field may become null/NaN -------------------------
let restored = 0;
for (const id of Object.keys(data.byBrand)) {
  const good = (lastGood.byBrand[id] || []);
  for (const r of data.byBrand[id]) {
    const g = good.find((x) => x.year === r.year) || {};
    for (const f of ['revenue', 'advertisement', 'sellingPromo']) {
      if (num(r[f]) == null) { if (num(g[f]) != null) { r[f] = g[f]; restored++; } }
    }
    if (!r.quality) r.quality = g.quality || 'estimated';
  }
}
if (restored) console.log(`[spend] restored ${restored} field(s) from last-good (never-regress guard)`);

// ---- write + refresh seed (only when meaningful content changed) ----------
if (writeIfChanged(SPEND_PATH, data, lastGood)) {
  console.log('[spend] wrote public/data/spend.json');
  refreshSeed();
} else {
  console.log('[spend] no change vs last-good; nothing to write');
}
console.log('[spend] done.');
process.exit(0);
