// Operators in the TML regional GTFS feed (docs/OPERATORS.md). The regional feed is the source, except for
// operators marked useOwnFeed (their own feed replaces their part of it); other own feeds are only used to
// cross-check today's trip count.

export interface OperatorConfig {
  id: string;
  name: string;
  /** agency_id values in the TML regional feed. */
  agencies: string[];
  /** Operator's own GTFS feed, for the cross-check (null = none exists). */
  ownFeed: string | null;
  /** Use the operator's own feed instead of its part of the regional feed (it is the more reliable one). */
  useOwnFeed?: boolean;
  /**
   * Its vehicles report their GPS position with the GTFS trip_id (Carris Metropolitana's open API): the build
   * writes a trip_id index per line (live/<line>.json) so the app links each live bus to its timetable trip.
   */
  liveTrips?: boolean;
}

export const TML_FEED_URL = 'https://go.tmlmobilidade.pt/hub/api/v1/plans/gtfs';

export const OPERATORS: OperatorConfig[] = [
  // The TML feed is its own feed. Live GPS: all 1 157 live trip_ids matched trips.txt exactly (2026-10-30).
  { id: 'cm', name: 'Carris Metropolitana', agencies: ['LA77N', 'BNA17', 'YA15B', 'A2L1N'], ownFeed: null, liveTrips: true },
  // Metro: its own feed has the full rush-hour service (Marqu?s de Pombal 19-20 h: 47 trains vs 30 in the
  // regional feed, 27 Oct 2026), so it replaces the regional Metro trips.
  { id: 'metro', name: 'Metro de Lisboa', agencies: ['IA2N9'], ownFeed: 'https://www.metrolisboa.pt/google_transit/googleTransit.zip', useOwnFeed: true },
  { id: 'cp', name: 'CP – Comboios de Portugal', agencies: ['N18KL'], ownFeed: 'https://publico.cp.pt/gtfs/gtfs.zip' },
  { id: 'fertagus', name: 'Fertagus', agencies: ['7NTB1'], ownFeed: 'https://www.fertagus.pt/GTFSTMLzip/Fertagus_GTFS.zip' },
  { id: 'ttsl', name: 'Transtejo / Soflusa', agencies: ['LTP61'], ownFeed: null },
  { id: 'mts', name: 'MTS – Metro Transportes do Sul', agencies: ['KB1F6'], ownFeed: 'https://mts.pt/imt/MTS-20240129.zip' },
  { id: 'carris', name: 'Carris', agencies: ['IA9T6'], ownFeed: 'https://gateway.carris.pt/gateway/gtfs/api/v2.11/GTFS' },
  { id: 'tcb', name: 'TCB – Transportes Colectivos do Barreiro', agencies: ['A3H3M'], ownFeed: 'https://backend.tcbarreiro.pt/download-gtfs' },
  { id: 'mobicascais', name: 'MobiCascais', agencies: ['HF16N'], ownFeed: 'https://drive.google.com/uc?export=download&id=13ucYiAJRtu-gXsLa02qKJrGOgDjbnUWX' },
];

/** Allowed difference between the regional feed and an operator's own feed (today's trips). */
export const CROSS_CHECK_TOLERANCE_PCT = 10;
