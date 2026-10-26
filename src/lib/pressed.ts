// TPulso: instant pressed state. CSS :active can lag on touch screens (the browser first waits to see whether
// the touch becomes a scroll), so the touched control gets .is-pressed on pointerdown, in the same frame.
// It is removed on release, cancel, or as soon as the finger moves more than 8 px (a scroll or map drag).
const TAPPABLE = 'button, [role="button"], .leaflet-marker-icon';

export function installPressedState(): void {
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = (e.target as Element | null)?.closest?.(TAPPABLE);
      if (!el || (el as HTMLButtonElement).disabled) return;
      el.classList.add('is-pressed');
      const x = e.clientX, y = e.clientY;
      const end = () => {
        el.classList.remove('is-pressed');
        window.removeEventListener('pointerup', end, true);
        window.removeEventListener('pointercancel', end, true);
        window.removeEventListener('pointermove', move, true);
      };
      const move = (m: PointerEvent) => {
        if (Math.abs(m.clientX - x) + Math.abs(m.clientY - y) > 8) end();
      };
      window.addEventListener('pointerup', end, true);
      window.addEventListener('pointercancel', end, true);
      window.addEventListener('pointermove', move, { capture: true, passive: true });
    },
    { capture: true, passive: true },
  );
}
