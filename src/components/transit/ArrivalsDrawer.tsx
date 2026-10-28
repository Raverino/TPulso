import { memo, useEffect, useRef, useState, type UIEvent } from "react";
import { useClock } from "@/lib/clock";
import { MODE_COLORS } from "@/config";
import {
  ArrowLeft,
  Bus,
  CircleHelp,
  Download,
  Footprints,
  Gauge,
  ListOrdered,
  MapPin,
  Pin,
  PinOff,
  Radio,
  Ship,
  TrainFront,
  TramFront,
} from "lucide-react";
import {
  MODE_LABEL,
  clock,
  isUnknownRoute,
  type Arrival,
  type LiveDeparture,
  type Pinned,
  type TransitRoute,
  type TransportMode,
  type UpcomingStop,
  type Vehicle,
} from "@/lib/transit";
// TPulso: data-source display rule (CLAUDE.md).
import { SourceDot } from "@/components/SourceDot";
import { agoLabel, countdownLabel, SOURCE_TEXT, type SourceState } from "@/lib/sourceStatus";
import type { OperatorInfo } from "../../../shared/timetable";
import type { ServiceAlert } from "../../../shared/alerts";
import { AlertNote, AlertsPanel, VehicleAlerts, type AlertsView } from "./AlertsPanel";

const ICONS: Record<TransportMode, typeof Bus> = {
  bus: Bus,
  train: TrainFront,
  tram: TramFront,
  ferry: Ship,
};

const DOT: Record<TransportMode, string> = {
  bus: "bg-bus",
  train: "bg-train",
  tram: "bg-tram",
  ferry: "bg-ferry",
};

/** TPulso: a departure's source state. Board rows older than this are Stale. */
const BOARD_STALE_AFTER_S = 90;
function depState(realtime: boolean | undefined, boardAgeSec: number): "live" | "scheduled" | "stale" {
  if (boardAgeSec > BOARD_STALE_AFTER_S) return "stale";
  return realtime ? "live" : "scheduled";
}

/** TPulso: delay as text with an arrow, never by changing the source colour. */
function DelayText({ delayMin }: { delayMin: number }) {
  if (delayMin === 0) return <span className="text-accent">on time</span>;
  return delayMin > 0 ? (
    <span className="text-destructive" aria-label={`${delayMin} min late`}>▲ +{delayMin} min</span>
  ) : (
    <span className="text-accent" aria-label={`${-delayMin} min early`}>▼ −{-delayMin} min</span>
  );
}

/** TPulso: a tapped stop and its departures in the next 10 minutes. */
/** TPulso: a station of an expanded area point (side-panel list). */
export interface AreaRow {
  id: string;
  letter: string;
  name: string;
  /** "Bus stop", "Metro station"… (from the lines serving it, not from the name). */
  kindLabel: string;
  towards: string | null;
  modes: TransportMode[];
  distanceM: number;
}

export interface StopPanel {
  id: string;
  name: string;
  /** "Bus stop", "Metro station"… (from the lines serving it, not from the name). */
  kindLabel?: string | undefined;
  /** Bus/tram platform: the main destination of the trips leaving it. */
  towards?: string | null;
  /** Bus/tram platform: the platform on the other side of the street. */
  otherSide?: { id: string; towards: string | null } | null;
  distanceM: number;
  /** null while loading */
  departures: LiveDeparture[] | null;
  fetchedAt: number | null;
  error: string | null;
}

interface Props {
  arrivals: Arrival[];
  onSelectVehicle?: (id: string) => void;
  radius: number;
  vehicle?: Vehicle | undefined;
  route?: TransitRoute | undefined;
  upcoming: UpcomingStop[];
  beyond: UpcomingStop[];
  onClose: () => void;
  live?: boolean;
  followed?: Followed | null;
  onPin?: (a: Arrival) => void;
  onUnpin?: () => void;
  canSelect?: (vehicleId: string) => boolean;
  openId?: string | null;
  radarVehicles?: { id: string; line: string; mode: Vehicle["mode"]; headsign: string; distanceM: number }[];
  onOpen?: (id: string | null) => void;
  panelView?: "results" | "help" | "stop" | "area" | "alerts";
  /** Expanded area point: its stations (letter order), the picked one, and a row tap (pick, then open). */
  area?: AreaRow[] | null;
  pickedId?: string | null;
  onPickRow?: (id: string) => void;
  /** The picked platform's next departures (shown in its expanded row). */
  pickedDepartures?: LiveDeparture[] | null;
  onPanelClose?: () => void;
  // TPulso additions
  now: number;
  /** Seconds since the board was fetched (Stale state). */
  boardAgeSec: number;
  boardStatus: { loading: boolean; error: string | null; note: string | null };
  stop?: StopPanel | null;
  routeStatus: "idle" | "loading" | "ready" | "error";
  help: HelpInfo;
  /** TEST mode only: start a test ride on the selected vehicle. */
  onRide?: (() => void) | undefined;
  /** The running test ride, if any. */
  ride?: RideInfo | null;
  /** Expanded departure rows (by row id) and their trip stops. Toggling never touches the map. */
  tripStops?: Record<string, TripStopsView>;
  onToggleTrip?: (rowId: string) => void;
  /** Select another stop (a platform's "Other side" link). */
  onSelectStop?: (id: string) => void;
  /** TPulso: service alerts for the radar (null = alerts switched off on the server). */
  alerts?: AlertsView | null;
  /** Alerts on the selected vehicle's line. */
  vehicleAlerts?: ServiceAlert[];
  onShowAlerts?: (() => void) | undefined;
  /** TPulso, phones: the panel is raised over part of the map (more room for the list). */
  sheetUp?: boolean;
  onSheet?: ((up: boolean) => void) | undefined;
}

/** TPulso: a departure row's trip, expanded: its upcoming stops (same data as the vehicle panel). */
export interface TripStopsView {
  status: "loading" | "ready" | "error";
  stops: UpcomingStop[];
  /** The stop the vehicle is at or heading to (highlighted). */
  nextKey: string | null;
  /** The row's own stop ("your stop"). */
  yourKey: string | null;
  /** Final destination: headsign and terminus stop. */
  destination: string;
}

/** TPulso offline: what Help shows about the timetable data. */
export interface HelpInfo {
  window: string;
  operators: OperatorInfo[];
  excluded: { name: string; reason: string }[];
  regionMB: number | null;
  download: { state: "idle" | "running" | "done" | "error"; done: number; total: number; error?: string };
  onDownload: () => void;
}

export interface Followed {
  pinned: Pinned;
  dep: LiveDeparture | null;
  vehicle: Vehicle | null;
  vehicleDistM: number | null;
}

/**
 * TPulso: a countdown label ("~3 min") that reads the shared clock itself and re-renders only when its text
 * changes (about once a minute), so the 1 s tick never re-renders the lists around it.
 */
const Countdown = memo(function Countdown({ atSec, state }: { atSec: number; state: SourceState }) {
  return <>{useClock((t) => countdownLabel(atSec, Math.floor(t / 1000), state), [atSec, state])}</>;
});

export default function ArrivalsDrawer({
  arrivals,
  radius,
  vehicle,
  route,
  upcoming,
  beyond,
  onClose,
  onSelectVehicle,
  live = false,
  followed = null,
  onPin,
  onUnpin,
  canSelect,
  openId = null,
  radarVehicles = [],
  onOpen,
  panelView = "results",
  onPanelClose,
  now,
  boardAgeSec,
  boardStatus,
  stop = null,
  routeStatus,
  help,
  onRide,
  ride = null,
  tripStops = {},
  onToggleTrip,
  onSelectStop,
  area = null,
  pickedId = null,
  onPickRow,
  pickedDepartures = null,
  alerts = null,
  vehicleAlerts = [],
  onShowAlerts,
  sheetUp = false,
  onSheet,
}: Props) {
  // Tapping a departure just reveals its stop and clock time (no path view).
  const [showVeh, setShowVeh] = useState(true);
  const [showDep, setShowDep] = useState(true);
  const tap = (a: Arrival) => onOpen?.(openId === a.id ? null : a.id);
  // Keep showing the last vehicle while the card flips back.
  const last = useRef<{
    v: Vehicle;
    r?: TransitRoute | undefined;
    u: UpcomingStop[];
    b: UpcomingStop[];
  } | null>(null);
  if (vehicle) last.current = { v: vehicle, r: route, u: upcoming, b: beyond };
  const lastStop = useRef<StopPanel | null>(null);
  if (stop) lastStop.current = stop;
  const flipped = !!vehicle || panelView !== "results";
  const back = last.current;

  // TPulso, phones: scrolling a list down raises the panel; scrolling back to its top lowers it. Only the panel's
  // own lists count (not small nested ones), and a short pause after each change stops the resize from bouncing.
  const sheetLock = useRef(0);
  const onScrollCapture = (e: UIEvent) => {
    const el = e.target;
    if (!onSheet || !(el instanceof HTMLElement) || el.clientHeight < 120 || Date.now() < sheetLock.current) return;
    if (!sheetUp && el.scrollTop > 24 && el.scrollHeight - el.clientHeight > 120) {
      sheetLock.current = Date.now() + 450;
      onSheet(true);
    } else if (sheetUp && el.scrollTop <= 0) {
      sheetLock.current = Date.now() + 450;
      onSheet(false);
    }
  };

  return (
    <aside
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-border bg-background md:w-[360px] md:flex-none md:border-l"
      onScrollCapture={onScrollCapture}
    >
      {onSheet && (
        <button
          type="button"
          onClick={() => onSheet(!sheetUp)}
          aria-label={sheetUp ? "Show more of the map" : "Show more of the list"}
          aria-expanded={sheetUp}
          className="sheet-handle grid h-4 w-full shrink-0 place-items-center bg-surface md:hidden"
        >
          <span aria-hidden />
        </button>
      )}
      {/* TPulso: the detail panel slides and fades over the list (transform + opacity only, 220 ms; instant with
          reduced motion). Both layers fill the same reserved space, so the map never resizes. */}
      <div className="relative min-h-0 w-full flex-1">
        <div
          className={`panel-layer absolute inset-0 flex flex-col bg-surface ${flipped ? "is-behind pointer-events-none" : ""}`}
          aria-hidden={flipped}
        >
          <div className="flex items-baseline justify-between border-b border-border px-4 py-2.5">
            <h2 className="flex items-center gap-1.5 font-display text-sm font-bold">
              Nearby departures
              {live && (
                <span className="flex items-center gap-0.5 rounded bg-accent/15 px-1 text-[9px] font-bold uppercase text-accent">
                  <Radio className="size-2.5" /> live
                </span>
              )}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {arrivals.filter((a) => a.distanceM <= radius).length} within {radius} m
            </p>
          </div>

          {ride && <RideCard ride={ride} />}

          {followed && (
            <FollowCard
              f={followed}
              onUnpin={onUnpin}
              onSelect={onSelectVehicle}
              canSelect={canSelect}
              boardAgeSec={boardAgeSec}
            />
          )}

          <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-2 [-webkit-overflow-scrolling:touch]">
            {(
              <section className="mb-3">
                <Toggle label={`Vehicles on the radar now · ${radarVehicles.length}`} open={showVeh} onChange={setShowVeh} />
                {showVeh && radarVehicles.length === 0 && (
                  <p className="px-2 pb-2 text-[11px] text-muted-foreground">No vehicles inside the circle right now.</p>
                )}
                {showVeh && <ul className="space-y-1">
                  {radarVehicles.map((v) => {
                    const Icon = ICONS[v.mode];
                    return (
                      <li
                        key={v.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectVehicle?.(v.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") onSelectVehicle?.(v.id);
                        }}
                        className="flex cursor-pointer items-center gap-2.5 rounded-xl bg-surface-2/60 px-2.5 py-1.5 hover:bg-surface-2"
                      >
                        <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${DOT[v.mode]}`}>
                          <Icon className="size-3.5 text-primary-foreground" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate">
                            <span className="font-display text-xs font-bold">{v.line}</span>{" "}
                            <span className="truncate text-xs text-foreground/80">{v.headsign || "destination not available"}</span>
                          </div>
                          {/* TPulso: position source (timetable) */}
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <SourceDot state="expected" />
                            <span className="truncate">Expected position (timetable)</span>
                          </div>
                        </div>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{v.distanceM} m</span>
                      </li>
                    );
                  })}
                </ul>}
              </section>
            )}
            {/* TPulso: honest loading / error states for the departures board */}
            {boardStatus.loading ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">Loading departures…</p>
            ) : boardStatus.error && arrivals.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-destructive">Departures unavailable: {boardStatus.error}</p>
            ) : arrivals.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                No stops in range. Widen the radius or change the filter.
              </p>
            ) : (
              <>
                {boardStatus.note && <p className="px-2 pb-1 text-[11px] text-muted-foreground">{boardStatus.note}</p>}
                {(
                  [
                    ["In the radar · next 10 min", arrivals.filter((a) => a.distanceM <= radius)],

                  ] as const
                ).map(([title, group], gi) =>
                  group.length === 0 && gi === 1 ? null : (
                    <section key={title} className={gi ? "mt-3 opacity-75" : ""}>
                      <Toggle label={`${title} · ${group.length}`} open={showDep} onChange={setShowDep} />
                      {showDep && group.length === 0 && (
                        <p className="px-2 pb-2 text-[11px] text-muted-foreground">
                          Nothing leaving inside the circle in the next 10 minutes.
                        </p>
                      )}
                      <ul className={`space-y-1 ${showDep ? "" : "hidden"}`}>
                        {group.map((a) => {
                          const Icon = ICONS[a.mode];
                          const state = depState(a.realtime, boardAgeSec);
                          const at = Math.round((a.expectedAt ?? now) / 1000);
                          return (
                            <li
                              key={a.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => tap(a)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") tap(a);
                              }}
                              className={`flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl px-2.5 py-1.5 transition-colors hover:bg-surface-2 ${
                                followed && a.vehicleKey === followed.pinned.vehicleKey
                                  ? "bg-primary/15 ring-1 ring-primary/50"
                                  : "bg-surface-2/60"
                              } ${a.cancelled || state === "stale" ? "opacity-60" : ""}`}
                            >
                              <span
                                className={`grid size-7 shrink-0 place-items-center rounded-lg ${DOT[a.mode]}`}
                              >
                                <Icon className="size-3.5 text-primary-foreground" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-1.5">
                                  <span className="font-display text-xs font-bold">{a.line}</span>
                                  <span className="truncate text-xs text-foreground/80">
                                    {a.headsign}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                                  <Footprints className="size-2.5 shrink-0" />
                                  <span className="truncate">
                                    {a.stopName} · {a.distanceM} m ·{" "}
                                    {MODE_LABEL[a.mode]}
                                  </span>
                                </div>
                                {a.alert && <AlertNote label={a.alert} onOpen={onShowAlerts} />}
                              </div>
                              <div className="shrink-0 text-right">
                                {/* TPulso: source dot + "3 min" (Live) / "~3 min" (Scheduled, Stale) */}
                                <div className="flex items-center justify-end gap-1.5 font-display text-sm font-bold leading-none text-primary">
                                  <SourceDot state={state} />
                                  <span className="tabular-nums">
                                    <Countdown atSec={at} state={state} />
                                  </span>
                                </div>
                                <div className="mt-0.5 text-[9px] text-muted-foreground">
                                  {state === "stale"
                                    ? `last seen ${agoLabel(boardAgeSec)} ago`
                                    : state === "scheduled"
                                      ? "scheduled"
                                      : <DelayText delayMin={a.delayMin} />}
                                </div>
                              </div>
                              {onPin && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (followed && a.vehicleKey === followed.pinned.vehicleKey)
                                      onUnpin?.();
                                    else onPin(a);
                                  }}
                                  aria-label="Follow this connection"
                                  className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-primary"
                                >
                                  <Pin className="size-3" />
                                </button>
                              )}
                              {onToggleTrip && <TripToggle open={!!tripStops[a.id]} onClick={() => onToggleTrip(a.id)} />}
                              {tripStops[a.id] && <TripStopsPanel view={tripStops[a.id]!} now={now} />}
                              {openId === a.id && (
                                <div className="basis-full rounded-lg bg-background/60 px-2 py-1.5 text-[11px]">
                                  <div>
                                    <span className="text-muted-foreground">Stop: </span>
                                    <span className="font-semibold">{a.stopName}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Departs: </span>
                                    <span className="font-display font-bold tabular-nums text-primary">
                                      {state === "live" ? "" : "~"}
                                      {clock(a.expectedAt ?? Date.now() + (a.etaSec ?? a.minutes * 60) * 1000)}
                                    </span>
                                    {a.delayMin !== 0 && a.expectedAt && (
                                      <span className="text-muted-foreground">
                                        {" "}(scheduled {clock(a.expectedAt - a.delayMin * 60_000)})
                                      </span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ),
                )}
              </>
            )}
          </div>
        </div>

        <div
          className={`panel-layer absolute inset-0 flex flex-col bg-surface ${flipped ? "" : "is-away pointer-events-none"}`}
          aria-hidden={!flipped}
        >
          {/* TPulso: keyed by view, so switching list ↔ platform cross-fades (150 ms) inside the open panel;
              a selection change in the list re-renders in place. */}
          <div key={panelView} className="panel-swap flex min-h-0 flex-1 flex-col">
          {panelView === "area" && area ? (
            <AreaList rows={area} pickedId={pickedId ?? null} departures={pickedDepartures} onPick={onPickRow} onClose={onPanelClose} />
          ) : panelView === "help" ? (
            <HelpPanel onClose={onPanelClose} info={help} />
          ) : panelView === "alerts" && alerts ? (
            <AlertsPanel view={alerts} now={now} onClose={onPanelClose} />
          ) : panelView === "stop" && (stop ?? lastStop.current) ? (
            <StopDetails s={(stop ?? lastStop.current)!} now={now} onClose={onPanelClose} tripStops={tripStops} onToggleTrip={onToggleTrip} onSelectStop={onSelectStop} onShowAlerts={onShowAlerts} />
          ) : back ? (
            <VehicleDetails
              v={back.v}
              r={back.r}
              upcoming={back.u}
              beyond={back.b}
              onClose={onClose}
              now={now}
              routeStatus={routeStatus}
              onRide={onRide}
              alerts={vehicleAlerts}
              onShowAlerts={onShowAlerts}
            />
          ) : null}
          </div>
        </div>
      </div>
    </aside>
  );
}

/**
 * TPulso: the stations of an expanded area point. Each row: the letter shown on the map, the full name (wraps,
 * never cut), the direction (platforms), the kind of stop and the distance. A first tap picks the station: its
 * row expands in place with the next departures (its letter on the map is highlighted too); a second tap, or
 * "All departures", opens its panel. The list itself never moves or reloads.
 */
function AreaList({
  rows,
  pickedId,
  departures,
  onPick,
  onClose,
}: {
  rows: AreaRow[];
  pickedId: string | null;
  departures: LiveDeparture[] | null;
  onPick?: ((id: string) => void) | undefined;
  onClose: (() => void) | undefined;
}) {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={`Stations here · ${rows.length}`} icon={MapPin} onClose={onClose} />
      <ul className="min-h-0 flex-1 touch-pan-y space-y-1 overflow-y-auto overscroll-contain p-2">
        {rows.map((r) => (
          <AreaListRow key={r.id} r={r} on={r.id === pickedId} departures={r.id === pickedId ? departures : null} onPick={onPick} />
        ))}
      </ul>
    </div>
  );
}

const AreaListRow = memo(function AreaListRow({
  r,
  on,
  departures,
  onPick,
}: {
  r: AreaRow;
  on: boolean;
  departures: LiveDeparture[] | null;
  onPick?: ((id: string) => void) | undefined;
}) {
  const li = useRef<HTMLLIElement | null>(null);
  // Keep the last departures while the row collapses, so its content eases out instead of vanishing.
  const shown = useRef<LiveDeparture[] | null>(null);
  if (on && departures) shown.current = departures;
  useEffect(() => {
    if (on) li.current?.scrollIntoView({ block: "nearest" });
  }, [on]);
  const Icon = ICONS[r.modes[0] ?? "bus"];
  const deps = shown.current;
  return (
    <li ref={li}>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={on}
        aria-expanded={on}
        onClick={() => onPick?.(r.id)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onPick?.(r.id)}
        className={`area-row cursor-pointer rounded-xl px-2.5 py-2 ${on ? "is-on" : ""}`}
      >
        <div className="flex items-start gap-2.5">
          <span className="area-row-letter grid size-6 shrink-0 place-items-center rounded-full font-display text-[11px] font-black">{r.letter}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1.5 font-display text-sm font-bold leading-snug [overflow-wrap:anywhere]">
              <Icon className="mt-0.5 size-3.5 shrink-0" style={{ color: MODE_COLORS[r.modes[0] ?? "bus"] }} />
              <span>{r.name}</span>
            </div>
            {r.towards && <div className="text-xs text-foreground/80 [overflow-wrap:anywhere]">towards {r.towards}</div>}
            <div className="text-[11px] text-muted-foreground">
              {r.kindLabel} · {r.distanceM} m away
            </div>
          </div>
        </div>
        <div className={`area-row-more ${on ? "is-open" : ""}`} aria-hidden={!on}>
          <div>
            <div className="mt-2 space-y-1 border-t border-border pt-2 pl-8">
              {deps && deps.length === 0 && <p className="text-xs text-muted-foreground">No departures in the next 10 minutes.</p>}
              {deps?.map((d) => (
                <div key={d.id} className="flex items-center gap-2 text-xs">
                  <span className="min-w-8 rounded px-1 text-center font-display font-bold" style={{ background: MODE_COLORS[d.mode], color: "oklch(0.16 0.025 258)" }}>
                    {d.line}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{d.destination}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    <Countdown atSec={Math.round(d.expectedAt / 1000)} state="scheduled" />
                  </span>
                </div>
              ))}
              <span className="inline-block pt-0.5 text-xs font-bold text-primary">All departures · tap again →</span>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
});

function PanelHeader({ title, icon: Icon, onClose }: { title: string; icon: typeof CircleHelp; onClose: (() => void) | undefined }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
      <button onClick={onClose} aria-label="Back to live results" className="grid size-7 place-items-center rounded-lg bg-surface-2 text-foreground/80 active:scale-95">
        <ArrowLeft className="size-3.5" />
      </button>
      <Icon className="size-4 text-primary" />
      <h2 className="font-display text-sm font-bold">{title}</h2>
    </div>
  );
}

function HelpPanel({ onClose, info }: { onClose: (() => void) | undefined; info: HelpInfo }) {
  const fmt = (d: string) => `${d.slice(6, 8)}/${d.slice(4, 6)}/${d.slice(0, 4)}`;
  return (
    <div className="flex h-full flex-col" onDoubleClick={onClose}>
      <PanelHeader title="How TPulso works" icon={CircleHelp} onClose={onClose} />
      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 py-4 text-xs leading-relaxed [-webkit-overflow-scrolling:touch]">
        <p className="font-display text-sm font-bold text-primary">Timetable data, not live</p>
        <p className="text-foreground/85">TPulso shows the public transport timetable around you: stops inside your chosen circle, what leaves them in the next ten minutes, and where each vehicle should be according to the timetable. Nothing on screen is live.</p>

        <HelpSection title="Symbols">
          <HelpRow icon={<Bus className="size-4" />} title="Yellow" text="Bus" tone="bg-bus" />
          <HelpRow icon={<TramFront className="size-4" />} title="Purple" text="Tram or metro" tone="bg-tram" />
          <HelpRow icon={<TrainFront className="size-4" />} title="Blue" text="Train (CP, Fertagus)" tone="bg-train" />
          <HelpRow icon={<Ship className="size-4" />} title="Red" text="Ferry" tone="bg-ferry" />
          <p className="text-muted-foreground">Each kind of transport always has the same colour and its own symbol. Stations show a ring in the colours of the transport that stops there.</p>
          <HelpRow icon={<MapPin className="size-4" />} title="Countdown marker" text="The stop and time remaining for an opened departure" />
          <HelpRow icon={<Pin className="size-4" />} title="Pin" text="Keep following a connection on the board" />
        </HelpSection>

        {/* TPulso offline: the two timetable states (CLAUDE.md display rule) */}
        <HelpSection title="What the times and vehicles mean">
          <HelpRow icon={<SourceDot state="scheduled" />} title="Scheduled" text="A time from the timetable — “~3 min”" />
          <HelpRow icon={<SourceDot state="expected" />} title="Expected" text="Where a vehicle should be now according to the timetable (dashed outline). Real vehicles can be early, late or cancelled." />
        </HelpSection>

        <HelpSection title="Service alerts">
          <p>
            When an operator publishes a service alert (works, detours, strikes, a station entrance closed…), the departures and vehicles it
            concerns show <strong className="alert-text">⚠ Line alert</strong> or <strong className="alert-text">⚠ Stop alert</strong>, and the
            top bar shows how many alerts concern your radar. Tap either to read them. Alerts come from TML (all operators) and from
            Transtejo/Soflusa's notices, in Portuguese as published, and need a connection. The times shown are still the timetable: they do not
            include these changes.
          </p>
        </HelpSection>

        <HelpSection title="Timetables in this version">
          <p>Valid {info.window}. Source: TML regional GTFS feed.</p>
          <ul className="space-y-1">
            {info.operators.map((o) => (
              <li key={o.id}>
                <strong>{o.name}</strong> · {fmt(o.dateFrom)}–{fmt(o.dateTo)}
                {o.crossCheck.status === "mismatch" && (
                  <span className="block text-[11px] text-destructive">
                    Differs from the operator’s own timetable today ({o.tripsToday} vs {o.crossCheck.ownTripsToday} trips). Which one is right is not known yet.
                  </span>
                )}
              </li>
            ))}
          </ul>
          {info.excluded.length > 0 && (
            <p className="text-muted-foreground">Not included: {info.excluded.map((e) => `${e.name} (${e.reason})`).join("; ")}.</p>
          )}
        </HelpSection>

        <HelpSection title="Using TPulso offline">
          <p>
            Map areas you look at are saved on this device. To use TPulso without a connection anywhere in the region, save all areas now
            {info.regionMB !== null ? ` (about ${info.regionMB.toFixed(1)} MB)` : ""}. Map backgrounds are not saved.
          </p>
          <button
            onClick={info.onDownload}
            disabled={info.download.state === "running"}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 font-display text-xs font-bold disabled:opacity-60"
          >
            <Download className="size-4" />
            {info.download.state === "running"
              ? `Saving… ${info.download.done}/${info.download.total}`
              : info.download.state === "done"
                ? "Whole region saved"
                : "Save the whole region"}
          </button>
          {info.download.state === "error" && <p className="text-destructive">Could not save everything: {info.download.error}</p>}
        </HelpSection>

        <HelpSection title="Using the radar">
          <p>Choose 100, 200, 500 or 1000 metres, and filter by bus, tram/metro, train or ferry. Drag or pinch the map to look around: the circle stays in the middle of the screen and shows what is under it ("Exploring here"). Tap Recenter to go back; one second after you stop touching the map it goes back by itself, unless a vehicle or stop is selected. Tap a vehicle for its route and scheduled stops, or a stop for its departures (only the vehicles coming to that stop stay on the map). Tap a departure to show its stop. Tap the map to return to the results.</p>
        </HelpSection>

        <button onClick={onClose} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 font-display text-xs font-bold text-primary-foreground">
          <ArrowLeft className="size-4" /> Back to results
        </button>
      </div>
    </div>
  );
}

function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-5 space-y-2 border-t border-border pt-3"><h3 className="font-display text-xs font-bold text-primary">{title}</h3>{children}</section>;
}

function HelpRow({ icon, title, text, tone = "bg-surface-2" }: { icon: React.ReactNode; title: string; text: string; tone?: string }) {
  return <div className="flex items-center gap-2.5"><span className={`grid size-7 shrink-0 place-items-center rounded-lg text-primary-foreground ${tone}`}>{icon}</span><span><strong>{title}</strong> · {text}</span></div>;
}

function VehicleDetails({
  v,
  r,
  upcoming,
  beyond,
  onClose,
  now,
  routeStatus,
  onRide,
  alerts = [],
  onShowAlerts,
}: {
  v: Vehicle;
  r?: TransitRoute | undefined;
  upcoming: UpcomingStop[];
  beyond: UpcomingStop[];
  onClose: () => void;
  now: number;
  routeStatus: Props["routeStatus"];
  onRide?: (() => void) | undefined;
  alerts?: ServiceAlert[];
  onShowAlerts?: (() => void) | undefined;
}) {
  const Icon = ICONS[v.mode];
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <button
          onClick={onClose}
          aria-label="Back to departures"
          className="grid size-7 place-items-center rounded-lg bg-surface-2 text-foreground/80 active:scale-95"
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <h2 className="font-display text-sm font-bold">Vehicle details</h2>
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${DOT[v.mode]}`}>
          <Icon className="size-5 text-primary-foreground" />
        </span>
        <div className="min-w-0">
          <div className="font-display text-lg font-bold leading-tight">
            {v.line} <span className="font-medium text-foreground/70">→ {v.headsign || "—"}</span>
          </div>
          <div className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            {(r?.operator || v.operator) ?? ""} · {MODE_LABEL[v.mode]} ·{" "}
            <SourceDot state="expected" /> Expected position (timetable)
          </div>
        </div>
      </div>

      <VehicleAlerts alerts={alerts} onOpen={onShowAlerts} />
      {isUnknownRoute(v) && (
        <div className="mx-3 mb-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px]">
          <div className="font-display text-xs font-bold text-destructive">(?) Unknown route</div>
          <div className="text-muted-foreground">
            The operator has no line or route data for this bus today, so its route line and stops can't be shown.
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
        <div className="rounded-xl bg-surface-2/70 px-3 py-2">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Gauge className="size-3" /> Position
          </div>
          <div className="flex items-center gap-1.5 font-display text-sm font-bold">
            <SourceDot state="expected" /> Expected
          </div>
          <div className="text-[10px] text-muted-foreground">calculated from the timetable</div>
        </div>
        <div className="rounded-xl bg-surface-2/70 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Times</div>
          <div className="flex items-center gap-1.5 font-display text-sm font-bold">
            <SourceDot state="scheduled" /> Scheduled
          </div>
          <div className="text-[10px] text-muted-foreground">not live: delays are not known</div>
        </div>
      </div>

      {/* TPulso: TEST mode only — ride this vehicle (simulated from the timetable) */}
      {onRide && (
        <div className="px-3 pb-3">
          <button
            onClick={onRide}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-foreground/60 bg-surface-2 px-3 py-2 font-display text-xs font-bold active:scale-95"
          >
            <Icon className="size-4" /> Ride this vehicle <span className="font-medium text-muted-foreground">(test ride)</span>
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain pb-3">
        {routeStatus === "loading" && <p className="px-4 py-3 text-center text-xs text-muted-foreground">Loading route…</p>}
        {routeStatus === "error" && <p className="px-4 py-3 text-center text-xs text-destructive">Route unavailable right now.</p>}
        <StopSection
          title="Next stops in radar"
          stops={upcoming}
          empty="No more stops for this vehicle inside the radius."
          accent
          now={now}
        />
        <StopSection
          title="Further along the line"
          stops={beyond}
          empty="No further stops known."
          now={now}
        />
      </div>
    </>
  );
}

function StopSection({
  title,
  stops,
  empty,
  accent = false,
  now,
}: {
  title: string;
  stops: UpcomingStop[];
  empty: string;
  accent?: boolean;
  now: number;
}) {
  const nowSec = Math.floor(now / 1000);
  return (
    <section>
      <div className="sticky top-0 z-10 flex items-baseline justify-between border-t border-border bg-surface px-4 py-2">
        <h3 className="font-display text-xs font-bold">{title}</h3>
        <span className="text-[10px] text-muted-foreground">
          {stops.length ? `${stops.length}` : ""}
        </span>
      </div>
      {stops.length === 0 ? (
        <p className="px-4 py-3 text-center text-xs text-muted-foreground">{empty}</p>
      ) : (
        <TripStopList stops={stops} accent={accent} nowSec={nowSec} showAhead />
      )}
    </section>
  );
}

/** The stop list of the vehicle panel, shared with expanded departure rows. */
function TripStopList({
  stops,
  accent = false,
  nowSec,
  showAhead = false,
  highlightKey = null,
  yourKey = null,
}: {
  stops: UpcomingStop[];
  accent?: boolean;
  nowSec: number;
  showAhead?: boolean;
  highlightKey?: string | null;
  yourKey?: string | null;
}) {
  return (
    <ol className="relative ml-5 mr-3 border-l border-dashed border-border">
      {stops.map((u) => {
        const hi = u.key === highlightKey;
        const strong = accent || hi;
        return (
          <li key={u.key} className={`relative flex items-center gap-2 py-1.5 pl-4 ${hi ? "rounded-r-lg bg-foreground/10" : ""}`}>
            <span
              className={`absolute -left-[5px] rounded-full ${hi ? "size-3 -left-[6px] bg-foreground ring-2 ring-foreground/40" : strong ? "size-2.5 bg-primary" : "size-2.5 border border-muted-foreground bg-surface"}`}
            />
            <div className="min-w-0 flex-1">
              <div className={`truncate text-xs font-semibold ${strong ? "" : "text-foreground/70"}`}>
                {u.name}
                {u.key === yourKey && <span className="ml-1.5 rounded bg-foreground/15 px-1 text-[9px] font-bold uppercase">your stop</span>}
              </div>
              {showAhead && <div className="text-[10px] text-muted-foreground">{u.aheadM} m ahead</div>}
              {hi && !showAhead && <div className="text-[10px] text-muted-foreground">next stop</div>}
            </div>
            {/* TPulso: one source state per stop time */}
            <span
              className={`flex items-center gap-1.5 font-display text-sm font-bold ${strong ? "text-primary" : "text-muted-foreground"}`}
              aria-label={`${SOURCE_TEXT[u.state]} ${countdownLabel(nowSec + u.etaS, nowSec, u.state)}`}
            >
              <SourceDot state={u.state} />
              <Countdown atSec={nowSec + u.etaS} state={u.state} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** "Show later stops" button on a departure row. Never selects or hides anything on the map. */
function TripToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={open ? "Hide later stops" : "Show later stops"}
      aria-expanded={open}
      title={open ? "Hide later stops" : "Show later stops"}
      className={`grid size-6 shrink-0 place-items-center rounded-md hover:text-foreground ${open ? "bg-foreground/15 text-foreground" : "text-muted-foreground"}`}
    >
      <ListOrdered className="size-3" />
    </button>
  );
}

/** A departure row's trip, expanded: upcoming stops with scheduled times and the final destination. */
function TripStopsPanel({ view, now }: { view: TripStopsView; now: number }) {
  return (
    <div className="basis-full rounded-lg bg-background/60 py-1.5" onClick={(e) => e.stopPropagation()}>
      {view.status === "loading" ? (
        <p className="px-3 py-1 text-[11px] text-muted-foreground">Loading stops…</p>
      ) : view.status === "error" ? (
        <p className="px-3 py-1 text-[11px] text-destructive">Stops unavailable.</p>
      ) : (
        <>
          <TripStopList stops={view.stops} nowSec={Math.floor(now / 1000)} highlightKey={view.nextKey} yourKey={view.yourKey} />
          <p className="px-3 pt-1 text-[11px] text-muted-foreground">
            Final destination: <span className="font-semibold text-foreground">{view.destination}</span>
          </p>
        </>
      )}
    </div>
  );
}

/** TPulso: tapping a stop shows its departures for the next 10 minutes. */
function StopDetails({
  s,
  now,
  onClose,
  tripStops,
  onToggleTrip,
  onSelectStop,
  onShowAlerts,
}: {
  s: StopPanel;
  now: number;
  onClose: (() => void) | undefined;
  tripStops: Record<string, TripStopsView>;
  onToggleTrip?: ((rowId: string) => void) | undefined;
  onSelectStop?: ((id: string) => void) | undefined;
  onShowAlerts?: (() => void) | undefined;
}) {
  const ageSec = s.fetchedAt ? (now - s.fetchedAt) / 1000 : 0;
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Stop" icon={MapPin} onClose={onClose} />
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-primary">
          <MapPin className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="font-display text-lg font-bold leading-tight">
            {s.name}
            {/* TPulso: a bus/tram platform is one direction: say which */}
            {s.towards && <span className="block text-sm font-semibold text-foreground/80">towards {s.towards}</span>}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {s.kindLabel ? `${s.kindLabel} · ` : ""}
            {s.distanceM} m away · next 10 min
          </div>
          {s.otherSide && onSelectStop && (
            <button
              type="button"
              onClick={() => onSelectStop(s.otherSide!.id)}
              className="mt-1 text-left text-xs font-bold text-primary underline-offset-2 hover:underline"
            >
              Other side{s.otherSide.towards ? `: towards ${s.otherSide.towards}` : ""} →
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-2 pb-3">
        {s.departures === null ? (
          <p className={`px-2 py-6 text-center text-sm ${s.error ? "text-destructive" : "text-muted-foreground"}`}>
            {s.error ? `Departures unavailable: ${s.error}` : "Loading departures…"}
          </p>
        ) : s.departures.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">No departures in the next 10 minutes.</p>
        ) : (
          <div className="space-y-3">
            {(["bus", "tram", "train", "ferry"] as const).map((mode) => {
              const rows = s.departures!.filter((d) => d.mode === mode);
              if (!rows.length) return null;
              return (
                <section key={mode}>
                  <h3 className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {MODE_LABEL[mode]} · {rows.length}
                  </h3>
          <ul className="space-y-1">
            {rows.map((d) => {
              const Icon = ICONS[d.mode];
              const state = depState(d.realtime, ageSec);
              return (
                <li key={d.id} className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl bg-surface-2/60 px-2.5 py-1.5 ${state === "stale" ? "opacity-60" : ""}`}>
                  <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${DOT[d.mode]}`}>
                    <Icon className="size-3.5 text-primary-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">
                      <span className="font-display text-xs font-bold">{d.line}</span>{" "}
                      <span className="text-xs text-foreground/80">{d.destination}</span>
                    </div>
                    {d.alert && <AlertNote label={d.alert} onOpen={onShowAlerts} />}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center justify-end gap-1.5 font-display text-sm font-bold leading-none text-primary">
                      <SourceDot state={state} />
                      <span className="tabular-nums"><Countdown atSec={Math.round(d.expectedAt / 1000)} state={state} /></span>
                    </div>
                    <div className="mt-0.5 text-[9px] text-muted-foreground">
                      {state === "stale" ? `last seen ${agoLabel(ageSec)} ago` : state === "scheduled" ? "scheduled" : <DelayText delayMin={Math.round(d.delaySec / 60)} />}
                    </div>
                  </div>
                  {onToggleTrip && <TripToggle open={!!tripStops[d.id]} onClick={() => onToggleTrip(d.id)} />}
                  {tripStops[d.id] && <TripStopsPanel view={tripStops[d.id]!} now={now} />}
                </li>
              );
            })}
          </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** TPulso: the test ride (TEST mode only), shown like the original's follow card above the departures. */
export interface RideInfo {
  line: string;
  mode: TransportMode;
  headsign: string;
  speed: 1 | 5 | 10;
  ended: boolean;
  /** Remaining stops with their scheduled times (first = next stop). */
  stops: { name: string; atMs: number }[];
  onSpeed: (s: 1 | 5 | 10) => void;
  /** The map turns so the direction of travel points up (off by default). */
  headingUp: boolean;
  onHeadingUp: (on: boolean) => void;
  onExit: () => void;
}

function RideCard({ ride }: { ride: RideInfo }) {
  const Icon = ICONS[ride.mode];
  const [next, ...rest] = ride.stops;
  return (
    <div className="mx-2 mt-2 rounded-xl border-2 border-dashed border-foreground/60 bg-surface-2/80 p-2.5">
      <div className="flex items-center gap-2">
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${DOT[ride.mode]}`}>
          <Icon className="size-4 text-primary-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-black uppercase tracking-wide text-foreground">Test ride · simulated from the timetable</div>
          <div className="truncate font-display text-xs font-bold">
            {ride.line} <span className="font-medium text-foreground/75">→ {ride.headsign}</span>
          </div>
        </div>
        <button
          onClick={ride.onExit}
          className="shrink-0 rounded-lg border border-border bg-surface px-2 py-1 font-display text-[11px] font-bold active:scale-95"
        >
          Exit ride
        </button>
      </div>
      {ride.ended ? (
        <p className="mt-2 text-center font-display text-sm font-bold">Trip ended</p>
      ) : (
        <>
          {next && (
            <div className="mt-2 flex items-center justify-between rounded-lg bg-background/60 px-2 py-1.5">
              <div className="min-w-0">
                <div className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">Next stop</div>
                <div className="truncate text-xs font-semibold">{next.name}</div>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 font-display text-sm font-bold">
                <SourceDot state="scheduled" />
                <Countdown atSec={Math.round(next.atMs / 1000)} state="scheduled" />
              </span>
            </div>
          )}
          {rest.length > 0 && (
            <ol className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto px-1 text-[11px]">
              {rest.map((s, i) => (
                <li key={`${i}-${s.name}`} className="flex justify-between gap-2">
                  <span className="truncate text-foreground/80">{s.name}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground"><Countdown atSec={Math.round(s.atMs / 1000)} state="scheduled" /></span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">Ride clock</span>
        <div className="flex gap-0.5 rounded-lg bg-background/60 p-0.5" role="group" aria-label="Ride speed">
          {([1, 5, 10] as const).map((s) => (
            <button
              key={s}
              onClick={() => ride.onSpeed(s)}
              aria-pressed={ride.speed === s}
              className={`rounded-md px-2 py-0.5 font-display text-[11px] font-bold ${ride.speed === s ? "bg-foreground text-background" : "text-muted-foreground"}`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">Map direction</span>
        <button
          type="button"
          onClick={() => ride.onHeadingUp(!ride.headingUp)}
          aria-pressed={ride.headingUp}
          className={`rounded-md px-2 py-0.5 font-display text-[11px] font-bold ${ride.headingUp ? "bg-foreground text-background" : "bg-background/60 text-muted-foreground"}`}
        >
          Heading up
        </button>
      </div>
    </div>
  );
}

function FollowCard({
  f,
  onUnpin,
  onSelect,
  canSelect,
  boardAgeSec,
}: {
  f: Followed;
  onUnpin?: (() => void) | undefined;
  onSelect?: ((id: string) => void) | undefined;
  canSelect?: ((id: string) => boolean) | undefined;
  boardAgeSec: number;
}) {
  const { pinned, dep, vehicle, vehicleDistM } = f;
  const Icon = ICONS[pinned.mode];
  const mins = useClock((t) => (dep ? Math.max(0, Math.round((dep.expectedAt - t) / 60_000)) : null), [dep?.expectedAt]);
  const delayMin = dep ? Math.round(dep.delaySec / 60) : 0;
  const state: SourceState = dep ? depState(dep.realtime, boardAgeSec) : "stale";
  const selectable = vehicle && (canSelect?.(vehicle.id) ?? false);
  return (
    <div
      className={`mx-2 mt-2 rounded-xl border border-primary/50 bg-primary/10 p-2.5 ${selectable ? "cursor-pointer" : ""}`}
      onClick={() => selectable && onSelect?.(vehicle.id)}
    >
      <div className="flex items-center gap-2">
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${DOT[pinned.mode]}`}>
          <Icon className="size-4 text-primary-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-bold uppercase tracking-wide text-primary">Following</div>
          <div className="truncate font-display text-xs font-bold">
            {pinned.line}{" "}
            <span className="font-medium text-foreground/75">→ {pinned.destination}</span>
          </div>
          <div className="truncate text-[10px] text-muted-foreground">at {pinned.stopName}</div>
        </div>
        <div className="shrink-0 text-right">
          {dep ? (
            <>
              <div className="flex items-center justify-end gap-1 font-display text-lg font-bold leading-none text-primary">
                <SourceDot state={state} />
                {dep.cancelled ? "—" : `${state === "live" ? "" : "~"}${mins === 0 ? "now" : mins}`}
                {!dep.cancelled && mins !== 0 && (
                  <span className="ml-0.5 text-[10px] font-medium">min</span>
                )}
              </div>
              <div className="text-[9px]">
                {dep.cancelled
                  ? <span className="text-destructive">{dep.skipped ? "skips this stop" : "cancelled"}</span>
                  : state === "live"
                    ? <DelayText delayMin={delayMin} />
                    : <span className="text-muted-foreground">{state === "stale" ? `last seen ${agoLabel(boardAgeSec)} ago` : "scheduled"}</span>}
              </div>
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground">
              no longer
              <br />
              on the board
            </div>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onUnpin?.();
          }}
          aria-label="Stop following"
          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:text-foreground"
        >
          <PinOff className="size-3.5" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {dep
            ? `Scheduled ${clock(dep.plannedAt)}${dep.realtime ? ` · expected ${clock(dep.expectedAt)}` : ""}`
            : "It may have left or stopped reporting"}
        </span>
        <span className={vehicle ? "text-accent" : ""}>
          {vehicle && vehicleDistM !== null
            ? "on the road"
            : dep?.realtime
              ? "tracking…"
              : "not on the road yet"}
        </span>
      </div>
    </div>
  );
}

function Toggle({ label, open, onChange }: { label: string; open: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-1.5 px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
      <input
        type="checkbox"
        checked={open}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3 accent-[var(--primary)]"
        aria-label={`Show ${label}`}
      />
      {label}
    </label>
  );
}
