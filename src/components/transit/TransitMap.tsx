import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import L from "leaflet";
// TPulso: map rotation (compass). leafletGlobal must come first: the plugin patches the global L.
import "@/lib/leafletGlobal";
import "leaflet-rotate";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
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
import { MAP_TILES, MODE_COLORS } from "@/config";
import { clusterScreen, initialsOf, letterFor, letterOrder, shortLabel, spreadOffsets, uniqueInitials } from "@/offline/stations";
import { patternBox, positionsAt, type ActiveTrip } from "@/offline/engine";

const MODE_GLYPH: Record<Vehicle["mode"], string> = {
  bus: "BUS",
  train: "CP",
  tram: "TRM",
  ferry: "FRY",
};

const esc = (s: string) => s.replace(/[<>&"']/g, "");
const HEX = /^#[0-9a-f]{6}$/i;
const MODE_VAR: Record<TransportMode, string> = { bus: "var(--bus)", tram: "var(--tram)", train: "var(--train)", ferry: "var(--ferry)" };

/** TPulso: a stop marker on the map: a bus/tram platform (one direction) or a metro/train/ferry station
 * (src/offline/stations.ts). */
export interface MapStation {
  id: string;
  name: string;
  /** Normalised name: an area point counts its stations by name, not its platforms. */
  nameKey: string;
  kind: "platform" | "station";
  /** Platforms: direction of travel (degrees clockwise from north), shown only on the selected marker. */
  heading: number | null;
  lat: number;
  lng: number;
  /** Modes shown in the ring (already filtered by the mode filter). */
  modes: TransportMode[];
  /** Ring size in px (scaled by departures in the next 10 minutes). */
  size: number;
  /** Departures in the next 10 minutes (busier stations seed the area points). */
  departures: number;
}

/** TPulso: a stop of the selected vehicle, in its mode colour. */
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
const DIR_CHIP = `<svg viewBox="0 0 10 10" width="10" height="10"><path d="M5 1 L8.5 8.5 L5 6.6 L1.5 8.5 Z" fill="currentColor"/></svg>`;
/**
 * Ring split into one segment per mode; the icon box stays >= 28 px so it is easy to tap.
 * - `selected` (tapped, or picked in an expanded area point): highlighted; a platform also shows its direction
 *   as a small chip with an arrow (it turns with the map: --bearing).
 * - `badge`: a small badge — the letter (A, B…) of a station in an expanded area point, or the initials of a
 *   single station (unique within the radar).
 * - `withLabel`: the short name (≤ 22 characters) is in the icon, shown only when tapped or hovered (desktop),
 *   on the side toward the radar's centre (StationLayer.placeLabels). Expanded stations have none (the list).
 */
function stationIcon(s: MapStation, selected: boolean, badge?: string, withLabel = true, chip = false) {
  // `chip`: include the direction chip even when not selected (CSS shows it only on .is-selected), so a
  // selection can change by toggling a class, without a new icon.
  const heading = (selected || chip) && s.kind === "platform" && s.heading !== null ? Math.round(s.heading) : null;
  const key = `${s.modes.join(",")}|${s.size}|${selected ? 1 : 0}|${s.name}|${heading ?? ""}|${badge ?? ""}|${withLabel ? 1 : 0}`;
  const hit = stationIconCache.get(key);
  if (hit) return hit;
  const n = Math.max(1, s.modes.length);
  const ring = s.modes.length > 1
    ? `conic-gradient(${s.modes.map((m, i) => `${MODE_VAR[m]} ${(i * 100) / n}% ${((i + 1) * 100) / n}%`).join(", ")})`
    : MODE_VAR[s.modes[0] ?? "bus"];
  const box = Math.max(28, s.size + 4);
  const dir = heading !== null ? `<span class="station-dir" style="--heading:${heading}deg" aria-hidden="true">${DIR_CHIP}</span>` : "";
  const tag =
    (badge ? `<span class="station-letter">${esc(badge)}</span>` : "") +
    (withLabel ? `<span class="station-label lab-above">${esc(shortLabel(s.name))}</span>` : "");
  const icon = L.divIcon({
    className: "",
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
    html: `<div class="station${selected ? " is-selected" : ""}" style="--size:${s.size}px;--ring:${ring}"><span class="station-ring"></span><span class="station-core"></span>${dir}${tag}</div>`,
  });
  stationIconCache.set(key, icon);
  return icon;
}

const spreadIconCache = new Map<string, L.DivIcon>();
/**
 * TPulso: a station of an expanded area point, with its letter. It flies out from the area point's centre
 * (dx, dy = its offset) over 0.5 s, and back in when the area point collapses (closing). The icon never depends
 * on the selection (StationLayer toggles .is-selected on the element), and it is cached: a selection change, a
 * pan or a turn of the map only moves or restyles the marker and never replays an animation.
 */
function spreadStationIcon(s: MapStation, dx: number, dy: number, closing: boolean, letter: string) {
  const base = stationIcon(s, false, letter, false, true);
  const key = `${(base.options.html as string).length}|${base.options.html as string}|${dx}|${dy}|${closing ? 1 : 0}`;
  const hit = spreadIconCache.get(key);
  if (hit) return hit;
  if (spreadIconCache.size > 400) spreadIconCache.clear();
  const icon = L.divIcon({
    ...base.options,
    html: `<div class="spread-anim${closing ? " is-closing" : ""}" style="--fx:${-dx}px;--fy:${-dy}px">${base.options.html as string}</div>`,
  });
  spreadIconCache.set(key, icon);
  return icon;
}

const discIconCache = new Map<string, L.DivIcon>();
/** TPulso: the subtle dark disc under an expanded area point (never catches taps). Cached: never re-created. */
function spreadDiscIcon(radiusPx: number, closing: boolean) {
  const d = Math.round(radiusPx * 2);
  const key = `${d}|${closing ? 1 : 0}`;
  let icon = discIconCache.get(key);
  if (!icon) {
    icon = L.divIcon({ className: "spread-disc-marker", iconSize: [d, d], iconAnchor: [d / 2, d / 2], html: `<div class="spread-disc${closing ? " is-closing" : ""}"></div>` });
    discIconCache.set(key, icon);
  }
  return icon;
}
/** The thin line from a spread station to its real place (constant: never re-styled). */
const SPREAD_LINK_STYLE = { color: "var(--radar)", weight: 1, opacity: 0.5 };

/** Spread and collapse take this long (CSS uses the same 500 ms). */
const SPREAD_MS = 500;
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

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
    // TPulso: the pin colour comes only from the mode (src/config.ts MODE_COLORS).
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

const areaIconCache = new Map<string, L.DivIcon>();
/** Area point: a ring split into the colours of its modes, with the number of places inside. */
function areaIcon(modes: TransportMode[], count: number) {
  const key = `${modes.join(",")}|${count}`;
  const hit = areaIconCache.get(key);
  if (hit) return hit;
  const n = Math.max(1, modes.length);
  const ring = modes.length > 1
    ? `conic-gradient(${modes.map((m, i) => `${MODE_VAR[m]} ${(i * 100) / n}% ${((i + 1) * 100) / n}%`).join(", ")})`
    : MODE_VAR[modes[0] ?? "bus"];
  const icon = L.divIcon({
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    html: `<div class="station area-point" style="--size:32px;--ring:${ring}"><span class="station-ring"></span><span class="station-core"></span><span class="area-count">${count}</span></div>`,
  });
  areaIconCache.set(key, icon);
  return icon;
}

const MODE_ORDER: TransportMode[] = ["bus", "tram", "train", "ferry"];
type LabelSide = "above" | "below" | "left" | "right";

/**
 * TPulso: stations on the map in two levels. Level 1 (one marker per platform or place) comes from App; level 2
 * groups markers closer than 45 px on screen at the current zoom (deterministic, see clusterScreen):
 * - two or more different places: an area point with their number;
 * - the platforms of one place: a plain ring in the mode colour, no number.
 * Tapping either spreads its stations on a small upright circle, each with a letter (A, B…, see letterOrder),
 * and opens the station list in the side panel (onArea). A first tap on a letter (or its row) picks that
 * platform (highlighted on both); a second tap opens it. Tapping the background, zooming or selecting something
 * else collapses it; turning the map lays the letters out again. In station focus only the tapped one is shown.
 */
const StationLayer = memo(function StationLayer({
  stations,
  selectedStopId,
  onSelectStop,
  collapseKey,
  pickedId,
  onPick,
  onArea,
}: {
  stations: MapStation[];
  selectedStopId: string | null;
  onSelectStop: (id: string) => void;
  /** Changes when something else is selected (or the station list is closed): collapse the area point. */
  collapseKey: string;
  /** The platform picked in the expanded area point (map letter or list row). */
  pickedId: string | null;
  onPick: (id: string) => void;
  /** The stations of the expanded area point in letter order (null when none is expanded). */
  onArea: (ids: string[] | null) => void;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());
  /** The spread area point; `closing` while it animates back in (then it is removed). */
  const [spread, setSpread] = useState<{ key: string; closing: boolean } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const collapse = useCallback((animate: boolean) => {
    clearTimeout(closeTimer.current);
    if (!animate || reducedMotion()) {
      setSpread(null);
      return;
    }
    setSpread((cur) => (cur && !cur.closing ? { ...cur, closing: true } : cur));
    closeTimer.current = setTimeout(() => setSpread(null), SPREAD_MS);
  }, []);
  const expand = useCallback((key: string) => {
    clearTimeout(closeTimer.current);
    setSpread({ key, closing: false });
  }, []);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useMapEvents({
    zoomstart: () => collapse(false), // a zoom moves everything: no animation
    zoomend: () => setZoom(map.getZoom()),
    click: () => collapse(true), // background tap: animate back in
  });
  useEffect(() => {
    collapse(false);
  }, [collapseKey, collapse]);
  // Lay the spread out again after a pan or a turn of the map (at most once per frame while turning).
  const [layoutTick, setLayoutTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const relayout = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setLayoutTick((n) => n + 1));
    };
    map.on("rotate moveend", relayout);
    return () => {
      cancelAnimationFrame(raf);
      map.off("rotate moveend", relayout);
    };
  }, [map]);
  // While spread: vehicles and route lines fade to 25 % (CSS on the map container, transition 0.5 s).
  const spreadOpen = !!spread && !spread.closing && !selectedStopId;
  useEffect(() => {
    const el = map.getContainer();
    el.classList.toggle("map-spread", spreadOpen);
    return () => el.classList.remove("map-spread");
  }, [map, spreadOpen]);
  const expanded = spread?.key ?? null;

  const byId = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);
  // The expanded stations in letter order (same-named platforms get adjacent letters); tell App (station list).
  const spreadIds = useMemo(
    () => (expanded ? letterOrder(expanded.split(",").map((id) => byId.get(id)).filter((s): s is MapStation => !!s)).map((s) => s.id) : []),
    [expanded, byId],
  );
  const spreadIdsKey = spreadIds.join(",");
  useEffect(() => {
    onArea(spreadOpen && spreadIdsKey ? spreadIdsKey.split(",") : null);
  }, [spreadOpen, spreadIdsKey, onArea]);

  // A single label (tapped marker, or hovered on desktop), on the side toward the radar's centre so it never
  // crosses the ring; if that side has no room, the next side toward the centre. The direction chip of a
  // tapped platform goes on the other side (data-lab on the marker).
  const placeLabels = useCallback(
    (only?: Element) => {
      const container = map.getContainer();
      const root = container.parentElement;
      if (!root) return;
      const cs = getComputedStyle(root);
      const box = root.getBoundingClientRect();
      const cx = box.left + parseFloat(cs.getPropertyValue("--x")), cy = box.top + parseFloat(cs.getPropertyValue("--y"));
      const r = parseFloat(cs.getPropertyValue("--r"));
      if (!(r > 0)) return;
      const labels = only ? [only] : [...container.querySelectorAll(".station.is-selected .station-label")];
      for (const el of labels as HTMLElement[]) {
        const st = el.parentElement as HTMLElement;
        const m = st.getBoundingClientRect();
        const vx = cx - (m.left + m.width / 2), vy = cy - (m.top + m.height / 2);
        const h: LabelSide = vx >= 0 ? "right" : "left", v: LabelSide = vy >= 0 ? "below" : "above";
        const opp = { left: "right", right: "left", above: "below", below: "above" } as const;
        const order: LabelSide[] = Math.abs(vx) >= Math.abs(vy) ? [h, v, opp[v], opp[h]] : [v, h, opp[h], opp[v]];
        const inside = () => {
          const b = el.getBoundingClientRect();
          return [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]].every(([x, y]) => Math.hypot(x! - cx, y! - cy) <= r - 3);
        };
        let chosen = order[0]!;
        for (const side of order) {
          el.className = `station-label lab-${side}`;
          if (inside()) {
            chosen = side;
            break;
          }
        }
        el.className = `station-label lab-${chosen}`;
        st.dataset.lab = chosen;
      }
    },
    [map],
  );
  useLayoutEffect(() => {
    placeLabels();
    const again = () => placeLabels();
    map.on("moveend zoomend rotate resize", again);
    return () => {
      map.off("moveend zoomend rotate resize", again);
    };
  }, [map, placeLabels, selectedStopId, stations]);
  const hoverHandlers = useMemo(
    () => ({
      mouseover: (e: L.LeafletMouseEvent) => {
        const el = (e.target as L.Marker).getElement()?.querySelector(".station-label");
        if (el) placeLabels(el);
      },
    }),
    [placeLabels],
  );

  const clusters = useMemo(() => {
    const pts = stations.map((s) => {
      const p = map.project([s.lat, s.lng], zoom);
      return { id: s.id, x: p.x, y: p.y, weight: s.departures };
    });
    return clusterScreen(pts);
  }, [stations, zoom, map]);

  // Initials badges of the single (non-expanded) markers, unique within the radar: busiest first keep theirs.
  const badges = useMemo(() => {
    const singles: { key: string; name: string; weight: number }[] = [];
    for (const c of clusters) {
      const members = c.members.map((id) => byId.get(id)).filter((m): m is MapStation => !!m);
      if (!members.length) continue;
      if (members.length === 1 || new Set(members.map((m) => m.name)).size === 1) {
        singles.push({ key: members.length === 1 ? members[0]!.id : c.members.join(","), name: members[0]!.name, weight: members.reduce((n, m) => n + m.departures, 0) });
      }
    }
    singles.sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
    const ini = uniqueInitials(singles.map((x) => x.name));
    return new Map(singles.map((x, i) => [x.key, ini[i]!]));
  }, [clusters, byId]);

  // The spread's geometry: recomputed only when the map moves or turns (layoutTick), never on a selection.
  const geom = useMemo(() => {
    if (!expanded) return null;
    const c = clusters.find((x) => x.members.join(",") === expanded);
    if (!c) return null;
    const centre = map.unproject([c.x, c.y], zoom);
    const ordered = spreadIds.map((id) => byId.get(id)).filter((st): st is MapStation => !!st);
    const offsets = spreadOffsets(ordered.length);
    const cp = map.latLngToContainerPoint(centre);
    return {
      centre,
      ringR: Math.max(...offsets.map((o) => Math.hypot(o.dx, o.dy))),
      items: ordered.map((st, i) => {
        const pos = map.containerPointToLatLng([cp.x + offsets[i]!.dx, cp.y + offsets[i]!.dy]);
        return { st, letter: letterFor(i), ...offsets[i]!, pos, link: [[st.lat, st.lng], pos] as L.LatLngExpression[] };
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, spreadIds, byId, clusters, zoom, map, layoutTick]);
  const pickHandlers = useMemo(
    () => new Map((geom?.items ?? []).map((it) => [it.st.id, { click: () => onPick(it.st.id) }])),
    [geom, onPick],
  );
  // The selection is a class on the existing marker elements (CSS transitions do the rest): no new icons.
  const spreadMarkers = useRef(new Map<string, L.Marker>());
  const closingNow = spread?.closing ?? false;
  // An effect (not a layout effect): react-leaflet adds the markers to the map in its own effects, which run first.
  useEffect(() => {
    for (const [id, m] of spreadMarkers.current) {
      m.getElement()?.querySelector(".station")?.classList.toggle("is-selected", id === pickedId);
      m.setZIndexOffset(id === pickedId ? 3500 : 3000);
    }
  }, [pickedId, geom, closingNow]);

  // Station focus: only the tapped station.
  if (selectedStopId) {
    const s = byId.get(selectedStopId);
    return s ? (
      <Marker position={[s.lat, s.lng]} icon={stationIcon(s, true, badges.get(s.id) ?? initialsOf(s.name))} zIndexOffset={800} eventHandlers={{ click: () => onSelectStop(s.id) }} />
    ) : null;
  }
  return (
    <>
      {clusters.map((c) => {
        const members = c.members.map((id) => byId.get(id)!).filter(Boolean);
        if (members.length === 1) {
          const s = members[0]!;
          return (
            <Marker key={s.id} position={[s.lat, s.lng]} icon={stationIcon(s, false, badges.get(s.id))} riseOnHover eventHandlers={{ click: () => onSelectStop(s.id), ...hoverHandlers }} />
          );
        }
        const key = c.members.join(",");
        const centre = map.unproject([c.x, c.y], zoom);
        if (expanded !== key) {
          const places = new Set(members.map((s) => s.name)).size; // platforms of one place share its name
          const modes = MODE_ORDER.filter((m) => members.some((s) => s.modes.includes(m)));
          if (places === 1) {
            // One place, several platforms: a plain ring (no number); tapping it lets you pick the direction.
            const first = members[0]!;
            const ring: MapStation = { ...first, modes, kind: "station", heading: null, size: Math.max(...members.map((s) => s.size)) };
            return (
              <Marker key={`place-${key}`} position={centre} icon={stationIcon(ring, false, badges.get(key))} riseOnHover zIndexOffset={100} eventHandlers={{ click: () => expand(key), ...hoverHandlers }} />
            );
          }
          return (
            <Marker
              key={`area-${key}`}
              position={centre}
              icon={areaIcon(modes, places)}
              title={`${places} stations`}
              zIndexOffset={100}
              eventHandlers={{ click: () => expand(key) }}
            />
          );
        }
        // Spread: each station on a small upright circle around the area point (screen pixels, laid out again
        // when the map pans or turns), with a thin line to its real place, over a subtle dark disc. Letters only:
        // the names are in the station list. Stations fly out (and back in). Stable keys, icons and props: a
        // selection change re-creates nothing (see the layout effect above).
        if (!geom) return null;
        const closing = spread!.closing;
        return (
          <Fragment key={`spread-${key}`}>
            <Marker position={geom.centre} icon={spreadDiscIcon(geom.ringR + 30, closing)} interactive={false} keyboard={false} zIndexOffset={2000} />
            {geom.items.map((it) => (
              <Fragment key={`spread-${it.st.id}`}>
                {/* keyed by phase: the line is re-created only to play its fade-out on collapse */}
                <Polyline
                  key={closing ? "out" : "in"}
                  positions={it.link}
                  className={`spread-link${closing ? " is-closing" : ""}`}
                  pathOptions={SPREAD_LINK_STYLE}
                  interactive={false}
                />
                <Marker
                  ref={(m) => {
                    if (m) spreadMarkers.current.set(it.st.id, m);
                    else spreadMarkers.current.delete(it.st.id);
                  }}
                  position={it.pos}
                  icon={spreadStationIcon(it.st, it.dx, it.dy, closing, it.letter)}
                  zIndexOffset={3000}
                  eventHandlers={pickHandlers.get(it.st.id)!}
                />
              </Fragment>
            ))}
          </Fragment>
        );
      })}
    </>
  );
});

/** What the animation loop shows: exact keys (a focus), or everything of the mode filter inside the radar + margin. */
export interface VehicleFilter {
  /** Only these trip keys (focus modes); null = all within the radar + margin. */
  keys: ReadonlySet<string> | null;
  mode: FilterMode;
}

/**
 * TPulso: one requestAnimationFrame loop for all vehicles. Each frame it computes every active trip's expected
 * position from the clock (arc length along the shape, eased around stops — see engine.positionOf) and moves the
 * Leaflet markers imperatively with setLatLng: no React re-render per frame and no CSS transition. In a test ride
 * it sets the camera from the ridden vehicle's position in the same frame, so markers and map never drift apart.
 * Only vehicles inside the radar plus a margin are animated. Paused while the tab is hidden.
 */
function VehicleAnimator({
  trips,
  clock,
  filter,
  radius,
  rideKey,
  headingUp,
  onSelect,
  operatorName,
}: {
  trips: readonly ActiveTrip[];
  clock: () => number;
  filter: VehicleFilter;
  radius: number;
  rideKey: string | null;
  /** Test ride: turn the map so the ridden vehicle's direction of travel points up. */
  headingUp: boolean;
  onSelect: (key: string) => void;
  operatorName: (op: string) => string;
}) {
  const map = useMap();
  const state = useRef({ trips, clock, filter, radius, rideKey, headingUp, onSelect, operatorName });
  state.current = { trips, clock, filter, radius, rideKey, headingUp, onSelect, operatorName };

  useEffect(() => {
    const markers = new Map<string, L.Marker>();
    let raf = 0;
    let lastTs = -Infinity;
    let prevTs = performance.now();
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(100, ts - prevTs);
      prevTs = ts;
      if (document.hidden) return;
      const { trips: list, clock: now, filter: f, radius: r, rideKey: ride, headingUp: hu } = state.current;
      // Vehicles move a few metres per second: 20 updates a second look the same as 60 and cost a third.
      // A ride's camera follows its vehicle every frame.
      if (!ride && ts - lastTs < 50) return;
      lastTs = ts;
      const t = now();
      const centre = map.getCenter();
      const k = Math.cos((centre.lat * Math.PI) / 180);
      const margin = r * 1.3; // radar + margin
      const dLat = margin / 111_320, dLng = margin / (111_320 * k);
      // Only trips whose shape comes near the radar (or the focused / ridden ones) are computed.
      const near = list.filter((at) => {
        if (at.key === ride) return true;
        if (f.keys) return f.keys.has(at.key);
        if (f.mode !== "all" && f.mode !== at.p.mode) return false;
        const b = patternBox(at.p);
        return b[0] <= centre.lat + dLat && b[2] >= centre.lat - dLat && b[1] <= centre.lng + dLng && b[3] >= centre.lng - dLng;
      });
      let shownList = positionsAt(near, t).map((v) => ({ v, d: Math.hypot((v.lat - centre.lat) * 111_320, (v.lng - centre.lng) * 111_320 * k) }));
      if (!f.keys) shownList = shownList.filter((x) => x.d <= margin || x.v.key === ride);
      // Cap the DOM markers: the nearest ones (the ridden one always) when a busy area has too many.
      if (shownList.length > MAX_VEHICLE_MARKERS) shownList = shownList.sort((a, b) => (a.v.key === ride ? -1 : b.v.key === ride ? 1 : a.d - b.d)).slice(0, MAX_VEHICLE_MARKERS);
      const seen = new Set<string>();
      for (const { v } of shownList) {
        if (v.key === ride) {
          // Heading up: ease the map's rotation towards the direction of travel (time constant 0.35 s, so
          // the turn at a corner or stop is smooth). Then the camera: same computed position, same frame.
          if (hu) {
            const cur = map.getBearing();
            const d = normDeg(-v.bearing - cur);
            if (Math.abs(d) > 0.2) map.setBearing(cur + d * (1 - Math.exp(-dt / 350)));
          }
          // panBy (not setView) keeps Leaflet from re-projecting every layer each frame.
          const p = map.latLngToContainerPoint([v.lat, v.lng]);
          const c = map.getSize().divideBy(2);
          if (Math.abs(p.x - c.x) + Math.abs(p.y - c.y) > 0.5) map.panBy([p.x - c.x, p.y - c.y], { animate: false });
        }
        seen.add(v.key);
        const m = markers.get(v.key);
        if (m) m.setLatLng([v.lat, v.lng]);
        else {
          const veh: Vehicle = {
            id: v.key, mode: v.mode, line: v.line, operator: state.current.operatorName(v.op), headsign: v.headsign,
            lat: v.lat, lng: v.lng, bearing: v.bearing, speedKmh: NaN, punctualityMin: NaN, routeId: String(v.patternId), tripId: v.key,
          };
          const marker = L.marker([v.lat, v.lng], {
            icon: vehicleIcon(veh),
            title: `${v.line} → ${v.headsign || "—"} · Expected position (timetable)`,
            zIndexOffset: v.key === ride ? 1500 : 600,
          });
          marker.on("click", () => state.current.onSelect(v.key));
          marker.addTo(map);
          markers.set(v.key, marker);
        }
      }
      for (const [key, m] of markers) {
        if (!seen.has(key)) {
          m.remove();
          markers.delete(key);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      for (const m of markers.values()) m.remove();
      markers.clear();
    };
  }, [map]);
  return null;
}

/** At most this many vehicle markers in the DOM (the nearest to the radar centre). */
const MAX_VEHICLE_MARKERS = 60;

/** Return to the user's position this long after the last drag/zoom/touch ends. */
export const AUTO_RECENTER_MS = 1_000;
/** Duration of the return animation (seconds). */
const RECENTER_ANIM_S = 0.4;

/**
 * TPulso: the radar circle is a screen overlay at the map's centre; the map pans freely under it.
 * - Radius change: zoom so the circle (radius in metres at the map centre) fits on screen.
 * - Drag / pinch / wheel: the map moves; the radar is computed for the new map centre (onCenter).
 * - 1 s after the interaction ends (incl. the fling), the map glides back to the user (0.4 s), unless a vehicle
 *   or stop is selected. Any new touch, drag or zoom cancels the timer; it restarts when that interaction ends.
 * - The Recenter button (recenterSignal) returns immediately.
 */
function MapController({
  userPos,
  radius,
  recenterSignal,
  autoRecenter,
  follow,
  onCenter,
}: {
  userPos: LatLng;
  radius: number;
  recenterSignal: number;
  autoRecenter: boolean;
  /** Test ride: the camera is driven by the animation loop (it follows the vehicle every frame). */
  follow: boolean;
  onCenter: (c: LatLng) => void;
}) {
  const map = useMap();
  const latest = useRef({ userPos, radius, autoRecenter, onCenter });
  latest.current = { userPos, radius, autoRecenter, onCenter };
  /** The user has moved the map away (by hand) since the last return. */
  const exploring = useRef(false);
  /** A finger or mouse button is down on the map. */
  const pressed = useRef(false);
  const idle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fitAt = useCallback(
    (c: LatLng, glide: boolean) => {
      // The zoom at which the circle (radius in metres) fits the shorter side with 28 px to spare. Computed from
      // metres per pixel rather than with fitBounds, which would fit the *rotated* square when the map is turned.
      const size = map.getSize();
      const rPx = Math.max(40, Math.min(size.x, size.y) / 2 - 28);
      const z = Math.log2((156_543.034 * Math.cos((c.lat * Math.PI) / 180) * rPx) / latest.current.radius);
      if (glide) map.flyTo([c.lat, c.lng], z, { duration: RECENTER_ANIM_S });
      else map.setView([c.lat, c.lng], z, { animate: true });
    },
    [map],
  );
  const home = useCallback(
    (glide: boolean) => {
      clearTimeout(idle.current);
      exploring.current = false;
      fitAt(latest.current.userPos, glide);
    },
    [fitAt],
  );
  const cancel = useCallback(() => clearTimeout(idle.current), []);
  /** Start (or restart) the 1 s countdown — only when nothing is pressed and returning is allowed. */
  const schedule = useCallback(() => {
    clearTimeout(idle.current);
    if (pressed.current || !exploring.current) return;
    idle.current = setTimeout(() => {
      if (latest.current.autoRecenter && !pressed.current) home(true);
    }, AUTO_RECENTER_MS);
  }, [home]);

  // Radius change: fit the circle around the point currently under it.
  useEffect(() => {
    fitAt(exploring.current ? map.getCenter() : latest.current.userPos, false);
  }, [radius, fitAt, map]);
  // New position: follow it only while not exploring. During a test ride the animation loop sets the camera
  // every frame from the vehicle's computed position, so nothing is animated here (no fighting the markers).
  useEffect(() => {
    if (follow) {
      exploring.current = false;
      return;
    }
    if (!exploring.current) map.panTo([userPos.lat, userPos.lng], { animate: true });
  }, [userPos.lat, userPos.lng, map, follow]);
  // Recenter button: immediately.
  useEffect(() => {
    if (recenterSignal > 0) home(true);
  }, [recenterSignal, home]);

  useEffect(() => {
    const el = map.getContainer();
    const report = () => {
      const c = map.getCenter();
      latest.current.onCenter({ lat: c.lat, lng: c.lng });
    };
    // Interaction starts: cancel the countdown.
    const down = () => {
      pressed.current = true;
      cancel();
    };
    // Interaction ends (finger/button released): count down — restarted again if a fling is still moving.
    const up = () => {
      if (!pressed.current) return;
      pressed.current = false;
      schedule();
    };
    // Dragging or zooming by hand means the user is exploring.
    const byHand = () => {
      exploring.current = true;
      cancel();
    };
    // A zoom that starts while a finger is down is a pinch by hand.
    const pinch = () => {
      if (pressed.current) byHand();
    };
    const wheel = () => {
      exploring.current = true;
      schedule(); // each wheel step restarts the countdown
    };
    // A move that ends while the user is exploring (e.g. end of the fling or of a pinch) restarts the countdown.
    const moveEnd = () => {
      if (exploring.current) schedule();
    };
    // Reported when a move ends (not on every frame of a drag or pinch): the radar contents, stations and
    // clusters are recomputed once the map stops.
    map.on("moveend", report);
    map.on("dragstart drag", byHand);
    map.on("zoomstart", pinch);
    map.on("moveend zoomend", moveEnd);
    el.addEventListener("pointerdown", down);
    el.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("touchend", up);
    el.addEventListener("wheel", wheel, { passive: true });
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    report();
    return () => {
      cancel();
      map.off("moveend", report);
      map.off("dragstart drag", byHand);
      map.off("zoomstart", pinch);
      map.off("moveend zoomend", moveEnd);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("touchstart", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("touchend", up);
      el.removeEventListener("wheel", wheel);
      ro.disconnect();
    };
  }, [map, cancel, schedule]);

  // Focus mode (vehicle or stop selected) pauses the return; when released, count down again.
  useEffect(() => {
    if (autoRecenter) schedule();
    else cancel();
  }, [autoRecenter, schedule, cancel]);
  return null;
}

interface Props {
  /** Radar centre (the map centre, debounced). */
  center: LatLng;
  /** The user's real position (or the TEST point): the blue dot, and where Recenter goes. */
  userPos: LatLng;
  /** Map centre changes (when a pan or zoom ends). */
  onMapCenter: (c: LatLng) => void;
  /** Automatic return after the interaction ends is allowed (not while a vehicle or stop is selected, or riding). */
  autoRecenter: boolean;
  /** Test ride: the map follows the ridden vehicle and the user dot is hidden (the vehicle is the user). */
  riding: boolean;
  /** Animation: active trips, the (ride) clock, which vehicles to show, and the ridden trip. */
  trips: readonly ActiveTrip[];
  clock: () => number;
  vehicleFilter: VehicleFilter;
  rideKey: string | null;
  /** Test ride: the ridden vehicle's direction of travel points up (off by default). */
  headingUp: boolean;
  operatorName: (op: string) => string;
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
  /** Stops of the selected vehicle (passed / next / upcoming), in its mode colour. */
  routeStops: RouteStopMarker[];
  /** Tapping a station opens its departures. */
  onSelectStop: (id: string) => void;
  /** The tapped station (yellow), if any. */
  selectedStopId: string | null;
  /** Incremented by the top bar's recentre button. */
  recenterRequest: number;
  /** Expanded area point: the platform picked (map letter or list row), and the station list (letter order). */
  pickedId: string | null;
  onPick: (id: string) => void;
  onArea: (ids: string[] | null) => void;
  /** Incremented when the station list is closed: collapse the area point. */
  areaCloseRequest: number;
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

/** TPulso: the radar overlay sits at the screen centre; its radius is `radius` metres at the map centre. */
function SonarGeometry({
  radius,
  disc,
  root,
  steer,
}: {
  radius: number;
  disc: RefObject<HTMLDivElement | null>;
  root: RefObject<HTMLDivElement | null>;
  steer: RefObject<SVGCircleElement | null>;
}) {
  const map = useMap();
  useEffect(() => {
    const update = () => {
      const size = map.getSize();
      const c = map.getCenter();
      const p = map.latLngToContainerPoint(c);
      // A point `radius` metres due north: its screen distance is the circle's radius, at any rotation.
      const north = map.latLngToContainerPoint([c.lat + radius / 111_320, c.lng]);
      const x = size.x / 2, y = size.y / 2, r = Math.hypot(p.x - north.x, p.y - north.y);
      // Written straight to the overlay elements (no React render on zoom frames). The bezel and the compass
      // read --x/--y/--r from the root element.
      const d = disc.current;
      if (d) Object.assign(d.style, { left: `${x - r}px`, top: `${y - r}px`, width: `${r * 2}px`, height: `${r * 2}px` });
      const el = root.current;
      if (el) {
        el.style.setProperty("--x", `${x}px`);
        el.style.setProperty("--y", `${y}px`);
        el.style.setProperty("--r", `${r}px`);
      }
      // The steering band: centred 14 px outside the rim (44 px wide: from 8 px inside the circle to the bezel).
      const st = steer.current;
      if (st) {
        st.setAttribute("cx", String(x));
        st.setAttribute("cy", String(y));
        st.setAttribute("r", String(r + 14));
      }
    };
    update();
    // Only zoom, resize and the end of a move change it — never every frame of a move.
    map.on("zoom zoomanim resize viewreset moveend", update);
    return () => {
      map.off("zoom zoomanim resize viewreset moveend", update);
    };
  }, [map, radius, disc, root, steer]);
  return null;
}

/** Angle difference folded into -180..180 degrees. */
const normDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
/** Rotation is ignored until two fingers have turned this far (so a pinch does not wobble the map). */
const TWIST_DEAD_ZONE_DEG = 12;

/**
 * TPulso: compass on the radar ring. N/E/S/W turn with the map (N highlighted); markers and labels stay
 * upright (leaflet-rotate). Rotate by dragging along the ring, or with a two-finger twist on the map; one finger
 * inside the circle still pans. Tapping N turns the map back to north (0.3 s).
 */
function Compass({ map, root, steer }: { map: L.Map | null; root: RefObject<HTMLDivElement | null>; steer: RefObject<SVGCircleElement | null> }) {
  const anim = useRef(0);
  // The ring follows the map's rotation (CSS var on the root; the bezel ticks and the letters use it).
  useEffect(() => {
    if (!map) return;
    const set = () => root.current?.style.setProperty("--bearing", `${map.getBearing()}deg`);
    set();
    map.on("rotate", set);
    return () => {
      map.off("rotate", set);
    };
  }, [map, root]);
  // Steering: drag along the ring.
  useEffect(() => {
    const c = steer.current;
    if (!map || !c) return;
    let start: { a: number; b: number; id: number } | null = null;
    const angle = (e: PointerEvent) => {
      const box = root.current!.getBoundingClientRect();
      const size = map.getSize();
      return (Math.atan2(e.clientY - box.top - size.y / 2, e.clientX - box.left - size.x / 2) * 180) / Math.PI;
    };
    const down = (e: PointerEvent) => {
      cancelAnimationFrame(anim.current);
      start = { a: angle(e), b: map.getBearing(), id: e.pointerId };
      c.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (start && e.pointerId === start.id) map.setBearing(start.b + normDeg(angle(e) - start.a));
    };
    const up = (e: PointerEvent) => {
      if (start?.id === e.pointerId) start = null;
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
    };
  }, [map, root, steer]);
  // Two-finger twist on the map (the pinch zoom keeps working alongside).
  useEffect(() => {
    if (!map) return;
    const el = map.getContainer();
    let t: { a: number; b: number; on: boolean } | null = null;
    const ang = (e: TouchEvent) => {
      const p = e.touches[0]!, q = e.touches[1]!;
      return (Math.atan2(q.clientY - p.clientY, q.clientX - p.clientX) * 180) / Math.PI;
    };
    const startT = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        cancelAnimationFrame(anim.current);
        t = { a: ang(e), b: map.getBearing(), on: false };
      } else t = null;
    };
    const moveT = (e: TouchEvent) => {
      if (!t || e.touches.length !== 2) return;
      let d = normDeg(ang(e) - t.a);
      if (!t.on) {
        if (Math.abs(d) < TWIST_DEAD_ZONE_DEG) return;
        t.on = true;
        t.a += Math.sign(d) * TWIST_DEAD_ZONE_DEG; // start turning from here, without a jump
        d = normDeg(ang(e) - t.a);
      }
      map.setBearing(t.b + d);
    };
    const endT = (e: TouchEvent) => {
      if (e.touches.length < 2) t = null;
    };
    el.addEventListener("touchstart", startT, { passive: true });
    el.addEventListener("touchmove", moveT, { passive: true });
    el.addEventListener("touchend", endT, { passive: true });
    el.addEventListener("touchcancel", endT, { passive: true });
    return () => {
      el.removeEventListener("touchstart", startT);
      el.removeEventListener("touchmove", moveT);
      el.removeEventListener("touchend", endT);
      el.removeEventListener("touchcancel", endT);
    };
  }, [map]);
  useEffect(() => () => cancelAnimationFrame(anim.current), []);

  const resetNorth = () => {
    if (!map) return;
    cancelAnimationFrame(anim.current);
    const from = normDeg(map.getBearing());
    if (from === 0) return;
    if (reducedMotion()) return void map.setBearing(0);
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 300);
      map.setBearing(from * (1 - (1 - (1 - k) ** 3))); // ease-out, 0.3 s
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };

  return (
    <div className="compass">
      <svg className="compass-steer" aria-hidden>
        <circle ref={steer} />
      </svg>
      {(["N", "E", "S", "W"] as const).map((l, i) =>
        l === "N" ? (
          <button key={l} type="button" className="compass-letter is-north" style={{ "--a": "0deg" } as React.CSSProperties} onClick={resetNorth} aria-label="Turn the map to north up" title="North up">
            N
          </button>
        ) : (
          <span key={l} className="compass-letter" style={{ "--a": `${i * 90}deg` } as React.CSSProperties} aria-hidden>
            {l}
          </span>
        ),
      )}
    </div>
  );
}

/**
 * TPulso: route line styles (colours from src/config.ts). Constant objects, so react-leaflet never re-styles
 * a line just because the map re-rendered.
 */
const ROUND = { lineCap: "round", lineJoin: "round" } as const;
const perMode = <T,>(f: (m: TransportMode) => T) =>
  Object.fromEntries((["bus", "tram", "train", "ferry"] as const).map((m) => [m, f(m)])) as Record<TransportMode, T>;
const LINE_STYLE = {
  base: perMode((m) => ({ weight: 2.5, opacity: 0.35, color: MODE_COLORS[m], ...ROUND })),
  casing: [false, true].map((sel) => ({ weight: sel ? 8 : 6, opacity: 0.7, color: "#0b0f19", ...ROUND })),
  route: [false, true].map((sel) => perMode((m) => ({ weight: sel ? 4 : 3, opacity: sel ? 0.9 : 0.75, color: MODE_COLORS[m], ...ROUND }))),
};

export default memo(function TransitMap({
  center,
  userPos,
  onMapCenter,
  autoRecenter,
  riding,
  trips,
  clock,
  vehicleFilter,
  rideKey,
  headingUp,
  operatorName,
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
  pickedId,
  onPick,
  onArea,
  areaCloseRequest,
  baseLines,
}: Props) {
  const discRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const steerRef = useRef<SVGCircleElement>(null);
  const [leafletMap, setLeafletMap] = useState<L.Map | null>(null);
  // One canvas for all route lines (cheaper than hundreds of SVG paths; smoothFactor stays 0).
  const lineRenderer = useMemo(() => L.canvas({ padding: 0.3 }), []);
  // Recenter shows while the radar centre (map centre) is away from the user.
  const away = Math.hypot((center.lat - userPos.lat) * 111_320, (center.lng - userPos.lng) * 111_320 * Math.cos((center.lat * Math.PI) / 180)) > 25;
  const [recenterSignal, setRecenterSignal] = useState(0);
  useEffect(() => {
    if (recenterRequest > 0) setRecenterSignal((n) => n + 1);
  }, [recenterRequest]);
  const selected = selectedId ? vehicles.find((v) => v.id === selectedId) : undefined;

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
    <div ref={rootRef} className="relative h-full w-full">
    <MapContainer
      ref={setLeafletMap}
      // TPulso: rotation (leaflet-rotate); our own twist handler and compass replace its touch rotate and control.
      rotate
      bearing={0}
      touchRotate={false}
      rotateControl={false}
      shiftKeyRotate
      zoomSnap={0}
      center={[center.lat, center.lng]}
      zoom={16}
      zoomControl={false}
      // TPulso: the map pans and zooms freely under the screen-fixed radar.
      scrollWheelZoom={true}
      doubleClickZoom={false}
      touchZoom={true}
      dragging={true}
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
      <MapController userPos={userPos} radius={radius} recenterSignal={recenterSignal} autoRecenter={autoRecenter && !riding} follow={riding} onCenter={onMapCenter} />
      <ClearOnMapClick onClear={clear} />


      {!riding && <Marker position={[userPos.lat, userPos.lng]} icon={locateIcon} zIndexOffset={1000}>
        <Popup>
          <strong className="font-display">{hasGps ? "You are here" : "TEST location"}</strong>
          <div className="text-muted-foreground">
            {hasGps ? `${userPos.lat.toFixed(5)}, ${userPos.lng.toFixed(5)}` : "Not your real position"}
          </div>
        </Popup>
      </Marker>}

      {/* TPulso: the selected vehicle's stops in its mode colour — passed dimmed, next larger with a ring. */}
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

      {/* TPulso: stations (level 1) grouped into area points on screen (level 2); station focus shows one. */}
      {!selected && !focusStop && (
        <StationLayer stations={stations} selectedStopId={selectedStopId} onSelectStop={onSelectStop} collapseKey={`${selectedId ?? ""}|${selectedStopId ?? ""}|${areaCloseRequest}`}
          pickedId={pickedId}
          onPick={onPick}
          onArea={onArea}
        />
      )}

      {/* TPulso: whole lines (first stop to terminus), never clipped to the radar or to map areas. */}
      {!selected && !selectedStopId && baseLines.map((r) => (
        <Polyline
          key={`base-${r.id}`}
          positions={r.path}
          pathOptions={LINE_STYLE.base[r.mode]}
          smoothFactor={0}
          renderer={lineRenderer}
          interactive={false}
        />
      ))}
      {/* Dark outline under each line so every line colour (e.g. grey Carris lines) stays readable on the map. */}
      {activeRoutes.map((r) => (
        <Polyline
          key={`casing-${r.id}`}
          positions={r.path}
          pathOptions={LINE_STYLE.casing[selected ? 1 : 0]}
          smoothFactor={0}
          renderer={lineRenderer}
          interactive={false}
        />
      ))}
      {activeRoutes.map((r) => (
        <Polyline
          key={`route-${r.id}`}
          positions={r.path}
          pathOptions={LINE_STYLE.route[selected ? 1 : 0]![r.mode]}
          smoothFactor={0}
          renderer={lineRenderer}
          interactive={false}
        />
      ))}

      {/* TPulso: vehicles are animated imperatively by one requestAnimationFrame loop (no React per frame). */}
      <VehicleAnimator
        trips={trips}
        clock={clock}
        filter={vehicleFilter}
        radius={radius}
        rideKey={rideKey}
        headingUp={headingUp}
        onSelect={onSelect}
        operatorName={operatorName}
      />
      <SonarGeometry radius={radius} disc={discRef} root={rootRef} steer={steerRef} />
    </MapContainer>
      {/* TPulso: the radar disc and bezel are a screen overlay; they never capture drags or taps. */}
      <div ref={discRef} className="radar-disc" aria-hidden />
      <div className="sonar-bezel" aria-hidden />
      <Compass map={leafletMap} root={rootRef} steer={steerRef} />
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
});
