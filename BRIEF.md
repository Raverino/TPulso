# TPulso — MVP brief

## Goal
A working mobile MVP for Lisbon (Carris Metropolitana / TML buses) within one week of starting (target around Mon 2026-11-02).

## In scope (MVP)
- User position via GPS; fallback to the TEST location (see CLAUDE.md), clearly labelled.
- Radius selector: 100 / 200 / 500 m.
- Stops inside the radius, shown on a map.
- Departures per stop, with real-time vs scheduled clearly marked, and countdowns.
- Live buses on the map (positions from TML real-time data).
- Tapping a bus shows its line, destination and route line (from official GTFS shapes).
- Honest empty / loading / error states. No fake data. No internal IDs shown.
- Installable on a phone (PWA), usable one-handed.

## Out of scope for the MVP
Metro, CP trains, Lisbon city Carris, ferries; smooth vehicle animation; follow/pin a connection; Help and Feedback panels; accounts; database; push notifications; friend tracking.

## Data source (verify on day 1)
Carris Metropolitana open API and GTFS / GTFS-Realtime (docs: https://docs.carrismetropolitana.pt, API: https://api.carrismetropolitana.pt). Check which endpoints exist, whether a key is needed, rate limits, and how vehicles link to trips and stops. Save real responses to `fixtures/`.

## Day 1 tasks
1. Confirm the TML endpoints; fetch real stops, vehicles, arrivals and one route shape; save to `fixtures/`.
2. Write a short data-contract note (docs/DATA.md): which IDs link which objects.
3. Report anything that does not match the assumptions above.

## Later ideas (do not build yet)
- Share "I'm on this vehicle" by link, and a friend "track" mode with a compass. Keep vehicle IDs stable so this can be added.
- Metropolitan-wide scale: GTFS ingest into Postgres/PostGIS, other operators behind the provider interface, proper map tiles, vehicle clustering.

## Reference
The old project's logic worth reusing: distance and radar-clipping helpers, departure list split (inside vs outside radar), countdown formatting. The original is at `Dutch-Routes` and is read-only for this project.
