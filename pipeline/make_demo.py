"""Make the SIMULATED demo dataset that ships inside the app.

This is not satellite data. It is a made-up region with a known "true" amount of
burning, observed by simulated copies of the five FIRMS sensors. Because the truth
is known, it also lets us test that the harmonization recovers it.

Usage: python3 pipeline/make_demo.py  (writes data/demo.json and data/demo_truth.json)
"""
import json, math, os
from datetime import date
import numpy as np

rng = np.random.default_rng(7)
ORIGIN = date(2000, 1, 1)
di = lambda y, m, d: (date(y, m, d) - ORIGIN).days

NX, NY, CELL = 8, 6, 0.5
START, END = di(2000, 11, 1), di(2026, 10, 31)
SENSORS = {  # first day, last day
    "TERRA": (di(2000, 11, 1), END), "AQUA": (di(2002, 7, 4), END),
    "SNPP": (di(2012, 1, 20), END), "N20": (di(2018, 4, 1), END), "N21": (di(2023, 3, 1), END),
}
# detection rate relative to VIIRS S-NPP, by fire type (small farm fires are hard for MODIS)
RATE = {"TERRA": {"crop": 0.09, "forest": 0.20}, "AQUA": {"crop": 0.17, "forest": 0.33},
        "SNPP": {"crop": 1.0, "forest": 1.0}, "N20": {"crop": 1.04, "forest": 0.97}, "N21": {"crop": 0.98, "forest": 1.02}}

def bump(doy, center, width):
    d = (doy - center + 182.5) % 365 - 182.5
    return np.exp(-0.5 * (d / width) ** 2)

cells, kinds, weight = [], [], []
for j in range(NY):
    for i in range(NX):
        cells.append([round(i * CELL + CELL / 2, 3), round(j * CELL + CELL / 2, 3)])
        forest = i >= 5 or (i == 4 and j >= 3)
        kinds.append("forest" if forest else "crop")
        weight.append(float(rng.gamma(4, 0.25)) * (1.3 if (not forest and j >= 3) else 1.0))

days = np.arange(START, END + 1)
dates = [date.fromordinal(ORIGIN.toordinal() + int(d)) for d in days]
years = np.array([d.year for d in dates]); doy = np.array([d.timetuple().tm_yday for d in dates])
yr_list = sorted(set(years.tolist()))
year_noise = {k: {y: float(rng.lognormal(0, 0.22)) for y in yr_list} for k in ("spring", "autumn", "forest")}
year_noise["forest"][2021] *= 2.4   # one extreme forest fire year
year_noise["autumn"][2009] *= 1.7

def autumn_level(y):   # rises to 2016, then falls
    return 0.6 + 0.9 * (y - 2000) / 16 if y <= 2016 else 1.5 - 0.7 * (y - 2016) / 10

truth = np.zeros((len(cells), len(days)))
for c, kind in enumerate(kinds):
    lam = np.zeros(len(days))
    for y in yr_list:
        m = years == y
        if kind == "crop":
            lam[m] += 9 * year_noise["spring"][y] * bump(doy[m], 118, 9)
            lam[m] += 30 * autumn_level(y) * year_noise["autumn"][y] * bump(doy[m], 305, 10)
        else:
            onset = 85 - 0.9 * (y - 2000)     # forest season starts about 9 days earlier per decade
            lam[m] += 14 * (1 + 0.012 * (y - 2000)) * year_noise["forest"][y] * bump(doy[m], onset + 18, 17)
        lam[m] += 0.05
    lam *= weight[c] * rng.lognormal(0, 0.45, len(days))   # day to day weather and cloud
    truth[c] = lam

obs, sensors = {}, []
for s, (first, last) in SENSORS.items():
    per, total = [], 0
    for c, kind in enumerate(kinds):
        counts = rng.poisson(truth[c] * RATE[s][kind])
        counts[(days < first) | (days > last)] = 0
        nz = np.nonzero(counts)[0]; flat = []
        for k in nz: flat += [int(days[k]), int(counts[k])]
        per.append(flat); total += int(counts.sum())
    obs[s] = per; sensors.append({"id": s, "first": first, "last": last, "n": total})

out = {"meta": {"name": "Demo region (simulated)", "simulated": True, "cell": CELL,
                "source": "Simulated detections, not satellite data"},
       "sensors": sensors, "cells": cells, "obs": obs}
os.makedirs("data", exist_ok=True)
json.dump(out, open("data/demo.json", "w"), separators=(",", ":"))
annual = {str(y): float(truth[:, years == y].sum()) for y in yr_list}
json.dump({"annual_true_snpp_units": annual, "kinds": kinds}, open("data/demo_truth.json", "w"))
print("demo.json", os.path.getsize("data/demo.json") // 1024, "KB;", {s["id"]: s["n"] for s in sensors})
