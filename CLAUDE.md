# TPulso — public transport radar for the Lisbon metropolitan area (TML)

Read BRIEF.md before doing anything. This file holds the rules that apply to every session.

## What this is
A mobile-first web app (installable PWA) that shows buses and stops around the user within a 100 / 200 / 500 / 1000 m radar, with real-time departures and live vehicle positions, using Carris Metropolitana (TML) open data. It is a new, independent project inspired by OV Pulse (Netherlands). The original project, `Dutch-Routes`, must never be modified.

## Hard rules
- No fake, simulated or random data anywhere. If data is unavailable, show an honest empty/error state.
- Never show internal IDs to the user (e.g. `[IA9T6]199_0`). Show line number, destination, stop name.
- Identifiers must be linked through real GTFS keys (stop_id, trip_id, route/pattern id, shape_id), not by matching text. Only approved exception: `stripNamespace()` for the two links listed in docs/DATA.md §3.
- Real-time times and scheduled times must be visibly distinguishable.
- TEST mode: if the user is outside Portugal (or GPS is denied), use Marquês de Pombal (Metro) P1, Lisboa (38.725878, -9.151315; TML stop 060033) and show a clear "TEST" label in the UI. (Avenida da Liberdade was dropped: it has no TML stops within 500 m — see docs/DATA.md.)
- Radar radii: 100 m, 200 m, 500 m, 1000 m.
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
