# TPulso — public transport radar for the Lisbon metropolitan area (TML)

Read BRIEF.md before doing anything. This file holds the rules that apply to every session.

## What this is
A mobile-first web app (installable PWA) that shows buses and stops around the user within a 100 / 200 / 500 / 1000 m radar, with real-time departures and live vehicle positions, using Carris Metropolitana (TML) open data. It is a new, independent project inspired by OV Pulse (Netherlands). The original project, `Dutch-Routes`, must never be modified.

## Hard rules
- No fake, simulated or random data anywhere. If data is unavailable, show an honest empty/error state.
- Never show internal IDs to the user (e.g. `[IA9T6]199_0`). Show line number, destination, stop name.
- Identifiers must be linked through real GTFS keys (stop_id, trip_id, route/pattern id, shape_id), not by matching text. Only approved exception: `stripNamespace()` for the two links listed in docs/DATA.md §3.
- Real-time times and scheduled times must be visibly distinguishable.
- **Offline timetable version (current, docs/OFFLINE.md): two states only.** Everything is labelled as timetable data, with a visible "Timetable data, not live" note; nothing is ever shown as live.
  - **Scheduled**: blue-grey, outline-only dot; time like "~3 min" (all times).
  - **Expected**: a vehicle's position calculated from the timetable; dashed outline (pin and dot).
  - Live, Estimated and Stale (below) apply only when the live feature flag (`LIVE_ENABLED` / `VITE_LIVE`) is on; it is off.
  - Exception (2026-10-30, docs/LIVE.md): with `LIVE_VEHICLES_ENABLED` on, Carris Metropolitana **bus positions** are Live/Stale GPS (linked to their timetable trip by exact trip_id). All times stay Scheduled; the note then reads "Timetable times · live GPS buses".
- Data-source display rule for the live version (flag off; every departure and every vehicle shows its source; logic in `src/lib/sourceStatus.ts`):
  - **Live**: green, solid, pulsing dot; time like "3 min".
  - **Scheduled**: blue-grey, outline-only dot; time like "~3 min".
  - **Estimated**: lilac, dashed outline; time like "~3 min". Used for a selected bus's upcoming stops that have no Live/Scheduled row: computed from distance along the route and the bus's recent speed (`src/lib/eta.ts`, after the original's upcomingStopsFor/etaS).
  - **Stale**: grey, faded; text "last seen X ago".
  - **Expected position**: dashed outline (used by the offline version). Estimated, in the live version, also uses a dashed outline but a different hue and only for stop times.
  - Delay is shown as text ("+3 min") with an arrow, never by changing the source colour.
  - Never rely on colour alone (shape, fill, motion and text must also differ). A small on-screen legend explains the states.
- TEST mode: if the user is outside Portugal (or GPS is denied), use Marquês de Pombal (Metro) P1, Lisboa (38.725878, -9.151315; TML stop 060033) and show a clear "TEST" label in the UI. (Avenida da Liberdade was dropped: it has no TML stops within 500 m — see docs/DATA.md.)
- Radar radii: 100 m, 200 m, 500 m, 1000 m.
- Four mode colours only, defined once in `src/config.ts` (MODE_COLORS): Bus yellow, Tram/Metro purple, Train blue, Ferry red. Used for vehicle markers, route lines, station rings, list icons, legend and filter chips. No per-line or per-operator colours. The mode is also shown by its icon. The radar circle and the user dot are neutral light grey, never Train blue.
- Time zone: Europe/Lisbon.
- Never commit secrets. `.env` is git-ignored.

## Priority order
1. Correct TML data  2. Identifier relations  3. Real time  4. Departures  5. Route geometry  6. Radar UX  7. Visual polish

## Working style
- Before coding a data layer, capture real API responses into `fixtures/` and write tests against them.
- Put all TML-specific code behind a provider interface (stopsNear, departures, vehicles, shapes) and all region settings (bounds, timezone, TEST location) in one region config, so other regions/operators can be added later.
- Keep the app small: MVP scope only (see BRIEF.md). Do not add features outside it without asking.
- Run the tests and the dev server yourself and fix what breaks before reporting back.
- Explain results briefly; the owner is not a professional developer.

## Stack (proposed, confirm on day 1)
TypeScript, React, Vite or TanStack Start, Tailwind, Leaflet or MapLibre, Cloudflare Workers for deployment. No database in the MVP.

## Reuse the original OV Pulse (IMPORTANT)
TPulso is the Lisbon version of OV Pulse, not a new design. A read-only copy of the original is in `reference/ovpulse/` (see `reference/README.md`, git-ignored, never commit it, never edit the original `Dutch-Routes`).
- Read `reference/README.md` first, then reuse the original's screen layout, map behaviour, panels, departure list split (in radar / outside radar), vehicle cards, follow/pin, Help and Feedback panels, countdown ticking, design tokens (`styles.css`), icons and PWA manifest. Match its look and feel.
- Replace only the data layer: TML provider with exact IDs (docs/DATA.md), no simulated data, no OVapi/NS/OSM fuzzy matching, Lisbon time zone, Portuguese-friendly wording (keep English UI text unless told otherwise).
- When the new screen differs from the original's look or behaviour, the original is right unless BRIEF.md or this file says otherwise.
