import { useCallback } from "react";
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

  return <MapView className={className} initialCenter={stops[0]?.position ?? { lat: 21.16, lng: 79.08 }} initialZoom={12} onMapReady={handleMapReady} />;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
