import type { DemoState } from "./routers";

export type IncidentProjection = {
  lastUncontestedCustodian: string;
  reportingReceiver: string | null;
  missingExpectedHandoff: { senderId: string; receiverId: string } | null;
  dispatchedQuantity: number | null;
  receiverObservedQuantity: number | null;
  unresolvedQuantity: number;
  quantityConflictOpen: boolean;
  locationConflictOpen: boolean;
  historyCoverage: "complete" | "incomplete";
  onwardMovementBlocked: boolean;
  affectedLocations: Array<{
    organizationId: string;
    action: "investigate" | "quarantine" | "do_not_dispense" | "provide_documents" | "awaiting_receipt";
    reason: string;
  }>;
};

const ROUTE = ["medsure-labs", "central-pharma", "ramdeobaba-pharmacy"] as const;

function organizationName(state: DemoState, organizationId: string | null) {
  return state.organizations.find(item => item.id === organizationId)?.name ?? organizationId ?? "Unknown organization";
}

export function deriveIncident(state: DemoState): IncidentProjection {
  const dispatch = state.dispatches.at(-1);
  const receipt = state.receipts.at(-1);
  const quantityConflictOpen = state.conflicts.some(conflict => conflict.status === "open") || state.batch.quantityState === "discrepant";
  const locationConflictOpen = state.receipts.some(item => item.locationMismatch);
  const handoffIndex = quantityConflictOpen && state.batch.observedReceiverId
    ? state.batch.acceptedHandoffs + 1
    : state.batch.acceptedHandoffs;
  const missingExpectedHandoff = handoffIndex < ROUTE.length - 1
    ? { senderId: ROUTE[handoffIndex], receiverId: ROUTE[handoffIndex + 1] }
    : null;
  const historyCoverage = state.batch.routeCoverageState === "complete" && !missingExpectedHandoff ? "complete" : "incomplete";
  const unresolvedQuantity = dispatch && receipt ? Math.abs(dispatch.dispatchedQuantity - receipt.receiverObservedQuantity) : 0;
  const affectedLocations: IncidentProjection["affectedLocations"] = [];

  if (quantityConflictOpen) {
    const varianceReason = `Investigate the reported ${unresolvedQuantity}-unit variance.`;
    affectedLocations.push(
      { organizationId: "central-pharma", action: "investigate", reason: varianceReason },
      { organizationId: "central-pharma", action: "quarantine", reason: `Quarantine handling is participant-reported for the reported ${unresolvedQuantity}-unit variance.` },
    );
  }
  if (missingExpectedHandoff && quantityConflictOpen) {
    affectedLocations.push({ organizationId: "ramdeobaba-pharmacy", action: "do_not_dispense", reason: "Expected downstream handoff was not completed." });
    affectedLocations.push({ organizationId: "medsure-labs", action: "provide_documents", reason: "Provide manufacturing and dispatch documents for investigation." });
  }

  return {
    lastUncontestedCustodian: organizationName(state, state.batch.lastUncontestedCustodianId),
    reportingReceiver: state.batch.observedReceiverId ? organizationName(state, state.batch.observedReceiverId) : null,
    missingExpectedHandoff,
    dispatchedQuantity: dispatch?.dispatchedQuantity ?? null,
    receiverObservedQuantity: receipt?.receiverObservedQuantity ?? null,
    unresolvedQuantity,
    quantityConflictOpen,
    locationConflictOpen,
    historyCoverage,
    onwardMovementBlocked: !state.batch.onwardDispatchAllowed || quantityConflictOpen || locationConflictOpen,
    affectedLocations,
  };
}
