// The radar screen, ported from the original OV Pulse src/routes/index.tsx (layout, top bar, radius
// buttons, map + drawer split, GPS overlay, clock, select/open behaviour), on the TML data layer.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Crosshair, LoaderCircle, Radar } from 'lucide-react';

import { withinRadius } from '../shared/geo';
import { LISBON } from '../shared/region';
import type { StopLite } from '../shared/types';
import ArrivalsDrawer from '@/components/transit/ArrivalsDrawer';
import type { FocusStop } from '@/components/transit/TransitMap';
import { Legend } from '@/components/Legend';
import { loadStops, type StopsResult } from '@/lib/stopCache';
import { agoLabel, countdownLabel, departureSource, vehicleSource } from '@/lib/sourceStatus';
import { clockSec, distanceMeters, type Arrival, type UpcomingStop } from '@/lib/transit';
import { useBoard } from '@/lib/useBoard';
import { useLocation, type TestReason } from '@/lib/useLocation';
import { useNow } from '@/lib/useNow';
import { useVehicleRoute } from '@/lib/useVehicleRoute';
import { useVehicles } from '@/lib/useVehicles';

const TransitMap = lazy(() => import('@/components/transit/TransitMap'));

const region = LISBON;
const RADII = region.radii;
/** Like the original: only departures leaving within 10 minutes, at most 30. */
const WINDOW_SEC = 600;
const MAX_ROWS = 30;

const TEST_REASON: Record<TestReason, string> = {
  denied: 'Location permission is off',
  unavailable: 'This device has no GPS',
  timeout: 'No GPS fix yet',
  outside: 'You are outside Portugal',
};

type StopsState = { status: 'loading' } | { status: 'error'; message: string } | ({ status: 'ready' } & StopsResult);

export default function App() {
  const { state: loc, locate } = useLocation(region);
  const now = useNow(1000);
  const nowSec = Math.floor(now / 1000);
  const [radius, setRadius] = useState<number>(region.defaultRadius);
  const [testAccepted, setTestAccepted] = useState(false);

  // Trimmed stop list, cached on the phone and refreshed about daily.
  const [stopsState, setStopsState] = useState<StopsState>({ status: 'loading' });
  useEffect(() => {
    loadStops()
      .then(r => setStopsState({ status: 'ready', ...r }))
      .catch((e: Error) => setStopsState({ status: 'error', message: e.message }));
  }, []);
  const stopById = useMemo(
    () => new Map<string, StopLite>(stopsState.status === 'ready' ? stopsState.stops.map(s => [s.id, s]) : []),
    [stopsState],
  );

  const center = loc.mode === 'locating' ? null : loc.position;
  const isTest = loc.mode === 'test';
  const nearStops = useMemo(
    () => (center && stopsState.status === 'ready' ? withinRadius(stopsState.stops, center, radius) : []),
    [center, stopsState, radius],
  );

  const live = useVehicles(center, radius);
  const board = useBoard(center, radius);
  const vehicles = live.vehicles;
  const vehicleByTrip = useMemo(() => new Map(vehicles.map(v => [v.tripId, v])), [vehicles]);

  // Departures inside the radar, leaving within 10 minutes, soonest first.
  const arrivals = useMemo((): Arrival[] => {
    if (!board.board) return [];
    return board.board.departures
      .filter(d => d.distanceM <= radius)
      .filter(d => {
        const left = (d.estimatedAt ?? d.scheduledAt) - nowSec;
        return left >= -60 && left <= WINDOW_SEC;
      })
      .slice(0, MAX_ROWS)
      .map(d => ({
        id: d.id,
        stopId: d.stopId,
        stopName: d.stopName,
        stopLat: d.stopLat,
        stopLng: d.stopLng,
        line: d.line,
        headsign: d.headsign,
        scheduledAt: d.scheduledAt,
        estimatedAt: d.estimatedAt,
        distanceM: d.distanceM,
        tripId: d.tripId,
        // Exact link: departure trip_id == vehicle trip_id.
        vehicleId: d.tripId ? (vehicleByTrip.get(d.tripId)?.id ?? null) : null,
      }));
  }, [board.board, radius, nowSec, vehicleByTrip]);

  const boardNote = useMemo(() => {
    const b = board.board;
    if (!b) return null;
    const parts: string[] = [];
    if (b.stopsQueried < b.stopsInRadius) parts.push(`Showing the nearest ${b.stopsQueried} of ${b.stopsInRadius} stops.`);
    if (b.stopsFailed > 0) parts.push(`${b.stopsFailed} stop${b.stopsFailed === 1 ? '' : 's'} could not be loaded.`);
    return parts.join(' ') || null;
  }, [board.board]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = selectedId ? vehicles.find(v => v.id === selectedId) : undefined;
  // Flip back once the vehicle leaves the radar.
  useEffect(() => {
    if (selectedId && live.updatedAt !== null && !selected) setSelectedId(null);
  }, [selectedId, selected, live.updatedAt]);
  const resetPanel = useCallback(() => {
    setSelectedId(null);
    setOpenId(null);
  }, []);

  const routeState = useVehicleRoute(selectedId);
  const route = routeState.status === 'ready' ? routeState.route : null;

  // The selected bus's remaining stops, from its route's stop sequence (exact stop_ids), with a
  // live time where the board has this trip at that stop.
  const { upcoming, beyond } = useMemo(() => {
    if (!route || !center || !selected) return { upcoming: [] as UpcomingStop[], beyond: [] as UpcomingStop[] };
    const from = route.nextStopId ? route.stopIds.indexOf(route.nextStopId) : -1;
    const rest = from >= 0 ? route.stopIds.slice(from) : [];
    const liveAt = new Map(
      (board.board?.departures ?? []).filter(d => d.tripId === selected.tripId && d.estimatedAt !== null).map(d => [d.stopId, d.estimatedAt]),
    );
    const list: UpcomingStop[] = [];
    rest.forEach((id, i) => {
      const s = stopById.get(id);
      if (s) list.push({ key: `${i}-${id}`, stopId: id, name: s.name, lat: s.lat, lng: s.lng, estimatedAt: liveAt.get(id) ?? null });
    });
    return {
      upcoming: list.filter(u => distanceMeters(u, center) <= radius),
      beyond: list.filter(u => distanceMeters(u, center) > radius),
    };
  }, [route, center, selected, board.board, stopById, radius]);

  const vehicleDelay = useMemo(() => {
    if (!selected || !board.board) return null;
    // Prefer the stop the bus is heading to; otherwise its soonest stop on the board that it hasn't passed.
    const mine = board.board.departures.filter(x => x.tripId === selected.tripId && x.estimatedAt !== null);
    const d =
      mine.find(x => x.stopId === route?.nextStopId) ??
      mine.find(x => upcoming.some(u => u.stopId === x.stopId) || beyond.some(u => u.stopId === x.stopId)) ??
      (route ? undefined : mine[0]);
    return d ? (arrivals.find(a => a.id === d.id) ?? { ...d, vehicleId: selected.id }) : null;
  }, [selected, board.board, arrivals, route, upcoming, beyond]);

  const focusStop = useMemo((): FocusStop | null => {
    const a = openId ? arrivals.find(x => x.id === openId) : undefined;
    if (!a) return null;
    const state = departureSource(a, board.fetchedAt ? (now - board.fetchedAt) / 1000 : 0);
    return {
      lat: a.stopLat,
      lng: a.stopLng,
      name: a.stopName,
      label: countdownLabel(a.estimatedAt ?? a.scheduledAt, nowSec, state),
      vehicleId: a.vehicleId,
    };
  }, [openId, arrivals, board.fetchedAt, now, nowSec]);

  const liveCount = vehicles.filter(v => vehicleSource(v, now).state === 'live').length;
  const showOverlay = loc.mode === 'locating' || (loc.mode === 'test' && !testAccepted);

  return (
    <main className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background">
      {/* Compact top bar */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <span className="grid size-7 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Radar className="size-3.5" />
        </span>
        <div className="min-w-[9rem] flex-1">
          <h1 className="flex items-center gap-1.5 font-display text-xs font-bold leading-tight">
            TPulso
            {isTest && (
              <span className="rounded bg-primary px-1 text-[9px] font-black uppercase tracking-wide text-primary-foreground" role="status">
                TEST
              </span>
            )}
          </h1>
          <p className="truncate text-[10px] text-muted-foreground">
            {loc.mode === 'locating' ? 'Locating you… · ' : isTest ? `TEST location: ${region.testLocation.label} · ` : ''}
            {live.error ? (
              <span className="font-bold text-destructive">live feed unavailable</span>
            ) : live.updatedAt !== null ? (
              <span className="font-bold text-[var(--src-live)]">Live</span>
            ) : center ? (
              'connecting…'
            ) : (
              ''
            )}
            {live.updatedAt !== null && ` · ${liveCount} vehicles in the area · updated ${clockSec(live.updatedAt)}`}
            {stopsState.status === 'loading' ? ' · loading stops…' : ''}
            {stopsState.status === 'error' ? ` · stops unavailable (${stopsState.message})` : ''}
            {stopsState.status === 'ready' && stopsState.stale ? ` · stop list from ${agoLabel((now - stopsState.fetchedAt) / 1000)} ago` : ''}
          </p>
        </div>

        <Clock now={now} />
        <div className="flex gap-0.5 rounded-xl bg-surface-2 p-0.5">
          {RADII.map(r => (
            <button
              key={r}
              onClick={() => setRadius(r)}
              aria-pressed={radius === r}
              className={`rounded-lg px-2 py-1 font-display text-[11px] font-bold transition-colors ${
                radius === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
              }`}
            >
              {r >= 1000 ? `${r / 1000}km` : `${r}m`}
            </button>
          ))}
        </div>

        <button
          onClick={locate}
          aria-label="Recentre on my location"
          className="grid size-7 place-items-center rounded-xl border border-border bg-surface-2 text-foreground/80 active:scale-95"
        >
          <Crosshair className="size-3.5" />
        </button>
      </header>

      {/* Radar left, departures right (stacked on narrow phones) */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative h-[55%] shrink-0 md:h-auto md:flex-1">
          {center ? (
            <Suspense
              fallback={
                <div className="grid h-full place-items-center text-muted-foreground">
                  <LoaderCircle className="size-6 animate-spin" />
                </div>
              }
            >
              <TransitMap
                center={center}
                isTest={isTest}
                radius={radius}
                vehicles={vehicles}
                stops={nearStops}
                selectedId={selectedId}
                selectedPath={route?.path ?? []}
                upcoming={upcoming}
                focusStop={focusStop}
                now={now}
                onSelect={id => {
                  // Empty-radar tap or re-tapping the selected vehicle: reset everything.
                  if (id === null || id === selectedId) resetPanel();
                  else setSelectedId(id);
                }}
              />
            </Suspense>
          ) : (
            <div className="h-full" />
          )}
          <div className="pointer-events-none absolute bottom-6 left-2 z-[470]">
            <Legend />
          </div>
          {showOverlay && (
            <div className="absolute inset-0 z-[500] grid place-items-center bg-background/70 p-4 backdrop-blur-sm">
              <div className="flex max-w-xs flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-5 text-center shadow-float">
                <span className="relative grid size-12 place-items-center rounded-full bg-primary/15 text-primary">
                  <Crosshair className={`size-6 ${loc.mode === 'locating' ? 'animate-ping' : ''}`} />
                  {loc.mode === 'locating' && <Crosshair className="absolute size-6" />}
                </span>
                {loc.mode === 'locating' ? (
                  <>
                    <p className="font-display text-sm font-bold">Finding your location…</p>
                    <p className="text-xs text-muted-foreground">
                      Tap <strong>Allow</strong> when your browser asks for location — TPulso centres the radar on you.
                    </p>
                  </>
                ) : (
                  loc.mode === 'test' && (
                    <>
                      <p className="font-display text-sm font-bold">{TEST_REASON[loc.reason]}</p>
                      <p className="text-xs text-muted-foreground">
                        TPulso needs your location to show the buses around <em>you</em>. Right now the radar is centred on
                        the <strong>TEST</strong> location: {region.testLocation.label}, Lisboa.
                      </p>
                      {loc.reason !== 'outside' && (
                        <button
                          onClick={locate}
                          className="rounded-xl bg-primary px-4 py-2 font-display text-xs font-bold text-primary-foreground active:scale-95"
                        >
                          Turn on my location
                        </button>
                      )}
                      <button
                        onClick={() => setTestAccepted(true)}
                        className="rounded-xl border border-border bg-surface-2 px-4 py-2 font-display text-xs font-bold active:scale-95"
                      >
                        Continue with TEST location
                      </button>
                      {loc.reason === 'denied' && (
                        <p className="text-[10px] leading-snug text-muted-foreground">
                          Still nothing? Check your browser's location permission for this site (tap the lock/tune icon in
                          the address bar) and that location services are on.
                        </p>
                      )}
                    </>
                  )
                )}
              </div>
            </div>
          )}
        </div>
        <ArrivalsDrawer
          arrivals={arrivals}
          radius={radius}
          boardAt={board.fetchedAt}
          boardError={board.error}
          boardNote={boardNote}
          now={now}
          vehicle={selected}
          vehicleRoute={routeState.status === 'error' ? { status: 'error', message: routeState.message } : { status: routeState.status }}
          vehicleDelay={vehicleDelay}
          upcoming={upcoming}
          beyond={beyond}
          onClose={() => setSelectedId(null)}
          onSelectVehicle={id => setSelectedId(id === selectedId ? null : id)}
          openId={openId}
          radarVehicles={
            center
              ? vehicles
                  .map(v => ({
                    id: v.id,
                    line: v.line,
                    headsign: v.headsign,
                    timestamp: v.timestamp,
                    distanceM: Math.round(distanceMeters(v, center)),
                  }))
                  .sort((a, b) => a.distanceM - b.distanceM)
              : []
          }
          onOpen={setOpenId}
        />
      </div>
    </main>
  );
}

function Clock({ now }: { now: number }) {
  return (
    <span className="rounded-xl bg-surface-2 px-2 py-1 font-display text-xs font-bold tabular-nums text-primary">
      {clockSec(now)}
    </span>
  );
}
