// End-to-end test of the /api routes with the real TML provider, where the upstream API is
// replaced by the captured responses in fixtures/.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LISBON } from '../shared/region';
import type { Board, DepartureList, StopList, VehicleList, VehicleRoute } from '../shared/types';
import { handleApi } from './index';
import { TML_BASE_URL, TmlClient } from './providers/tml/client';
import { TmlProvider } from './providers/tml/provider';

const FIX = path.resolve(__dirname, '../fixtures');
const meta = JSON.parse(fs.readFileSync(path.join(FIX, '_meta.json'), 'utf8'));
const now = new Date(meta.captured_at);

// Upstream path -> fixture file. /stops is served from the near-TEST subset.
const ROUTES: Record<string, string> = {
  '/stops': 'stops.near-test-1500m.json',
  '/lines': 'lines.json',
  '/vehicles': 'vehicles.json',
  '/arrivals/by_stop/060035': 'arrivals.by_stop.060035.json',
  '/arrivals/by_stop/060033': 'arrivals.by_stop.060033.json',
  '/patterns/3715_0_1': 'pattern.3715_0_1.json',
  [`/shapes/${encodeURIComponent('[2QDAD]3715_0_1')}`]: 'shape._2QDAD_3715_0_1.json',
};

function fixtureFetch(upstreamDown = false) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    const p = url.slice(TML_BASE_URL.length);
    calls.push(p);
    if (upstreamDown) return new Response('', { status: 503 });
    const file = ROUTES[p];
    return file ? new Response(fs.readFileSync(path.join(FIX, file))) : new Response('[]', { status: 404 });
  };
  return { fn, calls };
}

function api(pathAndQuery: string, upstreamDown = false) {
  const f = fixtureFetch(upstreamDown);
  const provider = new TmlProvider(LISBON, new TmlClient(f.fn, () => now.getTime()));
  return { res: handleApi(new URL('http://x' + pathAndQuery), provider, now), calls: f.calls };
}

describe('GET /api/stops', () => {
  it('serves the trimmed list', async () => {
    const res = await api('/api/stops').res;
    expect(res.status).toBe(200);
    const body = (await res.json()) as StopList;
    expect(body.stops.length).toBe(11);
    expect(Object.keys(body.stops[0]!).sort()).toEqual(['id', 'lat', 'lng', 'name']);
  });
});

describe('GET /api/stops/:id/departures', () => {
  it('returns departures for a stop', async () => {
    const res = await api('/api/stops/060035/departures').res;
    const body = (await res.json()) as DepartureList;
    expect(body.stopId).toBe('060035');
    expect(body.departures.some(d => d.tripId === meta.chosen_vehicle.trip_id)).toBe(true);
  });
  it('rejects a malformed stop id without calling upstream', async () => {
    const { res, calls } = api('/api/stops/abc/departures');
    expect((await res).status).toBe(400);
    expect(calls).toEqual([]);
  });
  it('returns an empty list for an unknown stop', async () => {
    const body = (await (await api('/api/stops/999999/departures').res).json()) as DepartureList;
    expect(body.departures).toEqual([]);
  });
});

describe('GET /api/board', () => {
  const { lat, lng } = LISBON.testLocation;
  it('combines departures of all stops inside the radius, soonest first, tagged with their stop', async () => {
    const body = (await (await api(`/api/board?lat=${lat}&lng=${lng}&radius=500`).res).json()) as Board;
    expect(body.stopsInRadius).toBe(7);
    expect(body.stopsQueried).toBe(7);
    const d = body.departures.find(x => x.tripId === meta.chosen_vehicle.trip_id)!;
    expect(d).toMatchObject({ stopId: '060035', stopName: 'R Joaquim António Aguiar', line: '3715' });
    expect(d.distanceM).toBeGreaterThan(300);
    const at = body.departures.map(x => x.estimatedAt ?? x.scheduledAt);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(new Set(body.departures.map(x => x.id)).size).toBe(body.departures.length);
  });
  it('limits the radius to 1000 m', async () => {
    expect((await api(`/api/board?lat=${lat}&lng=${lng}&radius=1500`).res).status).toBe(400);
  });
  it('reports an outage when every stop fails, instead of an empty board', async () => {
    await expect(api(`/api/board?lat=${lat}&lng=${lng}&radius=500`, true).res).rejects.toThrow();
  });
});

describe('GET /api/vehicles', () => {
  it('returns vehicles near a point, with destination when the route data exists', async () => {
    const { lat, lng } = LISBON.testLocation;
    const body = (await (await api(`/api/vehicles?lat=${lat}&lng=${lng}&radius=1000`).res).json()) as VehicleList;
    const v = body.vehicles.find(x => x.id === meta.chosen_vehicle.id)!;
    expect(v.headsign).toBe('Santa Marta do Pinhal (via Centro Sul)');
  });
  it('validates the position and radius', async () => {
    expect((await api('/api/vehicles').res).status).toBe(400);
    expect((await api('/api/vehicles?lat=38.7&lng=-9.1&radius=99999').res).status).toBe(400);
  });
});

describe('GET /api/vehicles/:id/route', () => {
  it('returns line, destination and geometry for a live vehicle', async () => {
    const res = await api(`/api/vehicles/${encodeURIComponent(meta.chosen_vehicle.id)}/route`).res;
    const body = (await res.json()) as VehicleRoute;
    expect(body).toMatchObject({ line: '3715', headsign: 'Santa Marta do Pinhal (via Centro Sul)' });
    expect(body.path.length).toBe(1079);
    expect(body.stopIds).toHaveLength(31);
    expect(body.stopIds.slice(0, 2)).toEqual(['060405', '060035']);
    expect(body.nextStopId).toBe('060035');
  });
  it('404s for a vehicle not in the feed', async () => {
    expect((await api('/api/vehicles/nope/route').res).status).toBe(404);
  });
});

describe('upstream failure', () => {
  it('surfaces as an error, never as fake data', async () => {
    await expect(api('/api/stops', true).res).rejects.toThrow(/503/);
  });
});
