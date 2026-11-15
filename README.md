# Burn Calendar

A web app that turns MODIS and VIIRS fire hotspot records into one consistent burning activity calendar.

Built for the 2026 NASA Space Apps Challenge, "Harmonization of MODIS and VIIRS Hot Spots".

## What it does

- Reads NASA FIRMS active fire CSV files (MODIS Terra and Aqua, VIIRS S-NPP, NOAA-20, NOAA-21).
- Corrects for the fact that the sensors do not see the same fires, so the record does not jump when VIIRS starts in 2012.
- Shows a calendar heatmap (one row per year, one column per week) for a whole region or a single grid cell.
- Shows a typical year with its usual range, and any year against it.
- Finds the critical burning windows, whether the season is starting earlier or later, and unusually active weeks.
- Checks itself: it rebuilds the VIIRS record from MODIS alone for held-out years and reports the error.

## Important: the built-in data is simulated

`index.html` ships with a made-up demo region so the app works when you open it. It is labelled as simulated in the app. **Load real FIRMS data before you submit.**

## Use real data (one time, then no terminal)

1. Download the India files from the FIRMS country page (https://firms.modaps.eosdis.nasa.gov/country/): MODIS, VIIRS S-NPP and VIIRS NOAA-20, one CSV per year, into one folder.
2. Build the page once with all of India inside it:

```
python3 pipeline/firms_to_json.py --name "India" --cell 0.5 --out data/india.json path/to/firms_india/*.csv
python3 build.py data/india.json
```

3. Open `index.html`. Pick any state from the Region menu, or click a grid cell on the map. No terminal is needed after this.

For another country or a custom area, load its FIRMS CSV files with the "Load FIRMS CSV files" button, or run the same two commands on them (add `--bbox west,south,east,north` to cut out an area).

## Run it

Open `index.html` in a browser. No server needed. To put it online, push the repo to GitHub and turn on GitHub Pages.

## How the harmonization works

1. Keep presumed vegetation fires (`type == 0`). Drop MODIS detections with confidence below 30 and VIIRS detections marked low.
2. Count detections per grid cell, per sensor, per week. A year has 52 bins.
3. On weeks when two sensors were both flying, estimate each sensor's detection rate relative to VIIRS S-NPP. This is done per grid cell and per calendar month, and cells with little data are pulled toward the regional value.
4. Weeks when only a weak sensor was flying (MODIS Terra alone, before mid 2002) are left out, because scaling a few detections up a lot is unreliable.
5. Weekly activity = (sum of counts from all sensors flying) / (sum of their detection rates). This is the maximum likelihood estimate if each sensor's count is Poisson with mean (rate x activity). The unit is "VIIRS S-NPP equivalent detections".

Limits: activity is detections, not burned area. Fires MODIS cannot see at all cannot be recovered, so the method assumes the share of such fires in a cell and month is stable over time. Cloud and smoke hide fires from every sensor.

## Files

- `index.html` : the finished app in one file
- `src/core.js` : ingestion, harmonization and statistics (no DOM, also runs in Node)
- `src/app.js`, `src/template.html` : the interface
- `build.py` : puts code and data together into `index.html`
- `pipeline/firms_to_json.py` : raw FIRMS CSVs to the compact dataset
- `pipeline/make_demo.py` : makes the simulated demo data
- `src/india_states.json`, `src/world_outline.json` : map outlines
- `tests/test_core.js` : `node tests/test_core.js [folder of FIRMS csv files]`

## Credits

Fire data: NASA FIRMS (MODIS MCD14ML Collection 6.1, VIIRS VNP14IMG / VJ114IMG). Country outlines: Natural Earth. Indian state boundaries: DataMeet (CC BY 4.0). Built with help from an AI assistant (Claude); disclose this in your submission as the Space Apps rules ask.
