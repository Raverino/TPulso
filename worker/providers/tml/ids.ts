// TML IDs carry namespace tags such as "[YA15B]" (agency) or "[PL3CL][YA15B]" (plan + agency),
// and different endpoints use different forms of the same ID (see docs/DATA.md §2).
//
// Approved exception to the "exact keys only" rule, for exactly two links (docs/DATA.md §3):
//   1. arrival.line_id    "[YA15B]3715"            -> /lines id    "3715"
//   2. vehicle.pattern_id "[PL3CL][YA15B]3715_0_1" -> /patterns id "3715_0_1"
// Never use this on names or for anything else.

const NAMESPACE_PREFIX = /^(?:\[[A-Za-z0-9]+\])+/;

export function stripNamespace(id: string): string {
  return id.replace(NAMESPACE_PREFIX, '');
}
