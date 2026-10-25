# TPulso — data contract (Carris Metropolitana / TML)

Verified against the live API on **2026-10-25** (Sunday, ~13:40 Lisbon). Snapshot in `fixtures/` (see `fixtures/_meta.json`); refresh with `node scripts/capture-fixtures.mjs fixtures`.

## 1. Endpoints

Base URL: `https://api.carrismetropolitana.pt/v2`. **Always use `/v2/...`.** The unprefixed paths (`/stops`, `/lines`, …) still serve the old v1 format (e.g. `lat` as a string) or redirect to v2.

| Use in TPulso | Endpoint | Size | Cache-Control | Fixture |
|---|---|---|---|---|
| stopsNear | `GET /stops` (all 12 752 stops, no geo query) | 6.8 MB | 1 h | `stops.near-test-1500m.json` (subset) |
| departures | `GET /arrivals/by_stop/{stop_id}` (stop_id = 6 digits) | 10–100 KB | 20 s | `arrivals.by_stop.060033.json`, `arrivals.by_stop.060035.json` |
| vehicles | `GET /vehicles` (JSON, ~365 buses) | 300 KB | 5 s | `vehicles.json` |
| vehicles (GTFS-RT) | `GET /vehicles.pb` (GTFS-Realtime VehiclePositions, protobuf) | 70 KB | 5 s | `vehicles.pb` |
| route → shape | `GET /patterns/{pattern_id}` → `shape_id` | 0.5 MB | 1 h | `pattern.3715_0_1.json` |
| shapes | `GET /shapes/{shape_id}` (URL-encode the `[` `]`) | 0.2–0.4 MB | 1 h | `shape._2QDAD_3715_0_1.json` |
| line names/colours | `GET /lines`, `GET /routes` | 0.3–0.4 MB | 1 h | `lines.json`, `routes.json` |
| plan versions | `GET /plans` | tiny | 1 h | `plans.json` |
| static GTFS zip | `GET /gtfs` | 78 MB zip (stop_times.txt alone is 813 MB unpacked) | — | `gtfs/*.sample.txt` (rows for one trip) |
| *(out of scope)* | `GET /alerts` (GTFS-RT style JSON) | 90 KB | — | — |

- **No API key.** `Access-Control-Allow-Origin: *` (the browser could call it directly).
- **No rate limits documented and no rate-limit headers.** Respect the cache times above; poll vehicles every ≥ 10 s.
- **Docs site is gone:** `docs.carrismetropolitana.pt` redirects to the public website. The only reference is the source code: github.com/carrismetropolitana/api (branch `v2`, `apps/server/src/endpoints`).
- Endpoints that **do not exist**: single stop / single vehicle / single line lookups, arrivals by trip or line, a GTFS-RT TripUpdates feed. `arrivals/by_pattern` exists but returned `[]` for every ID form tried.
- Times: vehicle `timestamp` is **milliseconds**; arrival `*_unix` fields are **seconds**. Arrival `scheduled_arrival` strings can exceed 24:00 (GTFS style) — always use the `*_unix` fields.

## 2. ID formats

TML IDs carry namespace prefixes in square brackets: `[AGENCY]` (e.g. `[YA15B]`) and sometimes `[PLAN][AGENCY]` (e.g. `[PL3CL][YA15B]`). The four agencies: `LA77N`=41, `BNA17`=42, `YA15B`=43, `A2L1N`=44 (`agency_id` in the vehicles feed is the number). **The same object has a different ID form depending on the endpoint:**

| Object | /v2/vehicles | /v2/arrivals | /v2/lines, /routes, /patterns | GTFS zip |
|---|---|---|---|---|
| vehicle | `[YA15B]2436` | `2436` | — | — |
| trip | `[PL3CL][YA15B]3715_0_1_1330_1359_0_ESC_DOM` | **same** | `[2QDAD]3715_0_1_…` (older plan) | **same as vehicles** |
| pattern | `[PL3CL][YA15B]3715_0_1` | `[YA15B]3715_0_1` | `3715_0_1` | `[YA15B]3715_0_1` |
| route | `[YA15B]3715_0` | `[YA15B]3715_0` | `3715_0` | `[YA15B]3715_0` |
| line | `3715` | `[YA15B]3715` | `3715` | — |
| shape | — | — | `[2QDAD]3715_0_1` | `[PL3CL][YA15B]3715_0_1` |
| stop | `060035` (or `UNAVAILABLE_STOP_ID`) | `060035` | `060035` | **`360035`** (old ID in `legacy_ids`) |

None of these strings may ever be shown to the user. Show `lines.short_name` (e.g. "3715"), `headsign` and `stops.long_name`.

## 3. How objects link (verified)

```
stop (/stops.id) ──── arrivals/by_stop/{id}
                          │ arrival.trip_id  ══ exact ══  vehicle.trip_id   (14/15 tested)
                          │ arrival.vehicle_id + agency prefix = vehicle.id
vehicle ── vehicle.stop_id ══ exact ══ /stops.id   (357/367; rest "UNAVAILABLE_STOP_ID")
        ── vehicle.line_id ══ exact ══ /lines.id   (363/364)  → short_name, color, long_name
        ── vehicle.pattern_id ─(strip prefixes)→ /patterns/{id} → shape_id ══ exact ══ /shapes/{id}
```

- **Exact keys that work:** `trip_id` (vehicle ↔ arrival ↔ GTFS zip trips), `stop_id` (vehicle ↔ /stops ↔ arrivals), `line_id` (vehicle ↔ /lines), `shape_id` (pattern ↔ /shapes).
- **No exact key exists for:** arrival → line name (arrival `line_id` is `[YA15B]3715`, /lines id is `3715`), and vehicle → pattern/shape (vehicle `[PL3CL][YA15B]3715_0_1`, /patterns id `3715_0_1`). Both need the leading `[...]` prefixes removed. The official API does the same internally (`substring(indexOf(']') + 1)` in `arrivals.endpoint.ts`).
- `/patterns/{id}` returns an **array** of versions. Use the one whose `valid_on` contains today's date (Lisbon). Its `trips[].trip_ids` are on an older plan, so they **never** equal live trip IDs. Use the pattern for geometry and stop order only.
- The shape from the API (plan `2QDAD`) and the GTFS-zip shape for the live trip (plan `PL3CL`) were **identical** in the sample (1 079 points, 0 m difference).

## 4. Real-time vs scheduled (departures)

`/arrivals/by_stop` returns **every trip of the whole service day** at that stop, including past ones, sorted by schedule.
- `estimated_arrival_unix` not null → **real time** (also has `trip_id` and `vehicle_id`).
- `estimated_arrival_unix` null → **scheduled only** (`trip_id` and `vehicle_id` are null too).
- `observed_arrival*` is always null on this endpoint (hard-coded in the source).
- Coverage in the sample: 32 of 68 departures in the next 60 min (≈ 47 %) had a real-time estimate. Scheduled-only rows are the normal case, not an error.
- The client must drop past rows. Use the estimate if present, otherwise the scheduled time.

## 5. Rules for the provider (TML implementation)

1. Use the **v2 JSON API as the single source.** Do not mix in GTFS-zip IDs at runtime (different stop numbers and plans, see below).
2. Keep **one** tested function, `stripNamespace(id)`, that removes leading `[XXXXX]` groups. Use it only for the two missing links in §3, never on names. *(Needs owner approval, see "Mismatches" #4.)*
3. `stopsNear` cannot query by location. The 6.8 MB `/stops` list must be cached and filtered server-side (Cloudflare Worker cache, 1 h) and never downloaded by the phone.
4. Ignore `vehicle.stop_id === "UNAVAILABLE_STOP_ID"`. The capacity fields are 0 and make/model are null: do not show them.
5. Vehicle ID `[AGENCY]number` is stable and unique (0 duplicates). Keep it as the internal vehicle key for the later share feature.

## 6. Mismatches with BRIEF.md / CLAUDE.md

1. **The TEST location has no TML stops.** 0 stops within 100/200/500 m of Avenida da Liberdade. The nearest are the Marquês de Pombal (Metro) P1–P6 stops, 729–790 m away. Avenida da Liberdade is served by Carris (city) and the Metro, both out of scope. In TEST mode the radar would always be empty. → Choose a new TEST point, e.g. Marquês de Pombal P1 (38.725878, -9.151315), which has 4 TML stops within 100 m, 6 within 200 m and 7 within 500 m.
2. **Docs site no longer exists.** `docs.carrismetropolitana.pt` → redirect. Reference = API source on GitHub.
3. **No GTFS-Realtime TripUpdates.** Only VehiclePositions (`/vehicles.pb`). Real-time departures come from the JSON `arrivals/by_stop`, which gives estimates only (no observed times).
4. **IDs are not plain GTFS keys** and differ per endpoint (§2). Two links in the MVP (arrival → line name, vehicle → shape) need prefix-stripping. This conflicts with "link by real GTFS keys, not by matching text". The only fully exact alternative is to preprocess the 78 MB GTFS zip (trip_id → shape_id), which goes against "no database / small MVP".
5. **The GTFS zip and the API are out of sync.** The zip (feed 20261024) has renumbered ~5 050 stops (`060033` → `360033`, with the old ID in `legacy_ids`) and uses newer plans (`KMMRZ`, `PL3CL`, …). The API and the live data still use the old stop IDs and older plans in `/patterns`.
6. **Real-time is partial** (~47 % of near-term departures in the sample). The UI must treat scheduled-only as normal.
7. **No geo query for stops.** Radar filtering needs the full 6.8 MB list cached on the server.
8. **No documented rate limit and no key.** Easier than assumed, but no guarantees.
