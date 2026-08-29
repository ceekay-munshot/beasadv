#!/usr/bin/env node
// ---------------------------------------------------------------------------
// scrape-ai.mjs — refresh public/data/ai-visibility.json by asking the LLMs we
// actually have (Bedrock Claude + Mistral) a battery of buyer questions and
// measuring how often each brand is named.
//
// For each (platform, question) one completeJSONWith() call returns the brands
// the model would mention, with rank + sentiment. We aggregate per platform and
// an "all" merge: visibilityPct, shareOfVoice, sentiment{pos,neu,neg}, sampleGaps.
// Preserves ai-visibility.json's shape (platforms / platformLabels / byBrand →
// overall + byPlatform + sampleGaps). Degrades gracefully: no LLM keys → keep
// the current data, exit 0. never-regress; adds _provenance. ~15 Q × 2 = 30 calls.
// ---------------------------------------------------------------------------
import { dataPath, readJSON, writeIfChanged, refreshSeed, nowISO } from '../lib/store.mjs';
import { completeJSONWith, providerAvailable } from '../lib/llm.mjs';

const AI_PATH = dataPath('ai-visibility.json');
const META = readJSON(dataPath('meta.json'), { brands: [] });
const IDS = META.brands.map((b) => b.id);
const DISPLAY = META.brands.map((b) => b.name).join(', ');

const PLATFORMS = ['claude', 'mistral'];
const PLATFORM_LABELS = { claude: 'Claude', mistral: 'Mistral' };

const QUESTIONS = [
  'What is the best water purifier brand in India?',
  'Which RO water purifier is best for hard/high-TDS water in India?',
  'Best water purifier under ₹15,000 in India?',
  'Which water purifier brand has the best after-sales service in India?',
  'Aquaguard vs Kent — which should I buy?',
  'Most reliable water purifier for a family of four in India?',
  'Best water purifier for borewell water in India?',
  'Which water purifier brand is most trusted in India?',
  'Best budget water purifier in India in 2026?',
  'Which water purifier has the lowest maintenance cost in India?',
  'Best copper/mineral water purifier in India?',
  'Top water purifier brands in India by market share?',
  'Best water purifier for municipal tap water in India?',
  'Best premium water purifier in India?',
  'Which water purifier brand should I avoid in India?',
];

const MENTION_SCHEMA = {
  type: 'object', required: ['mentions'],
  properties: {
    mentions: {
      type: 'array',
      items: {
        type: 'object', required: ['brand'],
        properties: { brand: { type: 'string' }, rank: { type: ['number', 'null'] }, sentiment: { type: 'string' } },
      },
    },
  },
};
const SYSTEM = 'You are a knowledgeable India water-purifier advisor. Answer from your own knowledge (no browsing).';
const promptFor = (q) =>
  `${q}\n\nFrom this exact list [${DISPLAY}], return which of these brands you would mention in your answer, each with:\n` +
  `- rank: 1 = named most prominently (or null)\n- sentiment: "positive" | "neutral" | "negative"\n` +
  `Return {"mentions":[{"brand","rank","sentiment"}]}. Only include brands from the list you would actually mention.`;

// brand-name normalisation
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const NAME2ID = {};
META.brands.forEach((b) => { NAME2ID[norm(b.name)] = b.id; NAME2ID[norm(b.id)] = b.id; });
Object.assign(NAME2ID, { eurekaforbes: 'aquaguard', eureka: 'aquaguard', kentro: 'kent', kentrosystems: 'kent', aosmith: 'aosmith' });
const brandId = (s) => NAME2ID[norm(s)] || null;
const sentOf = (s) => { const n = norm(s); return n.startsWith('neg') ? 'neg' : n.startsWith('neu') ? 'neu' : n.startsWith('pos') ? 'pos' : 'neu'; };

// ---- load current ---------------------------------------------------------
const data = readJSON(AI_PATH);
if (!data || !data.byBrand) { console.error('[ai] ai-visibility.json unreadable; exiting 0'); process.exit(0); }
const lastGood = JSON.parse(JSON.stringify(data));
const now = nowISO();

function keepLastGood(reason) {
  console.log('[ai] ' + reason + '; keeping last-good');
  // preserve existing provenance; only stamp 'estimated' if none is present yet
  if (!data._provenance || !data._provenance.source) data._provenance = { source: 'estimated', fetchedAt: now };
  if (writeIfChanged(AI_PATH, data, lastGood)) refreshSeed();
  process.exit(0);
}

if (!PLATFORMS.some((p) => providerAvailable(p))) keepLastGood('no LLM provider configured');

// ---- query ----------------------------------------------------------------
const perPlatform = {}; // pf -> { answered, records:[{q,brand,sentiment}] }
for (const pf of PLATFORMS) {
  if (!providerAvailable(pf)) { console.log(`[ai] ${pf}: not configured, skipping`); continue; }
  const rec = { answered: 0, records: [] };
  for (const q of QUESTIONS) {
    try {
      const { data: out } = await completeJSONWith(pf, { system: SYSTEM, prompt: promptFor(q), schema: MENTION_SCHEMA });
      rec.answered++;
      for (const m of out.mentions || []) {
        const id = brandId(m.brand);
        if (id) rec.records.push({ q, brand: id, sentiment: sentOf(m.sentiment) });
      }
    } catch (e) { console.error(`[ai] ${pf} "${q.slice(0, 42)}…": ${e.message}`); }
  }
  if (rec.answered > 0) perPlatform[pf] = rec;
  console.log(`[ai] ${pf}: answered ${rec.answered}/${QUESTIONS.length}, ${rec.records.length} mentions`);
}

const platformsUsed = Object.keys(perPlatform);
const totalAnswered = platformsUsed.reduce((s, pf) => s + perPlatform[pf].answered, 0);
if (!platformsUsed.length || totalAnswered < 8) keepLastGood('too few answers this run');

// ---- aggregate ------------------------------------------------------------
function agg(records, answeredUnits) {
  const bb = {}; IDS.forEach((id) => (bb[id] = { units: new Set(), qs: new Set(), n: 0, pos: 0, neu: 0, neg: 0 }));
  for (const r of records) { const x = bb[r.brand]; if (!x) continue; x.units.add(r.unit); x.qs.add(r.q); x.n++; x[r.sentiment]++; }
  const total = IDS.reduce((s, id) => s + bb[id].n, 0) || 1;
  const out = {};
  IDS.forEach((id) => {
    const x = bb[id], n = x.n;
    out[id] = {
      visibilityPct: Math.round((x.units.size / answeredUnits) * 100),
      shareOfVoice: +((n / total) * 100).toFixed(1),
      sentiment: n > 0
        ? { pos: Math.round((x.pos / n) * 100), neu: Math.round((x.neu / n) * 100), neg: Math.round((x.neg / n) * 100) }
        : { pos: 0, neu: 0, neg: 0 },
      gaps: QUESTIONS.filter((q) => !x.qs.has(q)).slice(0, 4),
    };
  });
  return out;
}

const aggByPlatform = {};
platformsUsed.forEach((pf) => { aggByPlatform[pf] = agg(perPlatform[pf].records.map((r) => ({ ...r, unit: r.q })), perPlatform[pf].answered); });
const allRecords = platformsUsed.flatMap((pf) => perPlatform[pf].records.map((r) => ({ ...r, unit: pf + '|' + r.q })));
const aggAll = agg(allRecords, totalAnswered);

// ---- assemble (preserve shape) --------------------------------------------
const out = {
  platforms: platformsUsed,
  platformLabels: Object.fromEntries(platformsUsed.map((pf) => [pf, PLATFORM_LABELS[pf]])),
  byBrand: {},
  _provenance: { source: platformsUsed.join('+'), fetchedAt: now, platforms: platformsUsed },
};
IDS.forEach((id) => {
  const o = aggAll[id];
  const byPlatform = {};
  platformsUsed.forEach((pf) => {
    const a = aggByPlatform[pf][id];
    byPlatform[pf] = { visibilityPct: a.visibilityPct, shareOfVoice: a.shareOfVoice, sentiment: a.sentiment };
  });
  out.byBrand[id] = {
    overall: { visibilityPct: o.visibilityPct, shareOfVoice: o.shareOfVoice, sentiment: o.sentiment },
    byPlatform,
    sampleGaps: o.gaps,
    quality: 'measured',
  };
});

// ---- never-regress: if a brand somehow lost all structure, keep last-good --
IDS.forEach((id) => {
  if (!out.byBrand[id] || !out.byBrand[id].overall) out.byBrand[id] = lastGood.byBrand[id];
});

if (writeIfChanged(AI_PATH, out, lastGood)) {
  console.log(`[ai] wrote ai-visibility.json (platforms: ${platformsUsed.join(', ')})`);
  refreshSeed();
} else {
  console.log('[ai] no change vs last-good; nothing to write');
}
process.exit(0);
