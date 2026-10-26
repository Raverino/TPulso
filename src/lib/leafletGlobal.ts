// TPulso: leaflet-rotate (GPL-3.0, see README) patches the global `L`, which Leaflet's ES module build does not
// set. Import this module before 'leaflet-rotate' (ES modules run in import order).
import L from 'leaflet';

(window as unknown as { L: typeof L }).L = L;
