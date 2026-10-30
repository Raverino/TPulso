# Live GPS buses over the timetable (2026-10-30)

Carris (city buses and trams) did not give access to its real-time data. The one operator with **open** live
vehicle data is **Carris Metropolitana**: `https://api.carrismetropolitana.pt/v2/vehicles` (no key, CORS open,
cached 5 s). TPulso now shows those buses at their GPS position. Everything else stays timetable data.

## What is live and what is not

| | Source | State on screen |
|---|---|---|
| Carris Metropolitana bus positions | GPS (open API), refreshed every 10 s | **Live** (green pulsing dot, solid outline); **Stale** after 2 min (faded, "last seen X ago"); not shown after 10 min |
| All times (departures, next stops, end of line) | timetable | **Scheduled** "~3 min" |
| Every other vehicle (Carris, Metro, CP, Fertagus, ferries, TCB, MobiCascais) | timetable | **Expected** (dashed outline) |

The always-visible note reads **"Timetable times · live GPS buses"** while live buses work, and
"Timetable data, not live" otherwise. Help explains both.

## Linking by key (CLAUDE.md)

Each live bus reports the GTFS `trip_id` of the trip it runs. On 2026-10-30, **all 1 157 / 1 162 live trip_ids
matched the TML regional `trips.txt` exactly** (two checks, both 100 %).

- The timetable build (`npm run timetable`) writes one small index per Carris Metropolitana line:
  `public/data/<version>/live/<line>.json` = `trip_id → [pattern id, trip start]` (694 files, 572 kB gzip in total,
  largest 6 kB). The manifest lists them (`liveTrips`). Operators get an index when `liveTrips: true` in
  `scripts/timetable/operators.ts`.
- The bus's line id comes from its `route_id` with the approved rule `lineIdOfRoute` (docs/DATA.md §5).
- In the app (`src/offline/live.ts`): index → pattern + start → the timetable row with that start running on
  today's (or, after midnight, yesterday's) service day. The bus then **takes over that trip's key**, so tapping it
  opens the same panel as before (line, destination, next stop, end of line, route line), and its departures are
  the same rows.
- Where it is on its route (for the next stop) comes from projecting the GPS point onto the trip's shape; the
  position drawn is the GPS point itself (live pins are never moved to avoid overlaps).

A bus whose trip_id is not in the index, or whose route is not in the loaded map areas, is not shown (nothing is
guessed).

## While the feed works

Carris Metropolitana trips **without** a GPS bus are not drawn at a timetable position (they would be guesses next
to real buses). If the feed fails for more than a minute, their Expected positions come back automatically.
Departure rows always show the timetable.

## Server

`GET /api/vehicles?lat&lng&radius` behind its own flag **`LIVE_VEHICLES_ENABLED`** (wrangler.jsonc, now `"true"`).
The rest of the old live API (stops, departures, board) stays behind `LIVE_ENABLED` (off). One upstream list,
cached 5 s, serves every phone; phones never call the operator directly.

## Not done (possible next steps)

- **Live arrival times**: the same API has estimates per stop (`/arrivals/by_stop`); departure rows still show the
  timetable.
- **Delay**: a bus's delay versus its timetable could be shown ("+3 min") from its position.
- **Licence**: Carris Metropolitana calls its API open data; terms of use still to be confirmed before a public
  release (as for the timetables).
