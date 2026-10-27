# Service alerts — phase 1 findings (2026-10-27)

Research only: no app code was changed. Every source below was called for real on 2026-10-27 around 22:15
Lisbon time; samples are in `fixtures/alerts/` (with the response headers, `fetched-at.txt`).

## Summary

| Operator | Machine-readable source | Status |
|---|---|---|
| Carris Metropolitana (4 areas) | **TML hub alerts** (and CM API v2) | usable |
| MobiCascais | **TML hub alerts** | usable (2 alerts today) |
| Metro de Lisboa | **TML hub alerts** (1 alert today); line status `app.metrolisboa.pt/status/getLinhas.php` | hub usable; line status undocumented → needs approval |
| Transtejo / Soflusa | official RSS `ttsl.pt/avisos/feed/` (free text) | usable for operator-wide notices (no line keys) |
| Carris (city) | none public (web page only) | not usable without scraping |
| CP | none public (web/app only) | not usable without scraping / undocumented API |
| Fertagus | none found (site returned 503 during the test) | not usable |
| TCB | none (WordPress RSS feeds are empty; web page only) | not usable without scraping |

No source gives **trip-level delays** today (the Carris Metropolitana real-time API has arrival estimates, but
that is the live feature, switched off). So phase 3 can show alerts, but no source supports shifting an
expected time for a specific trip yet.

## Sources tested

### 1. TML hub alerts — recommended primary source
- URL: `https://go.tmlmobilidade.pt/hub/api/v1/alerts` (same hub as our timetable feed)
- Format: JSON `{ data: Alert[], error, status_code, timestamp }`; 116 kB, 119 alerts
- Alert fields: `_id, agency_id, title, description, cause, effect, active_period_start_date,
  active_period_end_date (ms), reference_type ("lines" | "stops" | "agency"), references [{ parent_id,
  child_ids }], municipality_ids, coordinates, image_url, info_url`
- Causes / effects use the GTFS-Realtime vocabulary (CONSTRUCTION, STRIKE, WEATHER… / DETOUR,
  STOP_MOVED, SIGNIFICANT_DELAYS, REDUCED_SERVICE, ACCESSIBILITY_ISSUE…)
- **Keys**: lines as the regional GTFS `route_id` (`[HF16N]25`, `[IA2N9]2`), stops as GTFS `stop_id`
  (`215268`), agency as the regional `agency_id`. These are exactly the TML feed's identifiers, so alerts can
  be linked to our data by key (CLAUDE.md), not by text. Note: the converted timetable keeps line numbers and
  pattern ids but not the GTFS `route_id`; phase 2 must add it to the converter output.
- Coverage today: Rodoviária de Lisboa 47, Transportes Sul do Tejo 31, Alsa Todi 28, Viação Alvorada 10
  (the four Carris Metropolitana areas), MobiCascais 2, Metropolitano de Lisboa 1. No alerts from Carris (city),
  CP, Fertagus, Transtejo/Soflusa or TCB at the time of the test.
- HTTPS: yes. CORS: `Access-Control-Allow-Origin: *`. Key: none. `Cache-Control: public, max-age=30`.
- Language: Portuguese.
- Terms of use: none stated (no documentation page found; `/hub/api/v1/docs` is 404). To clarify with TML
  before a public release.

### 2. Carris Metropolitana API v2 alerts
- URLs: `https://api.carrismetropolitana.pt/v2/alerts` (JSON, 99 kB, 110 alerts, 75 active) and
  `https://api.carrismetropolitana.pt/v2/alerts.pb` (GTFS-Realtime protobuf, 62 kB). `/alerts` without `v2`
  redirects (307).
- Format: GTFS-Realtime Service Alerts (`active_period, cause, effect, header_text, description_text,
  informed_entity, image`); `informed_entity` uses the same TML `route_id`s.
- Coverage: only the four Carris Metropolitana areas — a subset of the TML hub. Using both would duplicate
  alerts, so phase 2 should use the hub and keep this as a fallback.
- HTTPS: yes. CORS: `*`. Key: none. `Cache-Control: public, max-age=20`. Language: Portuguese.
- Documentation: the API's home page redirects to github.com/carrismetropolitana/api (README lists
  `GET /alerts` and `GET /alerts.pb`). No licence or terms of use stated in the repository or found on
  carrismetropolitana.pt/open-data (the page is rendered by JavaScript; no licence text in its HTML).

### 3. Metro de Lisboa line status — needs approval
- URL: `https://app.metrolisboa.pt/status/getLinhas.php` (`http://` redirects to `https://` with 301; the
  listings saying "no HTTPS" are out of date)
- Response: `{"resposta":{"amarela":" Ok","azul":" Ok","verde":" Ok","vermelha":" Ok","tipo_msg_am":"0",…},
  "codigo":"200"}` — status text per line plus a message-type code; served as `text/html`.
- CORS: none → must go through the Worker. Key: none. `Cache-Control: must-revalidate, max-age=86400`
  (the cache header cannot be trusted for freshness). Language: Portuguese.
- It is on Metro's own domain (used by its app) but **undocumented**: no official documentation or terms
  found, only third-party API directories. Using it is your decision.
- Line keys: lines are named by colour, not by GTFS `route_id`; mapping the four colours to the four Metro
  routes is a fixed, explicit table (to confirm against the Metro GTFS `route_id`s in phase 2).

### 4. Transtejo / Soflusa notices RSS
- URL: `https://ttsl.pt/avisos/feed/` (official WordPress feed of the "Avisos / Alterações de Serviço" page)
- Format: RSS 2.0, 10 latest items (title, link, date, HTML description). HTTPS: yes. CORS: none → Worker.
  Key: none. Language: Portuguese.
- No line or stop identifiers: notices can only be attached to the operator (e.g. "Transtejo/Soflusa"), not
  to a line — linking by text would break the CLAUDE.md rule. Validity is not given as fields (only in the
  text); treat each item as current for a limited time after its date, or show it as "published on …".
- Terms: none stated for the feed.

### Operators without a usable source
- **Carris (city)**: notices at https://www.carris.pt/viaje/alteracoes-de-servico/ (web page; no feed). The
  company states its real-time APIs are no longer public; access may be granted on request.
- **CP**: real-time information exists on cp.pt and in the app, but no public API; the internal endpoints used
  by the website are undocumented. Not used.
- **Fertagus**: no API or feed found; www.fertagus.pt returned 503 during the test.
- **TCB**: alerts page https://tcbarreiro.pt/alertas-tcb/ (web page); its WordPress feeds return no items.

Scraping any of these web pages is not done without your approval.

## Recommendation for phase 2
1. TML hub alerts as the main provider (HTTPS + CORS, real GTFS keys, covers 6 operators today).
2. Optional: Metro line status through the Worker (needs your approval; undocumented).
3. Optional: Transtejo/Soflusa RSS through the Worker as operator-wide notices.
4. Converter: keep the GTFS `route_id` per pattern (and `agency_id` per operator) so alerts link by key.
5. Ask TML (and Carris Metropolitana) about terms of use before a public release.
