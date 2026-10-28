// App-wide settings. Change the map look here, in one place.

export interface TileConfig {
  /** Leaflet URL template. */
  url: string;
  attribution: string;
  maxZoom: number;
  /** CSS class for the tile layer (only the fallback needs the original's dark filter). */
  className: string;
  /** Shown on the map when the tiles are not the intended production tiles. */
  problem: string | null;
}

/**
 * Intended tiles: CARTO "Dark Matter" without labels. CARTO needs a free key (carto.com/basemaps/apikey, email only);
 * put it in `.env` as VITE_CARTO_BASEMAPS_KEY (git-ignored). It is a public browser key: restrict it to your domains
 * in the CARTO dashboard before release.
 *
 * Without a key the map falls back to the standard OpenStreetMap tiles with the original OV Pulse dark filter.
 * That is fine for development, but OpenStreetMap's tile usage policy does not allow it for a real app.
 */
const CARTO_KEY: string = import.meta.env.VITE_CARTO_BASEMAPS_KEY ?? '';

export const MAP_TILES: TileConfig = CARTO_KEY
  ? {
      url: `https://basemaps.cartocdn.com/rastertiles/dark_nolabels/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_KEY)}`,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20,
      className: '',
      problem: null,
    }
  : {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      className: 'tiles-dark',
      problem: 'Development map tiles (OpenStreetMap). Add a CARTO key for the real map.',
    };

/**
 * TPulso: map tiles per appearance. "Standard" uses the dark tiles above; "Azulejo" (light theme) uses CARTO
 * "Positron" without labels, with the same key. Without a key both fall back to OpenStreetMap (dark-filtered for
 * Standard only).
 */
export function mapTilesFor(appearance: 'standard' | 'azulejo'): TileConfig {
  if (appearance === 'standard') return MAP_TILES;
  return CARTO_KEY
    ? { ...MAP_TILES, url: `https://basemaps.cartocdn.com/rastertiles/light_nolabels/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_KEY)}` }
    : { ...MAP_TILES, className: '' };
}

/**
 * Live data (TML API) feature flag. Off: TPulso is an offline timetable app (docs/OFFLINE.md). The live code is
 * kept and tested but never called while this is false. Turn on with VITE_LIVE=true (and LIVE_ENABLED in wrangler).
 */
export const LIVE_ENABLED: boolean = import.meta.env.VITE_LIVE === 'true';

/**
 * The four mode colours — the only colours that mean "which kind of transport", used everywhere (vehicle markers,
 * route lines, station rings, list icons, legend, filter chips). No per-line or per-operator colours.
 * Chosen for the dark CARTO map and checked with simulated protanopia, deuteranopia and tritanopia (Machado 2009):
 * every pair stays at least 23 dE (CIE76) apart, and each is 3.6:1 or more against the map. The mode is also
 * shown by the icon/glyph, never by colour alone.
 */
export const MODE_COLORS = {
  bus: '#FFCC00', // yellow
  tram: '#E28FFF', // purple (tram and metro)
  train: '#1F6FEB', // blue (CP, Fertagus)
  ferry: '#FF4A3D', // red
} as const;

/** Text colour on top of each mode colour (best contrast). */
export const MODE_TEXT = {
  bus: '#000000',
  tram: '#000000',
  train: '#FFFFFF',
  ferry: '#000000',
} as const;

/** Radar circle, ticks and the user dot: neutral light grey, so they are never mistaken for Train blue. */
export const RADAR_COLOR = '#E5E7EB';
/** The same neutral role on the white "Azulejo" map: a neutral dark grey (still never blue). */
export const RADAR_COLOR_LIGHT = '#4B5563';

/**
 * "Azulejo" appearance: the vehicle tiles (Azul board game style) use, per mode, a pale glaze of the mode colour
 * and a slightly deeper shade of it for the flower motif — the same four mode colours, made readable on white
 * (pure bus yellow is too pale there). Cobalt is the tile blue of the theme, kept clearly apart from Train blue.
 */
export const MODE_GLAZE = { bus: '#FFF4CC', tram: '#F6E6FD', train: '#E3EDFD', ferry: '#FDE5E3' } as const;
export const MODE_TILE = { bus: '#E0A800', tram: '#B65BD6', train: '#1F6FEB', ferry: '#E53B2F' } as const;
export const COBALT = '#1D4F8F';

/** Publish the colours as CSS variables (--bus, --bus-text, …, --radar) for styles.css and Tailwind classes. */
export function applyThemeColors(root: HTMLElement = document.documentElement, appearance: 'standard' | 'azulejo' = 'standard'): void {
  for (const [mode, color] of Object.entries(MODE_COLORS)) {
    root.style.setProperty(`--${mode}`, color);
    root.style.setProperty(`--${mode}-text`, MODE_TEXT[mode as keyof typeof MODE_TEXT]);
    root.style.setProperty(`--${mode}-glaze`, MODE_GLAZE[mode as keyof typeof MODE_GLAZE]);
    root.style.setProperty(`--${mode}-tile`, MODE_TILE[mode as keyof typeof MODE_TILE]);
  }
  const radar = appearance === 'azulejo' ? RADAR_COLOR_LIGHT : RADAR_COLOR;
  root.style.setProperty('--radar', radar);
  root.style.setProperty('--locate', radar);
  root.style.setProperty('--cobalt', COBALT);
}
