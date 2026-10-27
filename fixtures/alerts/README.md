# Service alert samples (phase 1, see docs/ALERTS.md)

Real responses saved on 2026-10-27 at 22:18 UTC (`fetched-at.txt`), each with its response headers
(`*.headers.txt`, cookies removed). Requests were sent with an `Origin` header to check CORS.

| File | Source URL |
|---|---|
| `tml-hub-alerts.json` | https://go.tmlmobilidade.pt/hub/api/v1/alerts |
| `carris-metropolitana-alerts.json` | https://api.carrismetropolitana.pt/v2/alerts |
| `carris-metropolitana-alerts.pb` | https://api.carrismetropolitana.pt/v2/alerts.pb (GTFS-Realtime protobuf) |
| `metro-lisboa-getLinhas.json` | https://app.metrolisboa.pt/status/getLinhas.php (undocumented) |
| `ttsl-avisos.rss.xml` | https://ttsl.pt/avisos/feed/ |
