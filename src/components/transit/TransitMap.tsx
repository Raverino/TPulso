import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { LocateFixed } from "lucide-react";
import "leaflet/dist/leaflet.css";

import {
  clipRoute,
  isUnknownRoute,
  type TransitRoute,
  type FilterMode,
  type LatLng,
  type Stop,
  type UpcomingStop,
  type Vehicle,
} from "@/lib/transit";
// TPulso: data-source states (Live / Scheduled / Estimated / Stale) and CARTO tiles.
import { countdownLabel, SOURCE_TEXT, type SourceState } from "@/lib/sourceStatus";
import { MAP_TILES } from "@/config";

const MODE_GLYPH: Record<Vehicle["mode"], string> = {
  bus: "BUS",
  train: "CP",
  tram: "TRM",
  ferry: "FRY",
};

const esc = (s: string) => s.replace(/[<>&"']/g, "");

const iconCache = new Map<string, L.DivIcon>();
/** Cached so markers keep their DOM element (lets the CSS glide run between ticks). */
function vehicleIcon(v: Vehicle) {
  const unknown = isUnknownRoute(v);
  const key = `${v.mode}|${v.line}|${unknown ? 1 : 0}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const icon = L.divIcon({
    className: "vehicle-marker",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    // TPulso offline: every vehicle is an Expected position from the timetable (dashed outline + badge).
    html: `<div class="vehicle-pin is-expected" data-mode="${v.mode}">
        <span class="src-dot src-expected pin-src"></span>
        <span style="font-size:8px;opacity:.7">${MODE_GLYPH[v.mode]}</span>
        <span>${esc(v.line)}</span>
        ${unknown ? `<span class="unknown-badge">?</span>` : ""}
      </div>`,
  });
  iconCache.set(key, icon);
  return icon;
}

/** Turn off the glide while the map zooms/refits so markers don't slide across the screen. */
function GlideGuard() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    let t: ReturnType<typeof setTimeout>;
    const off = () => {
      clearTimeout(t);
      el.classList.add("no-glide");
    };
    const on = () => {
      clearTimeout(t);
      t = setTimeout(() => el.classList.remove("no-glide"), 80);
    };
    map.on("zoomstart movestart viewreset", off);
    map.on("zoomend moveend", on);
    return () => {
      map.off("zoomstart movestart viewreset", off);
      map.off("zoomend moveend", on);
    };
  }, [map]);
  return null;
}

const stopIcon = L.divIcon({
  className: "",
  iconSize: [10, 10],
  iconAnchor: [5, 5],
  html: `<div class="stop-pin"></div>`,
});

// TPulso: the ETA badge carries the stop time's source dot (Live / Scheduled / Estimated).
function upcomingIcon(etaLabelText: string, name: string, state?: SourceState) {
  const safe = esc(name);
  const dot = state ? `<span class="src-dot src-${state} eta-src"></span>` : "";
  return L.divIcon({
    className: "",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    html: `<div class="upcoming-stop" title="${safe}"><span class="upcoming-eta lift">${dot}${esc(etaLabelText)}</span></div>`,
  });
}

const locateIcon = L.divIcon({
  className: "",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  html: `<div class="locate-dot"></div>`,
});

/** TPulso: after this long without touching the map, it glides back to your position. */
export const RECENTER_IDLE_MS = 20_000;

/**
 * Fits the radar circle in view. TPulso change: the radar is drawn in map coordinates, so dragging moves
 * it with the map (explore around) instead of the original's snap-back after 0.4 s. Position updates don't
 * pull the view back while exploring; it glides home after RECENTER_IDLE_MS idle or on `recenterSignal`.
 */
function Recenter({
  center,
  radius,
  recenterSignal,
  onAwayChange,
}: {
  center: LatLng;
  radius: number;
  recenterSignal: number;
  onAwayChange: (away: boolean) => void;
}) {
  const map = useMap();
  const away = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const homeRef = useRef<(glide: boolean) => void>(() => {});

  const setAway = useCallback(
    (v: boolean) => {
      if (away.current === v) return;
      away.current = v;
      onAwayChange(v);
    },
    [onAwayChange],
  );

  // Fit the radar circle snugly inside the sonar screen.
  homeRef.current = (glide: boolean) => {
    clearTimeout(idle.current);
    setAway(false);
    const bounds = L.latLng(center.lat, center.lng).toBounds(radius * 2);
    if (glide) map.flyToBounds(bounds, { padding: [28, 28], duration: 1.2 });
    else map.fitBounds(bounds, { padding: [28, 28], animate: true });
  };

  useEffect(() => {
    if (!away.current) homeRef.current(false);
  }, [center.lat, center.lng, radius]);

  useEffect(() => {
    if (recenterSignal > 0) homeRef.current(true);
  }, [recenterSignal]);

  useEffect(() => {
    const el = map.getContainer();
    const touched = () => {
      clearTimeout(idle.current);
      idle.current = setTimeout(() => homeRef.current(true), RECENTER_IDLE_MS);
    };
    const dragged = () => {
      setAway(true);
      touched();
    };
    map.on("dragstart", dragged);
    const onPointer = () => away.current && touched();
    el.addEventListener("pointerdown", onPointer);
    el.addEventListener("pointermove", onPointer, { passive: true });
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      if (!away.current) homeRef.current(false);
    });
    ro.observe(el);
    return () => {
      clearTimeout(idle.current);
      map.off("dragstart", dragged);
      el.removeEventListener("pointerdown", onPointer);
      el.removeEventListener("pointermove", onPointer);
      ro.disconnect();
    };
  }, [map, setAway]);
  return null;
}

interface Props {
  center: LatLng;
  hasGps: boolean;
  radius: number;
  filter: FilterMode;
  vehicles: Vehicle[];
  routes: Map<string, TransitRoute>;
  stops: Stop[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  focusStop?: { lat: number; lng: number; name: string; label: string; vehicleId: string | null } | null;
  /** Live feed refresh in progress: show a charging sweep on the radar. */
  loading?: boolean;
  // TPulso additions
  /** Upcoming stops of the selected vehicle with their expected times (Live / Scheduled / Estimated). */
  upcoming: UpcomingStop[];
  /** Tapping a stop opens its departures. */
  onSelectStop: (id: string) => void;
  selectedStopId: string | null;
  /** Incremented by the top bar's recentre button. */
  recenterRequest: number;
  now: number;
}

function ClearOnMapClick({ onClear }: { onClear: () => void }) {
  const map = useMap();
  useEffect(() => {
    map.on("click", onClear);
    return () => {
      map.off("click", onClear);
    };
  }, [map, onClear]);
  return null;
}

function SonarGeometry({
  center,
  radius,
  onChange,
}: {
  center: LatLng;
  radius: number;
  onChange: (g: { x: number; y: number; r: number }) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const update = () => {
      const c = L.latLng(center.lat, center.lng);
      const p = map.latLngToContainerPoint(c);
      const edge = map.latLngToContainerPoint(c.toBounds(radius * 2).getNorthEast());
      onChange({ x: p.x, y: p.y, r: Math.abs(p.y - edge.y) });
    };
    update();
    map.on("move zoom resize viewreset", update);
    return () => {
      map.off("move zoom resize viewreset", update);
    };
  }, [map, center.lat, center.lng, radius, onChange]);
  return null;
}

export default function TransitMap({
  center,
  hasGps,
  radius,
  filter,
  vehicles,
  routes,
  stops,
  selectedId,
  onSelect,
  focusStop,
  upcoming,
  onSelectStop,
  selectedStopId,
  recenterRequest,
  now,
}: Props) {
  const [geo, setGeo] = useState({ x: 0, y: 0, r: 0 });
  const [away, setAway] = useState(false);
  const [recenterSignal, setRecenterSignal] = useState(0);
  useEffect(() => {
    if (recenterRequest > 0) setRecenterSignal((n) => n + 1);
  }, [recenterRequest]);
  const selected = selectedId ? vehicles.find((v) => v.id === selectedId) : undefined;
  const nowSec = Math.floor(now / 1000);

  const visibleVehicles = useMemo(() => {
    if (focusStop) return vehicles.filter((v) => v.id === focusStop.vehicleId);
    if (selected) return [selected];
    return filter === "all" ? vehicles : vehicles.filter((v) => v.mode === filter);
  }, [vehicles, filter, selected, focusStop]);
  const activeRoutes = useMemo(() => {
    const ids = new Set(visibleVehicles.map((v) => v.routeId));
    // TPulso: a route can come as several slices (one per map area); `group` is the route they belong to.
    return [...routes.values()].filter((r): r is TransitRoute => ids.has(r.group ?? r.id));
  }, [visibleVehicles, routes]);
  const visibleStops = useMemo(() => {
    // TPulso: stops are shown (the original hid them); with a vehicle selected, its own stops are drawn
    // as upcoming-stop markers instead.
    if (selected || focusStop) return [];
    return filter === "all" ? stops : stops.filter((s) => s.mode === filter);
  }, [stops, filter, selected, focusStop]);
  // Keep the station marker on the radar: clamp to the rim when it lies outside.
  const focusPos = useMemo((): [number, number] | null => {
    if (!focusStop) return null;
    const k = Math.cos((center.lat * Math.PI) / 180);
    const dy = (focusStop.lat - center.lat) * 111_320;
    const dx = (focusStop.lng - center.lng) * 111_320 * k;
    const d = Math.hypot(dx, dy);
    const max = radius * 0.85;
    if (d <= max) return [focusStop.lat, focusStop.lng];
    const f = max / d;
    return [center.lat + (dy * f) / 111_320, center.lng + (dx * f) / (111_320 * k)];
  }, [focusStop, center, radius]);
  const upcomingStops = focusStop || !selected ? [] : upcoming;
  const clear = useCallback(() => onSelect(null), [onSelect]);

  return (
    <div className="relative h-full w-full">
    <MapContainer
      zoomSnap={0}
      center={[center.lat, center.lng]}
      zoom={16}
      zoomControl={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      touchZoom={false}
      boxZoom={false}
      keyboard={false}
      // TPulso: Leaflet's default fling speed is unlimited; a quick flick could throw the radar off-screen.
      inertiaMaxSpeed={1200}
      inertiaDeceleration={4000}
      attributionControl
      className="h-full w-full"
    >
      {/* TPulso: CARTO dark_nolabels tiles (src/config.ts); the original's dark CSS filter is removed. */}
      <TileLayer url={MAP_TILES.url} attribution={MAP_TILES.attribution} maxZoom={MAP_TILES.maxZoom} className={MAP_TILES.className} />
      <Recenter center={center} radius={radius} recenterSignal={recenterSignal} onAwayChange={setAway} />
      <GlideGuard />
      <ClearOnMapClick onClear={clear} />


      <Circle
        center={[center.lat, center.lng]}
        radius={radius}
        className="radar-ring"
        pathOptions={{
          color: "oklch(0.68 0.19 258)",
          weight: 1.5,
          fillColor: "oklch(0.68 0.19 258)",
          fillOpacity: 0.12,
          dashArray: "6 6",
        }}
      />

      <Marker position={[center.lat, center.lng]} icon={locateIcon} zIndexOffset={1000}>
        <Popup>
          <strong className="font-display">{hasGps ? "You are here" : "TEST location"}</strong>
          <div className="text-muted-foreground">
            {hasGps ? `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}` : "Not your real position"}
          </div>
        </Popup>
      </Marker>

      {upcomingStops.map((u) => (
        <Marker
          key={u.key}
          position={[u.lat, u.lng]}
          icon={upcomingIcon(countdownLabel(nowSec + u.etaS, nowSec, u.state), u.name, u.state)}
          zIndexOffset={500}
        >
          <Popup>
            <strong className="font-display">{u.name}</strong>
            <div className="text-muted-foreground">
              {u.aheadM} m ahead · {SOURCE_TEXT[u.state]} {countdownLabel(nowSec + u.etaS, nowSec, u.state)}
            </div>
          </Popup>
        </Marker>
      ))}

      {focusStop && focusPos && (
        <Marker
          position={focusPos}
          icon={upcomingIcon(focusStop.label, focusStop.name)}
          zIndexOffset={900}
          eventHandlers={{ click: clear }}
        />
      )}

      {visibleStops.map((s) => (
        <Marker
          key={s.id}
          position={[s.lat, s.lng]}
          icon={s.id === selectedStopId ? upcomingIcon(s.name, s.name) : stopIcon}
          title={s.name}
          zIndexOffset={s.id === selectedStopId ? 800 : 0}
          eventHandlers={{ click: () => onSelectStop(s.id) }}
        />
      ))}

      {activeRoutes.map((r) =>
        clipRoute(r, center, radius).map((seg, i) => (
          <Polyline
            key={`route-${r.id}-${i}-${radius}`}
            positions={seg}
            className={`route-line route-${r.mode}`}
            pathOptions={{ weight: 3, opacity: 0.6, color: "currentColor" }}
            interactive={false}
          />
        )),
      )}

      {visibleVehicles.map((v) => {
        return (
          <Marker
            key={v.id}
            position={[v.lat, v.lng]}
            icon={vehicleIcon(v)}
            title={`${v.line} → ${v.headsign || "—"} · Expected position (timetable)`}
            eventHandlers={{
              click: () => onSelect(v.id),
            }}
          >

          </Marker>
        );
      })}
      <SonarGeometry center={center} radius={radius} onChange={setGeo} />
    </MapContainer>
      <div
        className="sonar-bezel"
        style={{ "--x": `${geo.x}px`, "--y": `${geo.y}px`, "--r": `${geo.r}px` } as React.CSSProperties}
        aria-hidden
      />
      {/* TPulso additions: missing tile key notice and the Recenter button while exploring. */}
      {MAP_TILES.problem && (
        <p className="pointer-events-none absolute left-1/2 top-2 z-[480] -translate-x-1/2 rounded-lg bg-surface/90 px-2 py-1 text-center text-[10px] text-muted-foreground">
          {MAP_TILES.problem}
        </p>
      )}
      {away && (
        <button
          type="button"
          onClick={() => setRecenterSignal((n) => n + 1)}
          className="absolute bottom-6 right-3 z-[480] flex items-center gap-1.5 rounded-xl border border-border bg-surface/95 px-3 py-2 font-display text-xs font-bold text-primary shadow-float active:scale-95"
          aria-label="Recenter the radar on your position"
        >
          <LocateFixed className="size-4" /> Recenter
        </button>
      )}
    </div>
  );
}
