import type { AlertsProvider } from '../shared/alerts';
import { LISBON } from '../shared/region';
import type { TransitProvider } from '../shared/types';
import { AllSourcesFailed, CombinedAlerts } from './providers/alerts/provider';
import { TmlHubAlerts } from './providers/alerts/tmlHub';
import { TtslRssAlerts } from './providers/alerts/ttslRss';
import { TmlProvider } from './providers/tml/provider';

// One provider per Worker instance, so its in-memory caches are shared across requests.
const provider: TransitProvider = new TmlProvider(LISBON);
// Service alerts (docs/ALERTS.md): the TML hub, plus Transtejo/Soflusa notices as operator-wide notices.
const alertsProvider: AlertsProvider = new CombinedAlerts([new TmlHubAlerts(), new TtslRssAlerts()]);

const MAX_VEHICLE_RADIUS_M = 5000;
const MAX_BOARD_RADIUS_M = 1000;

export function json(body: unknown, maxAgeSec: number, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': maxAgeSec > 0 ? `public, max-age=${maxAgeSec}` : 'no-store' },
  });
}

const error = (status: number, code: string) => json({ error: code }, 0, status);

/** Routes /api/* requests. Exported separately from the Worker so it can be tested with any provider. */
export async function handleApi(url: URL, p: TransitProvider, now: Date): Promise<Response> {
  const path = url.pathname;

  if (path === '/api/stops') {
    return json(await p.stopList(), 3600);
  }

  let m = path.match(/^\/api\/stops\/([^/]+)\/departures$/);
  if (m) {
    const stopId = decodeURIComponent(m[1]!);
    if (!/^\d{6}$/.test(stopId)) return error(400, 'invalid_stop_id');
    return json(await p.departures(stopId, Math.floor(now.getTime() / 1000)), 15);
  }

  if (path === '/api/vehicles' || path === '/api/board') {
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    const radius = Number(url.searchParams.get('radius') ?? 1000);
    const ok = url.searchParams.has('lat') && url.searchParams.has('lng') &&
      Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    if (!ok) return error(400, 'invalid_position');
    const max = path === '/api/board' ? MAX_BOARD_RADIUS_M : MAX_VEHICLE_RADIUS_M;
    if (!Number.isFinite(radius) || radius <= 0 || radius > max) return error(400, 'invalid_radius');
    return path === '/api/board'
      ? json(await p.board({ lat, lng }, radius, Math.floor(now.getTime() / 1000)), 15)
      : json(await p.vehiclesNear({ lat, lng }, radius), 5);
  }

  m = path.match(/^\/api\/vehicles\/([^/]+)\/route$/);
  if (m) {
    const route = await p.vehicleRoute(decodeURIComponent(m[1]!), now);
    return route ? json(route, 30) : error(404, 'vehicle_not_found');
  }

  m = path.match(/^\/api\/vehicles\/([^/]+)\/stop-times$/);
  if (m) {
    const times = await p.vehicleStopTimes(decodeURIComponent(m[1]!), now);
    return times ? json(times, 15) : error(404, 'vehicle_not_found');
  }

  return error(404, 'not_found');
}

/**
 * GET /api/alerts: every alert source combined (partial when a source fails; 502 only when all fail). Cached for
 * 60 s by the provider and the browser.
 */
export async function handleAlerts(p: AlertsProvider, now: Date): Promise<Response> {
  try {
    return json(await p.alerts(now.getTime()), 60);
  } catch (e) {
    if (e instanceof AllSourcesFailed) return error(502, 'alerts_unavailable');
    throw e;
  }
}

interface Env {
  /** Feature flag for the TML live API (docs/OFFLINE.md §7). Off ("false") in the offline timetable version. */
  LIVE_ENABLED?: string;
  /**
   * Feature flag for live bus positions only (GET /api/vehicles, docs/LIVE.md): Carris Metropolitana's open GPS
   * feed shown over the timetable. The rest of the live API stays behind LIVE_ENABLED.
   */
  LIVE_VEHICLES_ENABLED?: string;
  /** Feature flag for service alerts (/api/alerts, docs/ALERTS.md). Independent of LIVE_ENABLED. */
  ALERTS_ENABLED?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // Alerts are not live vehicle data: they have their own flag and work in the offline version.
    if (url.pathname === '/api/alerts') {
      if (env.ALERTS_ENABLED !== 'true') return error(404, 'alerts_disabled');
      if (request.method !== 'GET') return error(405, 'method_not_allowed');
      return handleAlerts(alertsProvider, new Date());
    }
    // Live bus positions have their own flag: one upstream list (cached 5 s) serves every phone.
    if (url.pathname === '/api/vehicles' && env.LIVE_VEHICLES_ENABLED === 'true' && env.LIVE_ENABLED !== 'true') {
      if (request.method !== 'GET') return error(405, 'method_not_allowed');
      try {
        return await handleApi(url, provider, new Date());
      } catch (e) {
        console.error('api error', url.pathname, e);
        return error(502, 'upstream_unavailable');
      }
    }
    // The rest of the live provider is kept (and tested via handleApi) but switched off.
    if (env.LIVE_ENABLED !== 'true') return error(404, 'live_disabled');
    // Feedback panel (ported from the original): no storage is configured in the MVP (no database),
    // so say so honestly instead of pretending it was sent.
    if (url.pathname === '/api/feedback') {
      return request.method === 'POST' ? error(503, 'feedback_not_configured') : error(405, 'method_not_allowed');
    }
    if (request.method !== 'GET') return error(405, 'method_not_allowed');

    // The stop list is built from a 6.8 MB upstream file: keep the finished response in the edge cache.
    const cacheable = url.pathname === '/api/stops';
    const cache = typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : undefined;
    if (cacheable && cache) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }

    try {
      const res = await handleApi(url, provider, new Date());
      if (cacheable && cache && res.ok) ctx.waitUntil(cache.put(request, res.clone()));
      return res;
    } catch (e) {
      console.error('api error', url.pathname, e);
      return error(502, 'upstream_unavailable');
    }
  },
} satisfies ExportedHandler<Env>;
