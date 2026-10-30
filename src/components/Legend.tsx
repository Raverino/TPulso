import type { CSSProperties } from 'react';
import { SourceDot } from './SourceDot';

const MODES = [
  { key: 'bus', label: 'Bus' },
  { key: 'tram', label: 'Tram/Metro' },
  { key: 'train', label: 'Train' },
  { key: 'ferry', label: 'Ferry' },
] as const;

/** TPulso: the warning triangle of the alert badge (as on the map pins). */
const ALERT_SVG = (
  <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

/** A small copy of a map vehicle pin (same classes, so it matches both appearances). */
function MiniPin({ mode }: { mode: (typeof MODES)[number]['key'] }) {
  return (
    <span className="legend-pin" aria-hidden>
      <span className="vehicle-pin is-expected" data-mode={mode}>
        <span className="pin-line" />
      </span>
    </span>
  );
}

/** A small copy of a map stop marker (ring in the colours of the modes that stop there). */
function MiniStop() {
  return (
    <span className="legend-stop" aria-hidden>
      <span className="station" style={{ '--size': '14px', '--ring': 'conic-gradient(var(--bus) 0 50%, var(--tram) 0 100%)' } as CSSProperties}>
        <span className="station-ring" />
        <span className="station-core" />
      </span>
    </span>
  );
}

/**
 * Explains the map symbols and the two timetable states (CLAUDE.md display rule, offline version), plus the alert
 * badge when alerts are on. Every symbol is drawn with the same classes as on the map.
 * "box": floating over the map (wide screens); "strip": a full-width band under the radar (phones).
 */
export function Legend({ alerts = false, live = false, variant = 'box' }: { alerts?: boolean; live?: boolean; variant?: 'box' | 'strip' }) {
  const symbols = (
    <>
      {MODES.map(({ key, label }) => (
        <li key={key} className="flex items-center gap-1">
          <MiniPin mode={key} />
          {label}
        </li>
      ))}
      <li className="flex items-center gap-1">
        <MiniStop />
        Stop
      </li>
      {alerts && (
        <li className="flex items-center gap-1">
          <span className="legend-alert" aria-hidden>
            {ALERT_SVG}Alert
          </span>
          <span className="sr-only">service alert on the line</span>
        </li>
      )}
    </>
  );
  const states = (
    <>
      <li className="flex items-center gap-1">
        <SourceDot state="expected" />
        <span>
          <b>Expected</b> position
        </span>
      </li>
      <li className="flex items-center gap-1">
        <SourceDot state="scheduled" />
        <span>
          <b>Scheduled</b> ~3 min
        </span>
      </li>
      {live && (
        <li className="flex items-center gap-1">
          <span className="legend-pin" aria-hidden>
            <span className="vehicle-pin is-live" data-mode="bus">
              <span className="src-dot src-live pin-src" />
              <span className="pin-line" />
            </span>
          </span>
          <span>
            <b>Live</b> GPS
          </span>
        </li>
      )}
    </>
  );

  if (variant === 'strip') {
    return (
      <div className="legend-strip space-y-0.5 border-b border-border bg-surface px-3 py-1 text-[10px] leading-tight text-foreground/85" aria-label="Legend" role="group">
        <ul className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">{symbols}</ul>
        <ul className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          <li className="font-bold text-foreground">{live ? 'Timetable:' : 'Timetable data, not live:'}</li>
          {states}
        </ul>
      </div>
    );
  }
  return (
    <div
      className="space-y-1 rounded-xl border border-border bg-surface/90 px-2 py-1.5 text-[10px] leading-tight text-foreground/85 shadow-float backdrop-blur-sm"
      aria-label="Legend"
      role="group"
    >
      <p className="font-bold text-foreground">{live ? 'Timetable times · live GPS buses' : 'Timetable data, not live'}</p>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">{symbols}</ul>
      <ul className="space-y-0.5">{states}</ul>
    </div>
  );
}
