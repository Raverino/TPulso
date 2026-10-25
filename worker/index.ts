import { LISBON } from '../shared/region';
import type { TransitProvider } from '../shared/types';
import { TmlProvider } from './providers/tml/provider';

// One provider per Worker instance, so its in-memory caches are shared across requests.
const provider: TransitProvider = new TmlProvider(LISBON);

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

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
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
} satisfies ExportedHandler;
