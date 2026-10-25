# Other operators in the Lisbon area — timetable (GTFS) sources

Research only, nothing built yet. Checked on **2026-10-25** (a Sunday): every URL below was downloaded and its files read (agency, feed_info, calendar, calendar_dates, routes). "Trips today" counts trips whose service runs on 2026-10-25.

## Main finding: one regional feed already contains all of them

TML (Transportes Metropolitanos de Lisboa) publishes a **regional GTFS feed with every operator in the metropolitan area**:
`https://go.tmlmobilidade.pt/hub/api/v1/plans/gtfs` (112 MB zip, feed version `20261024-1626-06`).

| Agency in feed | Operator | Mode (route_type) | Routes | Trips today |
|---|---|---|---|---|
| `IA9T6` | Carris (city) | bus (3) 166 · tram (0) 10 | 176 | 6 302 |
| `IA2N9` | Metro de Lisboa | subway (1) | 5 | 1 427 |
| `N18KL` | CP – Comboios de Portugal | rail (2) | 123 | 856 |
| `7NTB1` | Fertagus | rail (2) | 2 | 104 |
| `LTP61` | Transtejo Soflusa | ferry (4) | 5 | 234 |
| `KB1F6` | MTS – Metro Transportes do Sul | tram/light rail (0) | 3 | **0** ⚠ |
| `A3H3M` | TCB – Transportes Colectivos do Barreiro | bus (3) | 75 | 594 |
| `HF16N` | MobiCascais | bus (3) | 162 | 1 155 |
| `LA77N` `BNA17` `YA15B` `A2L1N` | Carris Metropolitana (already live in TPulso) | bus (3) | 943 | 9 598 |

Why this matters: it uses **the same ID namespace as the TML API we already use** (`[AGENCY]…` prefixes, the same stop table with `legacy_ids`), so its stops and trips link to our current data by exact keys. `IA9T6` is the city Carris agency that already shows up in our departures and that we currently filter out.

⚠ **MTS** has 3 routes and 2 067 trips in the feed but **no trip runs today**, so its dates are wrong or missing for this period. MTS needs its own feed (see below).

## Per-operator check

| Operator | Official own feed (URL) | URL works? | Format | Licence | Feed dates | Covers today? | Live data? |
|---|---|---|---|---|---|---|---|
| **TML regional** (all of the below) | `https://go.tmlmobilidade.pt/hub/api/v1/plans/gtfs` | ✅ 200, 112 MB zip | GTFS (calendar_dates only), TML extensions (`plans.txt`) | Not stated in the feed. MobilityDatabase lists AGPL-3.0, which is the licence of TML's *code* on GitHub, not clearly of the data → **to confirm with TML** | 2020-05-06 → 2030-01-01 | ✅ (except MTS, see above) | Only Carris Metropolitana (already used). The TML arrivals API returns some city-Carris rows with an estimate (1 of 126 at stop 060035 in our fixture). |
| **Carris** (city bus + tram) | `https://gateway.carris.pt/gateway/gtfs/api/v2.11/GTFS` | ✅ 200, 48 MB zip | GTFS, 176 routes (only route_type 3; the trams are tagged as buses here) | Not stated | calendar 2026-06-06 → 12-31; feed_info says valid only 2026-10-24 → 11-08 (refreshed often) | ✅ | ⚠ Exists but **restricted**: Carris says its real-time APIs are "no longer public", access on request after review. |
| **Metro de Lisboa** | `https://www.metrolisboa.pt/google_transit/googleTransit.zip` | ✅ 200, 0.66 MB | GTFS incl. fares v2, 4 subway routes | Not stated | 2026-09-07 → 2026-12-31 | ✅ | ⚠ Reported public API with waiting times and line status (`app.metrolisboa.pt`); **not verified**, no official developer docs found. |
| **CP** (trains) | `https://publico.cp.pt/gtfs/gtfs.zip` | ✅ 200, 0.31 MB | GTFS (no feed_info; uses extended route_type 109 for suburban rail) | Not stated | 2025-12-14 → 2026-12-12 | ✅ (expires in 7 weeks) | ❌ No official open live feed found (live info only on cp.pt). |
| **Fertagus** | `https://www.fertagus.pt/GTFSTMLzip/Fertagus_GTFS.zip` | ✅ 200, 0.09 MB | GTFS, 3 rail routes | Not stated | 2026-09-14 → 2027-03-14 | ✅ | ❌ None found. |
| **Transtejo / Soflusa** | **No standalone official feed found** (not on MobilityDatabase; dados.gov.pt has an older city-harvested "Soflusa" dataset marked CC0, not checked as GTFS) | — | Only via the TML regional feed (`LTP61`, 5 ferry routes) | via TML | via TML: 2020-05-06 → 2027-07-01 | ✅ via TML | ❌ No open feed (their app shows real-time departures). |
| **MTS** (Almada–Seixal light rail) | Catalog URL `https://mts.pt/imt/MTS-20240129.zip` | ❌ **404** (redirects to an HTML page); no GTFS link on mts.pt | — | Catalog points to the national access point (NAP) entry 200 (page needs JavaScript; not readable here) | — | ❌ (TML copy has 0 trips today) | ❌ None found. |
| **TCB** (Barreiro buses) | `https://backend.tcbarreiro.pt/download-gtfs` | ✅ 200, 1.2 MB | GTFS (+ blocks, dead runs), 75 bus routes | Catalog link points to a Carris Metropolitana dataset → probably wrong; **not stated** | 2026-10-06 → 2026-12-31 | ✅ | ❌ None found. |
| **MobiCascais** | Google Drive: `https://drive.google.com/uc?export=download&id=13ucYiAJRtu-gXsLa02qKJrGOgDjbnUWX` | ✅ 200, 2.5 MB | GTFS incl. fares v1, 163 bus routes | Catalog points to `dadosabertos.cascais.pt/dataset/gtfs-mobicascais`, which now answers **404** → **to confirm** | 2025-01-01 → 2027-12-31 | ✅ | ❌ None found. |

**Live data summary:** only Carris Metropolitana has open real-time data today. City Carris has restricted real-time (on request); Metro de Lisboa reportedly has a public API (unverified). Everything else is **timetable only**, i.e. the "Scheduled" state.

**Licences:** none of the eight own feeds states a licence inside the file, and two catalog licence links are wrong or dead. Before TPulso shows or redistributes this data we should get written terms (TML for the regional feed, or each operator), or find them on the national access point.

## Proposal: a timetable-only "Scheduled" provider

Goal: show Metro, trains, ferries, city Carris, TCB and MobiCascais departures as **Scheduled** (blue-grey outline, "~3 min"), never as live, behind the existing `TransitProvider` interface.

**1. Source: the TML regional feed, plus MTS's own feed once a working URL is found.**
One download, one ID namespace, exact links to our current data. The operators' own feeds are kept as a fallback and as a cross-check for coverage gaps like MTS's.

**2. Preprocess offline, not in the Worker.** The feed is 112 MB zipped (~800 MB stop_times). A Worker can't parse that per request, and the MVP has no database. A scheduled job (a GitHub Action, nightly at 04:00 Lisbon) will:
- download the feed, check `feed_version` and that today is covered, else keep yesterday's output and mark the operator "no data today";
- keep only non-Carris-Metropolitana agencies (CM comes from the live API, so nothing is counted twice);
- write compact static files for the **next 3 service days** to Cloudflare R2 (or Workers static assets):
  - `stops.json`: id, name, lat, lng, modes. GTFS stop_ids are mapped to the API's stop_ids via `legacy_ids` (exact key), so a stop served by both Carris Metropolitana and city Carris is one stop.
  - `departures/{serviceDate}/{cell}.json`: per ~1 km grid cell, each stop's rows: line, headsign, mode, line colour, scheduled time (Unix seconds, resolved in Europe/Lisbon including times after 24:00 and DST days), trip_id.

  Rough size: about 250 000 stop-times per day for these operators, around 2 MB gzipped per day in total, split into small cells.

**3. `ScheduledGtfsProvider implements TransitProvider`:**
- `stopList()`: stops from `stops.json`, merged into the phone's trimmed list with a `modes` field (drives the filter).
- `departures(stopId)` / `board(center, r)`: read the cell file(s), return rows with `estimatedAt: null`. The existing UI then shows them as Scheduled automatically.
- `vehiclesNear()`: always `[]`. There are no positions, so no buses or trains are invented.
- `vehicleRoute()` / `vehicleStopTimes()`: `null`.

**4. `CompositeProvider([tmlLive, scheduledGtfs])`** in the Worker:
- merges stop lists, boards and departures, sorted by time;
- sends each request to the provider that owns the ID;
- `region.modesWithData` becomes "modes any provider currently has data for today", so the filter's "no data yet" labels update by themselves.

**5. Later live upgrades, each behind the same interface:**
- city Carris real-time (request access) or the occasional TML estimates for `IA9T6`, which we already receive;
- the Metro de Lisboa API, once verified.

A live row replaces the matching Scheduled row by exact `trip_id`.

**Open questions before building:**
1. Data licence and terms for the TML regional feed, and for each own feed.
2. A working MTS feed URL (or a fix from TML for `KB1F6` dates).
3. Hosting the nightly job (GitHub Actions + R2 is the simplest; R2 needs a Cloudflare account setting).
4. Whether city Carris departures should be enabled now from the TML arrivals API. They are real data we already receive, but mostly scheduled only.

Sources: MobilityDatabase entries [mdb-3412 (TML)](https://mobilitydatabase.org/feeds/gtfs/mdb-3412), [mdb-2929 (Carris)](https://mobilitydatabase.org/feeds/gtfs/mdb-2929), [tld-716 (Metro)](https://mobilitydatabase.org/feeds/gtfs/tld-716), [mdb-2057 (CP)](https://mobilitydatabase.org/feeds/gtfs/mdb-2057), [tld-715 (Fertagus)](https://mobilitydatabase.org/feeds/gtfs/tld-715), [mdb-2408 (MTS)](https://mobilitydatabase.org/feeds/gtfs/mdb-2408), [mdb-3186 (TCB)](https://mobilitydatabase.org/feeds/gtfs/mdb-3186), [mdb-1272 (MobiCascais)](https://mobilitydatabase.org/feeds/gtfs/mdb-1272); Carris real-time restriction: [Lisboa Para Pessoas](https://lisboaparapessoas.pt/en/?p=21696); Soflusa dataset on [dados.gov.pt](https://dados.gov.pt/en/datasets/informacao-sobre-transportes-publicos-da-cidade-de-lisboa-soflusa). All feed facts in the tables come from downloading and reading the files on 2026-10-25.
