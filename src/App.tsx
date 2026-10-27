// Ported from the original OV Pulse src/routes/index.tsx (Index + Clock): markup, layout, panels and behaviour
// are the original's. TPulso offline version: all data comes from the converted timetable files
// (docs/OFFLINE.md) — Scheduled departures and Expected vehicle positions. No live API is called
// (the live code is kept behind LIVE_ENABLED, off). Every TPulso change is marked "TPulso:".
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bus, CircleHelp, Crosshair, Layers, LoaderCircle, Radar, Ship, TrainFront, TramFront } from "lucide-react";

import ArrivalsDrawer, { type HelpInfo, type StopPanel, type TripStopsView } from "@/components/transit/ArrivalsDrawer";
import type { MapStation, RouteStopMarker } from "@/components/transit/TransitMap";
import { groupStations, letterFor, stationSize, stopDirections } from "@/offline/stations";
import {
  clockSec,
  distanceMeters,
  isInside,
  prepareRoute,
  type Arrival,
  type FilterMode,
  type LiveDeparture,
  type Pinned,
  type Radius,
  type Stop,
  type TransitRoute,
  type TransportMode,
  type UpcomingStop,
  type Vehicle,
} from "@/lib/transit";
// TPulso: offline timetable data layer, region config and display rule.
import { LISBON } from "../shared/region";
import { withinRadius } from "../shared/geo";
import { addDays, decodePolyline, type AreaFile, type LineShape, type RouteFile } from "../shared/timetable";
import { Legend } from "@/components/Legend";
import { countdownLabel } from "@/lib/sourceStatus";
import { useLocation, type TestReason } from "@/lib/useLocation";
import { activeTrips, departuresAtStop, expectedVehicles, isExpired, positionsAt, routePath, tripStopsForRow, upcomingStops, type ActiveTrip, type ExpectedVehicle, type ScheduledDeparture } from "@/offline/engine";
import { downloadRegion, loadLines, loadRoute, regionBytes } from "@/offline/store";
import { useTimetable } from "@/offline/useTimetable";
import { clockNow, setSimClock, useClock } from "@/lib/clock";
import { areaSelect, NO_SELECTION, pickedOf, type AreaSelection } from "@/lib/areaSelection";
import { MODE_COLORS, MODE_TEXT } from "@/config";

const TransitMap = lazy(() => import("@/components/transit/TransitMap"));

const region = LISBON;
const RADII = region.radii as Radius[];
/** Departures in the next 10 minutes, as in the original. */
const WINDOW_MS = 600_000;
/** What kind of stop a place is, from the lines serving it (bus stops are often named after a nearby metro). */
const KIND_LABEL: Record<string, string> = { bus: "Bus stop", tram: "Tram stop", metro: "Metro station", train: "Train station", ferry: "Ferry pier" };
/** Active trips are rebuilt every 30 s of (simulated) time. */
const TRIP_STEP_MS = 30_000;

// TPulso: Ferry added; modes without timetable data stay visible but disabled ("no data yet").
const FILTERS: { key: FilterMode; label: string; icon: typeof Bus | null }[] = [
  { key: "all", label: "All", icon: null },
  { key: "bus", label: "Bus", icon: Bus },
  { key: "train", label: "Train", icon: TrainFront },
  { key: "tram", label: "Tram/Metro", icon: TramFront },
  { key: "ferry", label: "Ferry", icon: Ship },
];

const TEST_REASON: Record<TestReason, string> = {
  denied: "Location is off",
  unavailable: "No GPS on this device",
  timeout: "No GPS fix yet",
  outside: "You are outside Portugal",
};

const fmtDate = (d: string) => `${d.slice(6, 8)}/${d.slice(4, 6)}`;

type RideSpeed = 1 | 5 | 10;
/** TPulso test ride state. The simulated time is baseSim + (real time - baseReal) × speed. */
interface Ride {
  key: string;
  patternId: number;
  tripIndex: number;
  serviceDate: string;
  speed: RideSpeed;
  baseReal: number;
  baseSim: number;
  /** Real time when the trip ended (then the ride exits after 3 s). */
  endedAt: number | null;
}

interface AreaStop extends Stop {
  modes: Set<TransportMode>;
  /** Direction of travel and destinations (bus/tram platforms are split by direction). */
  dir?: ReturnType<typeof stopDirections> extends Map<string, infer D> ? D : never;
}

export default function App() {
  // TPulso: GPS with the Marquês de Pombal TEST fallback.
  const { state: loc, locate: relocate } = useLocation(region);
  const gps: "pending" | "granted" | "denied" = loc.mode === "locating" ? "pending" : loc.mode === "gps" ? "granted" : "denied";
  // The user's position (or the TEST point): the blue dot and where Recenter goes.
  const userCenter = loc.mode === "locating" ? { lat: region.testLocation.lat, lng: region.testLocation.lng } : loc.position;
  const hasCenter = loc.mode !== "locating";
  // TPulso: the radar is computed for the map centre (the point under the screen-fixed circle) once the map stops
  // moving; it is the user's position until the map reports otherwise.
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | null>(null);
  const centerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const centerWaitSince = useRef<number | null>(null);
  const onMapCenter = useCallback((c: { lat: number; lng: number }) => {
    // Debounced 200 ms after the last move end, but never more than 1 s late (a ride's camera moves every frame).
    clearTimeout(centerTimer.current);
    const t = Date.now();
    centerWaitSince.current ??= t;
    const flush = () => {
      centerWaitSince.current = null;
      setMapCenter(c);
    };
    if (t - centerWaitSince.current >= 1000) flush();
    else centerTimer.current = setTimeout(flush, 200);
  }, []);
  useEffect(() => () => clearTimeout(centerTimer.current), []);
  const centerLat = hasCenter && mapCenter ? mapCenter.lat : userCenter.lat;
  const centerLng = hasCenter && mapCenter ? mapCenter.lng : userCenter.lng;
  const center = useMemo(() => ({ lat: centerLat, lng: centerLng }), [centerLat, centerLng]);
  const [testAccepted, setTestAccepted] = useState(false);
  const [recenterRequest, setRecenterRequest] = useState(0);
  const locate = useCallback(() => {
    relocate();
    setRecenterRequest((n) => n + 1);
  }, [relocate]);

  const [radius, setRadius] = useState<Radius>(region.defaultRadius as Radius);
  const [filter, setFilter] = useState<FilterMode>("all");
  // TPulso test ride (TEST mode only): a simulated clock, 1×/5×/10×, used for everything while riding.
  const [ride, setRide] = useState<Ride | null>(null);
  // TPulso: during a ride, optionally turn the map so the direction of travel points up (off by default).
  const [headingUp, setHeadingUp] = useState(false);
  useEffect(() => {
    if (!ride) setHeadingUp(false);
  }, [ride]);
  useLayoutEffect(() => {
    setSimClock(ride ? { baseSim: ride.baseSim, baseReal: ride.baseReal, speed: ride.speed } : null);
  }, [ride?.baseSim, ride?.baseReal, ride?.speed, !ride]); // eslint-disable-line react-hooks/exhaustive-deps
  // TPulso: the app itself re-renders every 5 s (lists, counts, vehicle selection). The header clock and every
  // countdown label read the shared 1 s clock on their own (src/lib/clock.ts), so the tick re-renders only them.
  const now = useClock((t) => Math.floor(t / 5000) * 5000);
  const nowSec = Math.floor(now / 1000);
  // Departure lists don't need recomputing every second: every 15 s (countdowns still tick each second).
  const boardNow = Math.floor(now / 15_000) * 15_000;

  // TPulso: the offline timetable around the radar.
  const tt = useTimetable(hasCenter ? center : null, radius);
  const manifest = tt.manifest;
  const expired = !!manifest && isExpired(manifest, now);

  // Test ride: the ridden vehicle's route, its expected position (= the user's position) and the end of the trip.
  const [rideRoute, setRideRoute] = useState<RouteFile | null>(null);
  useEffect(() => {
    if (!ride || !manifest) {
      setRideRoute(null);
      return;
    }
    let stop = false;
    loadRoute(manifest, ride.patternId)
      .then((r) => !stop && setRideRoute(r))
      .catch(() => !stop && setRide(null));
    return () => {
      stop = true;
    };
  }, [ride?.patternId, ride?.key, manifest]); // eslint-disable-line react-hooks/exhaustive-deps
  const ridePos = useMemo(() => {
    if (!ride || !rideRoute || !manifest) return undefined;
    const pseudo: AreaFile = { format: 1, version: manifest.version, area: "ride", stops: [], patterns: [rideRoute] };
    return expectedVehicles(manifest, [pseudo], now).find((v) => v.key === ride.key);
  }, [ride, rideRoute, manifest, now]);
  // Trip over (no expected position any more): say so, then exit after 3 s.
  useEffect(() => {
    if (ride && rideRoute && !ridePos && ride.endedAt === null) setRide({ ...ride, endedAt: Date.now() });
  }, [ride, rideRoute, ridePos]);
  useEffect(() => {
    if (!ride?.endedAt) return;
    const t = setTimeout(() => exitRide(), 3000);
    return () => clearTimeout(t);
  }, [ride?.endedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only in TEST mode: real GPS ends any ride.
  useEffect(() => {
    if (ride && gps !== "denied") exitRide();
  }, [gps]); // eslint-disable-line react-hooks/exhaustive-deps
  const followLat = ride && ridePos ? ridePos.lat : userCenter.lat;
  const followLng = ride && ridePos ? ridePos.lng : userCenter.lng;
  const followPos = useMemo(() => ({ lat: followLat, lng: followLng }), [followLat, followLng]);
  const exploringM = Math.round(distanceMeters(center, followPos));
  const exploring = !ride && exploringM > 25;
  useEffect(() => {
    if (manifest) navigator.serviceWorker?.controller?.postMessage({ type: "timetable-version", version: manifest.version });
  }, [manifest]);
  const opName = useMemo(() => new Map((manifest?.operators ?? []).map((o) => [o.id, o.name])), [manifest]);
  const modesWithData = useMemo(() => new Set((manifest?.operators ?? []).flatMap((o) => o.modes)), [manifest]);
  const hasData = (k: FilterMode) => k === "all" || modesWithData.has(k as TransportMode);

  // Stops of the loaded areas, with the modes serving them.
  const allStops = useMemo(() => {
    const m = new Map<string, AreaStop>();
    const dirs = stopDirections(tt.areas, region.metroOperators);
    for (const a of tt.areas) {
      for (const [id, name, lat, lng] of a.stops) if (!m.has(id)) m.set(id, { id, name, lat, lng, mode: "bus", modes: new Set(), dir: dirs.get(id) });
      for (const p of a.patterns) for (const id of p.stops) m.get(id)?.modes.add(p.mode);
    }
    for (const s of m.values()) s.mode = s.modes.has("train") ? "train" : s.modes.has("tram") ? "tram" : s.modes.has("ferry") ? "ferry" : "bus";
    return [...m.values()];
  }, [tt.areas]);
  const nearStops = useMemo(
    () =>
      hasCenter
        ? withinRadius(
            allStops.filter((s) => filter === "all" || s.modes.has(filter as TransportMode)),
            center,
            radius,
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasCenter, center.lat, center.lng, allStops, radius, filter],
  );

  // Active trips of the loaded areas (+ the ridden route), rebuilt every 30 s of (simulated) time; the window
  // reaches past the next rebuild, so the animation loop (clockNow, every frame) always has the running trips.
  const tripBucket = Math.floor(now / TRIP_STEP_MS) * TRIP_STEP_MS;
  const trips: ActiveTrip[] = useMemo(() => {
    if (!manifest || expired) return [];
    const areas = rideRoute ? [...tt.areas, { format: 1, version: manifest.version, area: "ride", stops: [], patterns: [rideRoute] } as AreaFile] : tt.areas;
    return activeTrips(manifest, areas, tripBucket - 60_000, tripBucket + TRIP_STEP_MS + 60_000);
  }, [manifest, expired, tt.areas, rideRoute, tripBucket]);
  // Expected vehicles for lists, counts and selection: every 5 s from the same index (the map animates on its own).
  const expected = useMemo(() => positionsAt(trips, now), [trips, now]);
  const toVehicle = useCallback(
    (v: ExpectedVehicle): Vehicle => ({
      id: v.key,
      mode: v.mode,
      line: v.line,
      operator: opName.get(v.op) ?? v.op,
      headsign: v.headsign,
      lat: v.lat,
      lng: v.lng,
      bearing: v.bearing,
      speedKmh: NaN,
      punctualityMin: NaN,
      routeId: String(v.patternId),
      tripId: v.key,
      live: false,
    }),
    [opName],
  );
  const vehicles: Vehicle[] = useMemo(() => expected.map(toVehicle), [expected, toVehicle]);
  const expectedByKey = useMemo(() => new Map(expected.map((v) => [v.key, v])), [expected]);
  const vehicleByKey = useMemo(() => new Map(vehicles.map((v) => [v.tripId, v])), [vehicles]);

  // TPulso: departures for every stop inside the radar, from the timetable (Scheduled).
  const toLive = useCallback(
    (d: ScheduledDeparture, s: { id: string; name: string; lat: number; lng: number }): LiveDeparture => ({
      id: `${d.tripKey}@${s.id}`,
      vehicleKey: d.tripKey,
      stopArea: s.id,
      stopName: s.name,
      stopLat: s.lat,
      stopLng: s.lng,
      distanceM: Math.round(distanceMeters(center, s)),
      line: d.line,
      mode: d.mode,
      destination: d.headsign,
      operator: opName.get(d.op) ?? d.op,
      expectedAt: d.atMs,
      plannedAt: d.atMs,
      delaySec: 0,
      realtime: false,
      cancelled: false,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [center.lat, center.lng, opName],
  );
  // Departures are cached per stop for each 15 s step, so moving the radar only computes stops that are new.
  const depCache = useRef<{ key: string; areas: AreaFile[] | null; byStop: Map<string, ScheduledDeparture[]> }>({ key: "", areas: null, byStop: new Map() });
  const board: LiveDeparture[] | null = useMemo(() => {
    // While new map areas load, the current ones stay in use (no empty list flashing during a pan).
    if (!manifest || !tt.areas.length) return manifest && !tt.loading ? [] : null;
    if (expired) return [];
    const cacheKey = `${manifest.version}|${boardNow}`;
    if (depCache.current.key !== cacheKey || depCache.current.areas !== tt.areas) depCache.current = { key: cacheKey, areas: tt.areas, byStop: new Map() };
    const cache = depCache.current.byStop;
    return nearStops.flatMap((s) => {
      let rows = cache.get(s.id);
      if (!rows) cache.set(s.id, (rows = departuresAtStop(manifest, tt.areas, s.id, boardNow - 30_000, boardNow + WINDOW_MS + 15_000)));
      return rows.map((d) => toLive(d, s));
    });
  }, [manifest, tt.loading, tt.areas, expired, nearStops, boardNow, toLive]);

  // TPulso: one marker per physical station (same normalised name within 60 m), sized by its departures in
  // the next 10 minutes and coloured by the modes serving it (already limited by the mode filter).
  const allStations = useMemo(
    () => groupStations(allStops.filter((s) => filter === "all" || s.modes.has(filter as TransportMode))),
    [allStops, filter],
  );
  const stations = useMemo(() => {
    const inRadar = new Set(nearStops.map((s) => s.id));
    return allStations.filter((st) => st.stopIds.some((id) => inRadar.has(id)));
  }, [allStations, nearStops]);
  const mapStations: MapStation[] = useMemo(() => {
    const perStop = new Map<string, number>();
    for (const d of board ?? []) {
      if (d.expectedAt < boardNow || d.expectedAt > boardNow + WINDOW_MS) continue;
      if (filter !== "all" && d.mode !== filter) continue;
      perStop.set(d.stopArea, (perStop.get(d.stopArea) ?? 0) + 1);
    }
    return stations.map((st) => ({
      id: st.id,
      name: st.name,
      nameKey: st.nameKey,
      kind: st.kind,
      heading: st.heading,
      lat: st.lat,
      lng: st.lng,
      modes: filter === "all" ? st.modes : st.modes.filter((m) => m === filter),
      departures: st.stopIds.reduce((n, id) => n + (perStop.get(id) ?? 0), 0),
      size: stationSize(st.stopIds.reduce((n, id) => n + (perStop.get(id) ?? 0), 0)),
    }));
  }, [stations, board, boardNow, filter]);

  const [pinned, setPinned] = useState<Pinned | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("tpulso:pinned");
      if (raw) setPinned(JSON.parse(raw) as Pinned);
    } catch {
      /* ignore */
    }
  }, []);
  const pin = useCallback((p: Pinned | null) => {
    setPinned(p);
    try {
      if (p) localStorage.setItem("tpulso:pinned", JSON.stringify(p));
      else localStorage.removeItem("tpulso:pinned");
    } catch {
      /* ignore */
    }
  }, []);

  // Departures inside the radar, leaving within 10 minutes, soonest first (as in the original).
  const arrivals = useMemo(() => {
    if (!board) return [];
    const seen = new Set<string>();
    const out: Arrival[] = [];
    for (const d of board) {
      if (filter !== "all" && d.mode !== filter) continue;
      if (d.distanceM > radius) continue;
      if (d.expectedAt < now - 30_000 || d.expectedAt > now + WINDOW_MS) continue;
      const k = `${d.vehicleKey}@${d.stopName}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const v = vehicleByKey.get(d.vehicleKey);
      out.push({
        id: d.id,
        stopId: d.stopArea,
        stopName: d.stopName,
        mode: d.mode,
        line: d.line,
        headsign: d.destination,
        minutes: Math.max(0, Math.round((d.expectedAt - now) / 60_000)),
        etaSec: Math.max(0, Math.round((d.expectedAt - now) / 1000)),
        delayMin: 0,
        distanceM: d.distanceM,
        vehicleKey: d.vehicleKey,
        stopArea: d.stopArea,
        expectedAt: d.expectedAt,
        realtime: false,
        cancelled: false,
        ...(v ? { vehicleId: v.id } : {}),
      });
    }
    return out.sort((a, b) => (a.etaSec ?? 0) - (b.etaSec ?? 0)).slice(0, 30);
  }, [board, vehicleByKey, radius, filter, now]);

  // The followed connection: its scheduled departure at your stop + where its vehicle is expected now.
  const followed = useMemo(() => {
    if (!pinned) return null;
    const dep = board?.find((d) => d.vehicleKey === pinned.vehicleKey && d.stopArea === pinned.stopArea) ?? null;
    const v = vehicleByKey.get(pinned.vehicleKey) ?? null;
    return { pinned, dep, vehicle: v, vehicleDistM: v ? Math.round(distanceMeters(v, { lat: pinned.stopLat, lng: pinned.stopLng })) : null };
  }, [pinned, board, vehicleByKey]);

  const pinArrival = useCallback(
    (a: Arrival) => {
      const d = board?.find((x) => x.id === a.id);
      if (!d) return;
      pin({ vehicleKey: d.vehicleKey, stopArea: d.stopArea, stopName: d.stopName, stopLat: d.stopLat, stopLng: d.stopLng, line: d.line, mode: d.mode, destination: d.destination });
    },
    [board, pin],
  );

  const radarVehicles = useMemo(
    () => vehicles.filter((v) => (filter === "all" || v.mode === filter) && isInside(v, center, radius)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicles, filter, center.lat, center.lng, radius],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [panelView, setPanelView] = useState<"results" | "help" | "stop" | "area">("results");
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const exitRide = useCallback(() => {
    setRide(null);
    setRecenterRequest((n) => n + 1); // back to the TEST point
  }, []);
  const setRideSpeed = useCallback((speed: RideSpeed) => {
    setRide((r) => {
      if (!r) return r;
      const t = Date.now();
      return { ...r, speed, baseReal: t, baseSim: r.baseSim + (t - r.baseReal) * r.speed };
    });
  }, []);
  const resetPanel = useCallback(() => {
    setPanelView("results");
    setSelectedId(null);
    setSelectedStopId(null);
    setOpenId(null);
    pin(null);
  }, [pin]);
  const openPanel = useCallback((view: "help") => {
    setSelectedId(null);
    setOpenId(null);
    setAreaCloseRequest((n) => n + 1);
    setPanelView(view);
  }, []);

  // TPulso: an expanded area point lists its stations in the side panel (letter, full name, direction,
  // distance). A first tap on a row or map letter picks the platform (highlighted on both); a second opens it.
  const [areaIds, setAreaIds] = useState<string[] | null>(null);
  // One state machine for the map letters and the list rows (src/lib/areaSelection.ts).
  const [areaSel, setAreaSel] = useState<AreaSelection>(NO_SELECTION);
  const pickedId = pickedOf(areaSel);
  const [areaCloseRequest, setAreaCloseRequest] = useState(0);
  const onArea = useCallback((ids: string[] | null) => {
    setAreaIds(ids);
    setAreaSel(NO_SELECTION);
    if (ids) {
      setSelectedId(null);
      setOpenId(null);
      setPanelView("area");
    } else setPanelView((v) => (v === "area" ? "results" : v));
  }, []);
  // A tapped station covers all of its stops (e.g. the six Marquês de Pombal platforms).
  const tappedStation = selectedStopId ? allStations.find((st) => st.id === selectedStopId) : undefined;
  const stopPanel: StopPanel | null = useMemo(() => {
    if (!tappedStation || !manifest) return null;
    const ids = new Set(tappedStation.stopIds);
    const members = allStops.filter((s) => ids.has(s.id));
    const rows = expired
      ? []
      : members
          .flatMap((m) => departuresAtStop(manifest, tt.areas, m.id, now - 30_000, now + WINDOW_MS).map((d) => toLive(d, m)))
          .sort((a, b) => a.expectedAt - b.expectedAt);
    // One distance everywhere: from the radar centre to the marker (the platform's position), as in the list.
    const distanceM = Math.round(distanceMeters(center, tappedStation));
    return {
      id: tappedStation.id,
      name: tappedStation.name,
      kindLabel: KIND_LABEL[members[0]?.dir?.kind ?? "bus"],
      towards: tappedStation.towards,
      otherSide: tappedStation.otherSide,
      distanceM,
      departures: rows,
      fetchedAt: now,
      error: null,
    };
  }, [tappedStation, allStops, center, manifest, expired, tt.areas, now, toLive]);
  const areaRows = useMemo(() => {
    if (!areaIds) return null;
    const byId = new Map(allStations.map((st) => [st.id, st]));
    return areaIds.flatMap((id, i) => {
      const st = byId.get(id);
      const kind = allStops.find((s) => s.id === st?.stopIds[0])?.dir?.kind ?? "bus";
      return st
        ? [{ id, letter: letterFor(i), name: st.name, kindLabel: KIND_LABEL[kind]!, towards: st.towards, modes: st.modes, distanceM: Math.round(distanceMeters(center, st)) }]
        : [];
    });
  }, [areaIds, allStations, allStops, center]);
  const openStop = useCallback((id: string) => {
    setSelectedId(null);
    setOpenId(null);
    setSelectedStopId(id);
    setPanelView("stop");
  }, []);
  // A tap on a map letter or a list row: pick it; a second tap opens its departures (its panel).
  const tapPlatform = useCallback(
    (id: string) => {
      const next = areaSelect(areaSel, { type: "tap", id });
      setAreaSel(next);
      if (next.kind === "departures") openStop(id);
    },
    [areaSel, openStop],
  );
  const selectStop = useCallback(
    (id: string) => {
      setSelectedId(null);
      setOpenId(null);
      if (panelView === "stop" && selectedStopId === id) {
        setPanelView("results");
        setSelectedStopId(null);
      } else {
        setSelectedStopId(id);
        setPanelView("stop");
      }
    },
    [panelView, selectedStopId],
  );

  // TPulso: while a stop is open, show only the vehicles whose trip passes that stop in the next 10 minutes
  // (exact trip key), wherever they are now; all others are hidden. Closing the panel restores them.
  const stopTripKeys = useMemo(
    () => (panelView === "stop" && stopPanel?.departures ? new Set(stopPanel.departures.map((d) => d.vehicleKey)) : null),
    [panelView, stopPanel],
  );
  // Patterns of the trips coming to the open stop (trip key = "<pattern>:<trip>:<service date>").
  const stopPatternIds = useMemo(() => (stopTripKeys ? [...new Set([...stopTripKeys].map((k) => Number(k.split(":")[0])))] : []), [stopTripKeys]);
  const inRange = radarVehicles.length;

  const focusStop = useMemo(() => {
    const d = openId ? board?.find((x) => x.id === openId) : undefined;
    if (!d) return null;
    const v = vehicleByKey.get(d.vehicleKey);
    return { lat: d.stopLat, lng: d.stopLng, name: d.stopName, label: countdownLabel(Math.round(d.expectedAt / 1000), nowSec, "scheduled"), vehicleId: v?.id ?? null };
  }, [openId, board, vehicleByKey, nowSec]);
  const selected = selectedId ? radarVehicles.find((v) => v.id === selectedId) : undefined;
  // Flip back once the vehicle leaves the radar or its trip ends.
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  // TPulso: the selected vehicle's full route (route file): route line + scheduled time at each upcoming stop.
  const selectedExp = selectedId ? expectedByKey.get(selectedId) : undefined;
  const selectedPattern = selectedExp?.patternId;
  const startRide = useCallback(() => {
    if (!selectedExp || gps !== "denied") return;
    const t = Date.now();
    setRide({ key: selectedExp.key, patternId: selectedExp.patternId, tripIndex: selectedExp.tripIndex, serviceDate: selectedExp.serviceDate, speed: 1, baseReal: t, baseSim: t, endedAt: null });
    setSelectedId(null);
    setSelectedStopId(null);
    setOpenId(null);
    setPanelView("results");
  }, [selectedExp, gps]);
  const [routeFile, setRouteFile] = useState<{ status: "idle" | "loading" | "ready" | "error"; route?: RouteFile }>({ status: "idle" });
  useEffect(() => {
    if (!manifest || selectedPattern === undefined) {
      setRouteFile({ status: "idle" });
      return;
    }
    let stop = false;
    setRouteFile({ status: "loading" });
    loadRoute(manifest, selectedPattern)
      .then((route) => !stop && setRouteFile({ status: "ready", route }))
      .catch(() => !stop && setRouteFile({ status: "error" }));
    return () => {
      stop = true;
    };
  }, [manifest, selectedPattern]);

  // TPulso: whole route lines (first stop to terminus) from the route files, for every vehicle shown and the
  // selected one — independent of the radar radius and of which map areas are loaded.
  const [routeFiles, setRouteFiles] = useState<Map<number, RouteFile>>(new Map());
  const shownPatterns = useMemo(
    () => [...new Set([...(stopTripKeys ? stopPatternIds : radarVehicles.map((v) => Number(v.routeId))), ...(selectedPattern !== undefined ? [selectedPattern] : [])])],
    [stopTripKeys, stopPatternIds, radarVehicles, selectedPattern],
  );
  useEffect(() => {
    if (!manifest) return;
    let stop = false;
    for (const id of shownPatterns) {
      if (routeFiles.has(id)) continue;
      loadRoute(manifest, id)
        .then((r) => !stop && setRouteFiles((m) => (m.has(id) ? m : new Map(m).set(id, r))))
        .catch(() => {
          /* a missing line is simply not drawn; the vehicle still shows */
        });
    }
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifest, shownPatterns.join(",")]);
  // While a stop is open: the vehicles coming to it, calculated from their full routes, so a train or tram
  // a few minutes away shows even outside the loaded map areas. Otherwise: the vehicles inside the radar.
  const visibleVehicles = useMemo(() => {
    if (!stopTripKeys) return radarVehicles;
    if (!manifest || expired) return [];
    const patterns = stopPatternIds.map((id) => routeFiles.get(id)).filter((r): r is RouteFile => !!r);
    const pseudo: AreaFile = { format: 1, version: manifest.version, area: "stop", stops: [], patterns };
    return expectedVehicles(manifest, [pseudo], now).filter((v) => stopTripKeys.has(v.key)).map(toVehicle);
  }, [stopTripKeys, radarVehicles, manifest, expired, stopPatternIds, routeFiles, now, toVehicle]);
  // The animation loop's trips: those of the loaded areas, plus (while a stop is open) the full routes coming to it.
  const mapTrips = useMemo(() => {
    if (!stopTripKeys || !manifest || expired) return trips;
    const patterns = stopPatternIds.map((id) => routeFiles.get(id)).filter((r): r is RouteFile => !!r);
    const pseudo: AreaFile = { format: 1, version: manifest.version, area: "stop", stops: [], patterns };
    return [...trips, ...activeTrips(manifest, [pseudo], tripBucket - 60_000, tripBucket + TRIP_STEP_MS + 60_000)];
  }, [trips, stopTripKeys, manifest, expired, stopPatternIds, routeFiles, tripBucket]);
  const vehicleFilter = useMemo(
    () => ({ keys: selectedId ? new Set([selectedId]) : (stopTripKeys ?? (focusStop?.vehicleId ? new Set([focusStop.vehicleId]) : null)), mode: filter }),
    [selectedId, stopTripKeys, focusStop?.vehicleId, filter],
  );
  const operatorName = useCallback((id: string) => opName.get(id) ?? id, [opName]);
  const onMapSelect = useCallback(
    (id: string | null) => {
      // Empty-radar tap or re-tapping the selected vehicle: reset everything.
      if (panelView !== "results" || id === null || id === selectedId) resetPanel();
      else setSelectedId(id);
    },
    [panelView, selectedId, resetPanel],
  );

  const routes = useMemo(() => {
    const m = new Map<string, TransitRoute>();
    for (const id of shownPatterns) {
      const r = id === routeFile.route?.id ? routeFile.route : routeFiles.get(id);
      if (!r) continue;
      m.set(`full|${r.id}`, { ...prepareRoute({ id: `full|${r.id}`, mode: r.mode, line: r.line, headsign: r.headsign, operator: opName.get(r.op) ?? r.op, path: routePath(r) }), group: String(r.id) });
    }
    return m;
  }, [shownPatterns, routeFiles, routeFile.route, opName]);

  // TPulso: tram, metro, train and ferry lines of the whole region, visible at every radius (lines.json).
  const [lineShapes, setLineShapes] = useState<LineShape[]>([]);
  useEffect(() => {
    if (!manifest) return;
    let stop = false;
    loadLines(manifest)
      .then((f) => !stop && setLineShapes(f.lines))
      .catch(() => !stop && setLineShapes([]));
    return () => {
      stop = true;
    };
  }, [manifest]);
  const allBaseLines = useMemo(
    () => lineShapes.map((l) => prepareRoute({ id: `line|${l.id}`, mode: l.mode, line: l.line, headsign: "", operator: "", path: decodePolyline(l.shape) })),
    [lineShapes],
  );
  const baseLines = useMemo(() => (filter === "all" ? allBaseLines : allBaseLines.filter((l) => l.mode === filter)), [allBaseLines, filter]);
  const selectedRoute = selected ? routes.get(`full|${selected.routeId}`) : undefined;

  const { upcoming, beyond } = useMemo(() => {
    const none = { upcoming: [] as UpcomingStop[], beyond: [] as UpcomingStop[] };
    const r = routeFile.route;
    if (!selectedExp || !r || r.id !== selectedExp.patternId) return none;
    const seg = selectedExp.segment;
    const along = r.dist[seg.from]! + seg.f * (r.dist[seg.to]! - r.dist[seg.from]!);
    const list: UpcomingStop[] = upcomingStops(r, selectedExp.tripIndex, selectedExp.serviceDate, selectedExp.nextStopIndex).map((u) => ({
      key: `${r.id}-${u.index}`,
      stopId: u.stop[0],
      name: u.stop[1],
      lat: u.stop[2],
      lng: u.stop[3],
      aheadM: Math.max(0, Math.round(r.dist[u.index]! - along)),
      etaS: (u.atMs - now) / 1000,
      state: "scheduled",
    }));
    return { upcoming: list.filter((u) => isInside(u, center, radius)), beyond: list.filter((u) => !isInside(u, center, radius)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExp, routeFile.route, now, center.lat, center.lng, radius]);

  // TPulso: all stops of the selected vehicle in its mode colour — passed (dimmed), next (larger, ring) and
  // upcoming, with the scheduled countdown for the upcoming stops inside the radar.
  const routeStops: RouteStopMarker[] = useMemo(() => {
    const r = routeFile.route;
    if (!selectedExp || !r || r.id !== selectedExp.patternId) return [];
    const labels = new Map(upcoming.map((u) => [u.key, countdownLabel(nowSec + u.etaS, nowSec, "scheduled")]));
    const color = MODE_COLORS[selectedExp.mode];
    const textColor = MODE_TEXT[selectedExp.mode];
    return r.stopInfo.map(([, name, lat, lng], i) => {
      const state = i < selectedExp.nextStopIndex ? "passed" : i === selectedExp.nextStopIndex ? "next" : "upcoming";
      const label = labels.get(`${r.id}-${i}`);
      return { key: `${r.id}-${i}`, name, lat, lng, state, ...(label ? { label } : {}), color, textColor };
    });
  }, [selectedExp, routeFile.route, upcoming, nowSec]);



  // TPulso: "Show later stops" on a departure row — the trip's upcoming stops (row id = "<trip key>@<stop id>").
  // Only the panel changes; nothing on the map is selected or hidden.
  const [expandedTrips, setExpandedTrips] = useState<string[]>([]);
  const toggleTrip = useCallback((rowId: string) => {
    setExpandedTrips((cur) => (cur.includes(rowId) ? cur.filter((x) => x !== rowId) : [...cur, rowId]));
  }, []);
  const [tripRoutes, setTripRoutes] = useState<Map<number, RouteFile | "error">>(new Map());
  useEffect(() => {
    if (!manifest) return;
    for (const rowId of expandedTrips) {
      const p = Number(rowId.split(":")[0]);
      if (tripRoutes.has(p)) continue;
      loadRoute(manifest, p)
        .then((r) => setTripRoutes((m) => new Map(m).set(p, r)))
        .catch(() => setTripRoutes((m) => new Map(m).set(p, "error")));
    }
  }, [expandedTrips, manifest]); // eslint-disable-line react-hooks/exhaustive-deps
  const tripStops = useMemo(() => {
    const out: Record<string, TripStopsView> = {};
    const allDeps = [...(board ?? []), ...(stopPanel?.departures ?? [])];
    for (const rowId of expandedTrips) {
      const [tripKey, stopId] = rowId.split("@") as [string, string];
      const [p, ti, date] = tripKey.split(":");
      const r = tripRoutes.get(Number(p));
      const dep = allDeps.find((d) => d.id === rowId);
      if (!r) {
        out[rowId] = { status: "loading", stops: [], nextKey: null, yourKey: null, destination: dep?.destination ?? "" };
        continue;
      }
      if (r === "error" || !dep) {
        out[rowId] = { status: "error", stops: [], nextKey: null, yourKey: null, destination: dep?.destination ?? "" };
        continue;
      }
      const v = expectedByKey.get(tripKey);
      const t = tripStopsForRow(r, Number(ti), date!, stopId, dep.expectedAt, v?.nextStopIndex);
      if (!t) {
        out[rowId] = { status: "error", stops: [], nextKey: null, yourKey: null, destination: dep.destination };
        continue;
      }
      out[rowId] = {
        status: "ready",
        stops: t.stops.map((u) => ({
          key: `${rowId}-${u.index}`,
          stopId: u.stop[0],
          name: u.stop[1],
          lat: u.stop[2],
          lng: u.stop[3],
          aheadM: 0,
          etaS: (u.atMs - now) / 1000,
          state: "scheduled" as const,
        })),
        nextKey: `${rowId}-${t.nextIndex}`,
        yourKey: t.yourIndex >= 0 ? `${rowId}-${t.yourIndex}` : null,
        destination: t.terminus && t.terminus !== dep.destination ? `${dep.destination} (${t.terminus})` : dep.destination,
      };
    }
    return out;
  }, [expandedTrips, tripRoutes, board, stopPanel, expectedByKey, now]);

  // TPulso: Help shows the timetable's dates per operator and offers to save the whole region.
  const [dl, setDl] = useState<HelpInfo["download"]>({ state: "idle", done: 0, total: 0 });
  const help: HelpInfo = {
    window: manifest ? `${fmtDate(manifest.window.first)}–${fmtDate(addDays(manifest.window.first, manifest.window.days - 1))}` : "—",
    operators: manifest?.operators ?? [],
    excluded: manifest?.excluded ?? [],
    regionMB: manifest ? regionBytes(manifest) / 1e6 : null,
    download: dl,
    onDownload: () => {
      if (!manifest) return;
      setDl({ state: "running", done: 0, total: Object.keys(manifest.areas).length });
      downloadRegion(manifest, (done, total) => setDl({ state: "running", done, total }))
        .then(() => setDl((d) => ({ ...d, state: "done" })))
        .catch((e: Error) => setDl((d) => ({ ...d, state: "error", error: e.message })));
    },
  };

  const showOverlay = gps === "pending" || (gps === "denied" && !testAccepted);

  return (
    <main className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background">
      {/* Compact top bar */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <span className="grid size-7 place-items-center rounded-xl bg-primary text-primary-foreground">
          <Radar className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-1.5 font-display text-xs font-bold leading-tight">
            TPulso
            {/* TPulso: clear TEST label when the radar is on the TEST location */}
            {gps === "denied" && (
              <span className="rounded bg-primary px-1 text-[9px] font-black uppercase tracking-wide text-primary-foreground" role="status">
                TEST
              </span>
            )}
            {ride && (
              <span className="rounded bg-foreground px-1 text-[9px] font-black uppercase tracking-wide text-background" role="status">
                Test ride{ride.speed > 1 ? ` · ${ride.speed}× clock` : ""}
              </span>
            )}
            {/* TPulso offline: always say this is not live */}
            <span className="rounded border border-border px-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
              Timetable data, not live
            </span>
          </h1>
          <p className="truncate text-[10px] text-muted-foreground">
            {gps === "pending"
              ? "Locating you… · "
              : exploring
                ? <span className="font-bold text-primary">{`Exploring here · ${exploringM >= 1000 ? `${(exploringM / 1000).toFixed(1)} km` : `${exploringM} m`} from ${gps === "granted" ? "my location" : "the TEST location"} · `}</span>
                : gps === "granted"
                  ? "My location · "
                  : `TEST location: ${region.testLocation.label} · `}
            {manifest ? (
              expired ? (
                <span className="font-bold text-destructive">timetable expired — connect to update</span>
              ) : (
                <span className="font-bold text-foreground/80">Timetable · valid {help.window}</span>
              )
            ) : tt.error ? (
              <span className="font-bold text-destructive">timetable unavailable</span>
            ) : (
              "loading timetable…"
            )}
            {` · ${inRange} expected vehicles in the area`}
            {tt.loading && manifest ? " · loading map areas…" : ""}
          </p>
        </div>

        <Clock />
        <div className="flex gap-0.5">
          <button
            onClick={() => openPanel("help")}
            aria-label="Open help"
            title="Help"
            className={`grid size-7 place-items-center rounded-lg border transition-colors ${panelView === "help" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface-2 text-foreground/80"}`}
          >
            <CircleHelp className="size-3.5" />
          </button>
        </div>
        <div className="flex gap-0.5 rounded-xl bg-surface-2 p-0.5">
          {RADII.map((r) => (
            <button
              key={r}
              onClick={() => setRadius(r)}
              className={`rounded-lg px-2 py-1 font-display text-[11px] font-bold transition-colors ${
                radius === r ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {r}m
            </button>
          ))}
        </div>

        <div className="flex gap-0.5 rounded-xl bg-surface-2 p-0.5">
          {FILTERS.map(({ key, label, icon: Icon }) => {
            const enabled = hasData(key);
            return (
              <button
                key={key}
                onClick={() => enabled && setFilter(key)}
                disabled={!enabled}
                title={enabled ? label : `${label} · no data yet`}
                aria-label={enabled ? label : `${label}, no data yet`}
                className={`flex min-w-11 items-center justify-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                  filter === key ? (key === "all" ? "bg-foreground text-background" : "") : enabled ? "text-foreground/70" : "cursor-not-allowed text-foreground/35"
                }`}
                // TPulso: chips use the mode colours (src/config.ts); the active chip is filled with its colour.
                style={
                  key !== "all" && filter === key
                    ? { background: MODE_COLORS[key], color: MODE_TEXT[key] }
                    : undefined
                }
              >
                {Icon ? (
                  <Icon className="size-3" style={key !== "all" && filter !== key && enabled ? { color: MODE_COLORS[key] } : undefined} />
                ) : (
                  <Layers className="size-3" />
                )}
                {enabled ? (
                  <span className="hidden sm:inline">{label}</span>
                ) : (
                  <span className="flex flex-col items-start leading-[1.05]">
                    <span className="hidden sm:inline">{label}</span>
                    <span className="text-[8px] font-medium">no data yet</span>
                  </span>
                )}
              </button>
            );
          })}
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
          <Suspense
            fallback={
              <div className="grid h-full place-items-center text-muted-foreground">
                <LoaderCircle className="size-6 animate-spin" />
              </div>
            }
          >
            {hasCenter ? (
              <TransitMap
                center={center}
                userPos={followPos}
                riding={!!ride}
                trips={mapTrips}
                clock={clockNow}
                vehicleFilter={vehicleFilter}
                rideKey={ride?.key ?? null}
                headingUp={!!ride && headingUp}
                operatorName={operatorName}
                onMapCenter={onMapCenter}
                autoRecenter={!selectedId && panelView !== "stop"}
                hasGps={gps === "granted"}
                radius={radius}
                filter={filter}
                vehicles={visibleVehicles}
                routes={routes}
                stations={mapStations}
                selectedId={selectedId}
                focusStop={focusStop}
                routeStops={routeStops}
                onSelectStop={selectStop}
                selectedStopId={panelView === "stop" ? selectedStopId : null}
                recenterRequest={recenterRequest}
                pickedId={pickedId}
                onPick={tapPlatform}
                onArea={onArea}
                areaCloseRequest={areaCloseRequest}
                baseLines={baseLines}
                onSelect={onMapSelect}
              />
            ) : (
              <div className="grid h-full place-items-center text-muted-foreground">
                <LoaderCircle className="size-6 animate-spin" />
              </div>
            )}
          </Suspense>
          {/* TPulso: legend of the timetable states + "Timetable data, not live" */}
          <div className="pointer-events-none absolute bottom-6 left-2 z-[470]">
            <Legend />
          </div>
          {expired && !showOverlay && (
            <div className="absolute inset-x-0 top-10 z-[490] mx-auto w-fit rounded-xl border border-destructive/50 bg-surface px-3 py-2 text-center text-xs shadow-float">
              <p className="font-display font-bold text-destructive">Timetable expired — connect to update</p>
              <p className="text-muted-foreground">The saved timetable ended on {help.window.split("–")[1]}. No times are shown.</p>
            </div>
          )}
          {showOverlay && (
            <div className="absolute inset-0 z-[500] grid place-items-center bg-background/70 p-4 backdrop-blur-sm">
              <div className="flex max-w-xs flex-col items-center gap-3 rounded-2xl border border-border bg-surface p-5 text-center shadow-float">
                <span className="relative grid size-12 place-items-center rounded-full bg-primary/15 text-primary">
                  <Crosshair className={`size-6 ${gps === "pending" ? "animate-ping" : ""}`} />
                  {gps === "pending" && <Crosshair className="absolute size-6" />}
                </span>
                {gps === "pending" ? (
                  <>
                    <p className="font-display text-sm font-bold">Finding your location…</p>
                    <p className="text-xs text-muted-foreground">
                      Tap <strong>Allow</strong> when your browser asks for location — TPulso centres the radar on you.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-display text-sm font-bold">{loc.mode === "test" ? TEST_REASON[loc.reason] : "Location is off"}</p>
                    <p className="text-xs text-muted-foreground">
                      TPulso needs your location to show the timetable around <em>you</em>. Right now the radar is centred on the{" "}
                      <strong>TEST</strong> location: {region.testLocation.label}, Lisboa.
                    </p>
                    {!(loc.mode === "test" && loc.reason === "outside") && (
                      <button
                        onClick={locate}
                        className="rounded-xl bg-primary px-4 py-2 font-display text-xs font-bold text-primary-foreground active:scale-95"
                      >
                        Turn on my location
                      </button>
                    )}
                    {/* TPulso: needed to use the app from abroad / without GPS */}
                    <button
                      onClick={() => setTestAccepted(true)}
                      className="rounded-xl border border-border bg-surface-2 px-4 py-2 font-display text-xs font-bold active:scale-95"
                    >
                      Continue with TEST location
                    </button>
                    <p className="text-[10px] leading-snug text-muted-foreground">
                      Still nothing? Check your browser's location permission for this site (tap the lock/tune icon in the address bar) and that
                      location services are on.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <ArrivalsDrawer
          arrivals={arrivals}
          radius={radius}
          vehicle={selected}
          route={selectedRoute}
          upcoming={upcoming}
          beyond={beyond}
          onClose={() => setSelectedId(null)}
          onSelectVehicle={(id) => {
            if (id === selectedId) {
              setSelectedId(null);
              pin(null);
            } else {
              setPanelView("results");
              setSelectedId(id);
            }
          }}
          live={false}
          followed={followed}
          onPin={pinArrival}
          onUnpin={() => pin(null)}
          canSelect={(id) => radarVehicles.some((v) => v.id === id)}
          openId={openId}
          radarVehicles={radarVehicles
            .map((v) => ({ id: v.id, line: v.line, mode: v.mode, headsign: v.headsign, distanceM: Math.round(distanceMeters(v, center)) }))
            .sort((a, b) => a.distanceM - b.distanceM)}
          onOpen={setOpenId}
          panelView={panelView}
          onPanelClose={() => {
            setPanelView("results");
            setSelectedStopId(null);
            setAreaCloseRequest((n) => n + 1);
          }}
          area={areaRows}
          pickedId={pickedId}
          onPickRow={tapPlatform}
          now={now}
          boardAgeSec={0}
          boardStatus={{
            loading: hasCenter && !board && !tt.error,
            error: board ? null : tt.error,
            note: expired ? "Timetable expired — connect to update." : tt.error,
          }}
          stop={stopPanel}
          onSelectStop={selectStop}
          routeStatus={routeFile.status}
          help={help}
          tripStops={tripStops}
          onToggleTrip={toggleTrip}
          onRide={gps === "denied" && !ride ? startRide : undefined}
          ride={
            ride
              ? {
                  line: rideRoute?.line ?? "",
                  mode: rideRoute?.mode ?? "bus",
                  headsign: rideRoute?.headsign ?? "",
                  speed: ride.speed,
                  ended: ride.endedAt !== null,
                  stops:
                    rideRoute && ridePos
                      ? upcomingStops(rideRoute, ride.tripIndex, ride.serviceDate, ridePos.nextStopIndex).map((u) => ({ name: u.stop[1], atMs: u.atMs }))
                      : [],
                  onSpeed: setRideSpeed,
                  headingUp,
                  onHeadingUp: setHeadingUp,
                  onExit: exitRide,
                }
              : null
          }
        />
      </div>
    </main>
  );
}

/** TPulso: the only part of the app that re-renders every second (it reads the shared clock itself). */
const Clock = memo(function Clock() {
  const now = useClock((t) => Math.floor(t / 1000) * 1000);
  // TPulso: Europe/Lisbon time (the original showed nl-NL local time).
  return (
    <span className="rounded-xl bg-surface-2 px-2 py-1 font-display text-xs font-bold tabular-nums text-primary">
      {clockSec(now)}
    </span>
  );
});
