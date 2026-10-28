// TML hub alerts (docs/ALERTS.md §1): the main source. Lines, stops and agencies are named by the regional GTFS
// keys, so they are passed on as they are; nothing is matched by name.
import { notEnded, type AlertSource, type ServiceAlert } from '../../../shared/alerts';
import { AlertSourceError, fetchText, httpsUrl, type FetchFn } from './fetchText';

export const TML_HUB_ALERTS_URL = 'https://go.tmlmobilidade.pt/hub/api/v1/alerts';

interface RawRef {
  parent_id?: unknown;
  child_ids?: unknown;
}
interface RawAlert {
  _id?: unknown;
  agency_id?: unknown;
  title?: unknown;
  description?: unknown;
  cause?: unknown;
  effect?: unknown;
  active_period_start_date?: unknown;
  active_period_end_date?: unknown;
  reference_type?: unknown;
  references?: unknown;
  info_url?: unknown;
  image_url?: unknown;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const ms = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);

/** References grouped by parent (the hub repeats the same reference several times). */
function grouped(refs: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!Array.isArray(refs)) return out;
  for (const r of refs as RawRef[]) {
    const parent = str(r?.parent_id);
    if (!parent) continue;
    let set = out.get(parent);
    if (!set) out.set(parent, (set = new Set()));
    for (const c of ids(r.child_ids)) set.add(c);
  }
  return out;
}

/** One hub alert in our shape, or null when it lacks an id, agency or title. */
export function normaliseTmlAlert(a: RawAlert): ServiceAlert | null {
  const id = str(a._id);
  const agencyId = str(a.agency_id);
  const title = str(a.title);
  if (!id || !agencyId || !title) return null;
  const type = a.reference_type === 'lines' || a.reference_type === 'stops' ? a.reference_type : 'agency';
  const refs = grouped(a.references);
  return {
    id: `tml:${id}`,
    source: 'tml',
    agencyId,
    scope: type,
    lines: type === 'lines' ? [...refs].map(([lineId, stops]) => ({ lineId, stopIds: [...stops] })) : [],
    stops: type === 'stops' ? [...refs].map(([stopId, lines]) => ({ stopId, lineIds: [...lines] })) : [],
    title,
    description: str(a.description),
    cause: str(a.cause) || 'UNKNOWN_CAUSE',
    effect: str(a.effect) || 'UNKNOWN_EFFECT',
    start: ms(a.active_period_start_date),
    end: ms(a.active_period_end_date),
    endAssumed: false,
    url: httpsUrl(a.info_url),
    imageUrl: httpsUrl(a.image_url),
  };
}

/** The hub's alerts that have not ended (current and announced). */
export function parseTmlHub(body: string, nowMs: number): ServiceAlert[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new AlertSourceError('invalid JSON');
  }
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new AlertSourceError('no data list');
  const out: ServiceAlert[] = [];
  const seen = new Set<string>();
  for (const raw of data as RawAlert[]) {
    const a = raw && typeof raw === 'object' ? normaliseTmlAlert(raw) : null;
    if (!a || seen.has(a.id) || !notEnded(a, nowMs)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

export class TmlHubAlerts implements AlertSource {
  readonly id = 'tml' as const;
  private readonly fetchFn: FetchFn;
  constructor(fetchFn: FetchFn = (u, i) => fetch(u, i)) {
    this.fetchFn = fetchFn;
  }
  async fetchAlerts(nowMs: number): Promise<ServiceAlert[]> {
    return parseTmlHub(await fetchText(this.fetchFn, TML_HUB_ALERTS_URL, 60), nowMs);
  }
}
