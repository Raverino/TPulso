// Ported from the original OV Pulse src/routes/index.tsx (Index + Clock). The markup, layout, panels and
// behaviour are the original's; the data effects are replaced by the TML worker endpoints:
//   /api/live       -> /api/vehicles   (useVehicles)
//   /api/departures -> /api/board      (useBoard) + /api/stops/:id/departures for a pinned/tapped stop
//   /api/routes     -> /api/vehicles/:id/route (official GTFS shape per vehicle, exact IDs)
// Removed: seedStops/stepVehicles/mergeLive (simulated or fuzzy-matched data), NS platform trains,
// OSM area loading. Every TPulso change is marked "TPulso:".
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Bus, CircleHelp, Crosshair, Layers, LoaderCircle, MessageSquare, Radar, Ship, TrainFront, TramFront } from "lucide-react";

import ArrivalsDrawer, { type StopPanel } from "@/components/transit/ArrivalsDrawer";
import {
  DATA_MODE,
  clockSec,
  distanceMeters,
  fromApiVehicle,
  isInside,
  stopDeparturesToLive,
  toLiveDeparture,
  toTransitRoute,
  type Arrival,
  type FilterMode,
  type LiveDeparture,
  type Pinned,
  type Radius,
  type Stop,
  type TransitRoute,
  type UpcomingStop,
  type Vehicle,
} from "@/lib/transit";
// TPulso: our data layer, region config and display rule.
import { LISBON } from "../shared/region";
import { withinRadius } from "../shared/geo";
import { Legend } from "@/components/Legend";
import { loadStops, type StopsResult } from "@/lib/stopCache";
import { countdownLabel } from "@/lib/sourceStatus";
import { buildStopEtas, recentSpeedMps } from "@/lib/eta";
import { useBoard } from "@/lib/useBoard";
import { useLocation, type TestReason } from "@/lib/useLocation";
import { useStopDepartures } from "@/lib/useStopDepartures";
import { useVehicleRoutes } from "@/lib/useVehicleRoutes";
import { useVehicleStopTimes } from "@/lib/useVehicleStopTimes";
import { useVehicles } from "@/lib/useVehicles";

const TransitMap = lazy(() => import("@/components/transit/TransitMap"));

const region = LISBON;
const RADII = region.radii as Radius[];

// TPulso: Ferry added; modes without data stay visible but disabled ("no data yet").
const FILTERS: { key: FilterMode; label: string; icon: typeof Bus | null }[] = [
  { key: "all", label: "All", icon: null },
  { key: "bus", label: "Bus", icon: Bus },
  { key: "train", label: "Train", icon: TrainFront },
  { key: "tram", label: "Tram/Metro", icon: TramFront },
  { key: "ferry", label: "Ferry", icon: Ship },
];
const hasData = (k: FilterMode) => k === "all" || region.modesWithData.includes(k);

const TEST_REASON: Record<TestReason, string> = {
  denied: "Location is off",
  unavailable: "No GPS on this device",
  timeout: "No GPS fix yet",
  outside: "You are outside Portugal",
};

type StopsState = { status: "loading" } | { status: "error"; message: string } | ({ status: "ready" } & StopsResult);

export default function App() {
  // TPulso: GPS with the Marquês de Pombal TEST fallback (useLocation) instead of Amsterdam/Utrecht.
  const { state: loc, locate: relocate } = useLocation(region);
  const gps: "pending" | "granted" | "denied" = loc.mode === "locating" ? "pending" : loc.mode === "gps" ? "granted" : "denied";
  const center = loc.mode === "locating" ? { lat: region.testLocation.lat, lng: region.testLocation.lng } : loc.position;
  const hasCenter = loc.mode !== "locating";
  const [testAccepted, setTestAccepted] = useState(false);
  const [recenterRequest, setRecenterRequest] = useState(0);
  const locate = useCallback(() => {
    relocate();
    setRecenterRequest((n) => n + 1);
  }, [relocate]);

  const [radius, setRadius] = useState<Radius>(region.defaultRadius as Radius);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const now = useMemo(() => Date.now(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const nowSec = Math.floor(now / 1000);

  // TPulso: real stops from the cached trimmed stop list (the original drew none; it seeded fake ones).
  const [stopsState, setStopsState] = useState<StopsState>({ status: "loading" });
  useEffect(() => {
    loadStops()
      .then((r) => setStopsState({ status: "ready", ...r }))
      .catch((e: Error) => setStopsState({ status: "error", message: e.message }));
  }, []);
  const stopById = useMemo(
    () => new Map(stopsState.status === "ready" ? stopsState.stops.map((s) => [s.id, s]) : []),
    [stopsState],
  );
  const nearStops = useMemo(
    () => (hasCenter && stopsState.status === "ready" ? withinRadius(stopsState.stops, center, radius) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasCenter, center.lat, center.lng, stopsState, radius],
  );
  const stops: Stop[] = useMemo(() => nearStops.map((s) => ({ id: s.id, name: s.name, mode: DATA_MODE, lat: s.lat, lng: s.lng })), [nearStops]);

  // Live vehicle positions (TPulso: /api/vehicles, refreshed every 15 s like the original).
  const live = useVehicles(hasCenter ? center : null, radius);
  const liveStatus: "connecting" | "live" | "offline" = live.error ? "offline" : live.updatedAt !== null ? "live" : "connecting";
  const feedAt = live.updatedAt;
  const newestFix = live.vehicles.reduce((m, v) => Math.max(m, v.timestamp), 0);
  const feedStale = newestFix ? Math.max(0, (now - newestFix) / 1000) : 0;

  // Live departure boards for stops inside the radar (+ the stop of the connection you follow).
  const boardState = useBoard(hasCenter ? center : null, radius);
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
  // TPulso: the pinned stop may be outside the radar: fetch its own departures (exact stop_id).
  const pinnedOutside = !!(pinned && boardState.board && !boardState.board.stopIds.includes(pinned.stopArea));
  const pinnedFetch = useStopDepartures(pinnedOutside ? pinned!.stopArea : null);
  const board: LiveDeparture[] | null = useMemo(() => {
    if (!boardState.board) return null;
    const rows = boardState.board.departures.map(toLiveDeparture);
    if (pinnedOutside && pinned && pinnedFetch.list) {
      rows.push(
        ...stopDeparturesToLive(
          {
            id: pinned.stopArea,
            name: pinned.stopName,
            lat: pinned.stopLat,
            lng: pinned.stopLng,
            distanceM: Math.round(distanceMeters(center, { lat: pinned.stopLat, lng: pinned.stopLng })),
          },
          pinnedFetch.list.departures,
        ),
      );
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardState.board, pinnedOutside, pinned, pinnedFetch.list]);
  const boardAgeSec = boardState.fetchedAt ? (now - boardState.fetchedAt) / 1000 : 0;

  // Routes (official shapes) for the vehicles on the radar.
  const routeEntries = useVehicleRoutes(live.vehicles);
  const routes = useMemo(() => {
    const m = new Map<string, TransitRoute>();
    for (const [id, e] of routeEntries) if (e.status === "ready" && e.route.path.length > 1) m.set(id, toTransitRoute(e.route));
    return m;
  }, [routeEntries]);

  // TPulso: API vehicles -> the original's Vehicle. Punctuality from this trip's live row on the board
  // (exact trip_id), speed from its recent GPS fixes; NaN = not known (never shown as "on time").
  const vehicles: Vehicle[] = useMemo(
    () =>
      live.vehicles.map((v) => {
        const mine = boardState.board?.departures.filter((d) => d.tripId === v.tripId && d.estimatedAt !== null) ?? [];
        const entry = routeEntries.get(v.id);
        const next = entry?.status === "ready" ? mine.find((d) => d.stopId === entry.route.nextStopId) : undefined;
        const d = next ?? mine[0];
        const fixes = live.fixes.get(v.id);
        const path = entry?.status === "ready" ? entry.route.path : [];
        // Measured speed for the card (unclamped); estimates use the clamped value.
        const speed = fixes ? recentSpeedMps(fixes, path, undefined, false) : null;
        return fromApiVehicle(v, {
          speedKmh: speed !== null ? speed * 3.6 : NaN,
          punctualityMin: d ? Math.round((d.estimatedAt! - d.scheduledAt) / 60) : NaN,
          ...(d ? { delaySec: d.estimatedAt! - d.scheduledAt } : {}),
          routeUnavailable: entry?.status === "ready" && entry.route.stopIds.length === 0,
        });
      }),
    [live.vehicles, live.fixes, boardState.board, routeEntries],
  );

  const vehicleByKey = useMemo(() => new Map(vehicles.map((v) => [v.tripId, v])), [vehicles]);

  // Real departures from the live board, inside the radar, leaving within 10 minutes, soonest first.
  // TPulso: no fallback to departures estimated from vehicles (the original's OSM-based estimate).
  const arrivals = useMemo(() => {
    if (!board) return [];
    const seen = new Set<string>();
    const out: Arrival[] = [];
    for (const d of board) {
      if (filter !== "all" && d.mode !== filter) continue;
      if (d.distanceM > radius) continue; // pinned stop may be far away
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
        delayMin: Math.round(d.delaySec / 60),
        distanceM: d.distanceM,
        vehicleKey: d.vehicleKey,
        stopArea: d.stopArea,
        expectedAt: d.expectedAt,
        realtime: d.realtime,
        cancelled: d.cancelled,
        ...(d.skipped ? { skipped: true } : {}),
        ...(v ? { vehicleId: v.id } : {}),
      });
    }
    const ids = new Set<string>();
    return out
      .filter((a) => a.distanceM <= radius && (a.expectedAt ?? 0) - now >= -60_000 && (a.etaSec ?? 0) <= 600 && !ids.has(a.id) && ids.add(a.id))
      .sort((a, b) => (a.etaSec ?? 0) - (b.etaSec ?? 0))
      .slice(0, 30);
  }, [board, vehicleByKey, radius, filter, now]);

  const boardNote = useMemo(() => {
    const b = boardState.board;
    if (!b) return null;
    const parts: string[] = [];
    if (b.stopsQueried < b.stopsInRadius) parts.push(`Showing the nearest ${b.stopsQueried} of ${b.stopsInRadius} stops.`);
    if (b.stopsFailed > 0) parts.push(`${b.stopsFailed} stop${b.stopsFailed === 1 ? "" : "s"} could not be loaded.`);
    if (boardState.error) parts.push(`Refresh failed (${boardState.error}).`);
    return parts.join(" ") || null;
  }, [boardState.board, boardState.error]);

  // The followed connection: its live departure at your stop + where the vehicle is now.
  const followed = useMemo(() => {
    if (!pinned) return null;
    const dep = board?.find((d) => d.vehicleKey === pinned.vehicleKey && d.stopArea === pinned.stopArea) ?? null;
    const v = vehicleByKey.get(pinned.vehicleKey) ?? null;
    return {
      pinned,
      dep,
      vehicle: v,
      vehicleDistM: v ? Math.round(distanceMeters(v, { lat: pinned.stopLat, lng: pinned.stopLng })) : null,
    };
  }, [pinned, board, vehicleByKey]);

  const pinArrival = useCallback(
    (a: Arrival) => {
      const d = board?.find((x) => x.id === a.id);
      if (!d) return;
      pin({
        vehicleKey: d.vehicleKey,
        stopArea: d.stopArea,
        stopName: d.stopName,
        stopLat: d.stopLat,
        stopLng: d.stopLng,
        line: d.line,
        mode: d.mode,
        destination: d.destination,
      });
    },
    [board, pin],
  );

  const visibleVehicles = useMemo(
    () => vehicles.filter((v) => (filter === "all" || v.mode === filter) && isInside(v, center, radius)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehicles, filter, center.lat, center.lng, radius],
  );
  const inRange = visibleVehicles.length;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [panelView, setPanelView] = useState<"results" | "help" | "feedback" | "stop">("results");
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const resetPanel = useCallback(() => {
    setPanelView("results");
    setSelectedId(null);
    setSelectedStopId(null);
    setOpenId(null);
    pin(null);
  }, [pin]);
  const openPanel = useCallback((view: "help" | "feedback") => {
    setSelectedId(null);
    setOpenId(null);
    setPanelView(view);
  }, []);
  const focusStop = useMemo(() => {
    const d = openId ? board?.find((x) => x.id === openId) : undefined;
    if (!d) return null;
    const v = vehicleByKey.get(d.vehicleKey);
    const state = boardAgeSec > 90 ? "stale" : d.realtime ? "live" : "scheduled";
    return {
      lat: d.stopLat,
      lng: d.stopLng,
      name: d.stopName,
      label: countdownLabel(Math.round(d.expectedAt / 1000), nowSec, state),
      vehicleId: v?.id ?? null,
    };
  }, [openId, board, vehicleByKey, nowSec, boardAgeSec]);
  const selected = selectedId ? visibleVehicles.find((v) => v.id === selectedId) : undefined;
  // Flip back once the vehicle leaves the radar or gets filtered out.
  useEffect(() => {
    if (selectedId && !selected && live.updatedAt !== null) setSelectedId(null);
  }, [selectedId, selected, live.updatedAt]);
  const selectedRoute = selected ? routes.get(selected.routeId) : undefined;
  const selectedEntry = selectedId ? routeEntries.get(selectedId) : undefined;

  // TPulso: an expected time for every upcoming stop (src/lib/eta.ts): Live / Scheduled from this trip's
  // own rows (exact trip_id; next ~10 stops + board), otherwise Estimated from route distance and speed.
  const stopTimes = useVehicleStopTimes(selectedId);
  const { upcoming, beyond } = useMemo(() => {
    const none = { upcoming: [] as UpcomingStop[], beyond: [] as UpcomingStop[] };
    if (!selected || selectedEntry?.status !== "ready") return none;
    const r = selectedEntry.route;
    const from = r.nextStopId ? r.stopIds.indexOf(r.nextStopId) : -1;
    const routeStops = (from >= 0 ? r.stopIds.slice(from) : []).flatMap((id) => {
      const s = stopById.get(id);
      return s ? [{ id, name: s.name, lat: s.lat, lng: s.lng }] : [];
    });
    const times = new Map((stopTimes?.vehicleId === selected.id ? stopTimes.times : []).map((t) => [t.stopId, t]));
    for (const d of boardState.board?.departures ?? []) {
      if (d.tripId === selected.tripId && !times.has(d.stopId)) times.set(d.stopId, d);
    }
    const fixes = live.fixes.get(selected.id);
    const etas = buildStopEtas({
      stops: routeStops,
      path: r.path,
      vehicle: selected,
      nowSec,
      speedMps: fixes ? recentSpeedMps(fixes, r.path) : null,
      times: [...times.values()],
    });
    const list: UpcomingStop[] = etas.map((e, i) => ({
      key: `${r.vehicleId}-${i}-${e.id}`,
      stopId: e.id,
      name: e.name,
      lat: e.lat,
      lng: e.lng,
      aheadM: e.aheadM,
      etaS: e.atSec - nowSec,
      state: e.state,
    }));
    return { upcoming: list.filter((u) => isInside(u, center, radius)), beyond: list.filter((u) => !isInside(u, center, radius)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectedEntry, stopById, stopTimes, boardState.board, live.fixes, nowSec, center.lat, center.lng, radius]);

  // TPulso: tapping a stop opens its departures for the next 10 minutes (board rows when the board
  // covers the stop, otherwise the stop's own departures).
  const tappedStop = selectedStopId ? nearStops.find((s) => s.id === selectedStopId) : undefined;
  const tappedOnBoard = !!(tappedStop && boardState.board?.stopIds.includes(tappedStop.id));
  const tappedFetch = useStopDepartures(tappedStop && boardState.board && !tappedOnBoard ? tappedStop.id : null);
  const stopPanel: StopPanel | null = useMemo(() => {
    if (!tappedStop) return null;
    const inWindow = (d: LiveDeparture) => d.expectedAt - now >= -60_000 && d.expectedAt - now <= 600_000;
    const base = { id: tappedStop.id, name: tappedStop.name, distanceM: Math.round(tappedStop.distance) };
    if (tappedOnBoard && board) {
      return { ...base, departures: board.filter((d) => d.stopArea === tappedStop.id && inWindow(d)), fetchedAt: boardState.fetchedAt, error: boardState.error };
    }
    const rows = tappedFetch.list
      ? stopDeparturesToLive({ ...base, lat: tappedStop.lat, lng: tappedStop.lng }, tappedFetch.list.departures).filter(inWindow).sort((a, b) => a.expectedAt - b.expectedAt)
      : null;
    return { ...base, departures: rows, fetchedAt: tappedFetch.fetchedAt, error: tappedFetch.error ?? (boardState.board ? null : boardState.error) };
  }, [tappedStop, tappedOnBoard, board, boardState.fetchedAt, boardState.error, boardState.board, tappedFetch, now]);
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
          </h1>
          <p className="truncate text-[10px] text-muted-foreground">
            {gps === "pending" ? "Locating you… · " : gps === "granted" ? "" : `TEST location: ${region.testLocation.label} · `}
            {liveStatus === "live" ? (
              <span className="font-bold text-[oklch(0.78_0.19_145)]">
                Live{feedStale > 45 ? ` (feed ${Math.round(feedStale / 60) || 1} min behind)` : ""}
              </span>
            ) : liveStatus === "offline" ? (
              <span className="font-bold text-destructive">live feed unavailable</span>
            ) : "connecting…"}
            {` · ${inRange} vehicles in the area`}
            {feedAt ? ` · updated ${clockSec(feedAt)}` : ""}
            {stopsState.status === "loading" ? " · loading stops…" : stopsState.status === "error" ? " · stops unavailable" : ""}
          </p>
        </div>

        <Clock now={now} />
        <div className="flex gap-0.5">
          <button
            onClick={() => openPanel("help")}
            aria-label="Open help"
            title="Help"
            className={`grid size-7 place-items-center rounded-lg border transition-colors ${panelView === "help" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface-2 text-foreground/80"}`}
          >
            <CircleHelp className="size-3.5" />
          </button>
          <button
            onClick={() => openPanel("feedback")}
            aria-label="Send feedback"
            title="Feedback"
            className={`grid size-7 place-items-center rounded-lg border transition-colors ${panelView === "feedback" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface-2 text-foreground/80"}`}
          >
            <MessageSquare className="size-3.5" />
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
                className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                  filter === key ? "bg-primary text-primary-foreground" : enabled ? "text-foreground/70" : "cursor-not-allowed text-foreground/35"
                }`}
              >
                {Icon ? <Icon className="size-3" /> : <Layers className="size-3" />}
                {enabled ? (
                  <span className="hidden sm:inline">{label}</span>
                ) : (
                  // TPulso: disabled modes are labelled "no data yet"
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
                hasGps={gps === "granted"}
                radius={radius}
                filter={filter}
                vehicles={visibleVehicles}
                routes={routes}
                stops={stops}
                selectedId={selectedId}
                focusStop={focusStop}
                upcoming={upcoming}
                onSelectStop={selectStop}
                selectedStopId={panelView === "stop" ? selectedStopId : null}
                recenterRequest={recenterRequest}
                now={now}
                onSelect={(id) => {
                  // Empty-radar tap or re-tapping the selected vehicle: reset everything.
                  if (panelView !== "results" || id === null || id === selectedId) {
                    resetPanel();
                  } else setSelectedId(id);
                }}
              />
            ) : (
              <div className="grid h-full place-items-center text-muted-foreground">
                <LoaderCircle className="size-6 animate-spin" />
              </div>
            )}
          </Suspense>
          {/* TPulso: legend of the data-source states */}
          <div className="pointer-events-none absolute bottom-6 left-2 z-[470]">
            <Legend />
          </div>
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
                      TPulso needs your location to show the buses around <em>you</em>. Right now the radar is centred on
                      the <strong>TEST</strong> location: {region.testLocation.label}, Lisboa.
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
                      Still nothing? Check your browser's location permission for this site (tap the lock/tune icon in the
                      address bar) and that location services are on.
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
          live={!!board && arrivals.some((a) => a.realtime)}
          followed={followed}
          onPin={pinArrival}
          onUnpin={() => pin(null)}
          canSelect={(id) => visibleVehicles.some((v) => v.id === id)}
          openId={openId}
          radarVehicles={visibleVehicles
            .map((v) => ({ id: v.id, line: v.line, mode: v.mode, headsign: v.headsign, fixAt: v.fixAt ?? 0, distanceM: Math.round(distanceMeters(v, center)) }))
            .sort((a, b) => a.distanceM - b.distanceM)}
          onOpen={setOpenId}
          panelView={panelView}
          onPanelClose={() => {
            setPanelView("results");
            setSelectedStopId(null);
          }}
          now={now}
          boardAgeSec={boardAgeSec}
          boardStatus={{ loading: hasCenter && !boardState.board && !boardState.error, error: boardState.board ? null : boardState.error, note: boardNote }}
          stop={stopPanel}
          routeStatus={!selectedEntry ? "idle" : selectedEntry.status}
        />
      </div>
    </main>
  );
}

function Clock({ now }: { now: number }) {
  // TPulso: Europe/Lisbon time (the original showed nl-NL local time).
  return (
    <span className="rounded-xl bg-surface-2 px-2 py-1 font-display text-xs font-bold tabular-nums text-primary">
      {clockSec(now)}
    </span>
  );
}
