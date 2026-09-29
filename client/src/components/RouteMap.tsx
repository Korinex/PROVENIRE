import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type RouteStopStatus = "accepted" | "pending" | "conflict" | "incomplete";

export type RouteStop = {
  id: string;
  name: string;
  role: string;
  position: L.LatLngExpression;
  status: RouteStopStatus;
};

export type RouteLeg = {
  from: string;
  to: string;
  status: RouteStopStatus;
};

const STATUS_COLORS: Record<RouteStopStatus, string> = {
  accepted: "#0891b2",
  pending: "#d97706",
  conflict: "#e11d48",
  incomplete: "#64748b",
};

export type LocationSignal = "live" | "stale" | "unknown";

export function RouteMap({ stops, legs, locationSignal, vehiclePosition, className }: {
  stops: RouteStop[];
  legs: RouteLeg[];
  locationSignal: LocationSignal;
  vehiclePosition?: L.LatLngExpression | null;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const vehicleLayerRef = useRef<L.LayerGroup | null>(null);
  const fittedPositionsRef = useRef("");
  const [tilesUnavailable, setTilesUnavailable] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      scrollWheelZoom: false,
      preferCanvas: true,
    });
    const routeLayer = L.layerGroup().addTo(map);
    const vehicleLayer = L.layerGroup().addTo(map);
    const tileLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
    });
    let hasLoadedTile = false;
    tileLayer.on("tileload", () => {
      hasLoadedTile = true;
      setTilesUnavailable(false);
    });
    tileLayer.on("tileerror", () => {
      if (!hasLoadedTile) setTilesUnavailable(true);
    });
    tileLayer.addTo(map);

    mapRef.current = map;
    routeLayerRef.current = routeLayer;
    vehicleLayerRef.current = vehicleLayer;
    return () => {
      map.remove();
      mapRef.current = null;
      routeLayerRef.current = null;
      vehicleLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const routeLayer = routeLayerRef.current;
    if (!map || !routeLayer) return;

    routeLayer.clearLayers();
    const stopsById = new Map(stops.map(stop => [stop.id, stop]));
    for (const leg of legs) {
      const from = stopsById.get(leg.from);
      const to = stopsById.get(leg.to);
      if (!from || !to) continue;
      L.polyline([from.position, to.position], {
        color: STATUS_COLORS[leg.status],
        weight: leg.status === "conflict" ? 6 : 4,
        opacity: leg.status === "incomplete" ? 0.6 : 0.95,
        dashArray: leg.status === "pending" || leg.status === "incomplete" ? "9 9" : undefined,
        lineCap: "round",
      }).addTo(routeLayer);
    }

    for (const stop of stops) {
      const marker = L.circleMarker(stop.position, {
        radius: 9,
        color: "#ffffff",
        weight: 3,
        fillColor: STATUS_COLORS[stop.status],
        fillOpacity: 1,
      });
      const popup = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = stop.name;
      const role = document.createElement("div");
      role.textContent = stop.role;
      const status = document.createElement("div");
      status.textContent = `Status: ${stop.status}`;
      popup.append(name, role, status);
      marker.bindPopup(popup);
      marker.bindTooltip(stop.name, { direction: "top", offset: [0, -8] });
      marker.addTo(routeLayer);
    }

    const positionKey = stops.map(stop => {
      const point = L.latLng(stop.position);
      return `${stop.id}:${point.lat}:${point.lng}`;
    }).join("|");
    if (positionKey !== fittedPositionsRef.current) {
      const bounds = L.latLngBounds(stops.map(stop => stop.position));
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [56, 56], maxZoom: 8 });
      fittedPositionsRef.current = positionKey;
    }
    window.requestAnimationFrame(() => map.invalidateSize());
  }, [legs, stops]);

  useEffect(() => {
    const vehicleLayer = vehicleLayerRef.current;
    if (!vehicleLayer) return;
    vehicleLayer.clearLayers();
    if (locationSignal !== "unknown" && vehiclePosition) {
      const vehicleIcon = L.divIcon({
        className: "route-vehicle-marker-shell",
        html: `<span class="route-vehicle-marker route-vehicle-${locationSignal}" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><path d="M7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg></span>`,
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      });
      L.marker(vehiclePosition, { icon: vehicleIcon, keyboard: true, title: `Vehicle location ${locationSignal}` })
        .bindTooltip(`Vehicle · ${locationSignal}`, { direction: "top", offset: [0, -18] })
        .addTo(vehicleLayer);
    }
  }, [locationSignal, vehiclePosition]);

  return <div className={`route-map ${className ?? ""}`}>
    <div className="route-map-leaflet">
      <div ref={containerRef} className="route-map-canvas" aria-label="Interactive OpenStreetMap of the recorded supply route" />
    </div>
    {tilesUnavailable && <div className="route-map-tile-warning" role="status">Map tiles could not be loaded. Check your connection; route markers remain available.</div>}
  </div>;
}
