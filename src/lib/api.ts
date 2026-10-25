import type { Board, DepartureList, LatLng, StopList, VehicleList, VehicleRoute, VehicleStopTimes } from '../../shared/types';

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'No connection');
  }
  if (!res.ok) throw new ApiError(res.status, res.status === 502 ? 'TML data is unavailable right now' : `Server error ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  stops: (signal?: AbortSignal) => getJson<StopList>('/api/stops', signal),
  departures: (stopId: string, signal?: AbortSignal) =>
    getJson<DepartureList>(`/api/stops/${encodeURIComponent(stopId)}/departures`, signal),
  vehicles: (c: LatLng, radius: number, signal?: AbortSignal) =>
    getJson<VehicleList>(`/api/vehicles?lat=${c.lat.toFixed(6)}&lng=${c.lng.toFixed(6)}&radius=${Math.round(radius)}`, signal),
  board: (c: LatLng, radius: number, signal?: AbortSignal) =>
    getJson<Board>(`/api/board?lat=${c.lat.toFixed(6)}&lng=${c.lng.toFixed(6)}&radius=${Math.round(radius)}`, signal),
  vehicleStopTimes: (id: string, signal?: AbortSignal) =>
    getJson<VehicleStopTimes>(`/api/vehicles/${encodeURIComponent(id)}/stop-times`, signal),
  vehicleRoute: (id: string, signal?: AbortSignal) =>
    getJson<VehicleRoute>(`/api/vehicles/${encodeURIComponent(id)}/route`, signal),
};
