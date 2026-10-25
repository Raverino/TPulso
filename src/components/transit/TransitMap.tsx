// Ported from the original OV Pulse TransitMap.tsx: radar circle, sonar bezel, snap-back
// recentre, dark tiles, vehicle pins, upcoming-stop and countdown markers, clipped route line.
// Changes: TML data, the Live/Stale source badge on every vehicle, stops inside the radar shown.
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import type { StopLite, Vehicle } from '../../../shared/types';
import { agoLabel, countdownLabel, SOURCE_TEXT, vehicleSource } from '@/lib/sourceStatus';
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

function upcomingIcon(name: string, label: string | null) {
  return L.divIcon({
    className: '',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    html: `<div class="upcoming-stop" title="${esc(name)}">${label ? `<span class="upcoming-eta lift">${esc(label)}</span>` : ''}</div>`,
  });
}

const locateIcon = L.divIcon({
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  html: `<div class="locate-dot"></div>`,
});

function Recenter({ center, radius }: { center: LatLng; radius: number }) {
  const map = useMap();
  useEffect(() => {
    // Fit the radar circle snugly inside the sonar screen.
    const home = () =>
      map.fitBounds(L.latLng(center.lat, center.lng).toBounds(radius * 2), { padding: [28, 28], animate: true });
    home();
    // Always spring back to the radar view after the user drags or zooms.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const snapBack = () => {
      clearTimeout(timer);
      timer = setTimeout(home, 400);
    };
    map.on('dragend', snapBack);
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      home();
    });
    ro.observe(map.getContainer());
    return () => {
      clearTimeout(timer);
      map.off('dragend', snapBack);
      ro.disconnect();
    };
  }, [center.lat, center.lng, radius, map]);
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
  now,
}: Props) {
  const [geo, setGeo] = useState({ x: 0, y: 0, r: 0 });
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
        attributionControl
        className="h-full w-full"
      >
        <TileLayer
          className="tiles-dark"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors · Carris Metropolitana"
          maxZoom={19}
        />
        <Recenter center={center} radius={radius} />
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
              <Marker key={s.id} position={[s.lat, s.lng]} icon={stopIcon}>
                <Popup>
                  <strong className="font-display">{s.name}</strong>
                  <div className="text-muted-foreground">Bus stop · {Math.round(s.distance)} m</div>
                </Popup>
              </Marker>
            ))}

        {upcomingStops.map(u => (
          <Marker
            key={u.key}
            position={[u.lat, u.lng]}
            icon={upcomingIcon(u.name, u.estimatedAt !== null ? countdownLabel(u.estimatedAt, nowSec, 'live') : null)}
            zIndexOffset={500}
          >
            <Popup>
              <strong className="font-display">{u.name}</strong>
              <div className="text-muted-foreground">
                {u.estimatedAt !== null ? `Live estimate ${countdownLabel(u.estimatedAt, nowSec, 'live')}` : 'No live time for this stop'}
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
    </div>
  );
}
