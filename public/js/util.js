/* util.js — formatting helpers + the derived-metric math (Pull score, signals,
 * verdicts). Pure functions, no DOM. Exposed as window.Util so the file works as
 * a classic <script> (needed for file:// support). */
(function () {
  'use strict';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const avg = (a) => (a.length ? sum(a) / a.length : 0);

  // ---- number formatting (all tabular-friendly) ---------------------------
  const inGroup = (n) => Math.round(n).toLocaleString('en-IN');
  const fmtInt = (n) => inGroup(n);
  const fmtCr = (n) => `₹${inGroup(n)} cr`;
  const fmtPct = (n, d = 1) => `${Number(n).toFixed(d)}%`;
  const fmtSignedPct = (n, d = 1) => `${n >= 0 ? '+' : ''}${Number(n).toFixed(d)} pp`;
  const fmtRating = (n) => Number(n).toFixed(1);
  function fmtCompact(n) {
    const a = Math.abs(n);
    if (a >= 1e7) return (n / 1e6).toFixed(0) + 'M';
    if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e5) return (n / 1e3).toFixed(0) + 'K';
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(Math.round(n));
  }

  // ---- spend helpers ------------------------------------------------------
  const aspTotal = (row) => row.advertisement + row.sellingPromo;
  const aspByKind = (row, kind) => (kind === 'ad' ? row.advertisement : aspTotal(row));
  const aspPct = (row, kind) => (aspByKind(row, kind) / row.revenue) * 100;

  // ---- search helpers -----------------------------------------------------
  function fyAverages(series) {
    const out = [];
    for (let i = 0; i < series.length; i += 4) out.push(+avg(series.slice(i, i + 4)).toFixed(1));
    return out; // one value per fiscal year
  }
  const latestFyAvg = (series) => +avg(series.slice(-4)).toFixed(1);

  // ---- normalisation ------------------------------------------------------
  // log-normalise a value to 0..100 across a set (spreads wide-range signals
  // like followers / review counts so small brands aren't all flat-zero).
  function logNorm(v, values) {
    const ls = values.map((x) => Math.log(x + 1));
    const lo = Math.min(...ls), hi = Math.max(...ls);
    if (hi === lo) return 100;
    return clamp(((Math.log(v + 1) - lo) / (hi - lo)) * 100, 0, 100);
  }

  // ---- signals + Pull score ----------------------------------------------
  // Builds a 0..100 score per brand for each demand/mind-share signal plus a
  // "raw" display value for tooltips. Normalised across ALL brands so scores
  // are stable regardless of the active filter.
  function buildSignals(data) {
    const brands = data.meta.brands;
    const latestTrend = (id) => { const s = data.search.byBrand[id] || []; return s.length ? s[s.length - 1] : 0; };
    const socialReach = (s) => ((s && s.youtube) || 0) + ((s && s.instagram) || 0); // youtube + instagram only (Facebook dropped)
    const socialTotals = brands.map((b) => socialReach(data.social.byBrand[b.id]));
    const spendTotals = brands.map((b) => {
      const rows = data.spend.byBrand[b.id]; return rows ? aspTotal(rows[rows.length - 1]) : 0;
    });
    // each Pull signal is normalised as share-of-max across the 5 brands
    const maxSearch = Math.max(1, ...brands.map((b) => latestTrend(b.id)));
    const maxSocial = Math.max(1, ...socialTotals);
    const maxAi = Math.max(1, ...brands.map((b) => (((data.ai.byBrand[b.id] || {}).overall || {}).visibilityPct) || 0));
    const maxLogRev = Math.max(1, ...brands.map((b) => Math.log(((data.reviews.byBrand[b.id] || {}).totalCount || 0) + 1)));
    const shareOfMax = (v, max) => (max > 0 ? clamp((v / max) * 100, 0, 100) : 0);
    const out = {};
    brands.forEach((b) => {
      const searchLatest = latestTrend(b.id);      // latest Google-Trends point (0..100)
      const social = data.social.byBrand[b.id] || {};
      const reviews = data.reviews.byBrand[b.id] || {};
      const ai = (data.ai.byBrand[b.id] || {}).overall || { visibilityPct: 0 };
      const spendRows = data.spend.byBrand[b.id] || [];
      const spendLatest = spendRows.length ? aspTotal(spendRows[spendRows.length - 1]) : 0;
      // reviews: log-scaled rating-count (share-of-max) blended with avg rating
      const reviewsScore = 0.75 * shareOfMax(Math.log((reviews.totalCount || 0) + 1), maxLogRev) + 0.25 * (((reviews.avgRating || 0) / 5) * 100);
      out[b.id] = {
        score: {
          spend: logNorm(spendLatest, spendTotals),
          search: shareOfMax(searchLatest, maxSearch),
          social: shareOfMax(socialReach(social), maxSocial),
          reviews: clamp(reviewsScore, 0, 100),
          ai: shareOfMax(ai.visibilityPct || 0, maxAi),
        },
        raw: {
          spend: spendLatest,               // ₹ cr
          search: searchLatest,             // latest trends index 0..100
          social: socialReach(social),      // followers (youtube + instagram)
          reviews: reviews.totalCount || 0, // review count
          ai: ai.visibilityPct || 0,        // %
        },
      };
    });
    return out;
  }

  // Composite Pull score = demand side only (spend excluded on purpose).
  // Tunable weights, documented here in one place: search 30% / social 25% /
  // reviews 25% / AI visibility 20%.
  const PULL_WEIGHTS = { search: 0.30, social: 0.25, reviews: 0.25, ai: 0.20 };
  function pullScore(sig) {
    const s = sig.score;
    return Math.round(
      s.search * PULL_WEIGHTS.search + s.social * PULL_WEIGHTS.social +
      s.reviews * PULL_WEIGHTS.reviews + s.ai * PULL_WEIGHTS.ai
    );
  }

  // Plain-English verdict: spend intensity (A&SP % of revenue trend) × pull.
  function verdict(spendPct, pull) {
    const spendRising = spendPct.delta > 1;   // A&SP % of revenue up >1pp over the years
    const pullHigh = pull.score >= 55;
    const pullRising = pull.trend.delta > 4;  // trends interest rising over the years
    if (spendRising && (pullHigh || pullRising)) return { label: "Spending, and it's working", tone: 'good' };
    if (spendRising) return { label: "Spending hard — pull isn't keeping up", tone: 'warn' };
    if (pullHigh) return { label: 'Strong organic pull', tone: 'good' };
    return { label: 'Quiet on both', tone: 'mid' };
  }

  // Everything the Overview + Vs tabs need, per brand.
  function computePull(data) {
    const signals = buildSignals(data);
    const byBrand = {};
    data.meta.brands.forEach((b) => {
      const sig = signals[b.id];
      const spendRows = data.spend.byBrand[b.id] || [];
      const firstRow = spendRows[0], lastRow = spendRows[spendRows.length - 1];
      const spendPct = firstRow ? {
        first: aspPct(firstRow, 'adsp'), last: aspPct(lastRow, 'adsp'),
        delta: aspPct(lastRow, 'adsp') - aspPct(firstRow, 'adsp'),
      } : { first: 0, last: 0, delta: 0 };
      const fyPull = fyAverages(data.search.byBrand[b.id] || []);
      const score = pullScore(sig);
      const pull = {
        score,
        byFy: fyPull,
        trend: { first: fyPull[0] || 0, last: fyPull[fyPull.length - 1] || 0, delta: (fyPull[fyPull.length - 1] || 0) - (fyPull[0] || 0) },
      };
      byBrand[b.id] = {
        score, signals: sig.score, raw: sig.raw, spendPct, pull,
        spark: (data.search.byBrand[b.id] || []).slice(-10),
        verdict: verdict(spendPct, pull),
      };
    });
    return { signals, byBrand };
  }

  // ---- misc ---------------------------------------------------------------
  const QUALITY = {
    disclosed: { text: 'Disclosed', cls: 'badge-disclosed' },
    snapshot: { text: 'Snapshot', cls: 'badge-snapshot' },
    'private-circle': { text: 'PrivateCircle', cls: 'badge-private' },
    estimated: { text: 'Estimated', cls: 'badge-estimated' },
  };
  const qualityBadge = (q) => QUALITY[q] || QUALITY.estimated;

  const SHORT = {
    aquaguard: 'Aquaguard', kent: 'Kent',
    livpure: 'Livpure', pureit: 'Pureit', aosmith: 'AO Smith',
  };
  const shortName = (id) => SHORT[id] || id;

  // heat-strip colour: score 0(weak/red) .. 100(strong/green)
  function heatColor(score) {
    const h = (clamp(score, 0, 100) / 100) * 140; // 0 red -> 140 green
    return { bg: `hsl(${h} 78% 90%)`, fg: `hsl(${h} 55% 28%)`, dot: `hsl(${h} 65% 45%)` };
  }

  window.Util = {
    clamp, sum, avg,
    fmtInt, fmtCr, fmtPct, fmtSignedPct, fmtRating, fmtCompact,
    aspTotal, aspByKind, aspPct, fyAverages, latestFyAvg, logNorm,
    buildSignals, pullScore, computePull, verdict,
    qualityBadge, shortName, heatColor,
  };
})();
