import type { DemoState } from "./routers";
import { getLocationFreshness, getVehicleStatus } from "./location";

export type HeadlineStatus =
  | "tampered"
  | "needs_review"
  | "held"
  | "recalled"
  | "history_incomplete"
  | "verifier_incomplete"
  | "receiver_pending"
  | "verified";

export type DerivedStatuses = {
  recordIntegrity: "valid" | "tampered";
  quantityAgreement: "consistent" | "discrepant" | "unknown";
  historyCoverage: "complete" | "incomplete";
  verifierAvailability: "agreement" | "incomplete" | "disagreement";
  handoffStatus: "origin_verified" | "receiver_pending" | "accepted" | "needs_review";
  vehicleStatus: "not_started" | "in_transit" | "arrived" | "held" | "recalled" | "stale";
  locationStatus: "confirmed" | "checkpoint_reported" | "stale" | "mismatch" | "unknown";
  incidentStatus: "none" | "hold_active" | "recall_simulated";
  headlineStatus: HeadlineStatus;
};

/** Highest priority first. Integrity and activated movement controls outrank reported discrepancies. */
export const HEADLINE_STATUS_PRECEDENCE: readonly HeadlineStatus[] = [
  "tampered",
  "held",
  "recalled",
  "needs_review",
  "receiver_pending",
  "history_incomplete",
  "verifier_incomplete",
  "verified",
];

export function deriveStatuses(state: DemoState, clock: () => number = Date.now): DerivedStatuses {
  const recordIntegrity = state.batch.recordIntegrityState === "tampered" ? "tampered" : "valid";
  const quantityAgreement = state.receipts.length === 0
    ? "unknown"
    : state.batch.quantityState === "discrepant" ? "discrepant" : "consistent";
  const historyCoverage = state.batch.routeCoverageState;
  const verifierAvailability = state.batch.networkState === "disagreement" ? "disagreement" : state.batch.networkState;
  const handoffStatus = state.batch.handoffState;
  const incidentStatus = !state.incident.active || !state.incident.type
    ? "none"
    : state.incident.type === "simulated_hold" ? "hold_active" : "recall_simulated";

  const latestLocationEvent = [...state.events].reverse().find(event => event.type === "custody_location" || event.type === "transit_checkpoint");
  const lastReportAt = latestLocationEvent?.occurredAt ?? null;
  const freshness = getLocationFreshness(lastReportAt, clock);
  const lastCheckpoint = [...state.events].reverse().find(event => event.type === "transit_checkpoint");
  let locationStatus: DerivedStatuses["locationStatus"];
  if (state.batch.locationMismatch || state.receipts.some(receipt => receipt.locationMismatch)) locationStatus = "mismatch";
  else if (freshness === "stale") locationStatus = "stale";
  else if (lastCheckpoint) locationStatus = "checkpoint_reported";
  else if (latestLocationEvent) locationStatus = "confirmed";
  else locationStatus = "unknown";

  const currentLeg = state.transitLegs.find(leg => leg.status === "in_transit") ?? state.transitLegs.at(-1);
  const vehicleStatus = currentLeg
    ? getVehicleStatus(currentLeg.status, currentLeg.lastCheckpointAt ?? lastReportAt, clock)
    : "not_started";

  // Precedence is intentional: a hold/recall remains visible while its triggering discrepancy stays open.
  let headlineStatus: HeadlineStatus;
  if (recordIntegrity === "tampered") headlineStatus = "tampered";
  else if (incidentStatus === "hold_active") headlineStatus = "held";
  else if (incidentStatus === "recall_simulated") headlineStatus = "recalled";
  else if (quantityAgreement === "discrepant" || locationStatus === "mismatch" || handoffStatus === "needs_review") headlineStatus = "needs_review";
  else if (handoffStatus === "receiver_pending") headlineStatus = "receiver_pending";
  else if (historyCoverage === "incomplete") headlineStatus = "history_incomplete";
  else if (verifierAvailability !== "agreement") headlineStatus = "verifier_incomplete";
  else if (handoffStatus === "origin_verified") headlineStatus = "history_incomplete";
  else headlineStatus = "verified";

  return {
    recordIntegrity,
    quantityAgreement,
    historyCoverage,
    verifierAvailability,
    handoffStatus,
    vehicleStatus,
    locationStatus,
    incidentStatus,
    headlineStatus,
  };
}
