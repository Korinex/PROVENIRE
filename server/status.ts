import type { DemoState } from "./routers";
import { isRecordChainValid } from "./routers";
import { getLocationFreshness, getLocationStatus, getVehicleStatus, type LocationStatus, type VehicleStatus } from "./location";

export type DerivedStatuses = {
  recordIntegrity: "valid" | "tampered";
  quantityAgreement: "consistent" | "discrepant" | "unknown";
  historyCoverage: "complete" | "incomplete";
  verifierAvailability: "agreement" | "incomplete" | "disagreement";
  handoffStatus: "origin_verified" | "receiver_pending" | "accepted" | "needs_review";
  vehicleStatus: VehicleStatus;
  locationStatus: LocationStatus;
  incidentStatus: "none" | "hold_active" | "recall_simulated";
  headline: "tampered" | "needs_review" | "held" | "recalled" | "history_incomplete" | "verifier_incomplete" | "receiver_pending" | "verified";
};

function latestLocation(state: DemoState) {
  return state.events
    .filter(event => event.type === "custody_location" || event.type === "transit_checkpoint")
    .at(-1);
}

function deriveVehicleAndLocation(state: DemoState): { vehicleStatus: VehicleStatus; locationStatus: LocationStatus } {
  const leg = state.transitLegs.find(item => item.status === "in_transit") ?? state.transitLegs.at(-1);
  const report = latestLocation(state);
  const lastReportAt = report?.occurredAt ?? null;
  if (!leg) return { vehicleStatus: "not_started", locationStatus: "unknown" };
  const vehicleStatus = getVehicleStatus(leg.status, lastReportAt);
  const point = leg.lastCheckpointLocation
    ? { latitude: leg.lastCheckpointLocation.latitude, longitude: leg.lastCheckpointLocation.longitude }
    : report
      ? { latitude: Number(report.payload.latitude), longitude: Number(report.payload.longitude) }
      : null;
  const locationStatus = state.receipts.at(-1)?.locationMismatch
    ? "mismatch"
    : report?.type === "transit_checkpoint"
    ? getLocationStatus(point, point, lastReportAt, true)
    : getLocationStatus(point, point, lastReportAt, false);
  return { vehicleStatus, locationStatus };
}

function deriveVerifierAvailability(state: DemoState): DerivedStatuses["verifierAvailability"] {
  if (state.network.some(node => node.status === "unavailable")) return "incomplete";
  const computedHead = state.events.at(-1)?.proof.recordHash ?? "GENESIS";
  return state.network.every(node => node.headHash === computedHead) ? "agreement" : "disagreement";
}

/** Headline precedence: tampered, needs_review, held, recalled, history_incomplete, verifier_incomplete, receiver_pending, verified. */
function deriveHeadline(statuses: Omit<DerivedStatuses, "headline">): DerivedStatuses["headline"] {
  if (statuses.recordIntegrity === "tampered") return "tampered";
  if (statuses.quantityAgreement === "discrepant" || statuses.locationStatus === "mismatch" || statuses.handoffStatus === "needs_review") return "needs_review";
  if (statuses.incidentStatus === "hold_active") return "held";
  if (statuses.incidentStatus === "recall_simulated") return "recalled";
  if (statuses.historyCoverage === "incomplete") return "history_incomplete";
  if (statuses.verifierAvailability !== "agreement") return "verifier_incomplete";
  if (statuses.handoffStatus === "receiver_pending") return "receiver_pending";
  return "verified";
}

export function deriveStatuses(state: DemoState, clock: number): DerivedStatuses {
  const { vehicleStatus, locationStatus } = deriveVehicleAndLocation(state);
  const withoutHeadline: Omit<DerivedStatuses, "headline"> = {
    recordIntegrity: isRecordChainValid(state) ? "valid" : "tampered",
    quantityAgreement: state.receipts.length === 0 ? "unknown" : state.batch.quantityState === "discrepant" ? "discrepant" : "consistent",
    historyCoverage: state.batch.activeDispatchId ? "complete" : state.batch.routeCoverageState,
    verifierAvailability: deriveVerifierAvailability(state),
    handoffStatus: state.batch.handoffState,
    vehicleStatus: getLocationFreshness(latestLocation(state)?.occurredAt ?? null, () => clock) === "stale" ? "stale" : vehicleStatus,
    locationStatus,
    incidentStatus: state.incident.active ? state.incident.type === "simulated_recall" ? "recall_simulated" : "hold_active" : "none",
  };
  return { ...withoutHeadline, headline: deriveHeadline(withoutHeadline) };
}
