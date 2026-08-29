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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEND_PATH = join(ROOT, 'public', 'data', 'spend.json');
const PC_PATH = join(ROOT, 'public', 'data', 'manual', 'private-circle.json');
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
  for (const r of rowsOf(id)) r.stale = true;
  setProv(id, { stale: true, fetchedAt: NOW });
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
function findPdfLinks(html) {
  if (!html) return [];
  const out = [];
  const re = /href="([^"]+\.pdf[^"]*)"/gi; let m;
  while ((m = re.exec(html))) out.push(m[1]);
  // prefer annual-report-looking links
  return out.sort((a, b) => (/(annual|financial|report)/i.test(b) ? 1 : 0) - (/(annual|financial|report)/i.test(a) ? 1 : 0));
}
const abs = (base, href) => { try { return new URL(href, base).href; } catch { return href; } };

// ---- 2) Aquaguard (Eureka Forbes Ltd) ------------------------------------
async function extractListed({ id, entity, query, knownCompanyPath }) {
  if (!scrapeAvailable() || !llmAvailable()) {
    console.log(`[spend] ${id}: no scrape/LLM keys — not attempted, keeping last-good`);
    return { attempted: false };
  }
  try {
    const s = await getSession();
    let companyUrl = knownCompanyPath ? 'https://www.screener.in' + knownCompanyPath : null;
    const hits = await s.searchCompany(query);
    if (hits.length) {
      const hit = hits.find((h) => new RegExp(entity.split(' ')[0], 'i').test(h.name)) || hits[0];
      if (hit && hit.url) companyUrl = 'https://www.screener.in' + hit.url;
    }
    if (!companyUrl) throw new Error('company page not found');
    const pageHtml = await s.fetchRenderedHtml(companyUrl);
    const pdfs = findPdfLinks(pageHtml).map((h) => abs(companyUrl, h));
    if (!pdfs.length) throw new Error('no annual-report PDF link found');
    let extracted = null, sourceDoc = null;
    for (const pdf of pdfs.slice(0, 3)) {
      const doc = await fetchDoc(pdf);
      const md = doc && (doc.markdown || doc.html);
      if (!md) continue;
      const { data: out } = await completeJSON({ prompt: extractPrompt(entity, md), system: EXTRACT_SYSTEM, schema: EXTRACT_SCHEMA });
      if (out && Array.isArray(out.years) && out.years.some((y) => num(y.advertisement) != null || num(y.sellingPromo) != null || num(y.revenue) != null)) {
        extracted = out.years; sourceDoc = pdf; break;
      }
    }
    if (!extracted) throw new Error('extraction produced no usable figures');
    const n = mergeYears(id, extracted, 'disclosed');
    setProv(id, { sourceDoc, note: 'Company-wide Advertisement + Selling & Sales Promotion (Other Expenses)', fetchedAt: NOW, quality: 'disclosed' });
    console.log(`[spend] ${id}: extracted ${n} year(s) from ${sourceDoc}`);
    return { attempted: true, ok: true };
  } catch (e) {
    console.error(`[spend] ${id}: extraction failed (${e.message}); keeping last-good, marking stale`);
    markStale(id);
    return { attempted: true, ok: false };
  }
}

// ---- run ------------------------------------------------------------------
await extractListed({ id: 'aquaguard', entity: 'Eureka Forbes', query: 'Eureka Forbes', knownCompanyPath: '/company/EUREKAFORB/' });

// Kent: attempt listed extraction; else fall back to PrivateCircle
{
  const res = await extractListed({ id: 'kent', entity: 'Kent RO Systems', query: 'Kent RO Systems' });
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

// ---- write + refresh seed -------------------------------------------------
writeFileSync(SPEND_PATH, JSON.stringify(data, null, 2) + '\n');
console.log('[spend] wrote public/data/spend.json');
try {
  execFileSync('node', [join(ROOT, 'scripts', 'gen-data.mjs')], { stdio: 'inherit' });
} catch (e) {
  console.error(`[spend] gen-data refresh failed: ${e.message}`);
}
console.log('[spend] done.');
process.exit(0);
