import { SourceDot } from './SourceDot';

/** Explains the data-source states (CLAUDE.md display rule). */
export function Legend() {
  return (
    <ul
      className="space-y-0.5 rounded-xl border border-border bg-surface/90 px-2 py-1.5 text-[10px] leading-tight text-foreground/85 shadow-float backdrop-blur-sm"
      aria-label="Legend"
    >
      <li className="flex items-center gap-1.5">
        <SourceDot state="live" />
        <span>
          <b>Live</b> · 3 min
        </span>
      </li>
      <li className="flex items-center gap-1.5">
        <SourceDot state="scheduled" />
        <span>
          <b>Scheduled</b> · ~3 min
        </span>
      </li>
      <li className="flex items-center gap-1.5">
        <SourceDot state="estimated" />
        <span>
          <b>Estimated</b> · ~3 min
        </span>
      </li>
      <li className="flex items-center gap-1.5">
        <SourceDot state="stale" />
        <span>
          <b>Stale</b> · last seen … ago
        </span>
      </li>
    </ul>
  );
}
