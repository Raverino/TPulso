import { useEffect, useState } from 'react';
import type { DepartureList } from '../../shared/types';
import { api } from './api';
import { BOARD_POLL_MS } from './useBoard';

export interface StopDeparturesState {
  list: DepartureList | null;
  fetchedAt: number | null;
  error: string | null;
}

/**
 * Departures of one tapped stop that is not on the board (beyond the nearest 20).
 * Pass null to do nothing. Refreshes every 20 s like the board.
 */
export function useStopDepartures(stopId: string | null): StopDeparturesState {
  const [state, setState] = useState<StopDeparturesState>({ list: null, fetchedAt: null, error: null });
  useEffect(() => {
    setState({ list: null, fetchedAt: null, error: null });
    if (!stopId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    const poll = async () => {
      try {
        const list = await api.departures(stopId, ctrl.signal);
        if (!stopped) setState({ list, fetchedAt: Date.now(), error: null });
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        if (!stopped) setState(s => ({ ...s, error: (e as Error).message }));
      }
      if (!stopped) timer = setTimeout(poll, BOARD_POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [stopId]);
  return state;
}
