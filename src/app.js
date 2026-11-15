(function () {
  'use strict';
  var C = BurnCore, W = C.WEEKS;
  var $ = function (id) { return document.getElementById(id); };
  var DEMO = JSON.parse($('demo-data').textContent);
  var WORLD = [], STATES = [];
  try { WORLD = JSON.parse($('world').textContent); } catch (e) { WORLD = []; }
  try { STATES = JSON.parse($('states').textContent); } catch (e) { STATES = []; }

  var S = { P: null, A: null, region: '', cell: null, mode: 'harm', year: null, loadInfo: null, cellState: [], regions: {} };
  var nf = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
  function fmt(v) { return isNaN(v) ? 'no data' : (v < 10 ? (Math.round(v * 10) / 10).toString() : nf.format(v)); }
  function trim(x) { return (Math.round(x * 100) / 100).toString(); }
  function compact(v) { return v >= 1e6 ? trim(v / 1e6) + 'M' : v >= 1000 ? trim(v / 1000) + 'k' : trim(v); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function hex(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  var ramp = [];
  function readRamp() { ramp = [0, 1, 2, 3, 4].map(function (i) { return hex(css('--ramp-' + i)); }); }
  function rampColor(t) {
    t = Math.max(0, Math.min(1, t)) * 4; var i = Math.min(3, Math.floor(t)), f = t - i, a = ramp[i], b = ramp[i + 1];
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }
  function niceMax(v) { if (!(v > 0)) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }

  /* tooltip */
  var tip = $('tip');
  function showTip(ev, html) {
    tip.innerHTML = html; tip.style.display = 'block';
    var r = tip.getBoundingClientRect(), x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - 14;
    tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, y) + 'px';
  }
  function hideTip() { tip.style.display = 'none'; }

  function inRing(x, y, r) {
    var c = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    return c;
  }
  function stateAt(x, y) {
    for (var k = 0; k < STATES.length; k++) { var st = STATES[k], b = st.bbox; if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue; for (var r = 0; r < st.rings.length; r++) if (inRing(x, y, st.rings[r])) return st.name; }
    return '';
  }
  function assignStates() {
    var P = S.P, d = P.ds.meta.cell / 4; S.cellState = []; S.regions = {};
    P.ds.cells.forEach(function (c, i) {
      var nm = '';
      if (!P.ds.meta.simulated) { nm = stateAt(c[0], c[1]); var off = [[-d, -d], [d, -d], [-d, d], [d, d]]; for (var k = 0; !nm && k < 4; k++) nm = stateAt(c[0] + off[k][0], c[1] + off[k][1]); }
      S.cellState.push(nm); if (nm) (S.regions[nm] = S.regions[nm] || []).push(i);
    });
    var sel = $('region'), names = Object.keys(S.regions).sort();
    sel.innerHTML = '<option value="">' + (names.length ? 'All of the data (' + P.nC + ' cells)' : 'Whole region') + '</option>' + names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
    $('regionwrap').hidden = !names.length;
  }
  function regionCells() { if (S.region && S.regions[S.region]) return S.regions[S.region]; var a = []; for (var i = 0; i < S.P.nC; i++) a.push(i); return a; }
  function cellList() { return S.cell !== null ? [S.cell] : regionCells(); }
  function cellName(i) { var c = S.P.ds.cells[i]; return S.P.ds.meta.simulated ? 'grid cell ' + (i + 1) : 'cell at ' + Math.abs(c[1]).toFixed(2) + '\u00b0' + (c[1] >= 0 ? 'N' : 'S') + ', ' + Math.abs(c[0]).toFixed(2) + '\u00b0' + (c[0] >= 0 ? 'E' : 'W'); }
  function areaName() { return S.cell !== null ? cellName(S.cell) + (S.cellState[S.cell] ? ' (' + S.cellState[S.cell] + ')' : '') : S.region || (S.P.ds.meta.simulated || !Object.keys(S.regions).length ? 'whole region' : S.P.ds.meta.name); }

  function setData(ds, info) {
    S.P = C.build(ds); S.region = ''; S.cell = null; S.loadInfo = info || null;
    assignStates();
    S.A = C.analyze(S.P, cellList());
    var ys = S.A.years.filter(function (y) { return y.complete; });
    S.year = ys.length ? ys[ys.length - 1].year : S.P.y0 + S.P.nY - 1;
    var sel = $('year'); sel.innerHTML = '';
    for (var y = S.P.y0 + S.P.nY - 1; y >= S.P.y0; y--) { var o = document.createElement('option'); o.value = y; o.textContent = y; sel.appendChild(o); }
    sel.value = S.year;
    $('demo').hidden = ds === DEMO;
    renderAll(true);
  }

  function renderAll(keep) {
    readRamp();
    if (!keep) S.A = C.analyze(S.P, cellList());
    S.V = C.validateArea(S.P, cellList());
    $('rampbar').style.background = 'linear-gradient(90deg,' + [0, 0.25, 0.5, 0.75, 1].map(rampColor).join(',') + ')';
    var chip = $('cellchip'); chip.hidden = S.cell === null;
    if (S.cell !== null) { chip.innerHTML = 'Showing one ' + esc(cellName(S.cell)) + ' <button type="button" id="clearcell">Clear</button>'; $('clearcell').addEventListener('click', function () { S.cell = null; renderAll(); }); }
    renderHead(); renderFindings(); renderTiles(); renderMap(); renderCal(); renderTyp(); renderAnn(); renderWin(); renderAnom(); renderMethod();
  }

  function renderFindings() {
    var P = S.P, A = S.A, out = [];
    $('findtitle').textContent = 'Key findings, ' + areaName();
    var ws = A.windows.slice().sort(function (a, b) { return b.share - a.share; }), w = ws[0];
    if (w) {
      out.push('<b>Main burning window: ' + C.fmtDay(C.weekRange(2001, w.start)[0]) + ' to ' + C.fmtDay(C.weekRange(2001, w.end)[1]) + '.</b> It holds ' + (w.share * 100).toFixed(0) + '% of a typical year, with the peak around ' + C.weekLabel(w.peak) + '.');
      if (!isNaN(w.onsetShiftPerDecade)) out.push(Math.abs(w.onsetShiftPerDecade) < 1 ? '<b>The season start has not moved</b> in any clear way over the record.' : '<b>The season now starts about ' + Math.abs(w.onsetShiftPerDecade).toFixed(0) + ' days ' + (w.onsetShiftPerDecade < 0 ? 'earlier' : 'later') + ' per decade.</b>');
      if (!isNaN(w.activityTrendPerDecade)) out.push(Math.abs(w.activityTrendPerDecade) < 0.02 ? '<b>Burning in this window shows no clear trend</b> on the harmonized record.' : '<b>Burning in this window is ' + (w.activityTrendPerDecade >= 0 ? 'up ' : 'down ') + Math.abs(w.activityTrendPerDecade * 100).toFixed(0) + '% per decade</b> on the harmonized record.');
    } else out.push('<b>No clear burning season</b> in this area.');
    var ys = A.years.filter(function (y) { return y.complete; });
    if (ys.length >= 5) {
      var last = ys[ys.length - 1], med = C.median(ys.map(function (y) { return y.total; })), d = med > 0 ? last.total / med - 1 : 0;
      out.push('<b>' + last.year + ' was ' + (Math.abs(d) < 0.05 ? 'close to' : Math.abs(d * 100).toFixed(0) + '% ' + (d < 0 ? 'below' : 'above')) + ' the median year</b> (' + fmt(last.total) + ' against ' + fmt(med) + ').');
    }
    if (S.V) out.push('<b>Trust check: ' + (S.V.medErr * 100).toFixed(1) + '% error</b> when a year of VIIRS is rebuilt from MODIS alone. Raw MODIS counts are off by ' + (S.V.medErrRaw * 100).toFixed(0) + '%.');
    $('findings').innerHTML = out.map(function (x) { return '<li>' + x + '</li>'; }).join('');
  }

  function renderHead() {
    var P = S.P, m = P.ds.meta, d0 = C.dayToDate(P.first), d1 = C.dayToDate(P.last);
    var sens = P.ds.sensors.map(function (s) { return C.SENSOR_INFO[s.id].label; }).join(', ');
    $('dsmeta').innerHTML = '<span class="pill ' + (m.simulated ? 'sim' : '') + '">' + (m.simulated ? 'Simulated demo data' : 'NASA FIRMS data') + '</span> ' + esc(m.name) + ' · ' +
      C.MONTHS[d0.getUTCMonth()] + ' ' + d0.getUTCFullYear() + ' to ' + C.MONTHS[d1.getUTCMonth()] + ' ' + d1.getUTCFullYear() + ' · ' + esc(sens) + ' · ' + m.cell + '° grid, ' + P.nC + ' cells';
    var n = '';
    if (m.simulated) n = '<div class="notice"><strong>This is simulated data, not satellite observations.</strong> The demo region is made up so the app has something to show. Load real FIRMS CSV files with the button above to analyze a real place.</div>';
    else {
      var fam = {}; P.ids.forEach(function (s) { fam[C.SENSOR_INFO[s].family] = 1; });
      if (S.loadInfo) n += '<div class="notice" style="background:var(--surface);color:var(--ink-2);border-color:var(--line)">Read ' + nf.format(S.loadInfo.rows) + ' rows from ' + S.loadInfo.files + ' file' + (S.loadInfo.files > 1 ? 's' : '') + ' and kept ' + nf.format(S.loadInfo.kept) + '. Dropped ' + nf.format(S.loadInfo.dropped.lowConfidence) + ' low confidence, ' + nf.format(S.loadInfo.dropped.notVegetation) + ' not vegetation fires, ' + nf.format(S.loadInfo.dropped.unreadable) + ' unreadable.</div>';
      if (!fam.MODIS || !fam.VIIRS) n += '<div class="notice"><strong>Only ' + (fam.MODIS ? 'MODIS' : 'VIIRS') + ' files are loaded.</strong> Add ' + (fam.MODIS ? 'VIIRS' : 'MODIS') + ' files for the same area to harmonize the two records.</div>';
      else if (!P.hold) n += '<div class="notice"><strong>Too little overlap to check the method.</strong> The files need at least two full years where MODIS and VIIRS both have data.</div>';
    }
    $('notice').innerHTML = n;
  }

  function renderTiles() {
    var P = S.P, A = S.A, t = [];
    var ys = A.years.filter(function (y) { return y.complete; });
    t.push(['Record', ys.length ? ys[0].year + ' to ' + ys[ys.length - 1].year : 'no full year', ys.length + ' complete years, ' + areaName()]);
    var modis = P.ids.filter(function (s) { return C.SENSOR_INFO[s].family === 'MODIS' && !isNaN(A.rates[s]) && A.rates[s] > 0; });
    if (modis.length && P.ref === 'SNPP') {
      var best = modis.map(function (s) { return A.rates[s]; }).sort(function (a, b) { return b - a; })[0];
      t.push(['MODIS sees', best < 0.95 ? '1 in ' + (1 / best).toFixed(1) : '\u00d7' + best.toFixed(1), (best < 0.95 ? 'detections that VIIRS S-NPP makes' : 'the detections of VIIRS S-NPP') + ' (best MODIS sensor, this area)']);
    }
    var sr = C.stepRatio(P, A, 'rawTotal'), sh = C.stepRatio(P, A, 'total');
    if (!isNaN(sr) && !isNaN(sh)) t.push(['Jump when VIIRS starts', '\u00d7' + sr.toFixed(1) + ' \u2192 \u00d7' + sh.toFixed(2), 'raw counts, then harmonized (5 years after vs 5 years before)']);
    if (S.V) t.push(['Hold-out error', (S.V.medErr * 100).toFixed(1) + '%', 'yearly VIIRS total rebuilt from MODIS alone. Raw MODIS counts are off by ' + (S.V.medErrRaw * 100).toFixed(0) + '%']);
    $('tiles').innerHTML = t.map(function (x) { return '<div class="tile"><div class="k">' + x[0] + '</div><div class="v">' + x[1] + '</div><div class="d">' + x[2] + '</div></div>'; }).join('');
  }

  /* ---------- map ---------- */
  function renderMap() {
    var P = S.P, cells = P.ds.cells, deg = P.ds.meta.cell, el = $('map'), rc = regionCells(), inReg = new Uint8Array(P.nC);
    rc.forEach(function (i) { inReg[i] = 1; });
    var w = el.clientWidth || 320, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    rc.forEach(function (i) { var c = cells[i]; minX = Math.min(minX, c[0] - deg / 2); maxX = Math.max(maxX, c[0] + deg / 2); minY = Math.min(minY, c[1] - deg / 2); maxY = Math.max(maxY, c[1] + deg / 2); });
    var pad = Math.max(deg, (maxX - minX) * 0.08); minX -= pad; maxX += pad; minY -= pad; maxY += pad;
    var k = Math.cos((minY + maxY) / 2 * Math.PI / 180) || 1, sc = Math.min(w / ((maxX - minX) * k), 560 / (maxY - minY));
    var h = (maxY - minY) * sc, ox = (w - (maxX - minX) * k * sc) / 2;
    var X = function (lon) { return ox + (lon - minX) * k * sc; }, Y = function (lat) { return (maxY - lat) * sc; };
    var nFull = S.A.years.filter(function (y) { return y.complete; }).length || 1, vals = new Float64Array(P.nC), vmax = 0;
    for (var i = 0; i < P.nC; i++) {
      var c0 = cells[i]; if (c0[0] < minX - deg || c0[0] > maxX + deg || c0[1] < minY - deg || c0[1] > maxY + deg) { vals[i] = -1; continue; }
      var s = 0, hh = P.H[i]; for (var t = 0; t < P.nW; t++) if (P.cover[t] >= 1 && P.reliable[t] && !isNaN(hh[t])) s += hh[t];
      vals[i] = s / nFull; if (inReg[i] && vals[i] > vmax) vmax = vals[i];
    }
    vmax = vmax || 1;
    var out = '<svg viewBox="0 0 ' + w + ' ' + h.toFixed(1) + '" role="img" aria-label="Map of grid cells colored by mean yearly burning activity"><clipPath id="mapclip"><rect x="0" y="0" width="' + w + '" height="' + h.toFixed(1) + '" rx="4"/></clipPath><rect x="0" y="0" width="' + w + '" height="' + h.toFixed(1) + '" fill="var(--bg)" rx="4"/><g clip-path="url(#mapclip)">';
    var cw = deg * k * sc, ch = deg * sc, gap = cw > 6 ? 1 : 0;
    for (var j = 0; j < P.nC; j++) {
      if (vals[j] < 0) continue; var c = cells[j], on = S.cell === j;
      out += '<rect class="cellhit" tabindex="' + (inReg[j] && P.nC <= 400 ? 0 : -1) + '" data-i="' + j + '" x="' + (X(c[0] - deg / 2) + gap / 2).toFixed(1) + '" y="' + (Y(c[1] + deg / 2) + gap / 2).toFixed(1) + '" width="' + Math.max(1, cw - gap).toFixed(1) + '" height="' + Math.max(1, ch - gap).toFixed(1) + '" fill="' + rampColor(Math.sqrt(Math.min(1, vals[j] / vmax))) + '"' + (inReg[j] ? '' : ' opacity="0.3"') + (on ? ' stroke="var(--ink)" stroke-width="2.5"' : '') + '/>';
    }
    var hasStates = Object.keys(S.regions).length > 0, d = '', dsel = '';
    var seg = function (pts, close) { var q = ''; pts.forEach(function (p, n) { q += (n ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }); return q + (close ? 'Z' : ''); };
    if (hasStates) STATES.forEach(function (st) {
      var b = st.bbox; if (b[2] < minX || b[0] > maxX || b[3] < minY || b[1] > maxY) return;
      st.rings.forEach(function (r) { if (st.name === S.region) dsel += seg(r, true); else d += seg(r, true); });
    }); else if (!P.ds.meta.simulated) WORLD.forEach(function (ln) {
      var bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
      ln.forEach(function (p) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]); });
      if (bx1 < minX || bx0 > maxX || by1 < minY || by0 > maxY) return; d += seg(ln, false);
    });
    if (d) out += '<path d="' + d + '" fill="none" stroke="var(--ink-3)" stroke-width="0.8" pointer-events="none"/>';
    if (dsel) out += '<path d="' + dsel + '" fill="none" stroke="var(--ink)" stroke-width="2" pointer-events="none"/>';
    out += '</g></svg>';
    el.innerHTML = out;
    $('mapnote').textContent = (P.ds.meta.simulated ? 'Made-up region. The grid does not show real places. ' : '') + 'Color shows mean yearly activity. Click a cell to see its own calendar' + (hasStates ? ', or pick a state in the Region menu.' : '.');
    var svg = el.firstChild;
    var idx = function (e) { var a = e.target.getAttribute && e.target.getAttribute('data-i'); return a === null || a === undefined ? -1 : +a; };
    var pick = function (i) { if (i < 0) return; if (!inReg[i] && S.cellState[i]) { S.region = S.cellState[i]; $('region').value = S.region; S.cell = null; } else S.cell = S.cell === i ? null : i; hideTip(); renderAll(); };
    svg.addEventListener('click', function (e) { pick(idx(e)); });
    svg.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { var i = idx(e); if (i >= 0) { e.preventDefault(); pick(i); } } });
    svg.addEventListener('mousemove', function (e) { var i = idx(e); if (i < 0) { hideTip(); return; } var c = cells[i]; showTip(e, (P.ds.meta.simulated ? 'Grid cell ' + (i + 1) : (S.cellState[i] ? '<b>' + esc(S.cellState[i]) + '</b><br>' : '') + c[1].toFixed(2) + '\u00b0, ' + c[0].toFixed(2) + '\u00b0') + '<br><b>' + fmt(vals[i]) + '</b> per year on average'); });
    svg.addEventListener('mouseleave', hideTip);
  }

  /* ---------- calendar heatmap ---------- */
  function renderCal() {
    var P = S.P, A = S.A, el = $('cal'), w = Math.max(300, el.clientWidth || 800), L = 38, R = 4, T = 18;
    var data = S.mode === 'harm' ? A.h : A.raw, cw = (w - L - R) / W, rh = Math.max(11, Math.min(17, cw * 1.05)), h = T + P.nY * rh + 2;
    var vals = []; for (var t = 0; t < P.nW; t++) if (!isNaN(data[t]) && data[t] > 0) vals.push(data[t]);
    vals.sort(function (a, b) { return a - b; }); var vmax = vals.length ? vals[Math.floor((vals.length - 1) * 0.995)] : 1;
    var out = '<svg viewBox="0 0 ' + w + ' ' + h.toFixed(1) + '" role="img" aria-label="Calendar heatmap: one row per year, one column per week">';
    for (var m = 0; m < 12; m++) { var doy = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][m]; out += '<text x="' + (L + doy / 7 * cw + 2).toFixed(1) + '" y="11">' + C.MONTHS[m] + '</text>'; }
    for (var yi = 0; yi < P.nY; yi++) {
      var y = T + (P.nY - 1 - yi) * rh, yr = P.y0 + yi, on = yr === S.year;
      out += '<text x="' + (L - 6) + '" y="' + (y + rh / 2 + 4).toFixed(1) + '" text-anchor="end"' + (on ? ' style="fill:var(--ink);font-weight:600"' : '') + '>' + yr + '</text>';
      for (var wk = 0; wk < W; wk++) {
        var v = data[yi * W + wk], fill = isNaN(v) ? 'var(--cell-none)' : v <= 0 ? 'var(--ramp-0)' : rampColor(0.06 + 0.94 * Math.sqrt(Math.min(1, v / vmax)));
        out += '<rect data-t="' + (yi * W + wk) + '" x="' + (L + wk * cw + 0.5).toFixed(1) + '" y="' + (y + 0.5).toFixed(1) + '" width="' + Math.max(1, cw - 1).toFixed(1) + '" height="' + (rh - 1).toFixed(1) + '" fill="' + fill + '"/>';
      }
      if (on) out += '<rect x="' + (L - 1) + '" y="' + (y - 0.5).toFixed(1) + '" width="' + (W * cw + 1).toFixed(1) + '" height="' + (rh + 0.5).toFixed(1) + '" fill="none" stroke="var(--ink)" stroke-width="1.5" pointer-events="none"/>';
    }
    out += '</svg>';
    el.innerHTML = out;
    $('caltitle').textContent = 'Burning activity calendar, ' + areaName();
    $('calunit').textContent = S.mode === 'harm' ? 'Unit: VIIRS S-NPP equivalent detections per week.' : 'Unit: detections per week, every sensor simply added together.';
    var svg = el.firstChild;
    svg.addEventListener('mousemove', function (e) {
      var tt = e.target.getAttribute && e.target.getAttribute('data-t'); if (tt === null || tt === undefined) { hideTip(); return; }
      tt = +tt; var yr = P.y0 + Math.floor(tt / W), wk = tt % W, rg = C.weekRange(yr, wk), cl = A.clim[wk];
      var html = '<b>' + C.fmtDay(rg[0]) + ' to ' + C.fmtDay(rg[1]) + ' ' + yr + '</b><br>' + (S.mode === 'harm' ? 'Harmonized: ' : 'Raw count: ') + '<b>' + fmt(data[tt]) + '</b>';
      if (S.mode === 'harm' && isNaN(A.h[tt]) && P.cover[tt] >= 1 && !P.reliable[tt]) html += '<br>Left out: the sensors flying this week see too few of these fires to scale up safely.';
      if (S.mode === 'harm' && !isNaN(A.h[tt])) html += '<br>Typical for this week: ' + fmt(cl.med) + (A.z[tt] >= 2 ? '<br>Unusually high' : '');
      html += '<br>MODIS ' + fmt(A.fam.MODIS[tt]) + ' · VIIRS ' + fmt(A.fam.VIIRS[tt]);
      showTip(e, html);
    });
    svg.addEventListener('mouseleave', hideTip);
    svg.addEventListener('click', function (e) { var tt = e.target.getAttribute && e.target.getAttribute('data-t'); if (tt === null || tt === undefined) return; S.year = P.y0 + Math.floor(+tt / W); $('year').value = S.year; renderCal(); renderTyp(); });
  }

  /* ---------- shared chart frame ---------- */
  function frame(w, h, L, R, T, B, ymax, yTitle) {
    var out = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img">', pw = w - L - R, ph = h - T - B;
    for (var i = 0; i <= 4; i++) { var v = ymax * i / 4, y = T + ph - ph * i / 4; out += '<line x1="' + L + '" x2="' + (w - R) + '" y1="' + y + '" y2="' + y + '" stroke="var(--line)" stroke-width="1"/><text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + compact(v) + '</text>'; }
    if (yTitle) out += '<text x="' + L + '" y="' + (T - 8) + '" style="fill:var(--ink-3)">' + yTitle + '</text>';
    return { out: out, pw: pw, ph: ph, Y: function (v) { return T + ph - ph * Math.min(v, ymax * 1.02) / ymax; } };
  }
  function path(xs, ys) { var d = '', pen = false; for (var i = 0; i < xs.length; i++) { if (isNaN(ys[i])) { pen = false; continue; } d += (pen ? 'L' : 'M') + xs[i].toFixed(1) + ' ' + ys[i].toFixed(1); pen = true; } return d; }

  /* ---------- typical year ---------- */
  function renderTyp() {
    var P = S.P, A = S.A, el = $('typ'), w = Math.max(300, el.clientWidth || 560), h = 260, L = 44, R = 10, T = 24, B = 24;
    var yi = S.year - P.y0, cur = []; for (var wk = 0; wk < W; wk++) cur.push(A.h[yi * W + wk]);
    var ymax = niceMax(Math.max.apply(null, A.clim.map(function (c) { return c.p90 || 0; }).concat(cur.filter(function (v) { return !isNaN(v); }))));
    var f = frame(w, h, L, R, T, B, ymax, 'VIIRS equivalent detections per week'), out = f.out, X = function (wk) { return L + (wk + 0.5) / W * f.pw; };
    A.windows.forEach(function (wn) { out += '<rect x="' + (L + wn.start / W * f.pw).toFixed(1) + '" y="' + T + '" width="' + ((wn.end - wn.start + 1) / W * f.pw).toFixed(1) + '" height="' + f.ph + '" fill="var(--accent)" opacity="0.07"/>'; });
    var up = '', dn = ''; for (var k = 0; k < W; k++) { up += (k ? 'L' : 'M') + X(k).toFixed(1) + ' ' + f.Y(A.clim[k].p90 || 0).toFixed(1); dn = 'L' + X(k).toFixed(1) + ' ' + f.Y(A.clim[k].p10 || 0).toFixed(1) + dn; }
    out += '<path d="' + up + dn + 'Z" fill="var(--band)"/>';
    var xs = []; for (var q = 0; q < W; q++) xs.push(X(q));
    out += '<path d="' + path(xs, A.clim.map(function (c) { return f.Y(c.med || 0); })) + '" fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="4 3"/>';
    out += '<path d="' + path(xs, cur.map(function (v) { return isNaN(v) ? NaN : f.Y(v); })) + '" fill="none" stroke="var(--s-harm)" stroke-width="2" stroke-linejoin="round"/>';
    for (var a = 0; a < W; a++) if (A.z[yi * W + a] >= 2 && cur[a] >= Math.max(3, A.annualTypical * 0.002)) out += '<circle cx="' + X(a).toFixed(1) + '" cy="' + f.Y(cur[a]).toFixed(1) + '" r="4" fill="var(--crit)" stroke="var(--surface)" stroke-width="2"/>';
    for (var m = 0; m < 12; m++) { var doy = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][m]; out += '<text x="' + (L + doy / 364 * f.pw + 2).toFixed(1) + '" y="' + (h - 7) + '">' + C.MONTHS[m] + '</text>'; }
    out += '<line id="typx" y1="' + T + '" y2="' + (T + f.ph) + '" stroke="var(--ink-3)" stroke-width="1" visibility="hidden"/><rect id="typhit" x="' + L + '" y="' + T + '" width="' + f.pw + '" height="' + f.ph + '" fill="transparent"/></svg>';
    el.innerHTML = out; $('typyear').textContent = S.year + ', harmonized';
    var hit = el.querySelector('#typhit'), line = el.querySelector('#typx');
    hit.addEventListener('mousemove', function (e) {
      var r = hit.getBoundingClientRect(), wk = Math.max(0, Math.min(W - 1, Math.floor((e.clientX - r.left) / r.width * W))), c = A.clim[wk];
      line.setAttribute('x1', X(wk)); line.setAttribute('x2', X(wk)); line.setAttribute('visibility', 'visible');
      showTip(e, '<b>' + C.weekLabel(wk) + '</b><br>' + S.year + ': <b>' + fmt(cur[wk]) + '</b><br>Median: ' + fmt(c.med) + '<br>Usual range: ' + fmt(c.p10) + ' to ' + fmt(c.p90));
    });
    hit.addEventListener('mouseleave', function () { hideTip(); line.setAttribute('visibility', 'hidden'); });
  }

  /* ---------- yearly totals ---------- */
  function renderAnn() {
    var P = S.P, A = S.A, el = $('ann'), w = Math.max(300, el.clientWidth || 560), h = 260, L = 44, R = 12, T = 24, B = 24;
    var ys = A.years, ser = [['total', '--s-harm', 'Harmonized', 2.5], ['modis', '--s-modis', 'MODIS raw', 2], ['viirs', '--s-viirs', 'VIIRS raw', 2]];
    var mx = 0; ys.forEach(function (y) { ser.forEach(function (s) { if (!isNaN(y[s[0]])) mx = Math.max(mx, y[s[0]]); }); });
    var ymax = niceMax(mx), f = frame(w, h, L, R, T, B, ymax, 'Detections per year'), out = f.out;
    var X = function (i) { return L + (ys.length > 1 ? i / (ys.length - 1) : 0.5) * f.pw; }, xs = ys.map(function (y, i) { return X(i); });
    ser.slice().reverse().forEach(function (s) {
      var vals = ys.map(function (y) { return isNaN(y[s[0]]) ? NaN : f.Y(y[s[0]]); });
      out += '<path d="' + path(xs, vals) + '" fill="none" stroke="var(' + s[1] + ')" stroke-width="' + s[3] + '" stroke-linejoin="round"/>';
      ys.forEach(function (y, i) { if (!isNaN(vals[i])) out += '<circle cx="' + xs[i].toFixed(1) + '" cy="' + vals[i].toFixed(1) + '" r="' + (s[0] === 'total' ? 3 : 2.2) + '" fill="var(' + s[1] + ')" stroke="var(--surface)" stroke-width="1"/>'; });
    });
    var stepY = Math.max(1, Math.ceil(ys.length / (w < 420 ? 5 : 9)));
    ys.forEach(function (y, i) { if ((ys.length - 1 - i) % stepY === 0) out += '<text x="' + xs[i].toFixed(1) + '" y="' + (h - 7) + '" text-anchor="middle">' + y.year + '</text>'; });
    out += '<line id="annx" y1="' + T + '" y2="' + (T + f.ph) + '" stroke="var(--ink-3)" stroke-width="1" visibility="hidden"/><rect id="annhit" x="' + L + '" y="' + T + '" width="' + f.pw + '" height="' + f.ph + '" fill="transparent"/></svg>';
    el.innerHTML = out;
    var hit = el.querySelector('#annhit'), line = el.querySelector('#annx');
    hit.addEventListener('mousemove', function (e) {
      var r = hit.getBoundingClientRect(), i = Math.max(0, Math.min(ys.length - 1, Math.round((e.clientX - r.left) / r.width * (ys.length - 1)))), y = ys[i];
      line.setAttribute('x1', xs[i]); line.setAttribute('x2', xs[i]); line.setAttribute('visibility', 'visible');
      showTip(e, '<b>' + y.year + '</b>' + (y.complete ? '' : ' (incomplete year)') + '<br>Harmonized: <b>' + fmt(y.total) + '</b><br>MODIS raw: ' + fmt(y.modis) + '<br>VIIRS raw: ' + fmt(y.viirs));
    });
    hit.addEventListener('mouseleave', function () { hideTip(); line.setAttribute('visibility', 'hidden'); });
  }

  /* ---------- tables ---------- */
  function renderWin() {
    var A = S.A;
    if (!A.windows.length) { $('win').innerHTML = '<p>No clear burning season in this area.</p>'; return; }
    var rows = A.windows.map(function (wn) {
      var a = C.weekRange(2001, wn.start), b = C.weekRange(2001, wn.end), sh = wn.onsetShiftPerDecade, tr = wn.activityTrendPerDecade;
      var shTxt = isNaN(sh) ? 'not enough years' : Math.abs(sh) < 1 ? 'no clear shift' : Math.abs(sh).toFixed(0) + ' days ' + (sh < 0 ? 'earlier' : 'later') + ' per decade';
      var trTxt = isNaN(tr) ? 'not enough years' : Math.abs(tr) < 0.02 ? 'no clear trend' : (tr >= 0 ? '+' : '−') + Math.abs(tr * 100).toFixed(0) + '% per decade';
      return '<tr><td><b>' + C.fmtDay(a[0]) + ' to ' + C.fmtDay(b[1]) + '</b></td><td class="num">' + (wn.share * 100).toFixed(0) + '%</td><td>' + C.weekLabel(wn.peak) + '</td><td>' + shTxt + '</td><td>' + trTxt + '</td></tr>';
    }).join('');
    $('win').innerHTML = '<table><thead><tr><th>Window</th><th class="num">Share of year</th><th>Peak week</th><th>Season start</th><th>Activity trend</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function renderAnom() {
    var A = S.A, list = A.anomalies.slice().sort(function (a, b) { return b.z - a.z; }).slice(0, 10);
    if (!list.length) { $('anom').innerHTML = '<p>No unusually active weeks found.</p>'; return; }
    $('anom').innerHTML = '<table><thead><tr><th>Week</th><th class="num">Activity</th><th class="num">Typical</th><th>Compared with typical</th></tr></thead><tbody>' + list.map(function (a) {
      var rg = C.weekRange(a.year, a.week), ratio = a.typical > 0 ? a.value / a.typical : Infinity;
      return '<tr><td>' + C.fmtDay(rg[0]) + ' to ' + C.fmtDay(rg[1]) + ' <b>' + a.year + '</b></td><td class="num">' + fmt(a.value) + '</td><td class="num">' + fmt(a.typical) + '</td><td><span class="pill hot">' + (isFinite(ratio) ? ratio.toFixed(1) + ' times typical' : 'normally quiet') + '</span></td></tr>';
    }).join('') + '</tbody></table>';
  }
  function renderMethod() {
    var P = S.P, A = S.A;
    $('sens').innerHTML = '<table><thead><tr><th>Sensor</th><th class="num">Detections</th><th class="num">Rate here</th><th class="num">Rate, all data</th></tr></thead><tbody>' + P.ds.sensors.map(function (s) {
      var inf = P.fit.info[s.id], bm = inf.byMonth, r = A.rates[s.id];
      return '<tr><td>' + C.SENSOR_INFO[s.id].label + '</td><td class="num">' + nf.format(s.n) + '</td><td class="num">' + (s.id === P.ref ? 'reference' : isNaN(r) ? 'no overlap' : r.toFixed(2)) + '</td><td class="num">' + (s.id === P.ref ? '' : inf.overlapWeeks ? inf.overall.toFixed(2) : 'no overlap') + '</td></tr>';
    }).join('') + '</tbody></table>';
    var v = S.V;
    $('valid').innerHTML = v ? '<p>For each of ' + v.years.length + ' years with both records, the rates were fitted without that year, then the ' + C.SENSOR_INFO[P.ref].label + ' record for it was rebuilt from ' + v.legacy.map(function (s) { return C.SENSOR_INFO[s].label; }).join(' and ') + ' only. For ' + esc(areaName()) + ', the rebuilt yearly total is off by ' + (v.medErr * 100).toFixed(1) + '% (median). Using the raw MODIS count instead is off by ' + (v.medErrRaw * 100).toFixed(0) + '%. Week by week, rebuilt and real values correlate at r = ' + v.weeklyR.toFixed(2) + '.' + (P.ds.meta.simulated ? ' The demo data was simulated with the same kind of model, so real data will score lower than this.' : '') + '</p>' : '<p>Not enough overlapping years with fires in this area to run this check.</p>';
    var first = -1, last = -1; for (var t = 0; t < P.nW; t++) if (!P.reliable[t] && P.cover[t] >= 1) { if (first < 0) first = t; last = t; }
    $('weaknote').textContent = first < 0 ? 'Every week in this record has enough sensor coverage to be used.' :
      'Weeks when the sensors in orbit had too little detection power are left out of the harmonized record. Here that is ' + P.weakWeeks + ' weeks between ' + (P.y0 + Math.floor(first / W)) + ' and ' + (P.y0 + Math.floor(last / W)) + ', when MODIS Terra flew alone. Its morning pass sees few of these fires, so scaling its counts up would be unreliable.';
  }

  /* ---------- CSV copy ---------- */
  $('copy').addEventListener('click', function () {
    var P = S.P, A = S.A, lines = ['year,week,start_date,harmonized_snpp_equivalent,raw_modis,raw_viirs,typical_median,anomaly_score'];
    for (var t = 0; t < P.nW; t++) {
      if (isNaN(A.h[t])) continue; var yr = P.y0 + Math.floor(t / W), wk = t % W, d = C.dayToDate(C.weekRange(yr, wk)[0]).toISOString().slice(0, 10);
      lines.push([yr, wk + 1, d, A.h[t].toFixed(1), A.fam.MODIS[t].toFixed(0), A.fam.VIIRS[t].toFixed(0), A.clim[wk].med.toFixed(1), A.z[t].toFixed(2)].join(','));
    }
    var txt = lines.join('\n'), box = $('copyout'), btn = $('copy');
    box.value = txt; box.style.display = 'block';
    var done = function (ok) { btn.textContent = ok ? 'Copied ' + (lines.length - 1) + ' rows' : 'Select the text below and copy it'; setTimeout(function () { btn.textContent = 'Copy weekly table as CSV'; }, 2500); };
    try { navigator.clipboard.writeText(txt).then(function () { done(true); }, function () { box.select(); done(false); }); } catch (e) { box.select(); done(false); }
  });

  /* ---------- loading files ---------- */
  function readFile(ing, file, onProg) {
    if (!file.stream) return file.text().then(function (t) { ing.addText(file.name, t); });
    var reader = file.stream().getReader(), dec = new TextDecoder(), buf = '', first = true, read = 0;
    function step() {
      return reader.read().then(function (r) {
        if (r.done) { if (buf) { if (first) ing.startFile(file.name, buf); else ing.addLine(buf.replace(/\r$/, '')); } return; }
        read += r.value.length; buf += dec.decode(r.value, { stream: true });
        var lines = buf.split('\n'); buf = lines.pop(); var i = 0;
        if (first && lines.length) { ing.startFile(file.name, lines[0]); first = false; i = 1; }
        for (; i < lines.length; i++) ing.addLine(lines[i].replace(/\r$/, ''));
        onProg(read / file.size); return step();
      });
    }
    return step();
  }
  function loadFiles(files) {
    files = Array.prototype.slice.call(files); if (!files.length) return;
    var bad = files.filter(function (f) { return /\.(zip|shp|kml|kmz|json)$/i.test(f.name); });
    if (bad.length) { $('notice').innerHTML = '<div class="notice err"><strong>' + esc(bad[0].name) + ' is not a CSV file.</strong> Unzip the FIRMS download first, then load the .csv files inside it.</div>'; return; }
    var ing = new C.Ingest(), i = 0;
    var next = function () {
      if (i >= files.length) return Promise.resolve();
      var f = files[i], n = i + 1; i++;
      return readFile(ing, f, function (p) { $('notice').innerHTML = '<div class="notice">Reading file ' + n + ' of ' + files.length + ': ' + esc(f.name) + ' (' + Math.round(p * 100) + '%)</div>'; }).then(next);
    };
    next().then(function () {
      var name = files.length === 1 ? files[0].name.replace(/\.csv$/i, '') : files.length + ' FIRMS files';
      setData(ing.finalize(name), { rows: ing.rows, kept: ing.kept, dropped: ing.dropped, files: files.length });
    }).catch(function (e) { $('notice').innerHTML = '<div class="notice err"><strong>Could not load the files.</strong> ' + esc(e.message || e) + '</div>'; });
  }
  $('files').addEventListener('change', function (e) { loadFiles(e.target.files); e.target.value = ''; });
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files) loadFiles(e.dataTransfer.files); });
  $('demo').addEventListener('click', function () { setData(DEMO); });
  $('region').addEventListener('change', function (e) { S.region = e.target.value; S.cell = null; renderAll(); });
  $('year').addEventListener('change', function (e) { S.year = +e.target.value; renderCal(); renderTyp(); });
  function setMode(m) { S.mode = m; $('m-harm').setAttribute('aria-pressed', m === 'harm'); $('m-raw').setAttribute('aria-pressed', m === 'raw'); renderCal(); }
  $('m-harm').addEventListener('click', function () { setMode('harm'); });
  $('m-raw').addEventListener('click', function () { setMode('raw'); });
  var rt; window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { renderAll(true); }, 150); });
  new MutationObserver(function () { renderAll(true); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.matchMedia) { var mq = window.matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', function () { renderAll(true); }); }

  setData(DEMO);
})();
