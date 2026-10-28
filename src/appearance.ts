// TPulso: the app's appearance — "Standard" (the original dark Pulse look) or "Azulejo" (white and cobalt,
// Portuguese tiles). One attribute on <html> (data-appearance) switches every style in styles.css; the choice is
// remembered on this device. Applied before the first paint (main.tsx), so the page never flashes.
import { useSyncExternalStore } from 'react';
import { applyThemeColors } from './config';

export type Appearance = 'standard' | 'azulejo';
const KEY = 'tpulso:appearance';
const listeners = new Set<() => void>();

function stored(): Appearance {
  try {
    return localStorage.getItem(KEY) === 'azulejo' ? 'azulejo' : 'standard';
  } catch {
    return 'standard'; // no storage (private mode, blocked): the default look
  }
}

let current: Appearance = typeof window === 'undefined' ? 'standard' : stored();

/** Put the appearance on the page: the attribute for the CSS, the theme colours, the browser bar colour. */
export function applyAppearance(a: Appearance = current): void {
  const root = document.documentElement;
  root.dataset.appearance = a;
  root.style.colorScheme = a === 'azulejo' ? 'light' : 'dark';
  applyThemeColors(root, a);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', a === 'azulejo' ? '#ffffff' : '#141a2b');
}

export function setAppearance(a: Appearance): void {
  current = a;
  try {
    localStorage.setItem(KEY, a);
  } catch {
    /* not remembered, still applied */
  }
  applyAppearance(a);
  for (const l of listeners) l();
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}
