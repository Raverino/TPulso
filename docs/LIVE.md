# Live GPS buses over the timetable (2026-10-30)

Carris (city buses and trams) did not give access to its real-time data. The one operator with **open** live
vehicle data is **Carris Metropolitana**: `https://api.carrismetropolitana.pt/v2/vehicles` (no key, CORS open,
cached 5 s). TPulso now shows those buses at their GPS position. Everything else stays timetable data.

## What is live and what is not

| | Source | State on screen |
|---|---|---|
| Carris Metropolitana bus positions | GPS (open API), refreshed every 10 s | **Live** (green pulsing dot, solid outline); **Stale** after 2 min (faded, "last seen X ago"); not shown after 10 min |
| All times (departures, next stops, end of line) | timetable | **Scheduled** "~3 min" |
| Other buses (Carris city, TCB, MobiCascais: no open GPS) | — | **not on the map** (owner decision 2026-10-30); their departures stay in the lists as Scheduled |
| Trams, Metro, trains, ferries | timetable | **Expected** (dashed outline) |

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
- Where it is on its route comes from projecting the GPS point onto the trip's shape. The bus is **drawn on its
  line** at that point (GPS wanders a few metres) and, between fixes, **moves along the line** from where it is
  drawn to the newest fix, over as long as the bus took between its last two fixes (3–30 s), so it moves steadily
  at about its real pace (`trackUpdate` in `src/offline/live.ts`). A small step back (GPS noise, < 150 m) is held; a
  larger one is taken at once. A fix more than 150 m off the line is drawn where the GPS says. Live pins are never
  moved to avoid overlaps.

A bus whose trip_id is not in the index, or whose route is not in the loaded map areas, is not shown (nothing is
guessed).

## Only GPS buses on the map (owner decision, 2026-10-30)

With live buses on, **no bus is drawn at a timetable position**: Carris Metropolitana buses show at their GPS
position, and buses of operators without open GPS (Carris city, TCB, MobiCascais) are not on the map. Their
departures stay in the lists. If the feed fails for a minute, the top bar says "live buses unavailable" (bus
positions are then missing, never guessed). Trams, Metro, trains and ferries keep their Expected positions.

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
