/* charts.js — ApexCharts helpers: one shared theme + a factory per chart type.
 * Every factory mounts into a container id, destroying any previous instance so
 * re-renders (tab switches, toggles, filters) never leak charts. Exposed as
 * window.Charts (classic script, for file:// support). */
window.Charts = (function () {
  'use strict';

  const INK = '#0f172a', MUTED = '#94a3b8', SUBTLE = '#eef2f7';
  const FONT = 'Inter, ui-sans-serif, system-ui, sans-serif';
  const instances = {};
  const observers = {};

  // Nudge every chart to refit its parent. ApexCharts recomputes to the parent
  // width on a window resize — we lean on that so charts settle to the correct
  // width once late layout (e.g. Tailwind's async grid classes) has applied.
  let fitPending = false;
  function fitSoon() {
    if (fitPending) return; fitPending = true;
    requestAnimationFrame(() => { fitPending = false; try { window.dispatchEvent(new Event('resize')); } catch (e) {} });
  }

  // ---- small deep merge (objects only; arrays replaced) -------------------
  function merge(base, over) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    if (!over) return out;
    for (const k of Object.keys(over)) {
      const a = out[k], b = over[k];
      out[k] = a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(b)
        ? merge(a, b) : b;
    }
    return out;
  }

  function base() {
    return {
      chart: {
        fontFamily: FONT, foreColor: '#64748b', toolbar: { show: false },
        zoom: { enabled: false }, parentHeightOffset: 0, redrawOnParentResize: true,
        animations: { enabled: true, easing: 'easeinout', speed: 650, animateGradually: { enabled: true, delay: 90 } },
      },
      grid: {
        borderColor: SUBTLE, strokeDashArray: 5,
        xaxis: { lines: { show: false } }, yaxis: { lines: { show: true } },
        padding: { left: 10, right: 12, top: 0, bottom: 0 },
      },
      dataLabels: { enabled: false },
      legend: {
        show: true, position: 'bottom', horizontalAlign: 'center',
        fontSize: '12px', fontWeight: 600, fontFamily: FONT, labels: { colors: '#475569' },
        markers: { width: 9, height: 9, radius: 12, offsetX: -2 }, itemMargin: { horizontal: 9, vertical: 3 },
      },
      tooltip: { enabled: true, theme: 'light', style: { fontSize: '12px', fontFamily: FONT } },
      stroke: { curve: 'smooth', width: 3, lineCap: 'round' },
      xaxis: {
        axisBorder: { show: false }, axisTicks: { show: false },
        labels: { style: { colors: MUTED, fontSize: '11px', fontFamily: FONT } },
        crosshairs: { show: true, stroke: { color: '#e2e8f0', width: 1, dashArray: 4 } },
        tooltip: { enabled: false },
      },
      yaxis: { labels: { style: { colors: MUTED, fontSize: '11px', fontFamily: FONT } } },
      states: { hover: { filter: { type: 'lighten', value: 0.06 } }, active: { filter: { type: 'darken', value: 0.12 } } },
    };
  }

  function el(idOrEl) { return typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl; }

  function mount(idOrEl, options) {
    const node = el(idOrEl);
    if (!node) return null;
    const id = node.id;
    if (instances[id]) { try { instances[id].destroy(); } catch (e) {} delete instances[id]; }
    node.innerHTML = '';
    const chart = new ApexCharts(node, options);
    if (id) instances[id] = chart;
    // Render immediately when the container is already laid out; otherwise wait
    // a couple of frames so the width is real (avoids ApexCharts measuring 0 on
    // first paint before Tailwind's styles have been applied).
    if (node.clientWidth > 0) chart.render();
    else requestAnimationFrame(() => requestAnimationFrame(() => { if (instances[id] === chart) chart.render(); }));
    // Refit when the container's width later changes — covers Tailwind applying
    // its grid classes a frame after mount (which would otherwise leave a chart
    // stuck at the pre-grid full-card width and overflowing its neighbour).
    if (id && window.ResizeObserver) {
      if (observers[id]) observers[id].disconnect();
      let lastW = node.clientWidth;
      const ro = new ResizeObserver(() => {
        const w = node.clientWidth;
        if (Math.abs(w - lastW) > 2) { lastW = w; fitSoon(); }
      });
      ro.observe(node); observers[id] = ro;
    }
    return chart;
  }
  function destroy(idOrEl) {
    const node = el(idOrEl); const id = node ? node.id : idOrEl;
    if (observers[id]) { try { observers[id].disconnect(); } catch (e) {} delete observers[id]; }
    if (instances[id]) { try { instances[id].destroy(); } catch (e) {} delete instances[id]; }
    if (node) node.innerHTML = '';
  }
  function destroyAll() { Object.keys(instances).forEach(destroy); }

  const idIf = (v) => (typeof v === 'function' ? v : (x) => (v ? v(x) : x));

  // ---- line / multi-line --------------------------------------------------
  function line(idOrEl, o) {
    const opts = merge(base(), {
      chart: { type: 'line', height: o.height || 300 },
      series: o.series,
      colors: o.colors,
      stroke: { width: o.width || 3, curve: o.curve || 'smooth', dashArray: o.dashArray || 0 },
      markers: { size: 0, hover: { size: 5 }, strokeWidth: 0 },
      xaxis: { categories: o.categories, tickAmount: o.tickAmount || undefined, labels: { rotate: 0, hideOverlappingLabels: true } },
      yaxis: merge({ min: o.yMin != null ? o.yMin : undefined, max: o.yMax || undefined, forceNiceScale: true,
        labels: { formatter: o.yFormatter || ((v) => Math.round(v)) } }, o.yaxis || {}),
      tooltip: { shared: true, intersect: false, y: { formatter: o.valueFormatter || o.yFormatter } },
      fill: { type: 'solid', opacity: 1 },
    });
    return mount(idOrEl, merge(opts, o.override || {}));
  }

  // ---- area ---------------------------------------------------------------
  function area(idOrEl, o) {
    const opts = merge(base(), {
      chart: { type: 'area', height: o.height || 300 },
      series: o.series, colors: o.colors,
      stroke: { width: 2.5, curve: 'smooth' },
      fill: { type: 'gradient', gradient: { shadeIntensity: 0.25, opacityFrom: 0.45, opacityTo: 0.05, stops: [0, 95] } },
      markers: { size: 0, hover: { size: 5 } },
      xaxis: { categories: o.categories },
      yaxis: { min: 0, max: o.yMax || undefined, labels: { formatter: o.yFormatter || ((v) => Math.round(v)) } },
      tooltip: { shared: true, intersect: false, y: { formatter: o.valueFormatter || o.yFormatter } },
    });
    return mount(idOrEl, merge(opts, o.override || {}));
  }

  // ---- vertical bar (single series; distributed = colour per brand) -------
  function bar(idOrEl, o) {
    const horizontal = !!o.horizontal;
    const opts = merge(base(), {
      chart: { type: 'bar', height: o.height || 300 },
      series: [{ name: o.seriesName || 'Value', data: o.data }],
      colors: o.colors,
      plotOptions: { bar: {
        distributed: o.distributed !== false, horizontal,
        borderRadius: 7, borderRadiusApplication: 'end',
        columnWidth: o.columnWidth || '55%', barHeight: o.barHeight || '62%',
      } },
      dataLabels: o.dataLabels ? { enabled: true, style: { fontSize: '11px', fontWeight: 700, colors: [INK] },
        formatter: o.valueFormatter, offsetY: horizontal ? 0 : -18, offsetX: horizontal ? 8 : 0, background: { enabled: false } } : { enabled: false },
      legend: { show: o.legend !== false },
      xaxis: { categories: o.categories, labels: { formatter: horizontal ? (o.valueFormatter || undefined) : undefined, hideOverlappingLabels: false, trim: false } },
      yaxis: { labels: { formatter: horizontal ? undefined : (o.yFormatter || o.valueFormatter || ((v) => Math.round(v))) } },
      tooltip: { y: { formatter: o.valueFormatter || ((v) => Math.round(v)) } },
      fill: o.gradient ? { type: 'gradient', gradient: { shadeIntensity: 0.15, opacityFrom: 0.95, opacityTo: 0.8, stops: [0, 100] } } : { type: 'solid', opacity: 1 },
    });
    return mount(idOrEl, merge(opts, o.override || {}));
  }

  // ---- grouped bar (multi series) ----------------------------------------
  function groupedBar(idOrEl, o) {
    const horizontal = !!o.horizontal;
    const opts = merge(base(), {
      chart: { type: 'bar', height: o.height || 300 },
      series: o.series, colors: o.colors,
      plotOptions: { bar: { horizontal, borderRadius: 6, borderRadiusApplication: 'end', columnWidth: o.columnWidth || '70%', barHeight: o.barHeight || '70%', dataLabels: { position: 'top' } } },
      xaxis: { categories: o.categories, labels: { formatter: horizontal ? (o.valueFormatter || undefined) : undefined } },
      yaxis: { labels: { formatter: horizontal ? undefined : (o.yFormatter || o.valueFormatter || ((v) => Math.round(v))) } },
      tooltip: { shared: true, intersect: false, y: { formatter: o.valueFormatter || ((v) => Math.round(v)) } },
      fill: { type: 'solid', opacity: 1 },
    });
    return mount(idOrEl, merge(opts, o.override || {}));
  }

  // ---- stacked bar --------------------------------------------------------
  function stackedBar(idOrEl, o) {
    const horizontal = !!o.horizontal;
    const opts = merge(base(), {
      chart: { type: 'bar', height: o.height || 300, stacked: true, stackType: o.percent ? '100%' : 'normal' },
      series: o.series, colors: o.colors,
      plotOptions: { bar: { horizontal, borderRadius: 6, borderRadiusApplication: 'end', columnWidth: o.columnWidth || '52%', barHeight: o.barHeight || '58%' } },
      xaxis: { categories: o.categories, labels: { formatter: horizontal ? (o.percent ? (v) => Math.round(v) + '%' : o.valueFormatter) : undefined } },
      yaxis: { labels: { formatter: horizontal ? undefined : (o.yFormatter || o.valueFormatter || ((v) => Math.round(v))) } },
      tooltip: { shared: true, intersect: false, y: { formatter: o.valueFormatter || ((v) => Math.round(v)) } },
      fill: { type: 'solid', opacity: 1 },
    });
    return mount(idOrEl, merge(opts, o.override || {}));
  }

  // ---- donut --------------------------------------------------------------
  function donut(idOrEl, o) {
    const opts = merge(base(), {
      chart: { type: 'donut', height: o.height || 300 },
      series: o.data, labels: o.labels, colors: o.colors,
      stroke: { width: 2, colors: ['#ffffff'] },
      dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: 700, fontFamily: FONT }, dropShadow: { enabled: false },
        formatter: (val) => Math.round(val) + '%' },
      plotOptions: { pie: { donut: { size: '66%', labels: { show: true,
        name: { fontSize: '12px', color: MUTED },
        value: { fontSize: '20px', fontWeight: 800, color: INK, formatter: o.valueFormatter || ((v) => v) },
        total: { show: true, label: o.centerLabel || 'Total', color: MUTED, fontSize: '12px',
          formatter: o.totalFormatter || ((w) => Math.round(w.globals.seriesTotals.reduce((a, b) => a + b, 0))) } } } } },
      legend: { position: 'bottom' },
      tooltip: { y: { formatter: o.valueFormatter || ((v) => v) } },
    });
    return mount(idOrEl, merge(opts, o.override || {}));
  }

  // ---- radial gauge (single value 0..100) --------------------------------
  function gauge(idOrEl, o) {
    const opts = merge(base(), {
      chart: { type: 'radialBar', height: o.height || 190, sparkline: { enabled: o.bare || false } },
      series: [Math.round(o.value)], colors: [o.color], labels: [o.label || ''],
      plotOptions: { radialBar: {
        hollow: { size: o.hollow || '56%' }, track: { background: '#eef2f7', strokeWidth: '100%', margin: 3 },
        startAngle: -135, endAngle: 135,
        dataLabels: {
          name: { show: !!o.label, fontSize: '9px', fontWeight: 700, color: MUTED, offsetY: 16 },
          value: { show: true, fontSize: o.valueSize || '22px', fontWeight: 800, color: INK, offsetY: o.label ? -8 : 6,
            formatter: o.valueFormatter || ((v) => Math.round(v)) },
        },
      } },
      fill: { type: 'gradient', gradient: { shade: 'light', type: 'horizontal', gradientToColors: [o.color2 || o.color], stops: [0, 100] } },
      stroke: { lineCap: 'round' },
      tooltip: { enabled: false },
      legend: { show: false },
    });
    return mount(idOrEl, merge(opts, o.override || {}));
  }

  // ---- sparkline ----------------------------------------------------------
  function sparkline(idOrEl, o) {
    const opts = merge(base(), {
      chart: { type: o.type || 'line', height: o.height || 44, sparkline: { enabled: true } },
      series: [{ name: o.name || '', data: o.data }], colors: [o.color],
      stroke: { width: o.width || 2.5, curve: 'smooth' },
      fill: o.type === 'area' ? { type: 'gradient', gradient: { opacityFrom: 0.4, opacityTo: 0.02 } } : { opacity: 1 },
      markers: { size: 0 },
      tooltip: { enabled: o.tooltip !== false, y: { formatter: o.valueFormatter || ((v) => Math.round(v)) }, x: { show: false } },
    });
    return mount(idOrEl, merge(opts, o.override || {}));
  }

  // ---- combo: columns + line, dual axis (hero chart) ----------------------
  function combo(idOrEl, o) {
    const opts = merge(base(), {
      chart: { type: 'line', height: o.height || 320, stacked: false },
      series: [
        { name: o.barName, type: 'column', data: o.barData },
        { name: o.lineName, type: 'line', data: o.lineData },
      ],
      colors: [o.barColor, o.lineColor],
      stroke: { width: [0, 3.5], curve: 'smooth' },
      fill: { type: ['gradient', 'solid'], gradient: { shadeIntensity: 0.2, opacityFrom: 0.95, opacityTo: 0.7, stops: [0, 100] } },
      plotOptions: { bar: { borderRadius: 7, borderRadiusApplication: 'end', columnWidth: '48%' } },
      markers: { size: [0, 5], strokeWidth: 2, strokeColors: '#fff', hover: { size: 7 } },
      xaxis: { categories: o.categories },
      yaxis: [
        { seriesName: o.barName, min: 0, max: o.barMax || undefined, forceNiceScale: true,
          title: { text: o.barAxisTitle || '', style: { color: MUTED, fontSize: '11px', fontWeight: 600 } },
          labels: { formatter: o.barFormatter || ((v) => Math.round(v)) } },
        { seriesName: o.lineName, opposite: true, min: 0, max: 100, forceNiceScale: true,
          title: { text: o.lineAxisTitle || '', style: { color: MUTED, fontSize: '11px', fontWeight: 600 } },
          labels: { formatter: o.lineFormatter || ((v) => Math.round(v)) } },
      ],
      tooltip: { shared: true, intersect: false,
        y: { formatter: (val, opt) => {
          const isBar = opt && opt.seriesIndex === 0;
          return isBar ? (o.barFormatter ? o.barFormatter(val) : val) : (o.lineFormatter ? o.lineFormatter(val) : val);
        } } },
    });
    return mount(idOrEl, merge(opts, o.override || {}));
  }

  return { base, merge, mount, destroy, destroyAll, line, area, bar, groupedBar, stackedBar, donut, gauge, sparkline, combo, instances };
})();
