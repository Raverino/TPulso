import { Bus, Ship, TrainFront, TramFront } from 'lucide-react';
import { MODE_COLORS } from '@/config';
import { SourceDot } from './SourceDot';

const MODES = [
  { key: 'bus', label: 'Bus', icon: Bus },
  { key: 'tram', label: 'Tram/Metro', icon: TramFront },
  { key: 'train', label: 'Train', icon: TrainFront },
  { key: 'ferry', label: 'Ferry', icon: Ship },
] as const;

/** Explains the two timetable states (CLAUDE.md display rule, offline version). */
export function Legend() {
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
    </ul>
  );
}
