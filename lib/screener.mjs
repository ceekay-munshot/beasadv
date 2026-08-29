// lib/screener.mjs — a best-effort screener.in session via playwright-core.
//
//   const s = await openScreenerSession();
//   s.loggedIn, s.note
//   await s.searchCompany('Eureka Forbes')  -> [{ name, url }]
//   await s.fetchRenderedHtml(url)          -> html | null
//   await s.downloadBuffer(pdfUrl)          -> Buffer | null
//   await s.close();
//
// Degrades gracefully at every step: if playwright-core is missing or Chromium
// won't launch, methods no-op (return null / []). If login fails or there are no
// credentials, it continues logged-out. Never throws. Polite 1.5s min interval.
import { chromiumLaunchOptions } from './store.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

export async function openScreenerSession() {
  const s = {
    loggedIn: false,
    note: '',
    browser: null,
    context: null,
    page: null,
    _last: 0,
    async _polite() { const dt = Date.now() - this._last; if (dt < 1500) await sleep(1500 - dt); this._last = Date.now(); },
    async fetchRenderedHtml(url) {
      if (!this.page) return null;
      try { await this._polite(); await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); return await this.page.content(); }
      catch (e) { console.error(`[screener] fetchRenderedHtml ${url}: ${e.message}`); return null; }
    },
    async downloadBuffer(url) {
      if (!this.context) return null;
      try {
        await this._polite();
        const resp = await this.context.request.get(url, { timeout: 60000 });
        if (!resp.ok()) { console.error(`[screener] downloadBuffer ${resp.status()} ${url}`); return null; }
        return await resp.body();
      } catch (e) { console.error(`[screener] downloadBuffer ${url}: ${e.message}`); return null; }
    },
    async searchCompany(q) {
      if (!this.context) return [];
      try {
        await this._polite();
        const resp = await this.context.request.get('https://www.screener.in/api/company/search/?q=' + encodeURIComponent(q), { timeout: 30000 });
        if (!resp.ok()) { console.error(`[screener] searchCompany ${resp.status()} ${q}`); return []; }
        const arr = await resp.json();
        return (Array.isArray(arr) ? arr : []).map((x) => ({ name: x.name, url: x.url }));
      } catch (e) { console.error(`[screener] searchCompany ${q}: ${e.message}`); return []; }
    },
    async close() { try { if (this.browser) await this.browser.close(); } catch (e) { /* ignore */ } },
  };

  let pw;
  try { pw = await import('playwright-core'); }
  catch (e) { s.note = 'playwright-core not installed; screener disabled'; console.error(`[screener] ${s.note}`); return s; }

  try {
    s.browser = await pw.chromium.launch(chromiumLaunchOptions());
    s.context = await s.browser.newContext({ userAgent: UA });
    s.page = await s.context.newPage();
  } catch (e) {
    s.note = `chromium launch failed (${e.message}); screener disabled`;
    console.error(`[screener] ${s.note}`);
    await s.close();
    s.browser = s.context = s.page = null;
    return s;
  }

  const email = process.env.SCREENER_EMAIL, pass = process.env.SCREENER_PASSWORD;
  if (email && pass) {
    try {
      await s._polite();
      await s.page.goto('https://www.screener.in/login/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await s.page.fill('#id_username, input[name=username]', email);
      await s.page.fill('#id_password, input[name=password]', pass);
      await Promise.all([
        s.page.waitForLoadState('networkidle').catch(() => {}),
        s.page.click('button[type=submit], input[type=submit]'),
      ]);
      s.loggedIn = !/\/login\/?$/.test(s.page.url());
      s.note = s.loggedIn ? 'logged in' : 'login did not complete; continuing logged-out';
    } catch (e) {
      s.note = `login failed (${e.message}); continuing logged-out`;
      console.error(`[screener] ${s.note}`);
    }
  } else {
    s.note = 'no screener credentials; continuing logged-out';
  }
  console.log(`[screener] ${s.note}`);
  return s;
}
