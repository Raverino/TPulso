import { SOURCE_TEXT, type SourceState } from '../lib/sourceStatus';

/** The data-source marker. Always paired with text somewhere nearby; `label` is for screen readers. */
export function SourceDot({ state, label }: { state: SourceState; label?: string }) {
  return <span className={`src-dot src-${state}`} role="img" aria-label={label ?? SOURCE_TEXT[state]} />;
}
