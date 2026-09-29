import { useCallback, useState } from "react";
import { MapView } from "@/components/Map";

export type RouteStopStatus = "accepted" | "pending" | "conflict" | "incomplete";

export type RouteStop = {
  id: string;
  name: string;
  role: string;
  position: google.maps.LatLngLiteral;
  status: RouteStopStatus;
};

export type RouteLeg = {
  from: string;
  to: string;
  status: RouteStopStatus;
};

const STATUS_COLORS: Record<RouteStopStatus, string> = {
  accepted: "#38bdf8",
  pending: "#fbbf24",
  conflict: "#fb7185",
  incomplete: "#64748b",
};

function markerElement(stop: RouteStop) {
  const element = document.createElement("button");
  element.type = "button";
  element.title = `${stop.name} — ${stop.status}`;
  element.setAttribute("aria-label", `${stop.name}, ${stop.status}`);
  element.style.width = "18px";
  element.style.height = "18px";
  element.style.padding = "0";
  element.style.border = `3px solid ${STATUS_COLORS[stop.status]}`;
  element.style.borderRadius = "50%";
  element.style.background = "#0b0e14";
  element.style.boxShadow = `0 0 0 5px ${STATUS_COLORS[stop.status]}33`;
  element.style.cursor = "pointer";
  return element;
}

export function RouteMap({ stops, legs, className }: { stops: RouteStop[]; legs: RouteLeg[]; className?: string }) {
  const mapsConfigured = Boolean(import.meta.env.VITE_FRONTEND_FORGE_API_KEY);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(!mapsConfigured);
  const handleMapReady = useCallback((map: google.maps.Map) => {
    for (const stop of stops) {
      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: stop.position,
        title: stop.name,
        content: markerElement(stop),
      });
      const infoWindow = new google.maps.InfoWindow({
        content: `<div style="font-family: Arial, sans-serif; min-width: 170px"><strong>${escapeHtml(stop.name)}</strong><p>${escapeHtml(stop.role)}</p><span>Status: ${escapeHtml(stop.status)}</span></div>`,
      });
      marker.addListener("click", () => infoWindow.open({ map, anchor: marker }));
    }

    for (const leg of legs) {
      const from = stops.find(stop => stop.id === leg.from);
      const to = stops.find(stop => stop.id === leg.to);
      if (!from || !to) continue;

      new google.maps.Polyline({
        map,
        path: [from.position, to.position],
        geodesic: true,
        strokeColor: STATUS_COLORS[leg.status],
        strokeOpacity: leg.status === "incomplete" ? 0.45 : 0.95,
        strokeWeight: leg.status === "conflict" ? 5 : 3,
        icons: leg.status === "pending" || leg.status === "incomplete"
          ? [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 }, offset: "0", repeat: "12px" }]
          : undefined,
      });
    }

    if (stops.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      stops.forEach(stop => bounds.extend(stop.position));
      map.fitBounds(bounds, 48);
    }
  }, [legs, stops]);
  const handleMapError = useCallback(() => setMapFailed(true), []);

  const points = routeDiagramPoints(stops);
  return <div className={className}>
    {(!mapReady || mapFailed) && <div className="route-map-fallback" role="img" aria-label="Illustrative route diagram showing handoff stops and statuses">
      <div className="route-map-fallback-label">{mapFailed ? "Interactive map unavailable · illustrative route shown" : "Loading interactive map · illustrative route shown"}</div>
      <svg viewBox="0 0 800 360" aria-hidden="true">
        <defs><pattern id="route-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="#cbd5e1" strokeOpacity=".45" strokeWidth="1" /></pattern></defs>
        <rect width="800" height="360" fill="#eef3f7" /><rect width="800" height="360" fill="url(#route-grid)" />
        <path d="M0 300 C150 250 210 290 345 220 S570 115 800 160 M-20 95 C160 145 245 95 390 130 S650 265 830 220" fill="none" stroke="#fff" strokeWidth="24" />
        <path d="M0 300 C150 250 210 290 345 220 S570 115 800 160 M-20 95 C160 145 245 95 390 130 S650 265 830 220" fill="none" stroke="#d2dce5" strokeWidth="2" />
        {legs.map((leg, index) => {
          const from = points.get(leg.from);
          const to = points.get(leg.to);
          if (!from || !to) return null;
          return <line key={`${leg.from}-${leg.to}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={STATUS_COLORS[leg.status]} strokeWidth={leg.status === "conflict" ? 6 : 4} strokeDasharray={leg.status === "pending" || leg.status === "incomplete" ? "10 8" : undefined} strokeLinecap="round" />;
        })}
        {stops.map(stop => {
          const point = points.get(stop.id);
          if (!point) return null;
          return <g key={stop.id}>
            <circle cx={point.x} cy={point.y} r="16" fill={`${STATUS_COLORS[stop.status]}33`} />
            <circle cx={point.x} cy={point.y} r="9" fill="#fff" stroke={STATUS_COLORS[stop.status]} strokeWidth="5" />
            <text x={point.x} y={point.y + 35} textAnchor="middle" fill="#24374b" fontSize="13" fontWeight="600">{stop.name}</text>
            <text x={point.x} y={point.y + 52} textAnchor="middle" fill="#64758a" fontSize="11">{stop.status}</text>
          </g>;
        })}
      </svg>
    </div>}
    {mapsConfigured && !mapFailed && <MapView className="route-map-google" initialCenter={stops[0]?.position ?? { lat: 21.16, lng: 79.08 }} initialZoom={12} onMapReady={map => { handleMapReady(map); setMapReady(true); }} onMapError={handleMapError} />}
  </div>;
}

function routeDiagramPoints(stops: RouteStop[]) {
  const latitudes = stops.map(stop => stop.position.lat);
  const longitudes = stops.map(stop => stop.position.lng);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latSpan = maxLat - minLat || 1;
  const lngSpan = maxLng - minLng || 1;
  return new Map(stops.map(stop => [stop.id, {
    x: 100 + ((stop.position.lng - minLng) / lngSpan) * 600,
    y: 65 + ((maxLat - stop.position.lat) / latSpan) * 220,
  }]));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
