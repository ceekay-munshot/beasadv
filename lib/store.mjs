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

// refresh seed.js by running gen-data.mjs in its default (mirror) mode
export function refreshSeed() {
  try { execFileSync('node', [join(ROOT, 'scripts', 'gen-data.mjs')], { stdio: 'inherit' }); }
  catch (e) { console.error(`[store] seed refresh failed: ${e.message}`); }
}

export const nowISO = () => new Date().toISOString();
export const monthLabel = (d = new Date()) =>
  `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}'${String(d.getUTCFullYear()).slice(2)}`;
