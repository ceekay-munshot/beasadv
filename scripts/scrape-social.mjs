#!/usr/bin/env node
// ---------------------------------------------------------------------------
// scrape-social.mjs — refresh public/data/social.json (YouTube + Instagram).
//
//   YouTube   YouTube Data API v3 if YOUTUBE_API_KEY is set, else scrape the
//             channel page for the subscriber count.
//   Instagram best-effort: playwright-core login if INSTAGRAM_USERNAME/PASSWORD
//             are set, else scrape the public profile; keep last-good on failure.
//
// Preserves social.json's shape (youtube / instagram / engagementRate / total /
// growthSeries per brand; total = youtube + instagram). Only overwrites a number
// actually retrieved; engagementRate and growthSeries stay last-good. Applies the
// never-regress guard, degrades gracefully with no keys, and exits 0.
import { dataPath, readJSON, writeIfChanged, refreshSeed, num, parseCompact, nowISO, chromiumLaunchOptions } from '../lib/store.mjs';
import { fetchDoc, scrapeAvailable } from '../lib/scrape.mjs';

const SOCIAL = dataPath('social.json');
const SOURCES = dataPath('manual/sources.json');

const data = readJSON(SOCIAL);
if (!data || !data.byBrand) { console.error('[social] social.json unreadable; exiting 0'); process.exit(0); }
const lastGood = JSON.parse(JSON.stringify(data));
const sources = readJSON(SOURCES, { byBrand: {} });
data._provenance = data._provenance || {};
data._provenance.byBrand = data._provenance.byBrand || {};

// ---- YouTube --------------------------------------------------------------
async function ytApi(src) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  const q = src.youtubeChannelId ? `id=${src.youtubeChannelId}` : src.youtubeHandle ? `forHandle=${encodeURIComponent(src.youtubeHandle)}` : null;
  if (!q) return null;
  try {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics&${q}&key=${key}`);
    console.log(`[social] youtube api ${res.status}`);
    if (!res.ok) return null;
    const j = await res.json();
    const stats = j?.items?.[0]?.statistics;
    return stats ? num(stats.subscriberCount) : null;
  } catch (e) { console.error(`[social] youtube api error: ${e.message}`); return null; }
}
async function ytScrape(src) {
  if (!scrapeAvailable()) return null;
  const url = src.youtubeChannelId ? `https://www.youtube.com/channel/${src.youtubeChannelId}`
    : src.youtubeHandle ? `https://www.youtube.com/@${src.youtubeHandle}` : null;
  if (!url) return null;
  const doc = await fetchDoc(url);
  const text = doc && (doc.html || doc.markdown);
  if (!text) return null;
  const m = text.match(/([\d.,]+\s*[KMB]?)\s*subscribers/i);
  return m ? parseCompact(m[1]) : null;
}

// ---- Instagram (best-effort) ---------------------------------------------
async function igScrape(username) {
  if (!scrapeAvailable()) return null;
  const doc = await fetchDoc(`https://www.instagram.com/${username}/`);
  const text = doc && (doc.html || doc.markdown);
  if (!text) return null;
  const m = text.match(/([\d.,]+\s*[KMB]?)\s*Followers/i) || text.match(/"edge_followed_by":\{"count":(\d+)\}/);
  return m ? (m[1].match(/^\d+$/) ? num(m[1]) : parseCompact(m[1])) : null;
}
async function igPlaywright(username) {
  const user = process.env.INSTAGRAM_USERNAME, pass = process.env.INSTAGRAM_PASSWORD;
  if (!user || !pass) return null;
  let pw;
  try { pw = await import('playwright-core'); } catch { console.error('[social] playwright-core missing for IG'); return null; }
  let browser;
  try {
    browser = await pw.chromium.launch(chromiumLaunchOptions());
    const page = await browser.newPage();
    await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.fill('input[name=username]', user);
    await page.fill('input[name=password]', pass);
    await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), page.click('button[type=submit]')]);
    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const meta = await page.getAttribute('meta[property="og:description"]', 'content').catch(() => null);
    const m = meta && meta.match(/([\d.,]+\s*[KMB]?)\s*Followers/i);
    return m ? parseCompact(m[1]) : null;
  } catch (e) { console.error(`[social] IG playwright error: ${e.message}`); return null; }
  finally { try { if (browser) await browser.close(); } catch {} }
}

// ---- run ------------------------------------------------------------------
const now = nowISO();
let anyReal = false;
for (const id of Object.keys(data.byBrand)) {
  const src = sources.byBrand[id] || {};
  const b = data.byBrand[id];
  const prov = { fetchedAt: now };

  // YouTube
  const ytAttempted = !!(process.env.YOUTUBE_API_KEY || (scrapeAvailable() && (src.youtubeChannelId || src.youtubeHandle)));
  let yt = await ytApi(src); let ytSrc = yt != null ? 'youtube-api' : null;
  if (yt == null) { yt = await ytScrape(src); if (yt != null) ytSrc = 'youtube-scrape'; }
  if (num(yt) != null) { b.youtube = num(yt); anyReal = true; }
  prov.youtube = ytSrc || (ytAttempted ? 'last-good' : 'estimated');

  // Instagram
  const igAttempted = !!((process.env.INSTAGRAM_USERNAME && process.env.INSTAGRAM_PASSWORD) || (scrapeAvailable() && src.instagram));
  let ig = null, igSrc = null;
  if (src.instagram) {
    ig = await igPlaywright(src.instagram); if (ig != null) igSrc = 'instagram';
    if (ig == null) { ig = await igScrape(src.instagram); if (ig != null) igSrc = 'instagram-scrape'; }
  }
  // Trust the live scrape (followers legitimately jump as brands grow); reject
  // only obvious garbage — null, 0, or an absurd value — and keep last-good then.
  if (num(ig) != null && (num(ig) <= 0 || num(ig) > 5000000)) {
    console.error(`[social] ${id}: IG ${ig} out of sane range; keeping last-good`);
    ig = null; igSrc = null;
  }
  if (num(ig) != null) { b.instagram = num(ig); anyReal = true; }
  prov.instagram = igSrc || (igAttempted ? 'last-good' : 'estimated');

  // recompute total from whatever we have
  b.total = (num(b.youtube) || 0) + (num(b.instagram) || 0);
  if ((ytAttempted && ytSrc == null) || (igAttempted && igSrc == null)) prov.stale = true;
  // only rewrite a brand's provenance when we actually attempted it (keys present);
  // a no-key run leaves the existing (real) provenance untouched → no-op commit
  if (ytAttempted || igAttempted) data._provenance.byBrand[id] = prov;
}
if (anyReal) { data._provenance.source = 'YouTube + Instagram'; data._provenance.fetchedAt = now; }
else if (!data._provenance.source) { data._provenance.source = 'estimated'; data._provenance.fetchedAt = now; }

// ---- never regress --------------------------------------------------------
let restored = 0;
for (const id of Object.keys(data.byBrand)) {
  const g = lastGood.byBrand[id] || {};
  for (const f of ['youtube', 'instagram', 'engagementRate', 'total']) {
    if (num(data.byBrand[id][f]) == null) { if (num(g[f]) != null) { data.byBrand[id][f] = g[f]; restored++; } }
  }
  if (!Array.isArray(data.byBrand[id].growthSeries) || !data.byBrand[id].growthSeries.length) data.byBrand[id].growthSeries = g.growthSeries;
}
if (restored) console.log(`[social] restored ${restored} field(s) from last-good`);

if (writeIfChanged(SOCIAL, data, lastGood)) {
  console.log(`[social] wrote social.json (source: ${data._provenance.source})`);
  refreshSeed();
} else {
  console.log('[social] no change vs last-good; nothing to write');
}
process.exit(0);
