/** A simulated vehicle report becomes stale after fifteen minutes. */
export const STALE_LOCATION_THRESHOLD_MS = 15 * 60 * 1000;

export type LocationFreshness = "fresh" | "stale" | "unknown";
export type LocationPoint = { latitude: number; longitude: number };
export type LocationStatus = "confirmed" | "checkpoint_reported" | "stale" | "mismatch" | "unknown";
export type VehicleStatus = "not_started" | "in_transit" | "arrived" | "held" | "recalled" | "stale";
export type RouteStatus = "on_route" | "deviation" | "stale" | "held" | "recalled";

export function getLocationFreshness(
  lastCheckpointAt: string | null,
  clock: () => number = Date.now
): LocationFreshness {
  if (!lastCheckpointAt) return "unknown";
  const reportedAt = new Date(lastCheckpointAt).getTime();
  if (!Number.isFinite(reportedAt)) return "unknown";
  return clock() - reportedAt <= STALE_LOCATION_THRESHOLD_MS
    ? "fresh"
    : "stale";
}

const EARTH_RADIUS_KM = 6371;
export const DEFAULT_ROUTE_TOLERANCE_KM = 150;

function toRadians(value: number) {
  return value * Math.PI / 180;
}

export function haversineDistanceKm(first: LocationPoint, second: LocationPoint) {
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const latitudeOne = toRadians(first.latitude);
  const latitudeTwo = toRadians(second.latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitudeOne) * Math.cos(latitudeTwo) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function isOffRoute(
  point: LocationPoint | null,
  routePoints: LocationPoint[],
  toleranceKm = DEFAULT_ROUTE_TOLERANCE_KM
) {
  if (!point || routePoints.length === 0) return false;
  return routePoints.every(routePoint => haversineDistanceKm(point, routePoint) > toleranceKm);
}

export function getLocationStatus(
  currentLocation: LocationPoint | null,
  expectedLocation: LocationPoint | null,
  lastReportAt: string | null,
  isCheckpoint: boolean,
  clock: () => number = Date.now
): LocationStatus {
  if (getLocationFreshness(lastReportAt, clock) === "stale") return "stale";
  if (!currentLocation || !expectedLocation) return "unknown";
  if (isOffRoute(currentLocation, [expectedLocation])) return "mismatch";
  return isCheckpoint ? "checkpoint_reported" : "confirmed";
}

export function getVehicleStatus(
  status: "planned" | "in_transit" | "arrived" | "held" | "recalled",
  lastReportAt: string | null,
  clock: () => number = Date.now
): VehicleStatus {
  if (status === "planned") return "not_started";
  if (status === "held" || status === "recalled" || status === "arrived") return status;
  return getLocationFreshness(lastReportAt, clock) === "stale" ? "stale" : "in_transit";
}

/** Route status precedence is recalled, held, deviation, stale, on_route. */
export function getRouteStatus(
  vehicleStatus: VehicleStatus,
  locationStatus: LocationStatus
): RouteStatus {
  if (vehicleStatus === "recalled") return "recalled";
  if (vehicleStatus === "held") return "held";
  if (locationStatus === "mismatch") return "deviation";
  if (vehicleStatus === "stale" || locationStatus === "stale") return "stale";
  return "on_route";
}
