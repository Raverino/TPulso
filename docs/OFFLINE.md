# TPulso offline — design (for approval, not built yet)

Goal: the radar runs entirely on **timetable (GTFS) data** converted at build time into small static files that ship with the app. No live API is called at runtime. Everything on screen is labelled as timetable data.

All sizes below are **measured**, not guessed: a prototype converter was run on the real TML regional feed (version `20261024-1626-06`, downloaded 2026-10-25) for a 14-day window (2026-10-25 → 2026-11-07).

## 1. Sources and which operators are included

**Single source: the TML regional GTFS feed** (`go.tmlmobilidade.pt/hub/api/v1/plans/gtfs`, see docs/OPERATORS.md). It contains every operator, uses one ID namespace, and is the feed Carris Metropolitana itself publishes. The operators' own feeds are used only as a **cross-check**: the build compares today's trip count per operator and fails loudly if they differ by more than 10 %.

Rule: an operator is included only if it has **trips running today** and its service dates cover today. Its date range is shown in the app.

| Operator (agency) | Mode in filter | Dates in feed | Today | Included |
|---|---|---|---|---|
| Carris Metropolitana (LA77N, BNA17, YA15B, A2L1N) | Bus | ≤ 2026-11-30 … 2027-06-30 (per area) | 9 598 trips | ✅ first |
| Metro de Lisboa (IA2N9) | Tram·Metro | 2026-01-01 → 2026-12-31 | 1 427 | ✅ |
| CP (N18KL) | Train | 2025-12-14 → 2026-12-12 | 856 | ✅ |
| Fertagus (7NTB1) | Train | 2026-01-01 → 2026-12-31 | 104 | ✅ |
| Transtejo/Soflusa (LTP61) | Ferry | 2020-05-06 → 2027-07-01 | 234 | ✅ |
| MTS (KB1F6) | Tram·Metro | claims 2024 → 2030 | **0** | ❌ not current (own feed URL is 404) |
| Carris city (IA9T6) | Bus + Tram·Metro (trams) | 2026-06-06 → 2026-12-31 | 6 302 | ✅ |
| TCB (A3H3M) | Bus | 2026-10-06 → 2026-12-31 | 594 | ✅ |
| MobiCascais (HF16N) | Bus | 2025-01-01 → 2027-12-31 | 1 155 | ✅ |

With this, every filter mode has real data except where noted: Bus ✅, Tram·Metro ✅ (Metro + Carris trams; MTS missing), Train ✅, Ferry ✅.

## 2. Conversion script (`scripts/build-timetable.mjs`)

Runs in Node (not in the Worker): ~4 minutes and ~6 GB RAM for the full feed on this PC.

1. Download the feed (and the operators' own feeds for the cross-check). Record `feed_version` and a hash.
2. Pick the **window**: today + 13 days in Europe/Lisbon. Build a day bitmask per `service_id` from `calendar_dates`.
3. Keep trips running on at least one day of the window and operators that pass the "runs today" rule.
4. Group trips into **patterns** (same route, stop sequence, shape, destination). Store each trip as `[start time, time-profile index, day bitmask]`. Trips of one pattern usually share a few time profiles, which makes this very compact. Measured: 121 030 trips → 2 744 patterns.
5. Simplify shapes (Douglas-Peucker, 5 m) and encode them as polylines.
6. Write the files below, then validate:
   - every included operator has trips today;
   - no expired feed is included;
   - sizes are within limits;
   - unit tests on a small GTFS fixture pass (expected positions, times after 24:00, DST days, day bitmasks).

Times use the GTFS rule "noon minus 12 h" of the service day. That matters on DST days like today (2026-10-25), and for trips after midnight (e.g. 25:10), which belong to the previous service day.

### Output files (served as static assets next to the app)

```
/data/<version>/manifest.json          version, window, operators with date ranges, list of areas (+ sizes)
/data/<version>/areas/<lat>_<lng>.json one map area (~2.2 × 2.2 km grid cell)
/data/<version>/routes/<pattern>.json  one route pattern: full stop list, time profiles, shape
```

- **Area file**: the stops in the area (id, name, lat, lng, modes). For every pattern serving a stop there: line, colour, mode, destination, its stops from one stop before the area to one stop after (so a vehicle entering or leaving can be placed), the time profiles for that slice, the trips (start, profile, days), and the shape slice.
- **Route file**: loaded only when a vehicle is tapped, for the full route line and the scheduled time at each upcoming stop.

## 3. Sizes (measured)

| What | Files | Raw | gzip | brotli |
|---|---|---|---|---|
| All areas, whole metropolitan area, 14 days (incl. shape slices) | 852 | 23.6 MB | **5.4 MB** | ~3.9 MB |
| All route files (on demand only) | 2 744 | — | 3.5 MB (max 28 kB each) | 2.8 MB |
| Manifest | 1 | ~60 kB | ~12 kB | — |
| **Everything** | ~3 600 | | **≈ 9 MB** | ≈ 7 MB |

Per area (gzip): median **2 kB**, 90 % under **15 kB**, largest **121 kB** (central Lisbon). Around the TEST point:
- a 1000 m radar touches 2–4 areas: **0.2–0.4 MB**;
- the 3 × 3 block around Marquês de Pombal (the densest part of the network, so the worst case): **0.8 MB**.

Cloudflare Workers static assets allow 20 000 files of up to 25 MiB each, so ~3 600 files fit easily.

## 4. How the phone caches and refreshes

- **Service worker** (also makes the app installable, as the brief asks). The app shell is cached on install.
- **Manifest**: fetched network-first on every start (when online), falling back to the cached copy. It tells the app the data version and window.
- **Areas**: downloaded on demand, for the radar circle plus one ring of areas around it (for dragging), and kept in Cache Storage under their versioned URL. A typical first visit is 0.2–0.8 MB.
- **Optional "Download whole region"** button in Help: about 5–6 MB, for fully offline use.
- **New version**:
  - the old areas keep working while new ones load;
  - once the new manifest is active, old-version caches are deleted;
  - if an old file returns 404 after a deploy, the app re-reads the manifest.
- **Offline**: everything already cached keeps working until the end of its window (up to 13 days ahead). After that the app says **"Timetable expired — connect to update"** and shows no times. It never stretches old data.

## 5. Keeping the timetable current

- A **nightly job** (GitHub Actions, ~04:30 Lisbon) downloads the feeds, rolls the window forward one day, runs the converter and checks, and deploys a new data version with `wrangler deploy`. It needs a Cloudflare API token stored as a GitHub secret. Without that, the same script can be run by hand.
- **If a feed changes mid-window** (new `feed_version`), the next nightly build picks it up. A manual run can be triggered any time.
- **If a feed is broken or stops covering today**, that operator is dropped from the new version and the app shows it as "no data". The job reports the problem rather than shipping wrong data.
- **The feed date ranges are shown in the app:**
  - a small line under the status bar ("Timetable · valid to 7 Nov");
  - per operator in Help.

## 6. What the app shows (honesty rules)

- **Two states only:**
  - **Scheduled**: times from the timetable, "~3 min", blue-grey outline.
  - **Expected**: a vehicle's position calculated from the timetable, shown with a **dashed outline**.
  - Live and Stale are removed from the display.
- **A visible note on screen: "Timetable data, not live"**, plus a "Timetable" label in the top bar instead of "Live".
- **Expected vehicles:**
  - for each trip running now, the app finds the two scheduled stops it is between;
  - it interpolates by time along the shape between those stops, and waits at a stop between its arrival and departure times;
  - positions are recomputed every second, and the original's 1 s CSS glide makes them move smoothly;
  - this is deterministic, never random; a trip outside its scheduled times isn't shown.
- **Departures per stop:** the next 10 minutes from the timetable. Tapping a stop shows its next departures. Tapping a vehicle shows its route line and the scheduled time at each upcoming stop.
- **Filter:** Bus / Tram·Metro / Train / Ferry, each with real data from the included operators.

## 7. Live code kept, switched off

- The TML live provider, `/api/*` routes and their tests stay in the repo.
- A flag (`LIVE_ENABLED`, a Worker variable, plus `VITE_LIVE` in the app) is set to **off**. With it off, the Worker doesn't serve `/api/*` and the app never calls it.
- The tests keep running against the provider directly.

## 8. UI

Continue the faithful port of reference/ovpulse:
- CARTO dark_nolabels tiles (needs the free key);
- geographic radar with drag and Recenter;
- 100/200/500/1000 m radii;
- Marquês de Pombal TEST point;
- Europe/Lisbon time;
- Help kept; Feedback removed (button and panel).

## 9. Open questions for the owner

1. **Licence / redistribution.** Shipping converted timetable files means redistributing the data. None of the feeds states a licence (docs/OPERATORS.md). We need TML's (and ideally each operator's) terms before publishing.
2. **Single source.** Use the TML regional feed for everyone (recommended), with the operators' own feeds only as a cross-check?
3. **Window and area size.** Are 14 days and ~2.2 km areas OK?
4. **Hosting the nightly update.** GitHub Actions + a Cloudflare API token as a secret (you'd create the token), or manual rebuilds for now?
5. **MTS** stays out until a current feed exists. Is that OK?

## 10. Build results (first real run, 2026-10-25)

Command: `npm run timetable` (add `--offline` to reuse downloaded feeds). Run on this PC: **121 s, peak memory 1.1 GB** (GitHub Actions runners have 7 GB, so moving it there is fine). Output: 3 591 files, 37 MB raw / **12.1 MB gzip** (areas 5.6 MB: median 2 kB, 90 % ≤ 16 kB, max 113 kB; route files 6.4 MB, loaded on demand).

Cross-check (trips today, regional feed vs operator's own feed): CP 856 vs 821 (4 %), Fertagus 104 = 104, Carris 6 302 = 6 302, TCB 297 = 297 (after the fix below), MobiCascais 1 155 = 1 155. **Metro de Lisboa 1 427 vs 1 110 (29 %)**: same four lines and service hours (06:30–01:10) in both, but the regional copy has more trips and almost no matching start times, so it is a different timetable version. The build stops on such a mismatch unless run with `--accept-mismatch`; the mismatch is recorded in the manifest and shown in the app's Help. *Which Metro timetable is right is an open question for Metro/TML.*

Data fixes in the converter:
- **Duplicate trips.** The regional feed lists TCB's trips twice (two overlapping plans, XLHRT and HG6A7), and a few Carris Metropolitana (59) and Carris (2) trips likewise, over the 14 days. Exact duplicates (same route, destination, stops and times) are merged. 55 131 merges in total, mostly one trip listed under plans for different dates (harmless, days combined).
- **MTS** is excluded automatically: the feed claims 2024–2030 but has no trips on the build day.
