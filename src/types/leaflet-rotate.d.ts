// TPulso: the parts of leaflet-rotate 0.2.8 we use (the package ships no types).
import 'leaflet';

declare module 'leaflet' {
  interface MapOptions {
    rotate?: boolean;
    bearing?: number;
    touchRotate?: boolean;
    rotateControl?: boolean;
    shiftKeyRotate?: boolean;
  }
  interface Map {
    /** Rotate the map: the screen shows north at `theta` degrees clockwise from up. */
    setBearing(theta: number): this;
    getBearing(): number;
  }
}

declare module 'leaflet-rotate';
