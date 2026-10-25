import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { LocateFixed } from "lucide-react";
import "leaflet/dist/leaflet.css";

import {
  isUnknownRoute,
  type TransitRoute,
  type FilterMode,
  type LatLng,
  type TransportMode,
  type Vehicle,
} from "@/lib/transit";
// TPulso: data-source states (Live / Scheduled / Estimated / Stale) and CARTO tiles.
import { type SourceState } from "@/lib/sourceStatus";
import { MAP_TILES } from "@/config";

const MODE_GLYPH: Record<Vehicle["mode"], string> = {
  bus: "BUS",
  train: "CP",
  tram: "TRM",
  ferry: "FRY",
};

const esc = (s: string) => s.replace(/[<>&"']/g, "");
const HEX = /^#[0-9a-f]{6}$/i;
const MODE_VAR: Record<TransportMode, string> = { bus: "var(--bus)", tram: "var(--tram)", train: "var(--train)", ferry: "var(--ferry)" };

/** TPulso: a station on the map (one per physical station; see src/offline/stations.ts). */
export interface MapStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Modes shown in the ring (already filtered by the mode filter). */
  modes: TransportMode[];
  /** Ring size in px (scaled by departures in the next 10 minutes). */
  size: number;
}

/** TPulso: a stop of the selected vehicle, in its line colour. */
export interface RouteStopMarker {
  key: string;
  name: string;
  lat: number;
  lng: number;
  state: "passed" | "next" | "upcoming";
  /** Scheduled countdown ("~3 min") for upcoming stops inside the radar. */
  label?: string;
  color: string;
  textColor: string;
}

const stationIconCache = new Map<string, L.DivIcon>();
/** Ring split into one segment per mode; the icon box stays >= 28 px so it is easy to tap. */
function stationIcon(s: MapStation, selected: boolean, showLabel: boolean) {
  const key = `${s.modes.join(",")}|${s.size}|${selected ? 1 : 0}|${showLabel ? s.name : ""}`;
  const hit = stationIconCache.get(key);
  if (hit) return hit;
  const n = Math.max(1, s.modes.length);
  const ring = s.modes.length > 1
    ? `conic-gradient(${s.modes.map((m, i) => `${MODE_VAR[m]} ${(i * 100) / n}% ${((i + 1) * 100) / n}%`).join(", ")})`
    : MODE_VAR[s.modes[0] ?? "bus"];
  const box = Math.max(28, s.size + 4);
  const icon = L.divIcon({
    className: "",
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
    html: `<div class="station${selected ? " is-selected" : ""}" style="--size:${s.size}px;--ring:${ring}"><span class="station-ring"></span><span class="station-core"></span>${showLabel ? `<span class="station-label">${esc(s.name)}</span>` : ""}</div>`,
  });
  stationIconCache.set(key, icon);
  return icon;
}

function routeStopIcon(r: RouteStopMarker) {
  const color = HEX.test(r.color) ? r.color : "var(--primary)";
  const text = HEX.test(r.textColor) ? r.textColor : "var(--primary-foreground)";
  return L.divIcon({
    className: "",
    iconSize: r.state === "next" ? [16, 16] : [10, 10],
    iconAnchor: r.state === "next" ? [8, 8] : [5, 5],
    html: `<div class="route-stop is-${r.state}" style="--line:${color};--line-text:${text}" title="${esc(r.name)}">${r.label ? `<span class="upcoming-eta lift">${esc(r.label)}</span>` : ""}</div>`,
  });
}

/** Names of stations show from this zoom on (and always for the tapped one). */
const LABEL_ZOOM = 17.5;
function ZoomWatch({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => onZoom(map.getZoom()), [map, onZoom]);
  return null;
}

const iconCache = new Map<string, L.DivIcon>();
/** Cached so markers keep their DOM element (lets the CSS glide run between ticks). */
function vehicleIcon(v: Vehicle) {
  const unknown = isUnknownRoute(v);
  const bg = v.color && HEX.test(v.color) ? v.color : "";
  const fg = v.textColor && HEX.test(v.textColor) ? v.textColor : "";
  const key = `${v.mode}|${v.line}|${unknown ? 1 : 0}|${bg}|${fg}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const icon = L.divIcon({
    className: "vehicle-marker",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    // TPulso offline: every vehicle is an Expected position from the timetable (dashed outline + badge).
    // TPulso: pin in the official line colour (same as its route line and stops), else the mode colour.
    html: `<div class="vehicle-pin is-expected" data-mode="${v.mode}"${bg ? ` style="background:${bg};${fg ? `color:${fg};` : ""}"` : ""}>
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

/**
 * Keeps the radar circle in view. TPulso changes to the original's Recenter:
 * - every radius change fits the whole circle (with padding), so the radar works at 1000 m too;
 * - the map is anchored to real coordinates: dragging moves the map, circle and user dot stay where they are,
 *   and the map never snaps back by itself;
 * - position updates are followed only while the user is not exploring;
 * - the Recenter button (recenterSignal) returns to the location and re-fits the circle.
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
  const latest = useRef({ center, radius });
  latest.current = { center, radius };

  const setAway = useCallback(
    (v: boolean) => {
      if (away.current === v) return;
      away.current = v;
      onAwayChange(v);
    },
    [onAwayChange],
  );
  const fit = useCallback(
    (glide: boolean) => {
      setAway(false);
      const { center: c, radius: r } = latest.current;
      // toBounds(size) is a square of `size` metres: the circle's diameter.
      const bounds = L.latLng(c.lat, c.lng).toBounds(r * 2);
      if (glide) map.flyToBounds(bounds, { padding: [28, 28], duration: 0.8 });
      else map.fitBounds(bounds, { padding: [28, 28], animate: true });
    },
    [map, setAway],
  );

  // Radius change (and first render): always show the whole circle.
  useEffect(() => fit(false), [radius, fit]);
  // New position: follow it, unless the user is looking around elsewhere.
  useEffect(() => {
    if (!away.current) fit(false);
  }, [center.lat, center.lng, fit]);
  // Recenter button.
  useEffect(() => {
    if (recenterSignal > 0) fit(true);
  }, [recenterSignal, fit]);

  useEffect(() => {
    const onDrag = () => setAway(true);
    map.on("dragstart", onDrag);
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      if (!away.current) fit(false);
    });
    ro.observe(map.getContainer());
    return () => {
      map.off("dragstart", onDrag);
      ro.disconnect();
    };
  }, [map, setAway, fit]);
  return null;
}

interface Props {
  center: LatLng;
  hasGps: boolean;
  radius: number;
  filter: FilterMode;
  vehicles: Vehicle[];
  routes: Map<string, TransitRoute>;
  /** TPulso: one marker per physical station inside the radar. */
  stations: MapStation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  focusStop?: { lat: number; lng: number; name: string; label: string; vehicleId: string | null } | null;
  /** Live feed refresh in progress: show a charging sweep on the radar. */
  loading?: boolean;
  // TPulso additions
  /** Stops of the selected vehicle (passed / next / upcoming), in its line colour. */
  routeStops: RouteStopMarker[];
  /** Tapping a station opens its departures. */
  onSelectStop: (id: string) => void;
  /** The tapped station (yellow), if any. */
  selectedStopId: string | null;
  /** Incremented by the top bar's recentre button. */
  recenterRequest: number;
  /** TPulso: tram, metro, train and ferry lines of the region, drawn at every radius. */
  baseLines: TransitRoute[];
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
  stations,
  selectedId,
  onSelect,
  focusStop,
  routeStops,
  onSelectStop,
  selectedStopId,
  recenterRequest,
  baseLines,
}: Props) {
  const [geo, setGeo] = useState({ x: 0, y: 0, r: 0 });
  const [away, setAway] = useState(false);
  const [recenterSignal, setRecenterSignal] = useState(0);
  useEffect(() => {
    if (recenterRequest > 0) setRecenterSignal((n) => n + 1);
  }, [recenterRequest]);
  const selected = selectedId ? vehicles.find((v) => v.id === selectedId) : undefined;
  const [zoom, setZoom] = useState(16);

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
  // TPulso focus mode: with a vehicle selected only its own stops are drawn (routeStops); stations are
  // hidden. The mode filter is already applied to `stations` (ring segments and which stations show).
  const visibleStations = selected || focusStop ? [] : stations;
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
  const selectedStops = focusStop || !selected ? [] : routeStops;
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
      <ZoomWatch onZoom={setZoom} />


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

      {/* TPulso: the selected vehicle's stops in its line colour — passed dimmed, next larger with a ring. */}
      {selectedStops.map((u) => (
        <Marker key={u.key} position={[u.lat, u.lng]} icon={routeStopIcon(u)} zIndexOffset={u.state === "next" ? 600 : u.state === "upcoming" ? 500 : 400}>
          <Popup>
            <strong className="font-display">{u.name}</strong>
            <div className="text-muted-foreground">{u.state === "passed" ? "Already passed" : u.label ? `Scheduled ${u.label}` : u.state === "next" ? "Next stop" : "Further along the line"}</div>
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

      {/* TPulso: one ring per physical station; name only when tapped or zoomed in. */}
      {visibleStations.map((s) => (
        <Marker
          key={s.id}
          position={[s.lat, s.lng]}
          icon={stationIcon(s, s.id === selectedStopId, s.id === selectedStopId || zoom >= LABEL_ZOOM)}
          title={s.name}
          zIndexOffset={s.id === selectedStopId ? 800 : 0}
          eventHandlers={{ click: () => onSelectStop(s.id) }}
        />
      ))}

      {/* TPulso: whole lines (first stop to terminus), never clipped to the radar or to map areas. */}
      {!selected && baseLines.map((r) => (
        <Polyline
          key={`base-${r.id}`}
          positions={r.path}
          className={`route-line route-${r.mode}`}
          pathOptions={{ weight: 2.5, opacity: 0.35, color: "currentColor", lineCap: "round", lineJoin: "round" }}
          smoothFactor={0}
          interactive={false}
        />
      ))}
      {activeRoutes.map((r) => (
        <Polyline
          key={`route-${r.id}`}
          positions={r.path}
          className={r.color && HEX.test(r.color) ? "route-line" : `route-line route-${r.mode}`}
          pathOptions={{ weight: selected ? 4 : 3, opacity: selected ? 0.9 : 0.75, color: r.color && HEX.test(r.color) ? r.color : "currentColor", lineCap: "round", lineJoin: "round" }}
          smoothFactor={0}
          interactive={false}
        />
      ))}

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
