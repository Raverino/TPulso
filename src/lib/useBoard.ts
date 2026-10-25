import { useEffect, useState } from 'react';
import type { Board, LatLng } from '../../shared/types';
import { api } from './api';

export const BOARD_POLL_MS = 20_000;

export interface BoardState {
  board: Board | null;
  /** When the shown board was fetched (ms); used for the "stale" source state. */
  fetchedAt: number | null;
  error: string | null;
}

/**
 * Departures for all stops inside the radar, refreshed every 20 s (as in the original).
 * If one refresh fails the last good board stays, and the rows turn "stale" as it ages.
 */
export function useBoard(center: LatLng | null, radius: number): BoardState {
  const [state, setState] = useState<BoardState>({ board: null, fetchedAt: null, error: null });
  const lat = center?.lat;
  const lng = center?.lng;

  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    // A new position or radius means a different board: don't keep showing the old one.
    setState({ board: null, fetchedAt: null, error: null });

    const poll = async () => {
      try {
        const board = await api.board({ lat, lng }, radius, ctrl.signal);
        if (!stopped) setState({ board, fetchedAt: Date.now(), error: null });
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
  }, [lat, lng, radius]);

  return state;
}
