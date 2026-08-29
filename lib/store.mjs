// lib/store.mjs — small shared helpers for the data scrapers: locate/read/write
// public/data/*.json and refresh public/js/seed.js. Keeps every scraper's
// load → merge → never-regress → write → refresh-seed flow identical.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const dataPath = (name) => join(ROOT, 'public', 'data', name);

// coerce to a finite number, else null (accepts numeric strings like "93600")
export function num(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') { const n = Number(v.replace(/[,\s]/g, '')); if (isFinite(n) && v.trim() !== '') return n; }
  return null;
}

// parse a compact count like "93.6K" / "1.2M" / "573,000" -> number|null
export function parseCompact(s) {
  if (s == null) return null;
  const m = String(s).trim().replace(/,/g, '').match(/^([\d.]+)\s*([KkMmBb])?/);
  if (!m) return null;
  const v = parseFloat(m[1]); if (!isFinite(v)) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(v * mult);
}

export function readJSON(p, fallback = null) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}
export function writeJSON(p, obj) { writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }

// Serialise ignoring volatile fields (timestamps), so a no-op scraper run whose
// only "change" would be a fresh fetchedAt is treated as unchanged.
const VOLATILE = new Set(['fetchedAt']);
export const stableStringify = (o) => JSON.stringify(o, (k, v) => (VOLATILE.has(k) ? undefined : v));

// Write only when the meaningful content changed vs last-good. Returns true if
// written (caller then refreshes the seed); false means a scheduled run produced
// no diff and the workflow's "skip if no diff" will make it a true no-op commit.
export function writeIfChanged(p, data, lastGood) {
  if (lastGood && stableStringify(data) === stableStringify(lastGood)) return false;
  writeJSON(p, data);
  return true;
}

// refresh seed.js by running gen-data.mjs in its default (mirror) mode
export function refreshSeed() {
  try { execFileSync('node', [join(ROOT, 'scripts', 'gen-data.mjs')], { stdio: 'inherit' }); }
  catch (e) { console.error(`[store] seed refresh failed: ${e.message}`); }
}

// Chromium launch options for playwright-core. Only pin executablePath when
// PLAYWRIGHT_CHROMIUM_PATH is explicitly set; otherwise let playwright-core
// resolve the browser it installed — the CI cache (~/.cache/ms-playwright) or,
// in the dev sandbox, PLAYWRIGHT_BROWSERS_PATH. (Hardcoding a path breaks CI,
// where the installed Chromium lives somewhere else entirely.)
export function chromiumLaunchOptions(extra = {}) {
  const opts = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'], ...extra };
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) opts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  return opts;
}

export const nowISO = () => new Date().toISOString();
export const monthLabel = (d = new Date()) =>
  `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}'${String(d.getUTCFullYear()).slice(2)}`;
