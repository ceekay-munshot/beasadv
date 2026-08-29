/* data.js — loads and caches the /data/*.json files.
 * Prefers a live fetch (so a real server exercises the loading / empty / error
 * states) and falls back to the embedded window.__SEED__ mirror when fetch is
 * unavailable — e.g. when index.html is opened as a file:// URL, where browsers
 * block fetch() of local files. Exposed as window.Data (classic script). */
window.Data = (function () {
  'use strict';

  // friendly section key -> file, and -> seed key (file basename)
  const FILES = {
    meta: 'meta.json', spend: 'spend.json', search: 'search-trends.json',
    social: 'social.json', reviews: 'reviews.json', ai: 'ai-visibility.json',
  };
  const SEEDKEY = {
    meta: 'meta', spend: 'spend', search: 'search-trends',
    social: 'social', reviews: 'reviews', ai: 'ai-visibility',
  };
  const cache = {};

  function seedFor(key) {
    const sk = SEEDKEY[key];
    return window.__SEED__ && window.__SEED__[sk] != null ? window.__SEED__[sk] : null;
  }
  const ok = (data, source) => ({ status: 'ok', data, source });

  async function loadSection(key) {
    if (cache[key]) return cache[key];
    // Under file:// the browser blocks fetch() of local files (and logs a console
    // error for each attempt). Go straight to the embedded seed instead.
    if (location.protocol === 'file:') {
      const seed = seedFor(key);
      return (cache[key] = seed != null ? ok(seed, 'seed') : { status: 'error', error: new Error('No embedded data for ' + key) });
    }
    const file = FILES[key];
    let res;
    try {
      res = await fetch('data/' + file, { cache: 'no-store' });
    } catch (netErr) {
      // network error — typically file:// . Fall back to the seed silently.
      const seed = seedFor(key);
      return (cache[key] = seed != null ? ok(seed, 'seed') : { status: 'error', error: netErr });
    }
    if (res.status === 404) {
      const seed = seedFor(key);
      return (cache[key] = seed != null ? ok(seed, 'seed') : { status: 'empty' });
    }
    if (!res.ok) return (cache[key] = { status: 'error', error: new Error('HTTP ' + res.status) });
    let text;
    try {
      text = await res.text();
    } catch (e) {
      const seed = seedFor(key);
      return (cache[key] = seed != null ? ok(seed, 'seed') : { status: 'error', error: e });
    }
    try {
      return (cache[key] = ok(JSON.parse(text), 'fetch'));
    } catch (parseErr) {
      return (cache[key] = { status: 'error', error: parseErr }); // red card on bad JSON
    }
  }

  async function loadAll(keys) {
    const entries = await Promise.all(keys.map(async (k) => [k, await loadSection(k)]));
    return Object.fromEntries(entries);
  }

  return {
    loadSection,
    loadAll,
    cache,
    _clear() { for (const k in cache) delete cache[k]; },
  };
})();
