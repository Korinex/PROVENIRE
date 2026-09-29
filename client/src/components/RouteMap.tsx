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

export function RouteMap({ stops, legs, className }: { stops: RouteStop[]; legs: RouteLeg[]; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const [tilesUnavailable, setTilesUnavailable] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      scrollWheelZoom: false,
      preferCanvas: true,
    });
    const routeLayer = L.layerGroup().addTo(map);
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
    return () => {
      map.remove();
      mapRef.current = null;
      routeLayerRef.current = null;
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

    const bounds = L.latLngBounds(stops.map(stop => stop.position));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
    window.requestAnimationFrame(() => map.invalidateSize());
  }, [legs, stops]);

  return <div className={`route-map-leaflet ${className ?? ""}`}>
    <div ref={containerRef} className="route-map-canvas" aria-label="Interactive OpenStreetMap of the recorded supply route" />
    {tilesUnavailable && <div className="route-map-tile-warning" role="status">Map tiles could not be loaded. Check your connection; route markers remain available.</div>}
  </div>;
}
