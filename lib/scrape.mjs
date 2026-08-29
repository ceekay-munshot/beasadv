// lib/scrape.mjs — read web pages & PDFs, with provider failover.
//
//   fetchDoc(url)              -> { markdown, html } | null   (Firecrawl, then Scrape.do)
//   extractStructured(url, s)  -> object | null              (Firecrawl JSON mode)
//
// Global fetch only. Logs HTTP status; NEVER throws (callers keep last-good).
const hasFirecrawl = () => !!process.env.FIRECRAWL_API_KEY;
const hasScrapedo = () => !!process.env.SCRAPEDO_API_KEY;

export function scrapeAvailable() {
  return hasFirecrawl() || hasScrapedo();
}

async function firecrawlScrape(url) {
  if (!hasFirecrawl()) return null;
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['markdown', 'html'], onlyMainContent: false }),
    });
    console.log(`[scrape] firecrawl ${res.status} ${url}`);
    if (!res.ok) return null;
    const j = await res.json();
    const d = j?.data || {};
    if (!d.markdown && !d.html) return null;
    return { markdown: d.markdown || null, html: d.html || null };
  } catch (e) {
    console.error(`[scrape] firecrawl error ${url}: ${e.message}`);
    return null;
  }
}

async function scrapedoFetch(url) {
  if (!hasScrapedo()) return null;
  try {
    const api = `https://api.scrape.do/?token=${process.env.SCRAPEDO_API_KEY}&url=${encodeURIComponent(url)}&render=true`;
    const res = await fetch(api);
    console.log(`[scrape] scrape.do ${res.status} ${url}`);
    if (!res.ok) return null;
    const html = await res.text();
    if (!html) return null;
    return { markdown: null, html };
  } catch (e) {
    console.error(`[scrape] scrape.do error ${url}: ${e.message}`);
    return null;
  }
}

export async function fetchDoc(url) {
  return (await firecrawlScrape(url)) || (await scrapedoFetch(url));
}

export async function extractStructured(url, schema) {
  if (!hasFirecrawl()) return null;
  try {
    const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, formats: ['json'], jsonOptions: { schema } }),
    });
    console.log(`[scrape] firecrawl(json) ${res.status} ${url}`);
    if (!res.ok) return null;
    const j = await res.json();
    return j?.data?.json ?? null;
  } catch (e) {
    console.error(`[scrape] firecrawl(json) error ${url}: ${e.message}`);
    return null;
  }
}
