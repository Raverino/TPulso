// An operator's own GTFS feed in place of its part of the TML regional feed (docs/OPERATORS.md). Used where the
// operator's feed is the more reliable one (Metro de Lisboa: the regional feed lacks many rush-hour trains).
import type { GtfsSource, Row } from './gtfs.ts';

export interface OwnFeedReplacement {
  /** The operator's agency_id in the regional feed (its routes and trips there are dropped). */
  agencyId: string;
  /** Prefix for the own feed's ids (trips, stops, services, shapes), so they never clash with regional ids. */
  prefix: string;
  /** The operator's own feed. */
  source: GtfsSource;
}

/** Files taken from the own feed (with ids prefixed); every other file comes from the regional feed only. */
const OWN_FILES = new Set(['routes.txt', 'trips.txt', 'stop_times.txt', 'stops.txt', 'calendar.txt', 'calendar_dates.txt', 'shapes.txt']);

/**
 * The regional feed with one operator's routes and trips (and their stop times) replaced by the operator's own
 * feed. The own feed's routes keep the regional route_id of the line with the same short name (e.g. "Az"), so
 * the regional keys — used by the TML alerts — still name the line; its other ids are prefixed. Each call to
 * the returned source reads the files afresh, like any GtfsSource.
 */
export async function replaceOperatorFeed(regional: GtfsSource, rep: OwnFeedReplacement): Promise<GtfsSource> {
  const dropRoutes = new Set<string>();
  const regionalRouteOfLine = new Map<string, string>();
  for await (const r of regional('routes.txt')) {
    if (r.agency_id !== rep.agencyId) continue;
    dropRoutes.add(r.route_id!);
    if (r.route_short_name) regionalRouteOfLine.set(r.route_short_name, r.route_id!);
  }
  const dropTrips = new Set<string>();
  for await (const t of regional('trips.txt')) if (dropRoutes.has(t.route_id!)) dropTrips.add(t.trip_id!);

  const P = rep.prefix;
  const routeId = new Map<string, string>();
  for await (const r of rep.source('routes.txt')) routeId.set(r.route_id!, regionalRouteOfLine.get(r.route_short_name ?? '') ?? `${P}${r.route_id}`);

  function own(file: string, r: Row): Row {
    const x: Row = { ...r };
    if (file === 'routes.txt') {
      x.route_id = routeId.get(r.route_id!)!;
      x.agency_id = rep.agencyId;
    } else if (file === 'trips.txt') {
      x.route_id = routeId.get(r.route_id!) ?? `${P}${r.route_id}`;
      x.trip_id = P + r.trip_id;
      x.service_id = P + r.service_id;
      if (r.shape_id) x.shape_id = P + r.shape_id;
    } else if (file === 'stop_times.txt') {
      x.trip_id = P + r.trip_id;
      x.stop_id = P + r.stop_id;
    } else if (file === 'stops.txt') {
      x.stop_id = P + r.stop_id;
      if (r.parent_station) x.parent_station = P + r.parent_station;
    } else if (file === 'calendar.txt' || file === 'calendar_dates.txt') {
      x.service_id = P + r.service_id;
    } else if (file === 'shapes.txt') {
      x.shape_id = P + r.shape_id;
    }
    return x;
  }

  return async function* (file) {
    for await (const r of regional(file)) {
      if (file === 'routes.txt' && dropRoutes.has(r.route_id!)) continue;
      if ((file === 'trips.txt' || file === 'stop_times.txt') && dropTrips.has(r.trip_id!)) continue;
      yield r;
    }
    if (!OWN_FILES.has(file)) return;
    for await (const r of rep.source(file)) yield own(file, r);
  };
}
