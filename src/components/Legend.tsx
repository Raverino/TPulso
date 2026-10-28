import { Bus, Ship, TrainFront, TramFront, TriangleAlert } from 'lucide-react';
import { MODE_COLORS } from '@/config';
import { SourceDot } from './SourceDot';

const MODES = [
  { key: 'bus', label: 'Bus', icon: Bus },
  { key: 'tram', label: 'Tram/Metro', icon: TramFront },
  { key: 'train', label: 'Train', icon: TrainFront },
  { key: 'ferry', label: 'Ferry', icon: Ship },
] as const;

/**
 * Explains the two timetable states (CLAUDE.md display rule, offline version), and the alert badge when alerts are on.
 * "box": floating over the map (wide screens); "strip": a full-width band under the radar (phones), so it never
 * covers the radar.
 */
export function Legend({ alerts = false, variant = 'box' }: { alerts?: boolean; variant?: 'box' | 'strip' }) {
  if (variant === 'strip') {
    return (
      <ul
        className="legend-strip flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-border bg-surface px-3 py-1 text-[10px] leading-tight text-foreground/85"
        aria-label="Legend"
      >
        <li className="font-bold text-foreground">Timetable data, not live</li>
        {MODES.map(({ key, label, icon: Icon }) => (
          <li key={key} className="flex items-center gap-1">
            <Icon className="size-3" style={{ color: MODE_COLORS[key] }} />
            {label}
          </li>
        ))}
        <li className="flex items-center gap-1">
          <SourceDot state="scheduled" />
          <span>
            <b>Scheduled</b> ~3 min
          </span>
        </li>
        <li className="flex items-center gap-1">
          <SourceDot state="expected" />
          <span>
            <b>Expected</b> position
          </span>
        </li>
        {alerts && (
          <li className="flex items-center gap-1">
            <TriangleAlert className="alert-text size-3" aria-hidden />
            <b>Alert</b>
          </li>
        )}
      </ul>
    );
  }
  return (
    <ul
      className="space-y-0.5 rounded-xl border border-border bg-surface/90 px-2 py-1.5 text-[10px] leading-tight text-foreground/85 shadow-float backdrop-blur-sm"
      aria-label="Legend"
    >
      <li className="font-bold text-foreground">Timetable data, not live</li>
      <li className="flex flex-wrap gap-x-2 gap-y-0.5 pb-0.5">
        {MODES.map(({ key, label, icon: Icon }) => (
          <span key={key} className="flex items-center gap-1">
            <Icon className="size-3" style={{ color: MODE_COLORS[key] }} />
            {label}
          </span>
        ))}
      </li>
      <li className="flex items-center gap-1.5">
        <SourceDot state="scheduled" />
        <span>
          <b>Scheduled</b> · ~3 min
        </span>
      </li>
      <li className="flex items-center gap-1.5">
        <SourceDot state="expected" />
        <span>
          <b>Expected</b> · vehicle position from the timetable
        </span>
      </li>
      {alerts && (
        <li className="flex items-center gap-1.5">
          <TriangleAlert className="alert-text size-3" aria-hidden />
          <span>
            <b>Alert</b> · service alert on the line or stop
          </span>
        </li>
      )}
    </ul>
  );
}
