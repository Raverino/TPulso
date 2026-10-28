// TPulso: service alerts from the Worker (/api/alerts, docs/ALERTS.md). Read every 60 s while the app is visible
// and again when the connection comes back. A failed refresh keeps the last list, with its age; when the server
// has alerts switched off (ALERTS_ENABLED), the app shows nothing about alerts at all.
import { useEffect, useState } from 'react';
import type { AlertList } from '../../shared/alerts';

const REFRESH_MS = 60_000;

export interface AlertsState {
  /** off = the server has alerts switched off; error = no answer (offline?), maybe with an older list. */
  status: 'off' | 'loading' | 'ok' | 'error';
  list: AlertList | null;
  /** When `list` was received (ms). */
  receivedAt: number | null;
}

export function useAlerts(): AlertsState {
  const [state, setState] = useState<AlertsState>({ status: 'loading', list: null, receivedAt: null });
  useEffect(() => {
    let alive = true;
    let off = false;
    let ctrl: AbortController | null = null;
    const load = async () => {
      if (off || document.hidden) return;
      ctrl?.abort();
      const c = (ctrl = new AbortController());
      try {
        const res = await fetch('/api/alerts', { signal: c.signal });
        if (!alive) return;
        if (res.status === 404) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          if (body?.error === 'alerts_disabled') {
            off = true;
            setState({ status: 'off', list: null, receivedAt: null });
            return;
          }
        }
        if (!res.ok) throw new Error(`answer ${res.status}`);
        const list = (await res.json()) as AlertList;
        if (alive) setState({ status: 'ok', list, receivedAt: Date.now() });
      } catch (e) {
        if (alive && !c.signal.aborted) setState((s) => ({ ...s, status: 'error' }));
        if (!(e instanceof DOMException)) console.warn('Service alerts unavailable:', e);
      }
    };
    void load();
    const t = setInterval(load, REFRESH_MS);
    const onShow = () => !document.hidden && void load();
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('online', load);
    return () => {
      alive = false;
      ctrl?.abort();
      clearInterval(t);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('online', load);
    };
  }, []);
  return state;
}
