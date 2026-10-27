// TPulso: cheap upright markers on a rotated map (import after 'leaflet-rotate').
// leaflet-rotate keeps the marker pane outside the rotating pane and re-positions every marker on every rotation
// step (a JS calculation and a style write per marker, per step). Instead the marker pane goes *inside* the
// rotating pane, markers keep plain Leaflet positions (no work at all when the map turns), and each icon is
// turned back upright by one CSS variable on the pane (--bearing; see .leaflet-marker-pane in styles.css).
import L from 'leaflet';

type MarkerInternals = L.Marker & {
  _icon?: HTMLElement;
  _shadow?: HTMLElement;
  _zIndex: number;
  _resetZIndex(): void;
};

const proto = L.Marker.prototype as unknown as {
  getEvents(this: L.Marker): Record<string, unknown>;
  _setPos(this: MarkerInternals, pos: L.Point): void;
};
const rotateEvents = proto.getEvents;
proto.getEvents = function () {
  const events = rotateEvents.call(this);
  delete events.rotate; // nothing to do when the map turns: the pane turns, the icon is counter-rotated by CSS
  return events;
};
proto._setPos = function (pos) {
  // Plain Leaflet: the position is in the (rotating) pane's own coordinates.
  if (this._icon) L.DomUtil.setPosition(this._icon, pos);
  if (this._shadow) L.DomUtil.setPosition(this._shadow, pos);
  this._zIndex = pos.y + (this.options.zIndexOffset ?? 0);
  this._resetZIndex();
};

L.Map.addInitHook(function (this: L.Map & { _rotate?: boolean; _rotatePane?: HTMLElement }) {
  if (this._rotate && this._rotatePane) this._rotatePane.appendChild(this.getPane('markerPane')!);
});
