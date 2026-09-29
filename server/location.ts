/** A simulated vehicle report becomes stale after fifteen minutes. */
export const STALE_LOCATION_THRESHOLD_MS = 15 * 60 * 1000;

export type LocationFreshness = "fresh" | "stale" | "unknown";

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
