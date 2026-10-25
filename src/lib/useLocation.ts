import { useCallback, useEffect, useRef, useState } from 'react';
import { distanceMeters } from '../../shared/geo';
import { isInsideBounds, type RegionConfig } from '../../shared/region';
import type { LatLng } from '../../shared/types';

export type TestReason = 'denied' | 'unavailable' | 'outside' | 'timeout';

export type LocationState =
  | { mode: 'locating' }
  | { mode: 'gps'; position: LatLng; accuracy: number }
  | { mode: 'test'; position: LatLng; reason: TestReason };

const FIRST_FIX_TIMEOUT_MS = 10_000;
/** Like the original: only move the radar when you have moved more than this. */
const MOVE_THRESHOLD_M = 15;

/**
 * GPS position (followed continuously, like the original OV Pulse), or the region's TEST point when
 * GPS is denied, unavailable, too slow, or outside the region. `locate()` asks again.
 */
export function useLocation(region: RegionConfig): { state: LocationState; locate: () => void } {
  const [state, setState] = useState<LocationState>({ mode: 'locating' });
  const watchId = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const locate = useCallback(() => {
    const test = (reason: TestReason): LocationState => ({
      mode: 'test',
      position: { lat: region.testLocation.lat, lng: region.testLocation.lng },
      reason,
    });
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setState(test('unavailable'));
      return;
    }
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    clearTimeout(timer.current);
    setState(s => (s.mode === 'gps' ? s : { mode: 'locating' }));

    timer.current = setTimeout(() => setState(s => (s.mode === 'locating' ? test('timeout') : s)), FIRST_FIX_TIMEOUT_MS);
    watchId.current = navigator.geolocation.watchPosition(
      pos => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!isInsideBounds(here, region.bounds)) {
          setState(test('outside'));
          return;
        }
        setState(s =>
          s.mode === 'gps' && distanceMeters(s.position, here) <= MOVE_THRESHOLD_M
            ? { ...s, accuracy: pos.coords.accuracy }
            : { mode: 'gps', position: here, accuracy: pos.coords.accuracy },
        );
      },
      err => {
        // Keep a working GPS position on a temporary error; otherwise fall back to TEST.
        setState(s => (s.mode === 'gps' ? s : test(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')));
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );
  }, [region]);

  useEffect(() => {
    locate();
    return () => {
      clearTimeout(timer.current);
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [locate]);

  return { state, locate };
}
