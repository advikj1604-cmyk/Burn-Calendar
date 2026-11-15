// Run: node tests/test_core.js [folder with real FIRMS csv files]
const fs = require('fs'), path = require('path');
const C = require('../src/core.js');
const root = path.join(__dirname, '..');
const demo = JSON.parse(fs.readFileSync(path.join(root, 'data/demo.json')));
const truth = JSON.parse(fs.readFileSync(path.join(root, 'data/demo_truth.json')));
const t0 = Date.now();
const P = C.build(demo);
const all = demo.cells.map((_, i) => i);
const A = C.analyze(P, all);
console.log('build+analyze ms', Date.now() - t0, 'ref', P.ref, 'years', P.y0, P.y0 + P.nY - 1);
for (const s of P.ids) console.log(' sensitivity', s, P.fit.info[s].overall.toFixed(3));
const V = C.validateArea(P, all); console.log('validation', JSON.stringify({ medErr: V.medErr, medErrRaw: V.medErrRaw, r: V.weeklyR, n: V.years.length }), 'weak weeks', P.weakWeeks);
console.log('step raw', C.stepRatio(P, A, 'rawTotal').toFixed(2), 'step harmonized', C.stepRatio(P, A, 'total').toFixed(2));
// against the known truth of the simulation
let errs = [], rawErrs = [];
for (const y of A.years) if (y.complete) {
  const tr = truth.annual_true_snpp_units[y.year];
  errs.push(Math.abs(y.total - tr) / tr); rawErrs.push(Math.abs(y.rawTotal - tr) / tr);
  console.log(' ', y.year, 'truth', tr.toFixed(0), 'harmonized', y.total.toFixed(0), 'raw sum', y.rawTotal.toFixed(0));
}
console.log('median abs error vs truth: harmonized', (C.median(errs) * 100).toFixed(1) + '%', 'raw', (C.median(rawErrs) * 100).toFixed(1) + '%');
const pre = A.years.filter(y => y.complete && y.year < 2012).map(y => Math.abs(y.total - truth.annual_true_snpp_units[y.year]) / truth.annual_true_snpp_units[y.year]);
console.log('pre-VIIRS years only:', (C.median(pre) * 100).toFixed(1) + '%');
console.log('windows', A.windows.map(w => [C.weekLabel(w.start), C.weekLabel(w.end), (w.share * 100).toFixed(0) + '%', 'onset shift d/dec ' + w.onsetShiftPerDecade.toFixed(1), 'trend/dec ' + (w.activityTrendPerDecade * 100).toFixed(0) + '%']));
console.log('anomalies', A.anomalies.length, A.anomalies.sort((a, b) => b.z - a.z).slice(0, 5).map(a => a.year + ' wk' + a.week + ' z' + a.z.toFixed(1)));
// forest cells only: onset should move earlier by about 9 days per decade
const forest = all.filter(i => truth.kinds[i] === 'forest');
const AF = C.analyze(P, forest);
console.log('forest windows', AF.windows.map(w => [C.weekLabel(w.start), C.weekLabel(w.end), w.onsetShiftPerDecade.toFixed(1)]));

const dir = process.argv[2];
if (dir) {
  const ing = new C.Ingest();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.csv'))) ing.addText(f, fs.readFileSync(path.join(dir, f), 'utf8'));
  const ds = ing.finalize('real files');
  console.log('REAL FIRMS FILES rows', ing.rows, 'kept', ing.kept, 'dropped', JSON.stringify(ing.dropped), 'cells', ds.cells.length, 'cell deg', ds.meta.cell);
  console.log(' sensors', JSON.stringify(ds.sensors.map(s => [s.id, s.n, C.dayToDate(s.first).toISOString().slice(0, 10), C.dayToDate(s.last).toISOString().slice(0, 10)])));
  const P2 = C.build(ds), A2 = C.analyze(P2, ds.cells.map((_, i) => i));
  console.log(' ref', P2.ref, 'sens', P2.ids.map(s => s + ' ' + P2.fit.info[s].overall.toFixed(2)).join(', '), 'windows', A2.windows.length, 'validation', JSON.stringify(C.validateArea(P2, ds.cells.map((_, i) => i)) || null).slice(0, 80), 'weak', P2.weakWeeks);
  if (process.argv[3]) { const P3 = C.build(JSON.parse(fs.readFileSync(process.argv[3]))); const A3 = C.analyze(P3, P3.ds.cells.map((_, i) => i)); console.log(' weekly-file path: years', A3.years.filter(y => y.complete).map(y => y.year + ':' + y.total.toFixed(1)).join(' '), '| daily path:', A2.years.filter(y => y.complete).map(y => y.year + ':' + y.total.toFixed(1)).join(' ')); }
}
