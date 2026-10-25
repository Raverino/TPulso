// App-wide settings. Change the map look here, in one place.

export interface TileConfig {
  /** Leaflet URL template. */
  url: string;
  attribution: string;
  maxZoom: number;
  /** Shown on the map when the tiles cannot work as configured (e.g. a missing key). */
  problem: string | null;
}

/**
 * CARTO basemaps need a free key since 2026 (request one at carto.com/basemaps/apikey); without it
 * every tile is an "API KEY REQUIRED" placeholder. Put it in `.env` as VITE_CARTO_BASEMAPS_KEY
 * (git-ignored). It is a public browser key: restrict it to your domains in the CARTO dashboard.
 */
const CARTO_KEY: string = import.meta.env.VITE_CARTO_BASEMAPS_KEY ?? '';
const CARTO_STYLE = 'dark_nolabels';

/** Base map: CARTO "Dark Matter" without labels (already dark, so no CSS filter is applied). */
export const MAP_TILES: TileConfig = {
  url: `https://basemaps.cartocdn.com/rastertiles/${CARTO_STYLE}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_KEY)}`,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a> · Carris Metropolitana',
  maxZoom: 20,
  problem: CARTO_KEY ? null : 'Map background needs a CARTO key (VITE_CARTO_BASEMAPS_KEY in .env).',
};
