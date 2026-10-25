import { useRef, useState } from "react";
import {
  ArrowLeft,
  Bus,
  CircleHelp,
  Download,
  Footprints,
  Gauge,
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
export interface StopPanel {
  id: string;
  name: string;
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
  panelView?: "results" | "help" | "stop";
  onPanelClose?: () => void;
  // TPulso additions
  now: number;
  /** Seconds since the board was fetched (Stale state). */
  boardAgeSec: number;
  boardStatus: { loading: boolean; error: string | null; note: string | null };
  stop?: StopPanel | null;
  routeStatus: "idle" | "loading" | "ready" | "error";
  help: HelpInfo;
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
}: Props) {
  // Tapping a departure just reveals its stop and clock time (no path view).
  const [showVeh, setShowVeh] = useState(true);
  const [showDep, setShowDep] = useState(true);
  const tap = (a: Arrival) => onOpen?.(openId === a.id ? null : a.id);
  const nowSec = Math.floor(now / 1000);
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

  return (
    <aside className="relative min-h-0 flex-1 border-border bg-background [perspective:1400px] md:w-[360px] md:flex-none md:border-l">
      <div
        className="relative h-full w-full transition-transform duration-500 ease-out [transform-style:preserve-3d]"
        style={{ transform: flipped ? "rotateY(180deg)" : "none" }}
      >
        <div
          className={`absolute inset-0 flex flex-col bg-surface [backface-visibility:hidden] ${flipped ? "pointer-events-none" : ""}`}
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
                              </div>
                              <div className="shrink-0 text-right">
                                {/* TPulso: source dot + "3 min" (Live) / "~3 min" (Scheduled, Stale) */}
                                <div className="flex items-center justify-end gap-1.5 font-display text-sm font-bold leading-none text-primary">
                                  <SourceDot state={state} />
                                  <span className="tabular-nums">
                                    {countdownLabel(at, nowSec, state)}
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
          className={`absolute inset-0 flex flex-col bg-surface [backface-visibility:hidden] [transform:rotateY(180deg)] ${flipped ? "" : "pointer-events-none"}`}
          aria-hidden={!flipped}
        >
          {panelView === "help" ? (
            <HelpPanel onClose={onPanelClose} info={help} />
          ) : panelView === "stop" && (stop ?? lastStop.current) ? (
            <StopDetails s={(stop ?? lastStop.current)!} now={now} onClose={onPanelClose} />
          ) : back ? (
            <VehicleDetails
              v={back.v}
              r={back.r}
              upcoming={back.u}
              beyond={back.b}
              onClose={onClose}
              now={now}
              routeStatus={routeStatus}
            />
          ) : null}
        </div>
      </div>
    </aside>
  );
}

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
}: {
  v: Vehicle;
  r?: TransitRoute | undefined;
  upcoming: UpcomingStop[];
  beyond: UpcomingStop[];
  onClose: () => void;
  now: number;
  routeStatus: Props["routeStatus"];
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
        <ol className="relative ml-5 mr-3 border-l border-dashed border-border">
          {stops.map((u) => (
            <li key={u.key} className="relative flex items-center gap-2 py-1.5 pl-4">
              <span
                className={`absolute -left-[5px] size-2.5 rounded-full ${accent ? "bg-primary" : "border border-muted-foreground bg-surface"}`}
              />
              <div className="min-w-0 flex-1">
                <div
                  className={`truncate text-xs font-semibold ${accent ? "" : "text-foreground/70"}`}
                >
                  {u.name}
                </div>
                <div className="text-[10px] text-muted-foreground">{u.aheadM} m ahead</div>
              </div>
              {/* TPulso: one source state per stop time (Live / Scheduled / Estimated) */}
              <span
                className={`flex items-center gap-1.5 font-display text-sm font-bold ${accent ? "text-primary" : "text-muted-foreground"}`}
                aria-label={`${SOURCE_TEXT[u.state]} ${countdownLabel(nowSec + u.etaS, nowSec, u.state)}`}
              >
                <SourceDot state={u.state} />
                {countdownLabel(nowSec + u.etaS, nowSec, u.state)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** TPulso: tapping a stop shows its departures for the next 10 minutes. */
function StopDetails({ s, now, onClose }: { s: StopPanel; now: number; onClose: (() => void) | undefined }) {
  const nowSec = Math.floor(now / 1000);
  const ageSec = s.fetchedAt ? (now - s.fetchedAt) / 1000 : 0;
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Stop" icon={MapPin} onClose={onClose} />
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-primary">
          <MapPin className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="font-display text-lg font-bold leading-tight">{s.name}</div>
          <div className="text-[11px] text-muted-foreground">{s.distanceM} m away · next 10 min</div>
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
                <li key={d.id} className={`flex items-center gap-2.5 rounded-xl bg-surface-2/60 px-2.5 py-1.5 ${state === "stale" ? "opacity-60" : ""}`}>
                  <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${DOT[d.mode]}`}>
                    <Icon className="size-3.5 text-primary-foreground" />
                  </span>
                  <div className="min-w-0 flex-1 truncate">
                    <span className="font-display text-xs font-bold">{d.line}</span>{" "}
                    <span className="text-xs text-foreground/80">{d.destination}</span>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center justify-end gap-1.5 font-display text-sm font-bold leading-none text-primary">
                      <SourceDot state={state} />
                      <span className="tabular-nums">{countdownLabel(Math.round(d.expectedAt / 1000), nowSec, state)}</span>
                    </div>
                    <div className="mt-0.5 text-[9px] text-muted-foreground">
                      {state === "stale" ? `last seen ${agoLabel(ageSec)} ago` : state === "scheduled" ? "scheduled" : <DelayText delayMin={Math.round(d.delaySec / 60)} />}
                    </div>
                  </div>
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
  const mins = dep ? Math.max(0, Math.round((dep.expectedAt - Date.now()) / 60_000)) : null;
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
