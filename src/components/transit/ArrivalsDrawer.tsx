// Ported from the original OV Pulse ArrivalsDrawer.tsx: results panel with "Vehicles on the radar now"
// and "In the radar · next 10 min", tap-to-open departure rows, and the 3D flip to vehicle details.
// Changes: every row shows its data source (Live / Scheduled / Stale, CLAUDE.md), delays as text with
// an arrow. Not ported (out of MVP scope per BRIEF.md): follow/pin, Help and Feedback panels.
import { useRef, useState } from 'react';
import { ArrowLeft, Bus, Footprints, Radio } from 'lucide-react';

import { SourceDot } from '@/components/SourceDot';
import {
  agoLabel,
  countdownLabel,
  delayInfo,
  departureSource,
  SOURCE_TEXT,
  vehicleSource,
  type SourceState,
} from '@/lib/sourceStatus';
import { clock, type Arrival, type UpcomingStop } from '@/lib/transit';
import type { Vehicle } from '../../../shared/types';

export interface RadarVehicle {
  id: string;
  line: string | null;
  headsign: string | null;
  distanceM: number;
  timestamp: number;
}

interface Props {
  arrivals: Arrival[];
  radius: number;
  /** When the board was fetched (ms); null while loading. */
  boardAt: number | null;
  boardError: string | null;
  boardNote: string | null;
  now: number;
  onSelectVehicle?: (id: string) => void;
  vehicle?: Vehicle | undefined;
  vehicleRoute: { status: 'idle' | 'loading' | 'ready' | 'error'; message?: string };
  vehicleDelay: Arrival | null;
  upcoming: UpcomingStop[];
  beyond: UpcomingStop[];
  onClose: () => void;
  openId?: string | null;
  radarVehicles?: RadarVehicle[];
  onOpen?: (id: string | null) => void;
}

const radiusLabel = (r: number) => (r >= 1000 ? `${r / 1000} km` : `${r} m`);

export default function ArrivalsDrawer({
  arrivals,
  radius,
  boardAt,
  boardError,
  boardNote,
  now,
  vehicle,
  vehicleRoute,
  vehicleDelay,
  upcoming,
  beyond,
  onClose,
  onSelectVehicle,
  openId = null,
  radarVehicles = [],
  onOpen,
}: Props) {
  // Tapping a departure just reveals its stop and clock time (no path view).
  const [showVeh, setShowVeh] = useState(true);
  const [showDep, setShowDep] = useState(true);
  const tap = (a: Arrival) => onOpen?.(openId === a.id ? null : a.id);
  const nowSec = Math.floor(now / 1000);
  const boardAgeSec = boardAt ? (now - boardAt) / 1000 : 0;
  const live = boardAt !== null && arrivals.some(a => departureSource(a, boardAgeSec) === 'live');
  // Keep showing the last vehicle while the card flips back.
  const last = useRef<{ v: Vehicle; d: Arrival | null; u: UpcomingStop[]; b: UpcomingStop[] } | null>(null);
  if (vehicle) last.current = { v: vehicle, d: vehicleDelay, u: upcoming, b: beyond };
  const flipped = !!vehicle;
  const back = last.current;

  return (
    <aside className="relative min-h-0 flex-1 border-border bg-background [perspective:1400px] md:w-[360px] md:flex-none md:border-l">
      <div
        className="relative h-full w-full transition-transform duration-500 ease-out [transform-style:preserve-3d]"
        style={{ transform: flipped ? 'rotateY(180deg)' : 'none' }}
      >
        <div
          className={`absolute inset-0 flex flex-col bg-surface [backface-visibility:hidden] ${flipped ? 'pointer-events-none' : ''}`}
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
              {arrivals.length} within {radiusLabel(radius)}
            </p>
          </div>

          <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain p-2 [-webkit-overflow-scrolling:touch]">
            <section className="mb-3">
              <Toggle label={`Vehicles on the radar now · ${radarVehicles.length}`} open={showVeh} onChange={setShowVeh} />
              {showVeh && radarVehicles.length === 0 && (
                <p className="px-2 pb-2 text-[11px] text-muted-foreground">No vehicles inside the circle right now.</p>
              )}
              {showVeh && (
                <ul className="space-y-1">
                  {radarVehicles.map(v => {
                    const src = vehicleSource(v, now);
                    return (
                      <li
                        key={v.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onSelectVehicle?.(v.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') onSelectVehicle?.(v.id);
                        }}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-xl bg-surface-2/60 px-2.5 py-1.5 hover:bg-surface-2 ${src.state === 'stale' ? 'opacity-60' : ''}`}
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-bus">
                          <Bus className="size-3.5 text-primary-foreground" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate">
                            <span className="font-display text-xs font-bold">{v.line ?? '?'}</span>{' '}
                            <span className="truncate text-xs text-foreground/80">{v.headsign ?? 'destination not available'}</span>
                          </div>
                          <SourceLine state={src.state} text={`${SOURCE_TEXT[src.state]} position · last seen ${agoLabel(src.ageSec)} ago`} />
                        </div>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{v.distanceM} m</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {boardAt === null && !boardError ? (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">Loading departures…</p>
            ) : boardAt === null && boardError ? (
              <p className="px-2 py-8 text-center text-sm text-destructive">Departures unavailable: {boardError}</p>
            ) : (
              <section>
                <Toggle label={`In the radar · next 10 min · ${arrivals.length}`} open={showDep} onChange={setShowDep} />
                {boardError && (
                  <p className="px-2 pb-1 text-[11px] text-destructive">
                    Refresh failed ({boardError}); showing departures from {agoLabel(boardAgeSec)} ago.
                  </p>
                )}
                {boardNote && <p className="px-2 pb-1 text-[11px] text-muted-foreground">{boardNote}</p>}
                {showDep && arrivals.length === 0 && (
                  <p className="px-2 pb-2 text-[11px] text-muted-foreground">Nothing leaving inside the circle in the next 10 minutes.</p>
                )}
                <ul className={`space-y-1 ${showDep ? '' : 'hidden'}`}>
                  {arrivals.map(a => {
                    const state = departureSource(a, boardAgeSec);
                    const at = a.estimatedAt ?? a.scheduledAt;
                    const delay = state === 'live' ? delayInfo(a) : null;
                    return (
                      <li
                        key={a.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => tap(a)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') tap(a);
                        }}
                        className={`flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl bg-surface-2/60 px-2.5 py-1.5 transition-colors hover:bg-surface-2 ${state === 'stale' ? 'opacity-60' : ''}`}
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-bus">
                          <Bus className="size-3.5 text-primary-foreground" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-1.5">
                            <span className="font-display text-xs font-bold">{a.line}</span>
                            <span className="truncate text-xs text-foreground/80">{a.headsign}</span>
                          </div>
                          <div className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                            <Footprints className="size-2.5 shrink-0" />
                            <span className="truncate">
                              {a.stopName} · {a.distanceM} m · Bus
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="flex items-center justify-end gap-1.5 font-display text-sm font-bold leading-none">
                            <SourceDot state={state} />
                            <span className="tabular-nums">{countdownLabel(at, nowSec, state)}</span>
                          </div>
                          <div className="mt-0.5 text-[9px] text-muted-foreground">
                            {state === 'stale' ? (
                              `last seen ${agoLabel(boardAgeSec)} ago`
                            ) : state === 'scheduled' ? (
                              'scheduled'
                            ) : delay ? (
                              <span className={delay.minutes > 0 ? 'text-destructive' : 'text-accent'} aria-label={delay.spoken}>
                                {delay.arrow} {delay.text}
                              </span>
                            ) : (
                              'live · on time'
                            )}
                          </div>
                        </div>
                        {openId === a.id && (
                          <div className="basis-full rounded-lg bg-background/60 px-2 py-1.5 text-[11px]">
                            <div>
                              <span className="text-muted-foreground">Stop: </span>
                              <span className="font-semibold">{a.stopName}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">{state === 'live' ? 'Expected: ' : 'Scheduled: '}</span>
                              <span className="font-display font-bold tabular-nums text-primary">
                                {state === 'live' ? '' : '~'}
                                {clock(at * 1000)}
                              </span>
                              {a.estimatedAt !== null && delayInfo(a) && (
                                <span className="text-muted-foreground"> (scheduled {clock(a.scheduledAt * 1000)})</span>
                              )}
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        </div>

        <div
          className={`absolute inset-0 flex flex-col bg-surface [backface-visibility:hidden] [transform:rotateY(180deg)] ${flipped ? '' : 'pointer-events-none'}`}
          aria-hidden={!flipped}
        >
          {back ? (
            <VehicleDetails
              v={back.v}
              delay={back.d}
              routeState={vehicleRoute}
              upcoming={back.u}
              beyond={back.b}
              now={now}
              onClose={onClose}
            />
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function SourceLine({ state, text }: { state: SourceState; text: string }) {
  return (
    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <SourceDot state={state} />
      <span className="truncate">{text}</span>
    </div>
  );
}

function VehicleDetails({
  v,
  delay,
  routeState,
  upcoming,
  beyond,
  now,
  onClose,
}: {
  v: Vehicle;
  delay: Arrival | null;
  routeState: Props['vehicleRoute'];
  upcoming: UpcomingStop[];
  beyond: UpcomingStop[];
  now: number;
  onClose: () => void;
}) {
  const src = vehicleSource(v, now);
  const d = delay ? delayInfo(delay) : null;
  const routeMissing = routeState.status === 'ready' && upcoming.length + beyond.length === 0;
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
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-bus">
          <Bus className="size-5 text-primary-foreground" />
        </span>
        <div className="min-w-0">
          <div className="font-display text-lg font-bold leading-tight">
            {v.line ?? '?'} <span className="font-medium text-foreground/70">→ {v.headsign ?? '—'}</span>
          </div>
          <div className="truncate text-[11px] text-muted-foreground">Carris Metropolitana · Bus</div>
        </div>
      </div>

      {v.line === null && (
        <div className="mx-3 mb-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px]">
          <div className="font-display text-xs font-bold text-destructive">(?) Unknown line</div>
          <div className="text-muted-foreground">This bus reports a line that is not in the operator's line list.</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
        <div className="rounded-xl bg-surface-2/70 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Position</div>
          <div className="flex items-center gap-1.5 font-display text-sm font-bold">
            <SourceDot state={src.state} /> {SOURCE_TEXT[src.state]}
          </div>
          <div className="text-[10px] text-muted-foreground">last seen {agoLabel(src.ageSec)} ago</div>
        </div>
        <div className="rounded-xl bg-surface-2/70 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Punctuality</div>
          <div className="font-display text-sm font-bold">
            {!delay ? (
              <span className="text-muted-foreground">Not known</span>
            ) : d ? (
              <span className={d.minutes > 0 ? 'text-destructive' : 'text-accent'} aria-label={d.spoken}>
                {d.arrow} {d.text}
              </span>
            ) : (
              <span className="text-accent">On time</span>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground">{delay ? `at ${delay.stopName}` : 'no live time nearby'}</div>
        </div>
      </div>

      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain pb-3">
        {routeState.status === 'loading' && <p className="px-4 py-3 text-center text-xs text-muted-foreground">Loading route…</p>}
        {routeState.status === 'error' && (
          <p className="px-4 py-3 text-center text-xs text-destructive">Route unavailable: {routeState.message}</p>
        )}
        {routeMissing && (
          <p className="px-4 py-3 text-center text-xs text-muted-foreground">
            The operator has no route data for this bus today, so its stops and route line can't be shown.
          </p>
        )}
        {routeState.status === 'ready' && !routeMissing && (
          <>
            <StopSection title="Next stops in radar" stops={upcoming} empty="No more stops for this vehicle inside the radius." accent now={now} />
            <StopSection title="Further along the line" stops={beyond} empty="No further stops." now={now} />
          </>
        )}
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
        <span className="text-[10px] text-muted-foreground">{stops.length || ''}</span>
      </div>
      {stops.length === 0 ? (
        <p className="px-4 py-3 text-center text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ol className="relative ml-5 mr-3 border-l border-dashed border-border">
          {stops.map(u => (
            <li key={u.key} className="relative flex items-center gap-2 py-1.5 pl-4">
              <span
                className={`absolute -left-[5px] size-2.5 rounded-full ${accent ? 'bg-primary' : 'border border-muted-foreground bg-surface'}`}
              />
              <div className={`min-w-0 flex-1 truncate text-xs font-semibold ${accent ? '' : 'text-foreground/70'}`}>{u.name}</div>
              {u.estimatedAt !== null ? (
                <span className="flex items-center gap-1.5 font-display text-sm font-bold">
                  <SourceDot state="live" />
                  {countdownLabel(u.estimatedAt, nowSec, 'live')}
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground">no live time</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Toggle({ label, open, onChange }: { label: string; open: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-1.5 px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
      <input
        type="checkbox"
        checked={open}
        onChange={e => onChange(e.target.checked)}
        className="size-3 accent-[var(--primary)]"
        aria-label={`Show ${label}`}
      />
      {label}
    </label>
  );
}
