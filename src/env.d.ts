/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public CARTO basemaps key (see src/config.ts). */
  readonly VITE_CARTO_BASEMAPS_KEY?: string;
}
