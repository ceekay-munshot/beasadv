/* app.js — bootstrap, tab/subtab router, controls, state, and the six tab
 * renderers. Uses window.Util / window.Data / window.Charts. Classic script
 * (no ESM) so the dashboard also runs when opened directly as a file:// URL. */
(function () {
  'use strict';

  // ----------------------------------------------------------------- state
  const S = {
    tab: 'overview',
    selected: new Set(),      // visible brand ids (global filter)
    unit: 'cr',               // 'cr' | 'pct'
    spendKind: 'adsp',        // 'ad' | 'adsp'
    heroBrand: 'aquaguard',
    web: 'search',            // subtab: 'search' | 'social'
    searchTerm: 'brand',      // 'brand' | 'category'
    social: 'size',           // 'size' | 'engagement'
    shelfMkt: 'both',         // 'both' | 'amazon' | 'flipkart'
    shelfMetric: 'reviews',   // 'reviews' | 'rating'
    aiPlatform: 'all',        // 'all' | platform id
    aiGapBrand: 'aosmith',
    vs: new Set(),            // Vs Rivals chosen brands (2..4)
    vsMetric: 'pull',
  };

  let D = {};                 // section results { meta:{status,data}, ... }
  let META, BRANDS, BRAND_BY_ID, PULL;
  const U = window.Util;

  // ----------------------------------------------------------------- helpers
  const $ = (sel, root = document) => root.querySelector(sel);
  const panelEl = (t) => document.getElementById('panel-' + t);
  const visibleBrands = () => BRANDS.filter((b) => S.selected.has(b.id));
  const colorsOf = (arr) => arr.map((b) => b.color);
  const shortsOf = (arr) => arr.map((b) => U.shortName(b.id));

  function hexAdjust(hex, amt) { // amt>0 lighten toward white, <0 darken
    const n = parseInt(hex.replace('#', ''), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
    else { const k = 1 + amt; r *= k; g *= k; b *= k; }
    return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  }
  const tone = (t) => t === 'good' ? 'text-emerald-600' : t === 'warn' ? 'text-amber-600' : t === 'weak' ? 'text-rose-500' : 'text-slate-600';
  const icons = () => { try { if (window.lucide) window.lucide.createIcons(); } catch (e) { /* icons are decorative */ } };

  function qbadge(q) {
    const b = U.qualityBadge(q);
    const note = (META.qualityNotes && META.qualityNotes[q]) || '';
    return `<span class="badge ${b.cls}" title="${note}">${b.text}</span>`;
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  // Plain-English source note for a brand's spend, from _provenance if the
  // scraper wrote one, else derived from the entity / quality tier.
  function spendProvenance(b) {
    const sp = (D.spend && D.spend.data) || {};
    const prov = (sp._provenance || {})[b.id];
    const rows = (sp.byBrand || {})[b.id] || [];
    const latest = rows[rows.length - 1] || {};
    const q = latest.quality || b.quality;
    const stale = rows.some((r) => r && r.stale) || (prov && prov.stale);
    let text;
    if (prov && (prov.note || prov.sourceDoc)) {
      text = [prov.sourceDoc, prov.note].filter(Boolean).join(' — ');
      if (prov.fetchedAt) text += ` (fetched ${String(prov.fetchedAt).slice(0, 10)})`;
    } else if (b.spendEntity) {
      text = `Source: ${b.spendEntity} — ${b.spendNote || 'company-wide advertising & sales promotion'}. Years without disclosure are modelled.`;
    } else if (q === 'private-circle') {
      text = 'Source: PrivateCircle / MCA filings (unlisted entity).';
    } else if (q === 'snapshot') {
      text = 'Source: point-in-time company filing (snapshot); other years modelled.';
    } else if (q === 'disclosed') {
      text = (META.qualityNotes && META.qualityNotes.disclosed) || 'From the audited annual report.';
    } else {
      text = (META.qualityNotes && META.qualityNotes.estimated) || 'Modelled estimate — no public brand-level disclosure.';
    }
    if (stale) text += ' • Showing last-good values (latest refresh could not confirm new numbers).';
    return text;
  }
  const provIcon = (b) => `<span class="prov" title="${esc(spendProvenance(b))}"><i data-lucide="info" class="w-3.5 h-3.5"></i></span>`;
  const qDot = (q) => q === 'disclosed' ? '#10b981' : q === 'snapshot' ? '#3b82f6' : q === 'private-circle' ? '#8b5cf6' : '#f59e0b';

  // Source affordance for a data section (search / social / reviews), driven by
  // that file's _provenance block. Returns a plain-English note for an ⓘ tooltip.
  function srcNote(key) {
    const prov = D[key] && D[key].data && D[key].data._provenance;
    if (!prov || !prov.source || prov.source === 'estimated') return 'Modelled estimate — no live source yet.';
    let t = 'Source: ' + prov.source;
    const bb = prov.byBrand || {};
    if (prov.stale || Object.keys(bb).some((k) => bb[k] && bb[k].stale)) t += ' • some values showing last-good (latest refresh incomplete)';
    if (prov.fetchedAt) t += ` (updated ${String(prov.fetchedAt).slice(0, 10)})`;
    return t;
  }
  const srcIcon = (key) => `<span class="prov" title="${esc(srcNote(key))}"><i data-lucide="info" class="w-3.5 h-3.5"></i></span>`;
  const infoIcon = (text) => `<span class="prov" title="${esc(text)}"><i data-lucide="info" class="w-3.5 h-3.5"></i></span>`;

  function seg(name, opts, current) {
    return `<div class="seg" data-seg="${name}">` + opts.map((o) =>
      `<button class="seg-btn" data-val="${o.val}" aria-pressed="${o.val === current}">${o.icon ? `<i data-lucide="${o.icon}" class="w-3.5 h-3.5"></i>` : ''}${o.label}</button>`
    ).join('') + `</div>`;
  }
  function nsel(name, opts, current) {
    return `<select class="nsel" data-select="${name}">` + opts.map((o) =>
      `<option value="${o.val}" ${o.val === current ? 'selected' : ''}>${o.label}</option>`).join('') + `</select>`;
  }
  function cardHead(title, sub, right) {
    return `<div class="flex items-start justify-between gap-3 mb-2">
      <div class="min-w-0"><div class="section-title truncate">${title}</div>${sub ? `<div class="text-[12px] text-slate-500 mt-0.5 truncate">${sub}</div>` : ''}</div>
      ${right ? `<div class="flex items-center gap-2 flex-none">${right}</div>` : ''}</div>`;
  }
  function sectionCard(res, label) {
    if (res && res.status === 'empty')
      return `<div class="card p-8 text-center"><i data-lucide="inbox" class="w-7 h-7 mx-auto text-slate-300"></i>
        <div class="mt-2 text-sm font-semibold text-slate-500">No ${label} data yet</div>
        <div class="text-xs text-slate-400">This section will fill in once data is available.</div></div>`;
    return `<div class="card p-8 text-center" style="border-color:#fecaca;background:#fef2f2">
      <i data-lucide="alert-triangle" class="w-7 h-7 mx-auto text-rose-400"></i>
      <div class="mt-2 text-sm font-semibold text-rose-600">Couldn't load ${label}</div>
      <div class="text-xs text-rose-400">${(res && res.error && res.error.message) || 'Unexpected data format.'}</div></div>`;
  }
  const NICE = { spend: 'spend', search: 'search interest', social: 'social', reviews: 'reviews', ai: 'AI answers', meta: 'brands' };
  function need(panel, keys) {
    for (const k of keys) {
      const r = D[k];
      if (!r || r.status !== 'ok') { panel.innerHTML = `<div class="grid gap-3">${sectionCard(r, NICE[k] || k)}</div>`; return null; }
    }
    const out = {}; keys.forEach((k) => (out[k] = D[k].data)); return out;
  }
  function emptyBrands(panel) {
    panel.innerHTML = `<div class="card p-10 text-center"><i data-lucide="filter-x" class="w-8 h-8 mx-auto text-slate-300"></i>
      <div class="mt-2 font-semibold text-slate-500">No brands selected</div>
      <div class="text-sm text-slate-400">Use the <span class="font-semibold">Brands</span> menu (top-right) or the coloured chips to pick at least one.</div></div>`;
  }

  // ================================================================ HEADER
  function buildHeader() {
    // legend chips (clickable = quick filter)
    $('#brand-legend').innerHTML = BRANDS.map((b) =>
      `<span class="chip" data-brandtoggle="${b.id}" data-on="${S.selected.has(b.id)}">
        <span class="dot" style="background:${b.color}"></span>${b.name}
        ${b.group ? `<span class="text-[10px] text-slate-400 font-medium">${b.group}</span>` : ''}</span>`).join('');

    $('#hdr-controls').innerHTML = `
      <span class="hidden md:inline-flex items-center gap-1.5 text-[11px] text-slate-400 mr-1">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>Updated ${META.lastUpdated}</span>
      ${seg('unit', [{ val: 'cr', label: '₹ crore', icon: 'indian-rupee' }, { val: 'pct', label: '% of revenue', icon: 'percent' }], S.unit)}
      <div class="dd" data-dd-root>
        <button class="dd-btn" data-dd><i data-lucide="layers" class="w-4 h-4 text-slate-400"></i>Brands
          <span class="num text-slate-400" id="dd-count">(${S.selected.size}/${BRANDS.length})</span>
          <i data-lucide="chevron-down" class="w-3.5 h-3.5 text-slate-400"></i></button>
        <div class="dd-menu" hidden>
          <div class="flex items-center justify-between px-1 pb-1.5 mb-1 border-b border-slate-100">
            <span class="card-label">Show brands</span>
            <div class="flex gap-1.5"><button class="text-[11px] font-bold text-sky-600" data-allbrands>All</button>
              <span class="text-slate-300">·</span><button class="text-[11px] font-bold text-slate-400" data-nobrands>Clear</button></div>
          </div>
          ${BRANDS.map((b) => `<label class="dd-item">
            <input type="checkbox" data-brandcheck="${b.id}" ${S.selected.has(b.id) ? 'checked' : ''} class="accent-sky-500 w-3.5 h-3.5">
            <span class="dot" style="background:${b.color};width:9px;height:9px;border-radius:999px"></span>
            <span class="flex-1">${b.name}</span>
            ${b.group ? `<span class="text-[10px] text-slate-400">${b.group}</span>` : ''}</label>`).join('')}
        </div>
      </div>`;
    icons();
  }
  function updateBrandUI() {
    const c = $('#dd-count'); if (c) c.textContent = `(${S.selected.size}/${BRANDS.length})`;
    document.querySelectorAll('[data-brandtoggle]').forEach((el) => el.setAttribute('data-on', S.selected.has(el.dataset.brandtoggle)));
    document.querySelectorAll('[data-brandcheck]').forEach((el) => (el.checked = S.selected.has(el.dataset.brandcheck)));
  }

  // ================================================================ ROUTER
  function setTab(t) {
    S.tab = t;
    document.querySelectorAll('.tab-btn').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === t));
    renderCurrent();
  }
  function renderCurrent() {
    Charts.destroyAll();
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    panelEl(S.tab).classList.add('active');
    ({ overview: renderOverview, spend: renderSpend, web: renderWeb, shelf: renderShelf, ai: renderAI, vs: renderVs }[S.tab] || renderOverview)();
    icons();
    positionUnderline();
  }
  function positionUnderline() {
    const btn = $(`.tab-btn[data-tab="${S.tab}"]`), u = document.getElementById('tab-underline');
    if (btn && u) { u.style.left = btn.offsetLeft + 'px'; u.style.width = btn.offsetWidth + 'px'; }
  }

  // ================================================================ OVERVIEW
  function renderOverview() {
    const panel = panelEl('overview');
    if (!need(panel, ['spend', 'search'])) return;
    const vis = visibleBrands(); if (!vis.length) return emptyBrands(panel);

    const cards = vis.map((b) => {
      const p = PULL.byBrand[b.id];
      return `<div class="card p-3.5 flex flex-col">
        <div class="flex items-center gap-2 min-w-0 mb-0.5">
          <span class="dot" style="background:${b.color};width:10px;height:10px;border-radius:999px;flex:none"></span>
          <div class="font-display font-extrabold text-[14.5px] leading-tight truncate flex-1">${b.name}</div>
        </div>
        <div class="flex items-center justify-between gap-1 mb-1">
          <span class="text-[10px] truncate ${b.group ? 'text-slate-400' : 'text-slate-300'}">${b.group || 'independent'}</span>
          ${qbadge(b.quality)}
        </div>
        <div id="ov-g-${b.id}" class="h-[144px] -my-1"></div>
        <div class="text-center px-1"><div class="text-[11.5px] font-bold ${tone(p.verdict.tone)} leading-snug">${p.verdict.label}</div></div>
        <div id="ov-s-${b.id}" class="h-[38px] mt-1"></div>
        <div class="text-[10px] text-slate-400 text-center -mt-0.5">interest, last 10 quarters</div>
      </div>`;
    }).join('');

    panel.innerHTML = `
      <div class="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6 mb-3">${cards}</div>
      <div class="card p-4 md:p-5 mb-3">
        ${cardHead('As they spend more, is interest keeping up? ' + infoIcon('Bars: A&SP % of revenue (company filings / PrivateCircle). Line: Google-Trends search interest. Pull score blends search 30%, social 25%, reviews 25%, AI visibility 20% (share-of-max across brands).'),
          'Bars = share of revenue spent on marketing · Line = how much people search the brand',
          nsel('heroBrand', vis.map((b) => ({ val: b.id, label: b.name })), pickBrand(S.heroBrand, vis)))}
        <div id="ov-hero" class="h-[300px]"></div>
      </div>
      <div id="ov-insight"></div>`;

    vis.forEach((b) => {
      const p = PULL.byBrand[b.id];
      Charts.gauge('ov-g-' + b.id, { value: p.score, color: b.color, color2: hexAdjust(b.color, .35), label: 'Pull score', height: 144, valueSize: '20px' });
      Charts.sparkline('ov-s-' + b.id, { data: p.spark, color: b.color, height: 38, type: 'area', valueFormatter: (v) => Math.round(v) });
    });
    renderHero(vis);
    renderInsight();
  }
  const pickBrand = (id, vis) => (vis.some((b) => b.id === id) ? id : (vis[0] && vis[0].id));

  function renderHero(vis) {
    const id = pickBrand(S.heroBrand, vis); if (!id) return;
    const b = BRAND_BY_ID[id];
    const rows = D.spend.data.byBrand[id] || [];
    const cats = rows.map((r) => r.year);
    const barData = rows.map((r) => +U.aspPct(r, 'adsp').toFixed(1));
    const lineData = U.fyAverages(D.search.data.byBrand[id] || []);
    const barMax = Math.max(4, Math.ceil((Math.max(...barData, 1) * 1.35) / 2) * 2);
    Charts.combo('ov-hero', {
      categories: cats, barName: 'Marketing spend (% of revenue)', lineName: 'Search interest (0–100)',
      barData, lineData, barColor: hexAdjust(b.color, .12), lineColor: hexAdjust(b.color, -.28),
      barAxisTitle: '% of revenue', lineAxisTitle: 'Interest', barMax,
      barFormatter: (v) => (v == null ? '' : v.toFixed(1) + '%'), lineFormatter: (v) => Math.round(v),
      height: 300,
    });
  }

  function renderInsight() {
    const all = BRANDS;
    const leadBy = (fn) => all.reduce((best, b) => (fn(b) > fn(best) ? b : best), all[0]);
    const has = (k) => D[k] && D[k].status === 'ok';
    const items = [];
    if (has('search')) items.push({ icon: 'search', label: 'Most searched', b: leadBy((x) => U.latestFyAvg(D.search.data.byBrand[x.id] || [0])) });
    if (has('social')) {
      items.push({ icon: 'youtube', label: 'YouTube', b: leadBy((x) => (D.social.data.byBrand[x.id] || {}).youtube || 0) });
    }
    if (has('reviews')) items.push({ icon: 'star', label: 'Most reviewed', b: leadBy((x) => (D.reviews.data.byBrand[x.id] || {}).totalCount || 0) });
    if (has('ai')) items.push({ icon: 'sparkles', label: 'AI answers', b: leadBy((x) => ((D.ai.data.byBrand[x.id] || {}).overall || {}).visibilityPct || 0) });
    $('#ov-insight').innerHTML = `<div class="card px-4 py-3">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="card-label mr-1 flex items-center gap-1.5"><i data-lucide="trophy" class="w-3.5 h-3.5 text-amber-500"></i>Who leads each signal</span>
        ${items.map((it) => `<span class="chip" style="cursor:default">
          <i data-lucide="${it.icon}" class="w-3.5 h-3.5 text-slate-400"></i>
          <span class="text-slate-500">${it.label}:</span>
          <span class="dot" style="background:${it.b.color}"></span><span class="font-bold">${it.b.name}</span></span>`).join('')}
      </div></div>`;
  }

  // ================================================================ SPEND
  function renderSpend() {
    const panel = panelEl('spend');
    if (!need(panel, ['spend'])) return;
    const vis = visibleBrands(); if (!vis.length) return emptyBrands(panel);
    const unitCr = S.unit === 'cr', kind = S.spendKind;
    const spend = D.spend.data, years = spend.years;
    const splitBrand = vis.find((b) => b.id === 'aquaguard') || vis.find((b) => spend.byBrand[b.id]) || vis[0];

    panel.innerHTML = `
      <div class="flex items-center gap-2 flex-wrap mb-3">
        ${seg('unit', [{ val: 'cr', label: '₹ crore' }, { val: 'pct', label: '% of revenue' }], S.unit)}
        ${seg('spendKind', [{ val: 'adsp', label: 'Ad + Promotion' }, { val: 'ad', label: 'Advertisement only' }], S.spendKind)}
        <span class="text-[11px] text-slate-400 ml-auto hidden sm:flex items-center gap-1"><i data-lucide="info" class="w-3.5 h-3.5"></i>Badges show how reliable each number is.</span>
      </div>
      <div class="grid gap-3 lg:grid-cols-2">
        <div class="card p-4">${cardHead(`Where ${splitBrand.name}'s money goes each year`, unitCr ? 'Advertising vs selling &amp; sales promotion (₹ crore)' : 'As a share of revenue', qbadge(splitBrand.quality))}<div id="sp-stack" class="h-[290px]"></div></div>
        <div class="card p-4">${cardHead('Share of revenue spent on marketing', 'Solid = disclosed · dashed = estimated')}<div id="sp-pct" class="h-[290px]"></div></div>
      </div>
      <div class="grid gap-3 lg:grid-cols-5 mt-3">
        <div class="card p-4 lg:col-span-3">${cardHead('Who spent the most last year', `${years[years.length - 1]} · ${kind === 'ad' ? 'advertisement' : 'ad + promotion'} · ${unitCr ? '₹ crore' : '% of revenue'}`)}
          <div id="sp-latest" class="h-[250px]"></div>
          <div id="sp-latest-badges" class="flex flex-wrap gap-1.5 mt-1"></div></div>
        <div class="card p-4 lg:col-span-2 overflow-x-auto">${cardHead('Every year, every brand', `${kind === 'ad' ? 'Advertisement' : 'Ad + promotion'}, ${unitCr ? '₹ cr' : '% of rev'}`)}
          <div id="sp-table"></div></div>
      </div>`;

    // A) stacked split for splitBrand
    const rows = spend.byBrand[splitBrand.id];
    const conv = (v, r) => unitCr ? v : +(v / r.revenue * 100).toFixed(2);
    const advSeries = rows.map((r) => conv(r.advertisement, r));
    const promoSeries = rows.map((r) => conv(r.sellingPromo, r));
    const stackSeries = kind === 'ad'
      ? [{ name: 'Advertisement', data: advSeries }]
      : [{ name: 'Advertisement', data: advSeries }, { name: 'Selling & promotion', data: promoSeries }];
    Charts.stackedBar('sp-stack', {
      categories: years, series: stackSeries, colors: ['#6366f1', '#38bdf8'], height: 290,
      valueFormatter: (v) => unitCr ? U.fmtCr(v) : U.fmtPct(v),
      yFormatter: (v) => unitCr ? '₹' + Math.round(v) : Math.round(v) + '%',
    });

    // B) A&SP % of revenue line (always %), EF/disclosed solid, others dashed
    Charts.line('sp-pct', {
      categories: years,
      series: vis.map((b) => ({ name: b.name, data: (spend.byBrand[b.id] || []).map((r) => +U.aspPct(r, kind).toFixed(2)) })),
      colors: colorsOf(vis),
      dashArray: vis.map((b) => (b.quality === 'disclosed' ? 0 : 6)),
      height: 290, yMin: 0, yFormatter: (v) => Math.round(v) + '%', valueFormatter: (v) => U.fmtPct(v),
    });

    // C) latest-year spend across brands
    const lastYear = years[years.length - 1];
    const latestVal = (b) => {
      const r = (spend.byBrand[b.id] || []).find((x) => x.year === lastYear); if (!r) return 0;
      return unitCr ? U.aspByKind(r, kind) : +U.aspPct(r, kind).toFixed(2);
    };
    Charts.bar('sp-latest', {
      categories: shortsOf(vis), data: vis.map(latestVal), colors: colorsOf(vis), height: 250,
      valueFormatter: (v) => unitCr ? U.fmtCr(v) : U.fmtPct(v),
      yFormatter: (v) => unitCr ? '₹' + Math.round(v) : Math.round(v) + '%',
    });
    $('#sp-latest-badges').innerHTML = vis.map((b) => {
      const latest = (spend.byBrand[b.id] || []).slice(-1)[0] || {};
      return `<span class="chip" style="cursor:default"><span class="dot" style="background:${b.color}"></span>${U.shortName(b.id)} ${qbadge(latest.quality || b.quality)}${provIcon(b)}</span>`;
    }).join('');

    // D) table brand x year
    const th = ['Brand', ...years].map((h, i) => `<th${i === 0 ? '' : ''}>${h}</th>`).join('');
    const trs = vis.map((b) => {
      const tds = years.map((y) => {
        const r = (spend.byBrand[b.id] || []).find((x) => x.year === y);
        if (!r) return `<td class="text-slate-300 text-right">—</td>`;
        const val = unitCr ? U.aspByKind(r, kind) : U.aspPct(r, kind);
        const bd = U.qualityBadge(r.quality);
        return `<td class="text-right${r.stale ? ' opacity-60' : ''}" title="${bd.text}${r.stale ? ' · last-good (stale)' : ''}"><span class="num">${unitCr ? val : val.toFixed(1) + '%'}</span>
          <span class="inline-block w-1.5 h-1.5 rounded-full align-middle ml-1" style="background:${qDot(r.quality)}"></span></td>`;
      }).join('');
      return `<tr><td class="font-semibold whitespace-nowrap"><span class="dot inline-block mr-1.5" style="background:${b.color};width:8px;height:8px;border-radius:999px"></span>${U.shortName(b.id)} ${provIcon(b)}</td>${tds}</tr>`;
    }).join('');
    $('#sp-table').innerHTML = `<table class="grid-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>
      <div class="flex flex-wrap gap-2 mt-2 text-[10px] text-slate-400">${['disclosed', 'snapshot', 'private-circle', 'estimated'].map((q) => `<span class="inline-flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full" style="background:${qDot(q)}"></span>${U.qualityBadge(q).text}</span>`).join('')}</div>`;
  }

  // ================================================================ WEB & SOCIAL
  function renderWeb() {
    const panel = panelEl('web');
    panel.innerHTML = `
      <div class="flex items-center gap-2 flex-wrap mb-3">
        ${seg('web', [{ val: 'search', label: 'Search', icon: 'search' }, { val: 'social', label: 'Social', icon: 'users' }], S.web)}
      </div>
      <div id="web-body"></div>`;
    if (S.web === 'search') renderSearch(); else renderSocial();
  }

  function renderSearch() {
    const body = $('#web-body');
    if (!D.search || D.search.status !== 'ok') { body.innerHTML = sectionCard(D.search, 'search interest'); return; }
    const vis = visibleBrands(); if (!vis.length) return emptyBrands(body);
    const st = D.search.data, isCat = S.searchTerm === 'category';
    body.innerHTML = `<div class="card p-4 md:p-5">
      ${cardHead((isCat ? 'How much India searches for “water purifier”' : 'How many people search each brand') + ' ' + srcIcon('search'),
        'Relative interest, 0–100 · summer (Apr–Jun) peaks every year',
        nsel('searchTerm', [{ val: 'brand', label: 'By brand name' }, { val: 'category', label: '“water purifier” (category)' }], S.searchTerm))}
      <div id="se-line" class="h-[360px]"></div></div>`;
    const series = isCat
      ? [{ name: '“water purifier”', data: st.category }]
      : vis.map((b) => ({ name: b.name, data: st.byBrand[b.id] || [] }));
    Charts.line('se-line', {
      categories: st.quarters, series, colors: isCat ? ['#0f766e'] : colorsOf(vis),
      height: 360, yMin: 0, yMax: 100, width: 3,
      valueFormatter: (v) => Math.round(v),
      override: { xaxis: { categories: st.quarters, tickPlacement: 'on', labels: { rotate: 0, hideOverlappingLabels: false, formatter: (val) => (typeof val === 'string' && val.endsWith('Q1') ? val.split(' ')[0] : '') } } },
    });
  }

  function renderSocial() {
    const body = $('#web-body');
    if (!D.social || D.social.status !== 'ok') { body.innerHTML = sectionCard(D.social, 'social'); return; }
    const vis = visibleBrands(); if (!vis.length) return emptyBrands(body);
    const soc = D.social.data, isSize = S.social === 'size';

    body.innerHTML = `<div class="card p-4 md:p-5">
      ${cardHead('Followers — and are they actually engaging? ' + srcIcon('social'),
        isSize ? 'Audience size on each platform (each chart has its own scale)' : 'Average engagement rate — how many followers actually react',
        seg('social', [{ val: 'size', label: 'Audience size' }, { val: 'engagement', label: 'Engagement rate' }], S.social))}
      ${isSize
        ? `<div class="grid gap-3 md:grid-cols-2">
            <div><div class="card-label mb-1 flex items-center gap-1.5"><i data-lucide="youtube" class="w-3.5 h-3.5 text-rose-500"></i>YouTube subscribers</div><div id="so-yt" class="h-[230px]"></div></div>
            <div><div class="card-label mb-1 flex items-center gap-1.5"><i data-lucide="instagram" class="w-3.5 h-3.5 text-pink-500"></i>Instagram followers</div><div id="so-ig" class="h-[230px]"></div></div>
          </div>`
        : `<div id="so-eng" class="h-[300px]"></div>`}
      </div>
      <div class="card p-4 mt-3">${cardHead('Audience growth', 'Total followers across platforms, last 8 quarters')}
        <div id="so-growth" class="grid gap-2 grid-cols-2 md:grid-cols-3 xl:grid-cols-6"></div></div>`;

    if (isSize) {
      const mk = (elid, key, fmt) => Charts.bar(elid, {
        categories: shortsOf(vis), data: vis.map((b) => (soc.byBrand[b.id] || {})[key] || 0),
        colors: colorsOf(vis), height: 230, legend: false, valueFormatter: (v) => U.fmtCompact(v),
        yFormatter: (v) => U.fmtCompact(v),
        override: { xaxis: { labels: { rotate: -22, rotateAlways: true, hideOverlappingLabels: false, trim: false, style: { fontSize: '10px' } } } },
      });
      mk('so-yt', 'youtube'); mk('so-ig', 'instagram');
    } else {
      Charts.bar('so-eng', {
        categories: shortsOf(vis), data: vis.map((b) => (soc.byBrand[b.id] || {}).engagementRate || 0),
        colors: colorsOf(vis), height: 300, legend: false,
        valueFormatter: (v) => U.fmtPct(v), yFormatter: (v) => v.toFixed(1) + '%',
      });
    }
    // growth sparkline tiles
    $('#so-growth').innerHTML = vis.map((b) => {
      const g = (soc.byBrand[b.id] || {}).growthSeries || [];
      const first = g[0] || 0, last = g[g.length - 1] || 0, chg = first ? ((last - first) / first) * 100 : 0;
      return `<div class="rounded-xl border border-slate-100 p-2">
        <div class="flex items-center justify-between"><span class="text-[11px] font-semibold truncate">${U.shortName(b.id)}</span>
          <span class="text-[10px] font-bold ${chg >= 0 ? 'text-emerald-600' : 'text-rose-500'}">${chg >= 0 ? '▲' : '▼'} ${Math.abs(chg).toFixed(1)}%</span></div>
        <div id="gr-${b.id}" class="h-[34px]"></div></div>`;
    }).join('');
    vis.forEach((b) => Charts.sparkline('gr-' + b.id, { data: (soc.byBrand[b.id] || {}).growthSeries || [], color: b.color, height: 34, type: 'area', valueFormatter: (v) => U.fmtCompact(v * 1000) }));
  }

  // ================================================================ SHELF
  function renderShelf() {
    const panel = panelEl('shelf');
    if (!need(panel, ['reviews'])) return;
    const vis = visibleBrands(); if (!vis.length) return emptyBrands(panel);
    const rv = D.reviews.data, mkt = S.shelfMkt, isRating = S.shelfMetric === 'rating';
    const count = (b) => { const x = rv.byBrand[b.id] || {}; return mkt === 'amazon' ? x.amazonCount : mkt === 'flipkart' ? x.flipkartCount : x.totalCount; };

    panel.innerHTML = `
      <div class="flex items-center gap-2 flex-wrap mb-3">
        ${nsel('shelfMkt', [{ val: 'both', label: 'Amazon + Flipkart' }, { val: 'amazon', label: 'Amazon' }, { val: 'flipkart', label: 'Flipkart' }], S.shelfMkt)}
        ${seg('shelfMetric', [{ val: 'reviews', label: 'Review count' }, { val: 'rating', label: 'Rating' }], S.shelfMetric)}
      </div>
      <div class="grid gap-3 lg:grid-cols-5">
        <div class="card p-4 lg:col-span-3">${cardHead((isRating ? 'Who is rated highest' : 'Who gets talked about most') + ' ' + srcIcon('reviews'), isRating ? 'Average star rating (out of 5)' : 'Total customer reviews · ' + mktLabel(mkt))}<div id="sh-bar" class="h-[260px]"></div></div>
        <div class="card p-4 lg:col-span-2">${cardHead('Star ratings', 'Average rating per brand')}<div id="sh-stars" class="pt-1"></div></div>
      </div>
      <div class="grid gap-3 lg:grid-cols-5 mt-3">
        <div class="card p-4 lg:col-span-3">${cardHead('Total reviews over time (buzz) ' + srcIcon('reviews'), 'Cumulative Amazon + Flipkart reviews — a rising line = growing buzz')}<div id="sh-vel" class="h-[260px]"></div></div>
        <div class="card p-4 lg:col-span-2 overflow-x-auto">${cardHead('Flagship models', mktLabel(mkt))}<div id="sh-table"></div></div>
      </div>`;

    // A) reviews or rating bar
    Charts.bar('sh-bar', {
      categories: shortsOf(vis), data: vis.map((b) => isRating ? (rv.byBrand[b.id] || {}).avgRating || 0 : count(b)),
      colors: colorsOf(vis), height: 260, legend: false,
      valueFormatter: (v) => isRating ? U.fmtRating(v) + ' ★' : U.fmtInt(v),
      yFormatter: (v) => isRating ? v.toFixed(1) : U.fmtCompact(v),
      override: isRating ? { yaxis: { min: 0, max: 5, labels: { formatter: (v) => v.toFixed(0) } } } : {},
    });
    // B) star strip
    $('#sh-stars').innerHTML = vis.map((b) => starStrip(b, (rv.byBrand[b.id] || {}).avgRating || 0)).join('');
    // C) velocity line
    Charts.line('sh-vel', {
      categories: rv.velocityMonths, series: vis.map((b) => ({ name: b.name, data: (rv.byBrand[b.id] || {}).velocitySeries || [] })),
      colors: colorsOf(vis), height: 260, yMin: 0, valueFormatter: (v) => U.fmtInt(v) + ' reviews', yFormatter: (v) => U.fmtCompact(v),
      override: { xaxis: { categories: rv.velocityMonths, labels: { rotate: 0, hideOverlappingLabels: true } } },
    });
    // D) table
    const trs = vis.map((b) => {
      const x = rv.byBrand[b.id] || {};
      return `<tr><td class="font-semibold"><span class="dot inline-block mr-1.5" style="background:${b.color};width:8px;height:8px;border-radius:999px"></span>${U.shortName(b.id)}</td>
        <td class="text-slate-500 !text-left text-[11.5px]">${x.flagship || '—'}</td>
        <td class="text-right font-bold num">${U.fmtRating(x.avgRating || 0)}</td>
        <td class="text-right num">${U.fmtInt(count(b))}</td></tr>`;
    }).join('');
    $('#sh-table').innerHTML = `<table class="grid-table"><thead><tr><th>Brand</th><th class="!text-left">Flagship</th><th>Rating</th><th>Reviews</th></tr></thead><tbody>${trs}</tbody></table>`;
  }
  const mktLabel = (m) => m === 'amazon' ? 'Amazon' : m === 'flipkart' ? 'Flipkart' : 'Amazon + Flipkart';
  function starStrip(b, rating) {
    const pct = (rating / 5) * 100;
    return `<div class="flex items-center gap-2.5 py-[7px]">
      <span class="dot" style="background:${b.color};width:9px;height:9px;border-radius:999px;flex:none"></span>
      <span class="text-[12.5px] font-semibold w-20 truncate">${U.shortName(b.id)}</span>
      <span class="stars flex-none"><span class="base">★★★★★</span><span class="fill" style="width:${pct}%;color:${b.color}">★★★★★</span></span>
      <div class="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden min-w-[40px]"><div style="width:${pct}%;height:100%;background:linear-gradient(90deg,${hexAdjust(b.color, .25)},${b.color})"></div></div>
      <span class="num text-[13px] font-bold w-8 text-right">${U.fmtRating(rating)}</span></div>`;
  }

  // ================================================================ AI ANSWERS
  function renderAI() {
    const panel = panelEl('ai');
    if (!need(panel, ['ai'])) return;
    const vis = visibleBrands(); if (!vis.length) return emptyBrands(panel);
    const ai = D.ai.data, pf = S.aiPlatform;
    const rec = (b) => { const x = ai.byBrand[b.id] || {}; return pf === 'all' ? (x.overall || {}) : ((x.byPlatform || {})[pf] || {}); };
    const platformOpts = [{ val: 'all', label: 'All assistants' }].concat((ai.platforms || []).map((p) => ({ val: p, label: (ai.platformLabels || {})[p] || p })));

    panel.innerHTML = `
      <div class="flex items-center gap-2 flex-wrap mb-3">
        ${nsel('aiPlatform', platformOpts, S.aiPlatform)}
        <span class="text-[11px] text-slate-400 flex items-center gap-1"><i data-lucide="sparkles" class="w-3.5 h-3.5"></i>How often AI assistants name each brand when buyers ask for a purifier.</span>
      </div>
      <div class="card p-4 mb-3">${cardHead('How often AI names this brand ' + srcIcon('ai'), 'Share of buyer questions where the brand is recommended')}
        <div id="ai-gauges" class="grid gap-1 grid-cols-3 md:grid-cols-6"></div></div>
      <div class="grid gap-3 lg:grid-cols-2 mb-3">
        <div class="card p-4">${cardHead('Share of all AI mentions', 'Of the brands shown')}<div id="ai-donut" class="h-[300px]"></div></div>
        <div class="card p-4">${cardHead('How AI talks about each brand', 'Positive · neutral · negative')}<div id="ai-sent" class="h-[300px]"></div></div>
      </div>
      <div class="card p-4">${cardHead('Where you’re invisible', 'Buyer questions where the brand usually does not come up',
        nsel('aiGapBrand', vis.map((b) => ({ val: b.id, label: b.name })), pickBrand(S.aiGapBrand, vis)))}
        <div id="ai-gaps"></div></div>`;

    // gauges
    $('#ai-gauges').innerHTML = vis.map((b) => `<div class="text-center">
      <div id="ai-g-${b.id}" class="h-[132px]"></div>
      <div class="text-[11.5px] font-semibold -mt-1 truncate">${U.shortName(b.id)}</div>
      <div class="text-[10px] text-slate-400">${U.fmtPct(rec(b).shareOfVoice || 0)} share</div></div>`).join('');
    vis.forEach((b) => Charts.gauge('ai-g-' + b.id, { value: rec(b).visibilityPct || 0, color: b.color, color2: hexAdjust(b.color, .35), height: 132, valueSize: '17px', hollow: '52%', valueFormatter: (v) => Math.round(v) + '%' }));

    // donut share
    Charts.donut('ai-donut', {
      labels: vis.map((b) => b.name), data: vis.map((b) => rec(b).shareOfVoice || 0),
      colors: colorsOf(vis), height: 300, centerLabel: 'Brands', valueFormatter: (v) => v.toFixed(1) + '%',
      totalFormatter: () => vis.length,
    });

    // sentiment stacked (100%) horizontal
    Charts.stackedBar('ai-sent', {
      categories: shortsOf(vis), horizontal: true, percent: true, height: 300,
      series: [
        { name: 'Positive', data: vis.map((b) => (rec(b).sentiment || {}).pos || 0) },
        { name: 'Neutral', data: vis.map((b) => (rec(b).sentiment || {}).neu || 0) },
        { name: 'Negative', data: vis.map((b) => (rec(b).sentiment || {}).neg || 0) },
      ],
      colors: ['#22c55e', '#cbd5e1', '#f43f5e'], valueFormatter: (v) => Math.round(v) + '%',
    });

    // gaps
    const gid = pickBrand(S.aiGapBrand, vis), gb = BRAND_BY_ID[gid];
    const gaps = ((ai.byBrand[gid] || {}).sampleGaps) || [];
    $('#ai-gaps').innerHTML = gaps.length
      ? `<div class="grid gap-2 sm:grid-cols-2">${gaps.map((q) => `<div class="flex items-start gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
          <span class="grid place-items-center w-6 h-6 rounded-lg flex-none text-white" style="background:${gb.color}"><i data-lucide="help-circle" class="w-3.5 h-3.5"></i></span>
          <span class="text-[13px] text-slate-700 leading-snug">${q}</span></div>`).join('')}</div>
        <div class="text-[11px] text-slate-400 mt-2">${gb.name} rarely appears in AI answers to these ${gaps.length} common questions — a mind-share gap to close.</div>`
      : `<div class="text-sm text-slate-500 py-4 text-center">AI assistants already name <span class="font-semibold">${gb.name}</span> across the common buyer questions. 🎉</div>`;
  }

  // ================================================================ VS RIVALS
  const VS_METRICS = {
    pull: { label: 'Pull score', get: (id) => PULL.byBrand[id].score, fmt: (v) => Math.round(v), max: 100 },
    spend: { label: 'Ad spend (latest year)', get: (id) => PULL.byBrand[id].raw.spend, fmt: (v) => U.fmtCr(v) },
    search: { label: 'Search interest', get: (id) => PULL.byBrand[id].raw.search, fmt: (v) => Math.round(v), max: 100 },
    social: { label: 'Social audience', get: (id) => PULL.byBrand[id].raw.social, fmt: (v) => U.fmtCompact(v) },
    reviews: { label: 'E-commerce reviews', get: (id) => PULL.byBrand[id].raw.reviews, fmt: (v) => U.fmtInt(v) },
    ai: { label: 'AI visibility', get: (id) => PULL.byBrand[id].raw.ai, fmt: (v) => Math.round(v) + '%', max: 100 },
  };
  const HEAT_SIGNALS = [
    { key: 'spend', label: 'Spend', fmt: (v) => U.fmtCr(v) },
    { key: 'search', label: 'Search', fmt: (v) => Math.round(v) },
    { key: 'social', label: 'Social', fmt: (v) => U.fmtCompact(v) },
    { key: 'reviews', label: 'Reviews', fmt: (v) => U.fmtInt(v) },
    { key: 'ai', label: 'AI Visibility', fmt: (v) => Math.round(v) + '%' },
  ];

  function renderVs() {
    const panel = panelEl('vs');
    const vis = visibleBrands(); if (!vis.length) return emptyBrands(panel);
    // keep vs selection valid (2..4 from visible)
    let chosen = [...S.vs].filter((id) => S.selected.has(id));
    if (chosen.length < 2) chosen = vis.slice(0, Math.min(3, vis.length)).map((b) => b.id);
    if (chosen.length > 4) chosen = chosen.slice(0, 4);
    S.vs = new Set(chosen);
    const chosenBrands = chosen.map((id) => BRAND_BY_ID[id]);
    const m = VS_METRICS[S.vsMetric] || VS_METRICS.pull;

    panel.innerHTML = `
      <div class="flex items-center gap-2 flex-wrap mb-3">
        <span class="card-label mr-1">Compare</span>
        ${vis.map((b) => `<button class="chip" data-vsbrand="${b.id}" data-on="${S.vs.has(b.id)}"><span class="dot" style="background:${b.color}"></span>${U.shortName(b.id)}</button>`).join('')}
        <span class="text-[11px] text-slate-400">pick 2–4</span>
        <span class="ml-auto flex items-center gap-2"><span class="card-label">Metric</span>${nsel('vsMetric', Object.keys(VS_METRICS).map((k) => ({ val: k, label: VS_METRICS[k].label })), S.vsMetric)}</span>
      </div>
      <div class="grid gap-3 lg:grid-cols-5">
        <div class="card p-4 lg:col-span-3">${cardHead('Head to head: ' + m.label, 'Chosen brands, side by side')}<div id="vs-bar" class="h-[280px]"></div></div>
        <div class="card p-4 lg:col-span-2">${cardHead('Pull leaderboard', 'Ranked by overall Pull score')}<div id="vs-lead" class="flex flex-col gap-2"></div></div>
      </div>
      <div class="card p-4 mt-3">${cardHead('Every brand, every signal, one view', 'Green = strong · red = weak · hover a cell for the real number')}
        <div class="overflow-x-auto"><div id="vs-heat"></div></div></div>`;

    // A) comparison bar
    Charts.bar('vs-bar', {
      categories: chosenBrands.map((b) => U.shortName(b.id)), data: chosenBrands.map((b) => m.get(b.id)),
      colors: colorsOf(chosenBrands), height: 280, legend: false,
      valueFormatter: (v) => m.fmt(v),
      yFormatter: (v) => (m.max ? Math.round(v) : U.fmtCompact(v)),
      override: m.max ? { yaxis: { min: 0, max: m.max, labels: { formatter: (v) => Math.round(v) } } } : {},
    });

    // B) leaderboard (rank chosen by pull score)
    const ranked = [...chosenBrands].sort((a, b) => PULL.byBrand[b.id].score - PULL.byBrand[a.id].score);
    const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`);
    $('#vs-lead').innerHTML = ranked.map((b, i) => {
      const p = PULL.byBrand[b.id];
      return `<div class="flex items-center gap-3 rounded-xl border border-slate-100 p-2.5" style="border-left:4px solid ${b.color}">
        <span class="text-lg w-7 text-center">${medal(i)}</span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2"><span class="font-display font-bold text-[14px] truncate">${b.name}</span>${qbadge(b.quality)}</div>
          <div class="flex gap-1 mt-1">${['search', 'social', 'reviews', 'ai'].map((k) => `<span class="h-1.5 rounded-full" title="${k}: ${Math.round(p.signals[k])}/100" style="width:${Math.max(6, p.signals[k] * 0.38)}px;background:${b.color};opacity:${0.35 + p.signals[k] / 160}"></span>`).join('')}</div>
        </div>
        <div class="text-right"><div class="stat-num" style="color:${b.color}">${p.score}</div><div class="text-[10px] text-slate-400 -mt-0.5">Pull</div></div>
      </div>`;
    }).join('');

    // C) heat strip (all visible brands x signals)
    const heatRows = vis.map((b) => {
      const p = PULL.byBrand[b.id];
      const cells = HEAT_SIGNALS.map((s) => {
        const score = p.signals[s.key], hc = U.heatColor(score);
        return `<td class="p-1"><div class="heat-cell" style="background:${hc.bg};color:${hc.fg}"
          title="${s.label} · ${b.name}: ${s.fmt(p.raw[s.key])} (${Math.round(score)}/100)">${s.fmt(p.raw[s.key])}</div></td>`;
      }).join('');
      return `<tr><td class="pr-3 whitespace-nowrap"><span class="dot inline-block mr-1.5" style="background:${b.color};width:9px;height:9px;border-radius:999px"></span><span class="font-semibold text-[13px]">${b.name}</span></td>${cells}</tr>`;
    }).join('');
    $('#vs-heat').innerHTML = `<table class="w-full" style="border-collapse:separate;border-spacing:0">
      <thead><tr><th class="text-left pb-2"></th>${HEAT_SIGNALS.map((s) => `<th class="card-label pb-2 px-1 text-center">${s.label}</th>`).join('')}</tr></thead>
      <tbody>${heatRows}</tbody></table>`;
  }

  // ================================================================ EVENTS
  function wireEvents() {
    document.addEventListener('click', (e) => {
      // close any open Brands dropdown on a click outside of it
      if (!e.target.closest('[data-dd-root]')) document.querySelectorAll('.dd-menu').forEach((m) => (m.hidden = true));

      const tabBtn = e.target.closest('.tab-btn');
      if (tabBtn) { setTab(tabBtn.dataset.tab); return; }

      const segBtn = e.target.closest('.seg-btn');
      if (segBtn) {
        const name = segBtn.closest('.seg').dataset.seg, val = segBtn.dataset.val;
        S[name] = val;
        if (name === 'unit') buildHeader();       // keep header toggle in sync
        renderCurrent();
        return;
      }

      const chip = e.target.closest('[data-brandtoggle]');
      if (chip) { toggleBrand(chip.dataset.brandtoggle); return; }

      const vschip = e.target.closest('[data-vsbrand]');
      if (vschip) {
        const id = vschip.dataset.vsbrand;
        if (S.vs.has(id)) { if (S.vs.size > 2) S.vs.delete(id); }
        else { if (S.vs.size < 4) S.vs.add(id); }
        renderCurrent(); return;
      }

      const ddBtn = e.target.closest('[data-dd]');
      if (ddBtn) { const menu = ddBtn.parentElement.querySelector('.dd-menu'); menu.hidden = !menu.hidden; return; }
      if (e.target.closest('[data-allbrands]')) { S.selected = new Set(BRANDS.map((b) => b.id)); updateBrandUI(); renderCurrent(); return; }
      if (e.target.closest('[data-nobrands]')) { S.selected = new Set(); updateBrandUI(); renderCurrent(); return; }
    });

    document.addEventListener('change', (e) => {
      const sel = e.target.closest('.nsel');
      if (sel) { S[sel.dataset.select] = sel.value; renderCurrent(); return; }
      const cb = e.target.closest('[data-brandcheck]');
      if (cb) {
        const id = cb.dataset.brandcheck;
        if (cb.checked) S.selected.add(id); else S.selected.delete(id);
        updateBrandUI(); renderCurrent(); return;
      }
    });

    window.addEventListener('resize', positionUnderline);
    window.addEventListener('load', positionUnderline);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(positionUnderline);
  }
  function toggleBrand(id) {
    if (S.selected.has(id)) S.selected.delete(id); else S.selected.add(id);
    updateBrandUI(); renderCurrent();
  }

  // ================================================================ INIT
  const okOr = (k, fallback) => (D[k] && D[k].status === 'ok' ? D[k].data : fallback);

  // Wait until Tailwind's utility classes are actually active before the first
  // chart render, so containers have real widths (Play CDN applies styles a beat
  // after load; measuring too early makes ApexCharts compute a 0/negative size).
  function whenLayoutReady(cb) {
    let tries = 0;
    const probe = document.createElement('div');
    probe.className = 'grid'; probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
    (function check() {
      const ready = getComputedStyle(probe).display === 'grid';
      if (ready || tries++ > 90) { probe.remove(); cb(); }
      else requestAnimationFrame(check);
    })();
  }

  async function init() {
    D = await Data.loadAll(['meta', 'spend', 'search', 'social', 'reviews', 'ai']);
    if (D.meta.status !== 'ok') { const boot = document.getElementById('boot'); boot.innerHTML = sectionCard(D.meta, 'brands'); icons(); return; }
    META = D.meta.data; BRANDS = META.brands; BRAND_BY_ID = {}; BRANDS.forEach((b) => (BRAND_BY_ID[b.id] = b));
    S.selected = new Set(BRANDS.map((b) => b.id));
    S.vs = new Set(['aquaguard', 'kent', 'pureit'].filter((id) => BRAND_BY_ID[id]));
    try {
      PULL = U.computePull({
        meta: META, spend: okOr('spend', { byBrand: {} }), search: okOr('search', { byBrand: {} }),
        social: okOr('social', { byBrand: {} }), reviews: okOr('reviews', { byBrand: {} }), ai: okOr('ai', { byBrand: {} }),
      });
    } catch (err) { console.error('pull compute failed', err); PULL = { byBrand: {} }; }

    buildHeader();
    const boot = document.getElementById('boot'); if (boot) boot.remove();
    wireEvents();
    window.__APP__ = { S, D, PULL };  // for debugging
    whenLayoutReady(() => setTab('overview'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
