// Operators in the TML regional GTFS feed (docs/OPERATORS.md). The regional feed is the single source;
// each operator's own feed is used only to cross-check today's trip count.

export interface OperatorConfig {
  id: string;
  name: string;
  /** agency_id values in the TML regional feed. */
  agencies: string[];
  /** Operator's own GTFS feed, for the cross-check (null = none exists). */
  ownFeed: string | null;
}

export const TML_FEED_URL = 'https://go.tmlmobilidade.pt/hub/api/v1/plans/gtfs';

export const OPERATORS: OperatorConfig[] = [
  { id: 'cm', name: 'Carris Metropolitana', agencies: ['LA77N', 'BNA17', 'YA15B', 'A2L1N'], ownFeed: null }, // the TML feed is its own feed
  { id: 'metro', name: 'Metro de Lisboa', agencies: ['IA2N9'], ownFeed: 'https://www.metrolisboa.pt/google_transit/googleTransit.zip' },
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
