// All alert sources combined. A failing source does not hide the others: the list says which sources answered.
// The finished list is kept in memory for 60 s (15 s when a source failed, so it recovers quickly).
import type { AlertList, AlertSource, AlertsProvider } from '../../../shared/alerts';
import { AlertSourceError } from './fetchText';

const TTL_MS = 60_000;
const TTL_PARTIAL_MS = 15_000;

export class AllSourcesFailed extends Error {}

export class CombinedAlerts implements AlertsProvider {
  private readonly sources: AlertSource[];
  private memo: { expires: number; value: Promise<AlertList> } | null = null;

  constructor(sources: AlertSource[]) {
    this.sources = sources;
  }

  alerts(nowMs: number): Promise<AlertList> {
    if (this.memo && this.memo.expires > nowMs) return this.memo.value;
    const value = this.load(nowMs);
    const memo = { expires: nowMs + TTL_MS, value };
    this.memo = memo;
    value.then(
      list => {
        if (list.sources.some(s => !s.ok)) memo.expires = nowMs + TTL_PARTIAL_MS;
      },
      () => {
        if (this.memo === memo) this.memo = null; // never keep a total failure
      },
    );
    return value;
  }

  private async load(nowMs: number): Promise<AlertList> {
    const results = await Promise.allSettled(this.sources.map(s => s.fetchAlerts(nowMs)));
    const list: AlertList = { generatedAt: new Date(nowMs).toISOString(), sources: [], alerts: [] };
    results.forEach((r, i) => {
      const id = this.sources[i]!.id;
      if (r.status === 'fulfilled') {
        list.sources.push({ id, ok: true, count: r.value.length });
        list.alerts.push(...r.value);
      } else {
        const e = r.reason;
        // Only our own short messages go to the app; anything else (network, timeout) is logged.
        if (!(e instanceof AlertSourceError)) console.error('alert source failed', id, e);
        list.sources.push({ id, ok: false, count: 0, error: e instanceof AlertSourceError ? e.message : 'unreachable' });
      }
    });
    if (list.sources.length && list.sources.every(s => !s.ok)) throw new AllSourcesFailed('every alert source failed');
    return list;
  }
}
