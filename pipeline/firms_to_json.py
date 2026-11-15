"""Turn raw NASA FIRMS CSV files into the compact dataset the app reads.

Use this for big areas (a whole country, 20+ years) where dropping the raw CSVs
into the browser would be slow. For small areas you can drop the CSVs into the app.

Usage:
  python3 pipeline/firms_to_json.py --name "India" --cell 0.5 --out data/india.json path/to/csvs/*.csv
  python3 build.py data/india.json        # bakes it into index.html

Filters (same as the app): MODIS confidence >= 30, VIIRS confidence not "low",
and type == 0 (presumed vegetation fire) when the file has a type column.
"""
import argparse, csv, json, math, os, re, sys
from collections import defaultdict
from datetime import date

ORIGIN = date(2000, 1, 1)
ORDER = ["TERRA", "AQUA", "SNPP", "N20", "N21"]

def sensor_from(instr, sat, fname, viirs_header):
    i, s, f = (instr or "").upper(), re.sub(r"[\s_]", "", (sat or "").upper()), fname.upper()
    viirs = "VIIRS" in i or (not i and (viirs_header or re.search(r"VIIRS|SV-C2|J1V|J2V|SUOMI|NOAA", f)))
    if not viirs:
        if s in ("TERRA", "T"): return "TERRA"
        if s in ("AQUA", "A"): return "AQUA"
        if "MODIS" in i or re.search(r"MODIS|M-C6", f): return "AQUA" if s[:1] == "A" else "TERRA"
    if s in ("N20", "1", "NOAA-20", "NOAA20", "J1"): return "N20"
    if s in ("N21", "2", "NOAA-21", "NOAA21", "J2"): return "N21"
    if s in ("N", "SNPP", "NPP", "SUOMINPP", "SUOMI-NPP"): return "SNPP"
    if viirs:
        if re.search(r"J2V|NOAA-?21|N21", f): return "N21"
        if re.search(r"J1V|NOAA-?20|N20", f): return "N20"
        return "SNPP"
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+"); ap.add_argument("--out", required=True)
    ap.add_argument("--name", default="FIRMS data"); ap.add_argument("--cell", type=float, default=0.5)
    ap.add_argument("--bbox", help="west,south,east,north to keep (optional)")
    a = ap.parse_args()
    bbox = [float(x) for x in a.bbox.split(",")] if a.bbox else None
    counts = defaultdict(lambda: defaultdict(int))   # sensor -> (cx, cy, day) -> n
    span = defaultdict(lambda: [10**9, -1])   # sensor -> first and last day seen
    rows = kept = 0
    for path in a.files:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            rd = csv.reader(fh); head = [h.strip().lower() for h in next(rd)]
            ix = {h: i for i, h in enumerate(head)}
            if not {"latitude", "longitude", "acq_date"} <= set(ix):
                print("skipping (not a FIRMS file):", path, file=sys.stderr); continue
            vh = "bright_ti4" in ix; fname = os.path.basename(path)
            for r in rd:
                rows += 1
                try:
                    lat, lon = float(r[ix["latitude"]]), float(r[ix["longitude"]])
                    y, m, d = int(r[ix["acq_date"]][:4]), int(r[ix["acq_date"]][5:7]), int(r[ix["acq_date"]][8:10])
                except (ValueError, IndexError):
                    continue
                if bbox and not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]): continue
                s = sensor_from(r[ix["instrument"]] if "instrument" in ix else "", r[ix["satellite"]] if "satellite" in ix else "", fname, vh)
                if not s: continue
                if "type" in ix and r[ix["type"]].strip() not in ("", "0"): continue
                if "confidence" in ix:
                    cf = r[ix["confidence"]].strip().lower()
                    if s in ("TERRA", "AQUA"):
                        if cf != "" and float(cf) < 30: continue
                    elif cf in ("l", "low"): continue
                day = (date(y, m, d) - ORIGIN).days
                week = (y - 2000) * 52 + min(51, (date(y, m, d) - date(y, 1, 1)).days // 7)
                key = (math.floor((lon + 180) / a.cell), math.floor((lat + 90) / a.cell), week)
                counts[s][key] += 1; kept += 1
                span[s][0] = min(span[s][0], day); span[s][1] = max(span[s][1], day)
    ids = sorted({(k[1], k[0]) for s in counts for k in counts[s]})
    pos = {c: i for i, c in enumerate(ids)}
    cells = [[round(cx * a.cell - 180 + a.cell / 2, 3), round(cy * a.cell - 90 + a.cell / 2, 3)] for cy, cx in ids]
    obs, sensors = {}, []
    for s in ORDER:
        if s not in counts: continue
        per = [dict() for _ in ids]
        for (cx, cy, wk), n in counts[s].items(): per[pos[(cy, cx)]][wk] = n
        obs[s] = [[v for day in sorted(p) for v in (day, p[day])] for p in per]
        sensors.append({"id": s, "first": span[s][0], "last": span[s][1], "n": sum(counts[s].values())})
    out = {"meta": {"name": a.name, "simulated": False, "binned": "week", "cell": a.cell, "source": "NASA FIRMS active fire detections"},
           "sensors": sensors, "cells": cells, "obs": obs}
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    json.dump(out, open(a.out, "w"), separators=(",", ":"))
    print(f"read {rows} rows, kept {kept}, {len(cells)} cells ->", a.out, {s['id']: s['n'] for s in sensors})

if __name__ == "__main__":
    main()
