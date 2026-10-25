// Ported from the original OV Pulse TransitMap.tsx: radar circle, sonar bezel, snap-back
// recentre, dark tiles, vehicle pins, upcoming-stop and countdown markers, clipped route line.
// Changes: TML data, the Live/Stale source badge on every vehicle, stops inside the radar shown.
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import type { StopLite, Vehicle } from '../../../shared/types';
import { MAP_TILES } from '@/config';
import { agoLabel, countdownLabel, SOURCE_TEXT, vehicleSource, type SourceState } from '@/lib/sourceStatus';
import { clipPath, type LatLng, type UpcomingStop } from '@/lib/transit';

const esc = (s: string) => s.replace(/[<>&"']/g, '');

const iconCache = new Map<string, L.DivIcon>();
/** Cached so markers keep their DOM element (lets the CSS glide run between updates). */
function vehicleIcon(v: Vehicle, state: 'live' | 'stale') {
  const unknown = v.line === null;
  const key = `${v.line}|${state}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const icon = L.divIcon({
    className: 'vehicle-marker',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div class="vehicle-pin${state === 'stale' ? ' is-stale' : ''}" data-mode="bus">
        <span class="src-dot src-${state} pin-src"></span>
        <span style="font-size:8px;opacity:.7">BUS</span>
        <span>${unknown ? '?' : esc(v.line!)}</span>
        ${unknown ? `<span class="unknown-badge">?</span>` : ''}
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
      el.classList.add('no-glide');
    };
    const on = () => {
      clearTimeout(t);
      t = setTimeout(() => el.classList.remove('no-glide'), 80);
    };
    map.on('zoomstart movestart viewreset', off);
    map.on('zoomend moveend', on);
    return () => {
      map.off('zoomstart movestart viewreset', off);
      map.off('zoomend moveend', on);
    };
  }, [map]);
  return null;
}

const stopIcon = L.divIcon({
  className: '',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
  html: `<div class="stop-pin in-radar"></div>`,
});

function upcomingIcon(name: string, label: string | null, state?: SourceState) {
  const dot = state ? `<span class="src-dot src-${state} eta-src"></span>` : '';
  return L.divIcon({
    className: '',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    html: `<div class="upcoming-stop" title="${esc(name)}">${label ? `<span class="upcoming-eta lift">${dot}${esc(label)}</span>` : ''}</div>`,
  });
}

const locateIcon = L.divIcon({
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  html: `<div class="locate-dot"></div>`,
});

/** After this long without touching the map, it glides back to your position. */
export const RECENTER_IDLE_MS = 20_000;

/**
 * Keeps the radar circle fitted in view. The radar is drawn in map coordinates, so when you drag the
 * map it moves with it and you can explore around. While you are exploring, position updates don't
 * pull the view back; after RECENTER_IDLE_MS without interaction (or on `recenterSignal`) it glides home.
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

  // New position or radius: follow it, unless the user is exploring elsewhere.
  useEffect(() => {
    if (!away.current) homeRef.current(false);
  }, [center.lat, center.lng, radius]);

  // Recenter button.
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
    map.on('dragstart', dragged);
    // Any touch/mouse/pen interaction restarts the idle countdown while exploring.
    const onPointer = () => away.current && touched();
    el.addEventListener('pointerdown', onPointer);
    el.addEventListener('pointermove', onPointer, { passive: true });
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      if (!away.current) homeRef.current(false);
    });
    ro.observe(el);
    return () => {
      clearTimeout(idle.current);
      map.off('dragstart', dragged);
      el.removeEventListener('pointerdown', onPointer);
      el.removeEventListener('pointermove', onPointer);
      ro.disconnect();
    };
  }, [map, setAway]);
  return null;
}

export interface FocusStop {
  lat: number;
  lng: number;
  name: string;
  label: string;
  vehicleId: string | null;
}

interface Props {
  center: LatLng;
  isTest: boolean;
  radius: number;
  vehicles: Vehicle[];
  stops: (StopLite & { distance: number })[];
  selectedId: string | null;
  /** Route geometry of the selected vehicle ([lat, lng]); empty when not available. */
  selectedPath: [number, number][];
  upcoming: UpcomingStop[];
  onSelect: (id: string | null) => void;
  focusStop?: FocusStop | null;
  selectedStopId: string | null;
  onSelectStop: (id: string) => void;
  /** Incremented by the header's recentre button. */
  recenterRequest: number;
  now: number;
}

function ClearOnMapClick({ onClear }: { onClear: () => void }) {
  const map = useMap();
  useEffect(() => {
    map.on('click', onClear);
    return () => {
      map.off('click', onClear);
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
    map.on('move zoom resize viewreset', update);
    return () => {
      map.off('move zoom resize viewreset', update);
    };
  }, [map, center.lat, center.lng, radius, onChange]);
  return null;
}

export default function TransitMap({
  center,
  isTest,
  radius,
  vehicles,
  stops,
  selectedId,
  selectedPath,
  upcoming,
  onSelect,
  focusStop,
  selectedStopId,
  onSelectStop,
  recenterRequest,
  now,
}: Props) {
  const [geo, setGeo] = useState({ x: 0, y: 0, r: 0 });
  const [away, setAway] = useState(false);
  const [recenterSignal, setRecenterSignal] = useState(0);
  useEffect(() => {
    if (recenterRequest > 0) setRecenterSignal(n => n + 1);
  }, [recenterRequest]);
  const selected = selectedId ? vehicles.find(v => v.id === selectedId) : undefined;
  const nowSec = Math.floor(now / 1000);
  // Source state changes slowly; re-derive icons every 5 s rather than every tick.
  const bucket = Math.floor(now / 5000) * 5000;

  const visibleVehicles = useMemo(() => {
    if (focusStop) return vehicles.filter(v => v.id === focusStop.vehicleId);
    if (selected) return [selected];
    return vehicles;
  }, [vehicles, selected, focusStop]);
  const routeSegments = useMemo(
    () => (selected && !focusStop ? clipPath(selectedPath, center, radius) : []),
    [selected, focusStop, selectedPath, center, radius],
  );
  const selectedStopIds = useMemo(() => new Set(upcoming.map(u => u.stopId)), [upcoming]);
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
        // Leaflet's default fling speed is unlimited: a quick flick could throw the radar far off-screen.
        inertiaMaxSpeed={1200}
        inertiaDeceleration={4000}
        attributionControl
        className="h-full w-full"
      >
        <TileLayer
          url={MAP_TILES.url}
          attribution={MAP_TILES.attribution}
          maxZoom={MAP_TILES.maxZoom}
        />
        <Recenter center={center} radius={radius} recenterSignal={recenterSignal} onAwayChange={setAway} />
        <GlideGuard />
        <ClearOnMapClick onClear={clear} />

        <Circle
          center={[center.lat, center.lng]}
          radius={radius}
          className="radar-ring"
          pathOptions={{
            color: 'oklch(0.68 0.19 258)',
            weight: 1.5,
            fillColor: 'oklch(0.68 0.19 258)',
            fillOpacity: 0.12,
            dashArray: '6 6',
          }}
        />

        <Marker position={[center.lat, center.lng]} icon={locateIcon} zIndexOffset={1000}>
          <Popup>
            <strong className="font-display">{isTest ? 'TEST location' : 'You are here'}</strong>
            <div className="text-muted-foreground">
              {isTest ? 'Not your real position' : `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`}
            </div>
          </Popup>
        </Marker>

        {!focusStop &&
          stops
            .filter(s => !selectedStopIds.has(s.id))
            .map(s => (
              <Marker
                key={s.id}
                position={[s.lat, s.lng]}
                icon={s.id === selectedStopId ? upcomingIcon(s.name, s.name) : stopIcon}
                title={`${s.name} · ${Math.round(s.distance)} m`}
                zIndexOffset={s.id === selectedStopId ? 800 : 0}
                eventHandlers={{ click: () => onSelectStop(s.id) }}
              />
            ))}

        {upcomingStops.map(u => (
          <Marker
            key={u.key}
            position={[u.lat, u.lng]}
            icon={upcomingIcon(u.name, countdownLabel(u.atSec, nowSec, u.state), u.state)}
            zIndexOffset={500}
          >
            <Popup>
              <strong className="font-display">{u.name}</strong>
              <div className="text-muted-foreground">
                {SOURCE_TEXT[u.state]} · {countdownLabel(u.atSec, nowSec, u.state)}
              </div>
            </Popup>
          </Marker>
        ))}

        {focusStop && focusPos && (
          <Marker
            position={focusPos}
            icon={upcomingIcon(focusStop.name, focusStop.label)}
            zIndexOffset={900}
            eventHandlers={{ click: clear }}
          />
        )}

        {routeSegments.map((seg, i) => (
          <Polyline
            key={`route-${selectedId}-${i}-${radius}`}
            positions={seg}
            className="route-line route-bus"
            pathOptions={{ weight: 3, opacity: 0.6, color: 'currentColor' }}
            interactive={false}
          />
        ))}

        {visibleVehicles.map(v => {
          const src = vehicleSource(v, bucket);
          return (
            <Marker
              key={v.id}
              position={[v.lat, v.lng]}
              icon={vehicleIcon(v, src.state)}
              title={`${v.line ?? '?'} → ${v.headsign ?? 'destination unknown'} · ${SOURCE_TEXT[src.state]} · last seen ${agoLabel(src.ageSec)} ago`}
              zIndexOffset={src.state === 'live' ? 600 : 0}
              eventHandlers={{
                click: () => onSelect(v.id),
              }}
            />
          );
        })}
        <SonarGeometry center={center} radius={radius} onChange={setGeo} />
      </MapContainer>
      <div
        className="sonar-bezel"
        style={{ '--x': `${geo.x}px`, '--y': `${geo.y}px`, '--r': `${geo.r}px` } as React.CSSProperties}
        aria-hidden
      />
      {MAP_TILES.problem && (
        <p className="pointer-events-none absolute left-1/2 top-2 z-[480] -translate-x-1/2 rounded-lg bg-surface/90 px-2 py-1 text-center text-[10px] text-muted-foreground">
          {MAP_TILES.problem}
        </p>
      )}
      {away && (
        <button
          type="button"
          onClick={() => setRecenterSignal(n => n + 1)}
          className="absolute bottom-6 right-3 z-[480] flex items-center gap-1.5 rounded-xl border border-border bg-surface/95 px-3 py-2 font-display text-xs font-bold text-primary shadow-float active:scale-95"
          aria-label="Recenter the radar on your position"
        >
          <LocateFixed className="size-4" /> Recenter
        </button>
      )}
    </div>
  );
}
