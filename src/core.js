/* Burn Calendar core: FIRMS ingestion, MODIS/VIIRS harmonization, calendar statistics.
   Pure functions, no DOM. Runs in the browser and in Node (for tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BurnCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ORIGIN = Date.UTC(2000, 0, 1);
  var DAY = 86400000;
  var WEEKS = 52;
  var SENSOR_INFO = {
    TERRA: { label: 'MODIS Terra', family: 'MODIS' },
    AQUA: { label: 'MODIS Aqua', family: 'MODIS' },
    SNPP: { label: 'VIIRS S-NPP', family: 'VIIRS' },
    N20: { label: 'VIIRS NOAA-20', family: 'VIIRS' },
    N21: { label: 'VIIRS NOAA-21', family: 'VIIRS' }
  };
  var SENSOR_ORDER = ['TERRA', 'AQUA', 'SNPP', 'N20', 'N21'];

  /* ---------- dates ---------- */
  function dayIndex(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - ORIGIN) / DAY); }
  function dayToDate(di) { return new Date(ORIGIN + di * DAY); }
  function isLeap(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function yearStart(y) { return dayIndex(y, 1, 1); }
  // A year is cut into 52 bins: 51 seven-day weeks and a last bin of 8 or 9 days.
  function weekRange(y, w) {
    var s = yearStart(y) + w * 7;
    var e = w === WEEKS - 1 ? yearStart(y + 1) - 1 : s + 6;
    return [s, e];
  }
  function weekOfDay(di) {
    var dt = dayToDate(di), y = dt.getUTCFullYear();
    var doy = di - yearStart(y);
    return [y, Math.min(WEEKS - 1, Math.floor(doy / 7))];
  }
  function weekMonth(w) { // month (0-11) of the bin's midpoint in a non-leap year
    var doy = w * 7 + 3, cum = [31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365];
    for (var m = 0; m < 12; m++) if (doy < cum[m]) return m;
    return 11;
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(di) { var d = dayToDate(di); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
  function weekLabel(w) { var r = weekRange(2001, w); return fmtDay(r[0]) + ' to ' + fmtDay(r[1]); }

  /* ---------- FIRMS CSV ingestion ---------- */
  function sensorFrom(instr, sat, fileName, isViirsHeader) {
    var i = (instr || '').toUpperCase(), s = (sat || '').toUpperCase().replace(/[\s_]/g, '');
    var f = (fileName || '').toUpperCase();
    var viirs = i.indexOf('VIIRS') >= 0 || (!i && (isViirsHeader || /VIIRS|SV-C2|J1V|J2V|SUOMI|NOAA/.test(f)));
    if (!viirs) {
      if (s === 'TERRA' || s === 'T') return 'TERRA';
      if (s === 'AQUA' || s === 'A') return 'AQUA';
      if (i.indexOf('MODIS') >= 0 || /MODIS|M-C6/.test(f)) return s.charAt(0) === 'A' ? 'AQUA' : 'TERRA';
    }
    if (s === 'N20' || s === '1' || s === 'NOAA-20' || s === 'NOAA20' || s === 'J1') return 'N20';
    if (s === 'N21' || s === '2' || s === 'NOAA-21' || s === 'NOAA21' || s === 'J2') return 'N21';
    if (s === 'N' || s === 'SNPP' || s === 'NPP' || s === 'SUOMINPP' || s === 'SUOMI-NPP') return 'SNPP';
    if (viirs) {
      if (/J2V|NOAA-?21|N21/.test(f)) return 'N21';
      if (/J1V|NOAA-?20|N20/.test(f)) return 'N20';
      return 'SNPP';
    }
    return null;
  }

  // Detections are first binned on a 0.1 degree grid, then coarsened in finalize().
  function Ingest() {
    this.maps = {};      // sensor -> Map(key -> count)
    this.rows = 0; this.kept = 0; this.dropped = { lowConfidence: 0, notVegetation: 0, unreadable: 0 };
    this.files = [];
  }
  Ingest.prototype.startFile = function (name, headerLine) {
    var cols = headerLine.replace(/^﻿/, '').trim().toLowerCase().split(',');
    var idx = {}; cols.forEach(function (c, i) { idx[c.trim().replace(/"/g, '')] = i; });
    if (idx.latitude === undefined || idx.longitude === undefined || idx.acq_date === undefined)
      throw new Error(name + ' does not look like a FIRMS file. It needs latitude, longitude and acq_date columns.');
    this.cur = { name: name, idx: idx, viirsHeader: idx.bright_ti4 !== undefined, rows: 0 };
    this.files.push(this.cur);
  };
  Ingest.prototype.addLine = function (line) {
    if (!line) return;
    var c = this.cur, ix = c.idx, f = line.split(',');
    this.rows++; c.rows++;
    var lat = +f[ix.latitude], lon = +f[ix.longitude], ds = f[ix.acq_date];
    if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180) || !ds || ds.length < 10) { this.dropped.unreadable++; return; }
    var y = +ds.slice(0, 4), m = +ds.slice(5, 7), d = +ds.slice(8, 10);
    if (!(y > 1999 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) { this.dropped.unreadable++; return; }
    var sensor = sensorFrom(ix.instrument !== undefined ? f[ix.instrument] : '', ix.satellite !== undefined ? f[ix.satellite] : '', c.name, c.viirsHeader);
    if (!sensor) { this.dropped.unreadable++; return; }
    if (ix.type !== undefined && f[ix.type] !== undefined && f[ix.type].trim() !== '' && f[ix.type].trim() !== '0') { this.dropped.notVegetation++; return; }
    if (ix.confidence !== undefined) {
      var cf = (f[ix.confidence] || '').trim().toLowerCase();
      if (SENSOR_INFO[sensor].family === 'MODIS') { if (cf !== '' && +cf < 30) { this.dropped.lowConfidence++; return; } }
      else if (cf === 'l' || cf === 'low') { this.dropped.lowConfidence++; return; }
    }
    var gx = Math.floor((lon + 180) * 10), gy = Math.floor((lat + 90) * 10);
    if (gx > 3599) gx = 3599; if (gy > 1799) gy = 1799;
    var key = (gy * 3600 + gx) * 16384 + dayIndex(y, m, d);
    var mp = this.maps[sensor] || (this.maps[sensor] = new Map());
    mp.set(key, (mp.get(key) || 0) + 1);
    this.kept++;
  };
  Ingest.prototype.addText = function (name, text) {
    var lines = text.split(/\r?\n/);
    this.startFile(name, lines[0]);
    for (var i = 1; i < lines.length; i++) this.addLine(lines[i]);
  };
  Ingest.prototype.finalize = function (name) {
    var self = this, sensors = SENSOR_ORDER.filter(function (s) { return self.maps[s] && self.maps[s].size; });
    if (!sensors.length) throw new Error('No usable fire detections were found in these files.');
    var steps = [1, 2, 5, 10, 20, 50], step = 50, cellSets = {};
    for (var si = 0; si < steps.length; si++) {
      var st = steps[si], set = new Set();
      sensors.forEach(function (s) { self.maps[s].forEach(function (v, k) { var g = Math.floor(k / 16384); set.add(Math.floor(Math.floor(g / 3600) / st) * 3600 + Math.floor((g % 3600) / st)); }); });
      if (set.size <= 600) { step = st; cellSets = set; break; }
      cellSets = set;
    }
    var ids = Array.from(cellSets).sort(function (a, b) { return a - b; }), pos = new Map();
    ids.forEach(function (id, i) { pos.set(id, i); });
    var deg = step / 10;
    var cells = ids.map(function (id) {
      var cy = Math.floor(id / 3600), cx = id % 3600;
      return [+(cx * deg - 180 + deg / 2).toFixed(3), +(cy * deg - 90 + deg / 2).toFixed(3)];
    });
    var obs = {}, meta = [];
    sensors.forEach(function (s) {
      var per = ids.map(function () { return new Map(); }), first = Infinity, last = -Infinity, n = 0;
      self.maps[s].forEach(function (v, k) {
        var g = Math.floor(k / 16384), day = k % 16384;
        var id = Math.floor(Math.floor(g / 3600) / step) * 3600 + Math.floor((g % 3600) / step);
        var mp = per[pos.get(id)]; mp.set(day, (mp.get(day) || 0) + v);
        if (day < first) first = day; if (day > last) last = day; n += v;
      });
      obs[s] = per.map(function (mp) {
        var days = Array.from(mp.keys()).sort(function (a, b) { return a - b; }), flat = [];
        days.forEach(function (d) { flat.push(d, mp.get(d)); });
        return flat;
      });
      meta.push({ id: s, first: first, last: last, n: n });
    });
    return { meta: { name: name || 'Loaded FIRMS files', simulated: false, cell: deg, source: 'NASA FIRMS active fire detections' }, sensors: meta, cells: cells, obs: obs };
  };

  /* ---------- weekly cube ---------- */
  function prepare(ds) {
    var first = Infinity, last = -Infinity;
    ds.sensors.forEach(function (s) { if (s.first < first) first = s.first; if (s.last > last) last = s.last; });
    // A sensor's first detection in a quiet area can come long after it started flying. Treat the three
    // older sensors as flying from their FIRMS start date (or the start of this download), and treat a
    // sensor as still flying at the end of the download unless its detections stop over a year earlier.
    var START = { TERRA: dayIndex(2000, 11, 1), AQUA: dayIndex(2002, 7, 4), SNPP: dayIndex(2012, 1, 20) };
    ds = { meta: ds.meta, cells: ds.cells, obs: ds.obs, sensors: ds.sensors.map(function (s) {
      var f = s.first, l = s.last;
      if (START[s.id] !== undefined) f = Math.min(f, Math.max(START[s.id], first));
      if (last - l < 400) l = last;
      return { id: s.id, n: s.n, first: f, last: l };
    }) };
    var y0 = dayToDate(first).getUTCFullYear(), y1 = dayToDate(last).getUTCFullYear();
    var nY = y1 - y0 + 1, nW = nY * WEEKS, nC = ds.cells.length;
    var lens = new Float32Array(nW), cover = new Float32Array(nW);
    for (var yi = 0; yi < nY; yi++) for (var w = 0; w < WEEKS; w++) {
      var r = weekRange(y0 + yi, w), len = r[1] - r[0] + 1;
      lens[yi * WEEKS + w] = len;
      cover[yi * WEEKS + w] = Math.max(0, Math.min(r[1], last) - Math.max(r[0], first) + 1) / len;
    }
    var W = {}, frac = {};
    ds.sensors.forEach(function (s) {
      var fr = new Float32Array(nW);
      for (var yi = 0; yi < nY; yi++) for (var w = 0; w < WEEKS; w++) {
        var r = weekRange(y0 + yi, w);
        fr[yi * WEEKS + w] = Math.max(0, Math.min(r[1], s.last) - Math.max(r[0], s.first) + 1) / (r[1] - r[0] + 1);
      }
      frac[s.id] = fr;
      W[s.id] = ds.obs[s.id].map(function (flat) {
        var a = new Float32Array(nW);
        if (ds.meta.binned === 'week') { // already counted per week: index = (year - 2000) * 52 + week
          for (var j = 0; j < flat.length; j += 2) { var k2 = flat[j] - (y0 - 2000) * WEEKS; if (k2 >= 0 && k2 < nW) a[k2] += flat[j + 1]; }
        } else for (var i = 0; i < flat.length; i += 2) {
          var yw = weekOfDay(flat[i]);
          a[(yw[0] - y0) * WEEKS + yw[1]] += flat[i + 1];
        }
        for (var k = WEEKS - 1; k < nW; k += WEEKS) a[k] *= 7 / lens[k]; // last bin is 8 or 9 days long
        return a;
      });
    });
    var ids = ds.sensors.map(function (s) { return s.id; });
    var ref = ids.indexOf('SNPP') >= 0 ? 'SNPP' : ds.sensors.slice().sort(function (a, b) { return b.n - a.n; })[0].id;
    return { ds: ds, y0: y0, nY: nY, nW: nW, nC: nC, W: W, frac: frac, cover: cover, ids: ids, ref: ref, first: first, last: last };
  }

  /* ---------- harmonization ----------
     Model: in cell c and week t every sensor s counts N_s ~ Poisson(e_s(c, month) * L(c, t)),
     where L is burning activity in reference-sensor units and e_s is the sensor's detection
     rate relative to the reference (e_ref = 1). e_s is estimated on weeks when both sensors
     were flying, per cell and calendar month, shrunk toward the regional value where data is thin.
     The maximum likelihood estimate of L is then (sum of counts) / (sum of e_s over sensors flying). */
  var SHRINK = 30;
  function fitSensitivity(P, excludeYear) {
    var E = {}, info = {};
    P.ids.forEach(function (s) {
      var e = new Float32Array(P.nC * 12);
      if (s === P.ref) { e.fill(1); E[s] = e; info[s] = { overall: 1, overlapWeeks: null, byMonth: null }; return; }
      var S = new Float64Array(P.nC * 12), R = new Float64Array(P.nC * 12), Sm = new Float64Array(12), Rm = new Float64Array(12);
      var fs = P.frac[s], fr = P.frac[P.ref], Ws = P.W[s], Wr = P.W[P.ref], ow = 0;
      for (var t = 0; t < P.nW; t++) {
        if (fs[t] < 1 || fr[t] < 1) continue;
        if (excludeYear !== undefined && Math.floor(t / WEEKS) === excludeYear - P.y0) continue;
        ow++;
        var m = weekMonth(t % WEEKS);
        for (var c = 0; c < P.nC; c++) { var a = Ws[c][t], b = Wr[c][t]; S[c * 12 + m] += a; R[c * 12 + m] += b; Sm[m] += a; Rm[m] += b; }
      }
      var St = 0, Rt = 0; for (var m2 = 0; m2 < 12; m2++) { St += Sm[m2]; Rt += Rm[m2]; }
      var overall = Rt > 0 && St > 0 ? St / Rt : 1, byMonth = [];
      for (var m3 = 0; m3 < 12; m3++) {
        var em = (Sm[m3] + SHRINK * overall) / (Rm[m3] + SHRINK); byMonth.push(em);
        for (var c2 = 0; c2 < P.nC; c2++) e[c2 * 12 + m3] = Math.max(0.01, (S[c2 * 12 + m3] + SHRINK * em) / (R[c2 * 12 + m3] + SHRINK));
      }
      E[s] = e; info[s] = { overall: overall, overlapWeeks: ow, byMonth: byMonth, refTotal: Rt };
    });
    return { E: E, info: info };
  }
  // Harmonized weekly activity per cell, using only the sensors in `use` (default: all).
  function harmonizeCells(P, fit, use) {
    use = use || P.ids;
    var H = [];
    for (var c = 0; c < P.nC; c++) {
      var h = new Float32Array(P.nW);
      for (var t = 0; t < P.nW; t++) {
        var m = weekMonth(t % WEEKS), num = 0, den = 0;
        for (var i = 0; i < use.length; i++) { var s = use[i], f = P.frac[s][t]; if (f > 0) { num += P.W[s][c][t]; den += fit.E[s][c * 12 + m] * f; } }
        h[t] = den > 0 ? num / den : NaN;
      }
      H.push(h);
    }
    return H;
  }
  function sumCells(arrs, cellIdx, nW) {
    var out = new Float64Array(nW);
    for (var i = 0; i < cellIdx.length; i++) { var a = arrs[cellIdx[i]]; for (var t = 0; t < nW; t++) out[t] += a[t]; }
    return out;
  }
  function median(a) { if (!a.length) return NaN; var b = Array.from(a).sort(function (x, y) { return x - y; }), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; }
  function quantile(a, q) { if (!a.length) return NaN; var b = Array.from(a).sort(function (x, y) { return x - y; }), p = (b.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return b[lo] + (b[hi] - b[lo]) * (p - lo); }

  // Hold-out check. For every year where the reference and the other sensor family both flew all year,
  // fit the rates without that year and rebuild that year's reference record from the other family only.
  // The rebuilt weekly values are kept per cell so any area can be checked later.
  function holdOut(P) {
    var refFirst = null; P.ds.sensors.forEach(function (s) { if (s.id === P.ref) refFirst = s.first; });
    var legacy = P.ds.sensors.filter(function (s) { return SENSOR_INFO[s.id].family !== SENSOR_INFO[P.ref].family; }).map(function (s) { return s.id; });
    if (!legacy.length) legacy = P.ds.sensors.filter(function (s) { return s.id !== P.ref && s.first < refFirst; }).map(function (s) { return s.id; });
    if (!legacy.length) return null;
    var years = [], pred = [];
    for (var c0 = 0; c0 < P.nC; c0++) pred.push(new Float32Array(P.nW));
    for (var yi = 0; yi < P.nY; yi++) {
      var ok = true;
      for (var w = 0; w < WEEKS; w++) { var t = yi * WEEKS + w; if (P.frac[P.ref][t] < 1) ok = false; legacy.forEach(function (s) { if (P.frac[s][t] < 1) ok = false; }); }
      if (!ok) continue;
      var fit = fitSensitivity(P, P.y0 + yi);
      for (var c = 0; c < P.nC; c++) for (var w2 = 0; w2 < WEEKS; w2++) {
        var t2 = yi * WEEKS + w2, m = weekMonth(w2), num = 0, den = 0;
        for (var i = 0; i < legacy.length; i++) { num += P.W[legacy[i]][c][t2]; den += fit.E[legacy[i]][c * 12 + m]; }
        pred[c][t2] = den > 0 ? num / den : 0;
      }
      years.push(yi);
    }
    return years.length >= 2 ? { legacy: legacy, years: years, pred: pred } : null;
  }
  function validateArea(P, cellIdx) {
    var Hd = P.hold; if (!Hd) return null;
    var pred = sumCells(Hd.pred, cellIdx, P.nW), truth = sumCells(P.W[P.ref], cellIdx, P.nW), raw = new Float64Array(P.nW);
    Hd.legacy.forEach(function (s) { var r = sumCells(P.W[s], cellIdx, P.nW); for (var t = 0; t < P.nW; t++) raw[t] += r[t]; });
    var years = [], errH = [], errRaw = [], xs = [], ys = [];
    Hd.years.forEach(function (yi) {
      var sp = 0, st = 0, sr = 0;
      for (var w = 0; w < WEEKS; w++) { var t = yi * WEEKS + w; sp += pred[t]; st += truth[t]; sr += raw[t]; xs.push(pred[t]); ys.push(truth[t]); }
      if (st < 20) return;
      years.push({ year: P.y0 + yi, actual: st, rebuilt: sp, raw: sr });
      errH.push(Math.abs(sp - st) / st); errRaw.push(Math.abs(sr - st) / st);
    });
    if (years.length < 2) return null;
    var n = xs.length, mx = 0, my = 0; for (var i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; } mx /= n; my /= n;
    var sxy = 0, sxx = 0, syy = 0; for (var j = 0; j < n; j++) { sxy += (xs[j] - mx) * (ys[j] - my); sxx += (xs[j] - mx) * (xs[j] - mx); syy += (ys[j] - my) * (ys[j] - my); }
    return { legacy: Hd.legacy, years: years, medErr: median(errH), medErrRaw: median(errRaw), weeklyR: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN };
  }

  function build(ds) {
    var P = prepare(ds), fit = fitSensitivity(P);
    P.fit = fit; P.H = harmonizeCells(P, fit); P.hold = holdOut(P);
    // A week is trusted only if the sensors flying then have, together, at least half the detection power
    // of the full set of older sensors (or a reference-family sensor is flying). In practice this leaves out
    // the months when MODIS Terra flew alone: its morning pass sees few fires, so its counts would be scaled up too far.
    var famRef = SENSOR_INFO[P.ref].family, full = 0;
    P.ids.forEach(function (s) { if (SENSOR_INFO[s].family !== famRef) full += fit.info[s].overall; });
    P.reliable = new Uint8Array(P.nW); P.weakWeeks = 0;
    for (var t0 = 0; t0 < P.nW; t0++) {
      var got = 0, refFam = false;
      P.ids.forEach(function (s) { if (P.frac[s][t0] >= 1) { if (SENSOR_INFO[s].family === famRef) refFam = true; else got += fit.info[s].overall; } });
      P.reliable[t0] = refFam || full === 0 || got >= 0.5 * full ? 1 : 0;
      if (!P.reliable[t0] && P.cover[t0] >= 1) P.weakWeeks++;
    }
    P.rawAll = []; // all sensors simply added together, the naive record
    for (var c = 0; c < P.nC; c++) { var a = new Float32Array(P.nW); P.ids.forEach(function (s) { var w = P.W[s][c]; for (var t = 0; t < P.nW; t++) a[t] += w[t]; }); P.rawAll.push(a); }
    return P;
  }

  /* ---------- calendar statistics for an area (list of cell indexes) ---------- */
  function analyze(P, cellIdx) {
    var nW = P.nW, nY = P.nY;
    var h = sumCells(P.H, cellIdx, nW), raw = sumCells(P.rawAll, cellIdx, nW);
    for (var t = 0; t < nW; t++) { if (P.cover[t] < 1 || !P.reliable[t]) h[t] = NaN; if (P.cover[t] === 0) raw[t] = NaN; }
    var fam = { MODIS: new Float64Array(nW), VIIRS: new Float64Array(nW) };
    P.ids.forEach(function (s) { var r = sumCells(P.W[s], cellIdx, nW), f = fam[SENSOR_INFO[s].family]; for (var t = 0; t < nW; t++) f[t] += r[t]; });
    var rates = {};
    P.ids.forEach(function (s) {
      if (s === P.ref) { rates[s] = 1; return; }
      var a = sumCells(P.W[s], cellIdx, nW), b = sumCells(P.W[P.ref], cellIdx, nW), sa = 0, sb = 0;
      for (var t = 0; t < nW; t++) if (P.frac[s][t] >= 1 && P.frac[P.ref][t] >= 1) { sa += a[t]; sb += b[t]; }
      rates[s] = sb > 0 ? sa / sb : NaN;
    });
    var years = [];
    for (var yi = 0; yi < nY; yi++) {
      var full = true, tot = 0, rtot = 0, m = 0, v = 0, anyM = false, anyV = false;
      for (var w = 0; w < WEEKS; w++) {
        var t2 = yi * WEEKS + w; if (isNaN(h[t2])) full = false; else tot += h[t2];
        rtot += raw[t2] || 0; m += fam.MODIS[t2]; v += fam.VIIRS[t2];
        P.ids.forEach(function (s) { if (P.frac[s][t2] > 0) { if (SENSOR_INFO[s].family === 'MODIS') anyM = true; else anyV = true; } });
      }
      years.push({ year: P.y0 + yi, complete: full, total: full ? tot : NaN, rawTotal: full ? rtot : NaN, modis: full && anyM ? m : NaN, viirs: full && anyV ? v : NaN });
    }
    // typical year
    var clim = [];
    for (var w2 = 0; w2 < WEEKS; w2++) {
      var vals = []; for (var y = 0; y < nY; y++) { var x = h[y * WEEKS + w2]; if (!isNaN(x)) vals.push(x); }
      var lg = vals.map(function (x) { return Math.log1p(x); }), ml = median(lg), mad = median(lg.map(function (x) { return Math.abs(x - ml); }));
      clim.push({ med: median(vals), p10: quantile(vals, 0.1), p90: quantile(vals, 0.9), mean: vals.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, vals.length), ml: ml, sd: 1.4826 * mad, n: vals.length });
    }
    var annualTypical = clim.reduce(function (a, c) { return a + c.mean; }, 0);
    // anomaly score per week: robust z on log scale, with a floor so quiet weeks do not explode
    var floorSd = 0.35, minLevel = Math.max(3, annualTypical * 0.002), z = new Float32Array(nW);
    for (var t3 = 0; t3 < nW; t3++) {
      var c3 = clim[t3 % WEEKS];
      z[t3] = isNaN(h[t3]) ? NaN : (Math.log1p(h[t3]) - c3.ml) / Math.max(floorSd, c3.sd);
    }
    var anomalies = [];
    for (var t4 = 0; t4 < nW; t4++) if (!isNaN(z[t4]) && z[t4] >= 2 && h[t4] >= minLevel)
      anomalies.push({ year: P.y0 + Math.floor(t4 / WEEKS), week: t4 % WEEKS, value: h[t4], typical: clim[t4 % WEEKS].med, z: z[t4] });
    // critical burning windows: busiest weeks that together hold 80% of a typical year
    var order = clim.map(function (c, i) { return i; }).sort(function (a, b) { return clim[b].mean - clim[a].mean; });
    var inWin = new Uint8Array(WEEKS), acc = 0;
    for (var k = 0; k < WEEKS && acc < 0.8 * annualTypical; k++) { inWin[order[k]] = 1; acc += clim[order[k]].mean; }
    for (var w3 = 1; w3 < WEEKS - 1; w3++) if (!inWin[w3] && inWin[w3 - 1] && inWin[w3 + 1]) inWin[w3] = 1; // close one-week holes
    var windows = [], cur = null;
    for (var w4 = 0; w4 < WEEKS; w4++) {
      if (inWin[w4]) { if (!cur) { cur = { start: w4, end: w4 }; windows.push(cur); } else cur.end = w4; } else cur = null;
    }
    windows = windows.filter(function (wn) {
      var s = 0, peak = wn.start; for (var w = wn.start; w <= wn.end; w++) { s += clim[w].mean; if (clim[w].mean > clim[peak].mean) peak = w; }
      wn.share = annualTypical > 0 ? s / annualTypical : 0; wn.peak = peak;
      return wn.share >= 0.05;
    });
    windows.forEach(function (wn) {
      // onset per year: day when 10% of that year's burning inside the window (plus 3 weeks either side) has happened
      var a = Math.max(0, wn.start - 3), b = Math.min(WEEKS - 1, wn.end + 3), pts = [];
      for (var y = 0; y < nY; y++) {
        if (!years[y].complete) continue;
        var tot = 0; for (var w = a; w <= b; w++) tot += h[y * WEEKS + w];
        if (tot < 10) continue;
        var cum = 0, on = null;
        for (var w5 = a; w5 <= b; w5++) { var x = h[y * WEEKS + w5]; if (cum + x >= 0.1 * tot) { on = w5 * 7 + 7 * (0.1 * tot - cum) / Math.max(x, 1e-9); break; } cum += x; }
        if (on !== null) pts.push([P.y0 + y, on, tot]);
      }
      wn.onsets = pts;
      var slopes = [], tsl = [];
      for (var i = 0; i < pts.length; i++) for (var j = i + 1; j < pts.length; j++) {
        slopes.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
        if (pts[i][2] > 0) tsl.push(Math.log(pts[j][2] / pts[i][2]) / (pts[j][0] - pts[i][0]));
      }
      wn.onsetShiftPerDecade = slopes.length >= 10 ? median(slopes) * 10 : NaN;       // days per decade, negative = earlier
      wn.activityTrendPerDecade = tsl.length >= 10 ? Math.expm1(median(tsl) * 10) : NaN; // relative change per decade
    });
    return { rates: rates, h: h, raw: raw, fam: fam, years: years, clim: clim, z: z, anomalies: anomalies, windows: windows, annualTypical: annualTypical };
  }

  // Size of the jump at the moment the reference sensor starts: mean of the complete years after / before.
  function stepRatio(P, A, key) {
    var refFirst = null; P.ds.sensors.forEach(function (s) { if (s.id === P.ref) refFirst = s.first; });
    var yRef = dayToDate(refFirst).getUTCFullYear(), before = [], after = [];
    A.years.forEach(function (y) { if (!y.complete) return; var v = y[key]; if (y.year < yRef && y.year >= yRef - 5) before.push(v); if (y.year > yRef && y.year <= yRef + 5) after.push(v); });
    if (before.length < 2 || after.length < 2) return NaN;
    var mean = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
    return mean(after) / mean(before);
  }

  return { WEEKS: WEEKS, MONTHS: MONTHS, SENSOR_INFO: SENSOR_INFO, Ingest: Ingest, build: build, analyze: analyze, validateArea: validateArea, stepRatio: stepRatio,
    weekRange: weekRange, weekLabel: weekLabel, weekMonth: weekMonth, dayIndex: dayIndex, dayToDate: dayToDate, fmtDay: fmtDay, median: median, yearStart: yearStart };
});
