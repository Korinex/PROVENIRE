import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { generateOrgKeys, sealEvent, verifyChain, chainIsValid } from "./proof/index";
import type { EventBody as ProofEventBody, SealedEvent } from "./proof/seal";
import { getActorOrganizationId, requireBatchParticipant } from "./access";
import { getLocationFreshness, getLocationStatus, getRouteStatus, getVehicleStatus } from "./location";
import { deriveIncident } from "./incident";
import { deriveStatuses } from "./status";
import { allowVerificationRequest } from "./verificationRateLimit";

type OrgRole = "manufacturer" | "distributor" | "hospital_pharmacy";
type HandoffState = "receiver_pending" | "accepted" | "needs_review";

const MAX_QUANTITY = 1_000_000;
const ROUTE = ["medsure-labs", "central-pharma", "ramdeobaba-pharmacy"] as const;

type Organization = { id: string; name: string; role: OrgRole; shortRole: string };
type FacilityLocation = { id: string; name: string; role: OrgRole; latitude: number; longitude: number };
type Vehicle = { id: string; label: string; carrierName: string; dataSource: string; simulated: true };
type TransitLeg = { id: string; batchId: string; vehicleId: string; senderId: string; receiverId: string; originLocationId: string; destinationLocationId: string; status: "planned" | "in_transit" | "arrived" | "held" | "recalled"; startedAt: string; lastCheckpointAt: string | null; lastCheckpointLocation: { latitude: number; longitude: number; label: string } | null };
type Proof = {
  recordHash: string;
  previousHash: string;
  signature: string;
  signer: string;
  signatureValid: boolean;
};
type EventBody = ProofEventBody;
type Event = {
  id: string;
  type: "origin" | "dispatch" | "receipt" | "custody_location" | "transit_checkpoint";
  label: string;
  actorId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  proof: Proof;
};
type Dispatch = {
  id: string;
  batchId: string;
  senderId: string;
  receiverId: string;
  dispatchedQuantity: number;
  unit: string;
  location: string;
  originLocationId: string;
  destinationLocationId: string;
  occurredAt: string;
  status: HandoffState;
  proof: Proof;
};
type Receipt = {
  id: string;
  dispatchId: string;
  receiverId: string;
  receiverObservedQuantity: number;
  unit: string;
  location: string;
  locationId: string;
  locationMismatch: boolean;
  observedAt: string;
  status: HandoffState;
  variance: number;
  varianceDirection: "shortage" | "overage" | null;
  proof: Proof;
};
type Conflict = {
  id: string;
  dispatchId: string;
  receiptId: string;
  type: "quantity_discrepancy";
  expectedValue: number;
  observedValue: number;
  delta: number;
  variance: number;
  direction: "shortage" | "overage";
  status: "open" | "resolved";
  createdAt: string;
};
type IncidentAcknowledgment = {
  organizationId: string;
  status: "pending" | "acknowledged";
  acknowledgedAt: string | null;
  stockStatus: "not_checked" | "quarantine_reported" | "stock_not_found" | "stock_recovered" | "dispensed_before_hold";
  stockQuantity: number | null;
  reported: true;
};
type IncidentTimelineEntry = {
  id: string;
  type: string;
  occurredAt: string;
  actorOrganizationId: string | null;
  relatedEventIds: string[];
  label: string;
  simulated: true;
};
type IncidentState = {
  id: string;
  active: boolean;
  type: "simulated_hold" | "simulated_recall" | null;
  reason: string | null;
  triggeredAt: string | null;
  triggeredBy: string | null;
  triggeredByEventIds: string[];
  onwardMovementBlocked: boolean;
  acknowledgments: IncidentAcknowledgment[];
  timeline: IncidentTimelineEntry[];
};
export type DemoState = {
  organizations: Organization[];
  batch: {
    id: string;
    productName: string;
    batchNumber: string;
    manufactureDate: string;
    expiryDate: string;
    initialQuantity: number;
    unit: string;
    currentHolderId: string;
    lastUncontestedCustodianId: string;
    observedReceiverId: string | null;
    receiverObservedQuantity: number | null;
    quantityVariance: number;
    varianceDirection: "shortage" | "overage" | null;
    acceptedForOnwardCustody: number;
    handoffState: HandoffState | "origin_verified";
    recordIntegrityState: "valid" | "tampered";
    routeCoverageState: "complete" | "incomplete";
    quantityState: "consistent" | "discrepant";
    conflictState: "none" | "open" | "resolved";
    networkState: "agreement" | "incomplete" | "disagreement";
    onwardDispatchAllowed: boolean;
    acceptedHandoffs: number;
    activeDispatchId: string | null;
    locationMismatch: boolean;
  };
  facilities: FacilityLocation[];
  vehicles: Vehicle[];
  transitLegs: TransitLeg[];
  events: Event[];
  dispatches: Dispatch[];
  receipts: Receipt[];
  conflicts: Conflict[];
  incident: IncidentState;
  network: { id: string; name: string; status: "healthy" | "unavailable"; headHash: string; eventCount: number; divergent: boolean; verificationResult: "valid" | "invalid"; checkedAt: string }[];
  activity: { id: string; label: string; detail: string; tone: "neutral" | "good" | "warning" | "danger"; occurredAt: string }[];
};

const organizations: Organization[] = [
  { id: "medsure-labs", name: "MedSure Labs", role: "manufacturer", shortRole: "Manufacturer" },
  { id: "central-pharma", name: "Central Pharma Distributor", role: "distributor", shortRole: "Distributor" },
  { id: "ramdeobaba-pharmacy", name: "Ramdeobaba Hospital Pharmacy", role: "hospital_pharmacy", shortRole: "Hospital pharmacy" },
];

const facilities: FacilityLocation[] = [
  { id: "medsure-labs", name: "MedSure Labs, Mumbai (simulated)", role: "manufacturer", latitude: 19.0760, longitude: 72.8777 },
  { id: "central-pharma", name: "Central Pharma Distributor, Delhi (simulated)", role: "distributor", latitude: 28.6139, longitude: 77.2090 },
  { id: "ramdeobaba-pharmacy", name: "Ramdeobaba Hospital Pharmacy, Nagpur (simulated)", role: "hospital_pharmacy", latitude: 21.1458, longitude: 79.0882 },
];
const vehicles: Vehicle[] = [{ id: "PROV-TRUCK-07", label: "PROV-TRUCK-07", carrierName: "Simulated Provenire Transport", dataSource: "Simulated GPS playback", simulated: true }];
const CHECKPOINTS_BY_ROUTE = {
  "medsure-labs:central-pharma": [{ id: "mumbai", label: "Mumbai (simulated)", latitude: 19.0760, longitude: 72.8777 }, { id: "surat", label: "Surat (simulated)", latitude: 21.1702, longitude: 72.8311 }, { id: "vadodara", label: "Vadodara (simulated)", latitude: 22.3072, longitude: 73.1812 }, { id: "delhi", label: "Delhi (simulated)", latitude: 28.6139, longitude: 77.2090 }],
  "central-pharma:ramdeobaba-pharmacy": [{ id: "delhi", label: "Delhi (simulated)", latitude: 28.6139, longitude: 77.2090 }, { id: "bhopal", label: "Bhopal (simulated)", latitude: 23.2599, longitude: 77.4126 }, { id: "nagpur", label: "Nagpur (simulated)", latitude: 21.1458, longitude: 79.0882 }],
} as const;

function now() {
  return new Date().toISOString();
}

const orgKeys = generateOrgKeys(organizations.map(org => org.id));
// Each verifier keeps its own event-log replica and verifies that replica locally.
const verifierLedgers = new Map<string, SealedEvent[]>();

function orgName(state: DemoState, id: string | null | undefined) {
  return state.organizations.find(org => org.id === id)?.name ?? "Unknown organization";
}
function facilityFor(state: DemoState, id: string) { return state.facilities.find(facility => facility.id === id); }

function proofFor(state: DemoState, body: EventBody): Proof {
  const key = orgKeys.keys[body.actorOrgId];
  if (!key) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "No signing key configured for event actor." });
  const sealed = sealEvent(key.privateKey, body);
  return {
    recordHash: sealed.recordHash,
    previousHash: sealed.previousHash,
    signature: sealed.signature,
    signer: orgName(state, body.actorOrgId),
    signatureValid: true,
  };
}

function validateQuantity(value: number, fieldName: string) {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_QUANTITY) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${fieldName} must be a positive integer no greater than ${MAX_QUANTITY}.` });
  }
}

function addActivity(state: DemoState, label: string, detail: string, tone: DemoState["activity"][number]["tone"]) {
  state.activity.unshift({ id: `activity-${state.activity.length + 1}`, label, detail, tone, occurredAt: now() });
  if (state.activity.length > 200) state.activity = state.activity.slice(0, 200);
}

function addEvent(
  state: DemoState,
  type: Event["type"],
  label: string,
  actorId: string,
  payload: Record<string, unknown>,
  eventTime = now()
) {
  const payloadWithTime = { ...payload, occurredAt: eventTime };
  if ("observedAt" in payloadWithTime) payloadWithTime.observedAt = eventTime;

  const eventId = `event-${state.events.length + 1}`;
  const body: EventBody = {
    eventId,
    batchId: state.batch.id,
    seq: state.events.length,
    type,
    actorOrgId: actorId,
    occurredAt: eventTime,
    payload: payloadWithTime,
    previousHash: state.events.at(-1)?.proof.recordHash ?? "GENESIS",
  };
  const event: Event = {
    id: eventId,
    type,
    label,
    actorId,
    occurredAt: eventTime,
    payload: payloadWithTime,
    proof: proofFor(state, body),
  };
  state.events.push(event);
  return event;
}

export function makeInitialState(): DemoState {
  const state = {
    organizations: organizations.map(org => ({ ...org })),
    batch: {
      id: "batch-ms-2026-001",
      productName: "MedSure 500 mg",
      batchNumber: "MS-2026-001",
      manufactureDate: "2026-09-01",
      expiryDate: "2027-12-31",
      initialQuantity: 1000,
      unit: "units",
      currentHolderId: "medsure-labs",
      lastUncontestedCustodianId: "medsure-labs",
      observedReceiverId: null,
      receiverObservedQuantity: null,
      quantityVariance: 0,
      varianceDirection: null,
      acceptedForOnwardCustody: 1000,
      handoffState: "origin_verified" as const,
      recordIntegrityState: "valid" as const,
      routeCoverageState: "incomplete" as const,
      quantityState: "consistent" as const,
      conflictState: "none" as const,
      networkState: "agreement" as const,
      onwardDispatchAllowed: true,
      acceptedHandoffs: 0,
      activeDispatchId: null,
      locationMismatch: false,
    },
    facilities: facilities.map(facility => ({ ...facility })), vehicles: vehicles.map(vehicle => ({ ...vehicle })), transitLegs: [] as TransitLeg[],
    events: [] as Event[],
    dispatches: [] as Dispatch[],
    receipts: [] as Receipt[],
    conflicts: [] as Conflict[],
    incident: {
      id: "incident-none",
      active: false,
      type: null,
      reason: null,
      triggeredAt: null,
      triggeredBy: null,
      triggeredByEventIds: [],
      onwardMovementBlocked: false,
      acknowledgments: [],
      timeline: [],
    },
    network: ["Verifier North", "Verifier Central", "Verifier South"].map((name, index) => ({
      id: `node-${index + 1}`,
      name,
      status: "healthy" as const,
      headHash: "GENESIS",
      eventCount: 0,
      divergent: false,
      verificationResult: "valid" as const,
      checkedAt: now(),
    })),
    activity: [] as DemoState["activity"],
  } satisfies DemoState;

  addEvent(state, "origin", "Origin signed", "medsure-labs", {
    product: state.batch.productName,
    batchNumber: state.batch.batchNumber,
    quantity: state.batch.initialQuantity,
    unit: state.batch.unit,
    manufactureDate: state.batch.manufactureDate,
    expiryDate: state.batch.expiryDate,
  });
  const originFacility = facilityFor(state, "medsure-labs")!;
  addEvent(state, "custody_location", "Origin custody location signed", "medsure-labs", { batchId: state.batch.id, facilityId: originFacility.id, organizationId: "medsure-labs", latitude: originFacility.latitude, longitude: originFacility.longitude, locationLabel: originFacility.name, reason: "origin_at_facility" });
  refreshNodeHeads(state);
  addActivity(state, "Origin verified", "MedSure Labs signed the batch origin record", "good");
  return state;
}

let state = makeInitialState();
let tamperedEvents: Event[] | null = null;

function refreshNodeHeads(current: DemoState) {
  const events = current.events.map((event, index) => ({ eventId: event.id, batchId: current.batch.id, seq: index, type: event.type, actorOrgId: event.actorId, occurredAt: event.occurredAt, previousHash: event.proof.previousHash, payload: event.payload, recordHash: event.proof.recordHash, signature: event.proof.signature })) satisfies SealedEvent[];
  current.network = current.network.map(node => {
    if (node.status === "unavailable") return node;
    // A lagged peer intentionally keeps its previous signed history instead of
    // pretending to have the central event-log head.
    const peerEvents = structuredClone(node.divergent ? events.slice(0, -1) : events);
    verifierLedgers.set(node.id, peerEvents);
    const localLedger = verifierLedgers.get(node.id) ?? [];
    const valid = chainIsValid(verifyChain(localLedger, orgKeys.getPublicKeyMap()));
    return {
      ...node,
      headHash: localLedger.at(-1)?.recordHash ?? "GENESIS",
      eventCount: localLedger.length,
      verificationResult: valid ? "valid" : "invalid",
      checkedAt: now(),
    };
  });
  const peers = current.network.filter(node => node.status === "healthy");
  current.batch.networkState = current.network.some(node => node.status === "unavailable")
    ? "incomplete"
    : new Set(peers.map(node => node.headHash)).size > 1 || new Set(peers.map(node => node.verificationResult)).size > 1
      ? "disagreement"
      : "agreement";
}

function getExpectedReceiverId(current: DemoState): string | undefined {
  if (current.batch.acceptedHandoffs >= ROUTE.length - 1) return undefined;
  return ROUTE[current.batch.acceptedHandoffs + 1];
}

function createDispatch(current: DemoState, receiverId: string, quantityOverride?: number) {
  if (current.incident.active) {
    throw new TRPCError({ code: "CONFLICT", message: "Onward movement is blocked by a simulated hold." });
  }
  if (current.batch.conflictState === "open") {
    throw new TRPCError({ code: "CONFLICT", message: "Next dispatch is blocked pending resolution or route completion." });
  }
  if (current.batch.activeDispatchId) {
    throw new TRPCError({ code: "CONFLICT", message: "A receiver-pending handoff already requires a receipt." });
  }
  if (current.batch.acceptedHandoffs >= ROUTE.length - 1) {
    throw new TRPCError({ code: "CONFLICT", message: "All handoffs for this route are complete." });
  }
  if (current.batch.currentHolderId !== ROUTE[current.batch.acceptedHandoffs]) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the current holder can dispatch the next route handoff." });
  }
  const receiver = current.organizations.find(org => org.id === receiverId);
  if (!receiver) throw new TRPCError({ code: "NOT_FOUND", message: "Receiver organization not found." });
  const expectedReceiverId = getExpectedReceiverId(current);
  if (!expectedReceiverId) {
    throw new TRPCError({ code: "CONFLICT", message: "All handoffs for this route are complete." });
  }
  if (receiverId !== expectedReceiverId) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Expected next receiver is ${orgName(current, expectedReceiverId)}, not ${orgName(current, receiverId)}.` });
  }
  if (receiverId === current.batch.currentHolderId) {
    throw new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: "Sender and receiver must be different organizations." });
  }
  const quantity = quantityOverride ?? current.batch.acceptedForOnwardCustody;
  validateQuantity(quantity, "dispatch quantity");
  const id = `dispatch-${current.dispatches.length + 1}`;
  const timestamp = now();
  const originLocation = facilityFor(current, current.batch.currentHolderId);
  const destinationLocation = facilityFor(current, receiverId);
  if (!originLocation || !destinationLocation) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Route facility is not configured." });
  const payload = {
    type: "dispatch",
    batchId: current.batch.batchNumber,
    senderId: current.batch.currentHolderId,
    receiverId,
    quantityDispatched: quantity,
    unit: current.batch.unit,
    location: orgName(current, current.batch.currentHolderId),
    originLocationId: originLocation.id,
    destinationLocationId: destinationLocation.id,
    occurredAt: timestamp,
  };
  const event = addEvent(current, "dispatch", "Sender dispatch signed", current.batch.currentHolderId, payload, timestamp);
  const dispatch: Dispatch = {
    id,
    batchId: current.batch.id,
    senderId: current.batch.currentHolderId,
    receiverId,
    dispatchedQuantity: quantity,
    unit: current.batch.unit,
    location: orgName(current, current.batch.currentHolderId),
    originLocationId: originLocation.id,
    destinationLocationId: destinationLocation.id,
    occurredAt: event.occurredAt,
    status: "receiver_pending",
    proof: event.proof,
  };
  current.dispatches.push(dispatch);
  current.transitLegs.push({ id: `leg-${current.transitLegs.length + 1}`, batchId: current.batch.id, vehicleId: "PROV-TRUCK-07", senderId: dispatch.senderId, receiverId: dispatch.receiverId, originLocationId: originLocation.id, destinationLocationId: destinationLocation.id, status: "in_transit", startedAt: event.occurredAt, lastCheckpointAt: null, lastCheckpointLocation: null });
  current.batch.handoffState = "receiver_pending";
  current.batch.activeDispatchId = id;
  current.batch.observedReceiverId = null;
  current.batch.receiverObservedQuantity = null;
  current.batch.quantityVariance = 0;
  current.batch.quantityState = "consistent";
  current.batch.locationMismatch = false;
  addActivity(current, "Receiver pending", `${orgName(current, current.batch.currentHolderId)} dispatched ${quantity} units to ${receiver.name}`, "warning");
  refreshNodeHeads(current);
  return dispatch;
}

function createReceipt(current: DemoState, dispatchId: string, receiverId: string, observedQuantity: number, locationId = receiverId) {
  const dispatch = current.dispatches.find(item => item.id === dispatchId);
  if (!dispatch) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found." });
  if (dispatch.status !== "receiver_pending") {
    throw new TRPCError({ code: "CONFLICT", message: "This dispatch already has a final receipt state." });
  }
  if (dispatch.receiverId !== receiverId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the intended receiver can submit this receipt." });
  }
  const receiver = current.organizations.find(org => org.id === receiverId);
  if (!receiver) throw new TRPCError({ code: "NOT_FOUND", message: "Receiver organization not found." });
  validateQuantity(observedQuantity, "receiverObservedQuantity");
  const receiptLocation = facilityFor(current, locationId);
  if (!receiptLocation) throw new TRPCError({ code: "BAD_REQUEST", message: "Receipt facility is not configured." });
  const locationMismatch = dispatch.destinationLocationId !== receiptLocation.id || receiverId !== dispatch.receiverId || receiptLocation.id !== receiverId;
  const variance = Math.abs(dispatch.dispatchedQuantity - observedQuantity);
  const status: HandoffState = variance === 0 && !locationMismatch ? "accepted" : "needs_review";
  const id = `receipt-${current.receipts.length + 1}`;
  const timestamp = now();
  const payload = {
    type: "receipt",
    dispatchId,
    batchId: current.batch.batchNumber,
    receiverId,
    receiverObservedQuantity: observedQuantity,
    unit: current.batch.unit,
    location: receiptLocation.name,
    locationId: receiptLocation.id,
    observedAt: timestamp,
  };
  const event = addEvent(current, "receipt", "Receiver receipt signed", receiverId, payload, timestamp);
  const receipt: Receipt = {
    id,
    dispatchId,
    receiverId,
    receiverObservedQuantity: observedQuantity,
    unit: current.batch.unit,
    location: receiptLocation.name,
    locationId: receiptLocation.id,
    locationMismatch,
    observedAt: event.occurredAt,
    status,
    variance,
    varianceDirection: variance === 0 ? null : observedQuantity < dispatch.dispatchedQuantity ? "shortage" : "overage",
    proof: event.proof,
  };
  current.receipts.push(receipt);
  dispatch.status = status;
  current.batch.activeDispatchId = null;
  current.batch.observedReceiverId = receiverId;
  current.batch.receiverObservedQuantity = observedQuantity;
  current.batch.quantityVariance = variance;
  current.batch.varianceDirection = receipt.varianceDirection;
  current.batch.handoffState = status;
  current.batch.locationMismatch = locationMismatch;
  const leg = current.transitLegs.find(item => item.senderId === dispatch.senderId && item.receiverId === dispatch.receiverId && item.status === "in_transit");
  if (leg) leg.status = locationMismatch ? "held" : "arrived";

  if (status === "accepted") {
    current.batch.currentHolderId = receiverId;
    current.batch.lastUncontestedCustodianId = receiverId;
    current.batch.acceptedForOnwardCustody = observedQuantity;
    current.batch.quantityState = "consistent";
    current.batch.conflictState = "none";
    current.batch.acceptedHandoffs += 1;
    current.batch.routeCoverageState = current.batch.acceptedHandoffs >= ROUTE.length - 1 ? "complete" : "incomplete";
    current.batch.onwardDispatchAllowed = current.batch.acceptedHandoffs < ROUTE.length - 1;
    addEvent(current, "custody_location", "Facility arrival signed", receiverId, { batchId: current.batch.id, facilityId: receiptLocation.id, organizationId: receiverId, latitude: receiptLocation.latitude, longitude: receiptLocation.longitude, locationLabel: receiptLocation.name, reason: "arrived_at_facility" });
    addActivity(current, "Handoff accepted", `${receiver.name} confirmed ${observedQuantity} units`, "good");
  } else {
    current.batch.quantityState = "discrepant";
    current.batch.conflictState = "open";
    current.batch.acceptedForOnwardCustody = 0;
    current.batch.onwardDispatchAllowed = false;
    current.batch.routeCoverageState = "incomplete";
    if (locationMismatch && variance === 0) {
      current.batch.quantityState = "consistent";
      current.batch.conflictState = "open";
      addActivity(current, "Location mismatch", `${receiver.name} reported a different simulated receiving facility`, "danger");
    }
    const conflict: Conflict = {
      id: `conflict-${current.conflicts.length + 1}`,
      dispatchId,
      receiptId: id,
      type: "quantity_discrepancy",
      expectedValue: dispatch.dispatchedQuantity,
      observedValue: observedQuantity,
      delta: variance,
      variance,
      direction: observedQuantity < dispatch.dispatchedQuantity ? "shortage" : "overage",
      status: "open",
      createdAt: event.occurredAt,
    };
    if (variance > 0) {
      current.conflicts.push(conflict);
      addActivity(current, "Quantity discrepancy", `${receiver.name} observed ${observedQuantity}; variance ${variance}`, "danger");
    }
  }

  refreshNodeHeads(current);
  return receipt;
}

/** @internal Appends a checkpoint from the predefined simulated route. */
export function appendTransitCheckpoint(current: DemoState, legId: string, checkpointId: string) {
  const leg = current.transitLegs.find(item => item.id === legId);
  if (!leg) throw new TRPCError({ code: "NOT_FOUND", message: "Transit leg not found." });
  if (leg.status !== "in_transit") throw new TRPCError({ code: "CONFLICT", message: "Transit leg is not in transit." });
  const routeKey = `${leg.originLocationId}:${leg.destinationLocationId}` as keyof typeof CHECKPOINTS_BY_ROUTE;
  const checkpoint = CHECKPOINTS_BY_ROUTE[routeKey]?.find(item => item.id === checkpointId);
  if (!checkpoint) throw new TRPCError({ code: "BAD_REQUEST", message: "Checkpoint is not in the predefined simulated route." });
  const timestamp = now();
  addEvent(current, "transit_checkpoint", "Simulated transit checkpoint signed", leg.senderId, { vehicleId: leg.vehicleId, batchId: current.batch.id, latitude: checkpoint.latitude, longitude: checkpoint.longitude, checkpointLabel: checkpoint.label, source: "simulated_gps" }, timestamp);
  leg.lastCheckpointAt = timestamp;
  leg.lastCheckpointLocation = { latitude: checkpoint.latitude, longitude: checkpoint.longitude, label: checkpoint.label };
  refreshNodeHeads(current);
  return leg;
}

function recordVerification(current: DemoState) {
  const proofEvents = current.events.map(event => ({
    eventId: event.id,
    batchId: current.batch.id,
    seq: current.events.indexOf(event),
    type: event.type,
    actorOrgId: event.actorId,
    occurredAt: event.occurredAt,
    previousHash: event.proof.previousHash,
    payload: event.payload,
    recordHash: event.proof.recordHash,
    signature: event.proof.signature,
  })) satisfies SealedEvent[];
  return verifyChain(proofEvents, orgKeys.getPublicKeyMap());
}

export function isRecordChainValid(current: DemoState) {
  return chainIsValid(recordVerification(current));
}

function publicVerifier(current: DemoState) {
  const verification = recordVerification(current);
  const tampered = !isRecordChainValid(current);
  const conflictOpen = current.batch.conflictState === "open";
  let verificationStatus = "verified_history";
  if (tampered) verificationStatus = "tampered";
  else if (conflictOpen) verificationStatus = "needs_review";
  else if (current.batch.networkState !== "agreement") verificationStatus = "network_disagreement";
  else if (current.batch.handoffState === "receiver_pending") verificationStatus = "receiver_pending";
  else if (current.batch.routeCoverageState === "incomplete") verificationStatus = "coverage_incomplete";

  return {
    productName: current.batch.productName,
    batchNumber: current.batch.batchNumber,
    manufacturer: orgName(current, "medsure-labs"),
    manufactureDate: current.batch.manufactureDate,
    expiryDate: current.batch.expiryDate,
    acceptedHandoffCount: current.batch.acceptedHandoffs,
    verificationStatus,
    recordIntegrityState: tampered ? "invalid" : "valid",
    identityValid: verification.every(item => item.sigOk),
    hashValid: verification.every(item => item.hashOk),
    signatureValid: verification.every(item => item.sigOk && item.hashOk),
    predecessorValid: verification.every(item => item.prevOk),
    handoffComplete: current.batch.handoffState === "accepted",
    coverageComplete: current.batch.routeCoverageState === "complete",
    quantityConsistent: current.batch.quantityState === "consistent",
    recallClear: true,
    expiryClear: true,
    conflictOpen,
    networkAgreement: current.batch.networkState === "agreement",
    physicalAuthenticityProven: false,
    notice: "Provenire verifies submitted record integrity and authorship. It does not verify the medicine's physical contents.",
  };
}

function snapshot(current: DemoState) {
  return {
    organizations: current.organizations,
    batch: {
      ...current.batch,
      currentHolder: orgName(current, current.batch.currentHolderId),
      lastUncontestedCustodian: orgName(current, current.batch.lastUncontestedCustodianId),
      observedReceiver: current.batch.observedReceiverId ? orgName(current, current.batch.observedReceiverId) : null,
    },
    dispatches: current.dispatches.map(dispatch => ({
      ...dispatch,
      senderName: orgName(current, dispatch.senderId),
      receiverName: orgName(current, dispatch.receiverId),
    })),
    receipts: current.receipts.map(receipt => ({
      ...receipt,
      receiverName: orgName(current, receipt.receiverId),
    })),
    events: current.events.map(event => ({ ...event, actorName: orgName(current, event.actorId) })),
    conflicts: current.conflicts,
    facilities: current.facilities,
    vehicles: current.vehicles,
    transitLegs: current.transitLegs,
    network: current.network,
    activity: current.activity.slice(0, 12),
    publicVerifier: publicVerifier(current),
    statuses: deriveStatuses(current),
  };
}

function routeView(current: DemoState) {
  const leg = current.transitLegs.find(item => item.status === "in_transit") ?? current.transitLegs.at(-1) ?? null;
  const checkpointEvents = current.events.filter(event => event.type === "transit_checkpoint");
  const custodyEvents = current.events.filter(event => event.type === "custody_location");
  const lastCheckpoint = checkpointEvents.at(-1);
  const lastCustody = custodyEvents.at(-1);
  const lastLocationEvent = [lastCheckpoint, lastCustody].filter((event): event is Event => Boolean(event)).sort((first, second) => first.occurredAt.localeCompare(second.occurredAt)).at(-1);
  const routeKey = leg ? `${leg.originLocationId}:${leg.destinationLocationId}` as keyof typeof CHECKPOINTS_BY_ROUTE : null;
  const sequence = routeKey ? CHECKPOINTS_BY_ROUTE[routeKey] ?? [] : [];
  const lastCheckpointId = lastCheckpoint?.payload.checkpointLabel
    ? sequence.find(item => item.label === lastCheckpoint.payload.checkpointLabel)?.id
    : undefined;
  const nextIndex = lastCheckpointId ? sequence.findIndex(item => item.id === lastCheckpointId) + 1 : 0;
  const currentLocation = leg?.lastCheckpointLocation
    ? { ...leg.lastCheckpointLocation }
    : lastCustody
      ? { latitude: Number(lastCustody.payload.latitude), longitude: Number(lastCustody.payload.longitude), label: String(lastCustody.payload.locationLabel ?? "") }
      : null;
  const nextExpected = sequence[nextIndex] ?? null;
  const lastReportAt = lastLocationEvent?.occurredAt ?? null;
  const locationStatus = getLocationStatus(
    currentLocation,
    lastCheckpoint
      ? currentLocation
      : nextExpected
        ? { latitude: nextExpected.latitude, longitude: nextExpected.longitude }
        : currentLocation,
    lastReportAt,
    Boolean(lastCheckpoint),
  );
  const vehicleStatus = leg ? getVehicleStatus(leg.status, lastReportAt) : "not_started";
  return {
    batchNumber: current.batch.batchNumber,
    facilities: current.facilities.map(({ id, name, role, latitude, longitude }) => ({ id, name, role, latitude, longitude })),
    transitLegs: current.transitLegs.map(({ id, batchId, vehicleId, senderId, receiverId, originLocationId, destinationLocationId, status, startedAt, lastCheckpointAt, lastCheckpointLocation }) => ({ id, batchId, vehicleId, senderId, receiverId, originLocationId, destinationLocationId, status, startedAt, lastCheckpointAt, lastCheckpointLocation })),
    checkpoints: checkpointEvents.map(event => ({
      id: event.id,
      occurredAt: event.occurredAt,
      vehicleId: String(event.payload.vehicleId ?? ""),
      label: String(event.payload.checkpointLabel ?? ""),
      latitude: Number(event.payload.latitude),
      longitude: Number(event.payload.longitude),
    })),
    currentLocation,
    nextExpectedLocation: nextExpected ? { id: nextExpected.id, label: nextExpected.label, latitude: nextExpected.latitude, longitude: nextExpected.longitude } : null,
    lastReportAt,
    timeSinceLastReport: lastReportAt ? Math.max(0, Date.now() - Date.parse(lastReportAt)) : null,
    locationStatus,
    vehicleStatus,
    routeStatus: getRouteStatus(vehicleStatus, locationStatus),
  };
}

function locationTraceView(current: DemoState) {
  const route = routeView(current);
  const lastCustody = current.events.filter(event => event.type === "custody_location").at(-1);
  const leg = current.transitLegs.find(item => item.status === "in_transit") ?? current.transitLegs.at(-1) ?? null;
  const destination = leg ? facilityFor(current, leg.destinationLocationId) ?? null : null;
  return {
    ...route,
    lastConfirmedFacility: lastCustody ? {
      id: String(lastCustody.payload.facilityId ?? ""),
      name: String(lastCustody.payload.locationLabel ?? ""),
      latitude: Number(lastCustody.payload.latitude),
      longitude: Number(lastCustody.payload.longitude),
    } : null,
    currentSimulatedVehiclePoint: route.currentLocation,
    destination: destination ? { id: destination.id, name: destination.name, latitude: destination.latitude, longitude: destination.longitude } : null,
    quantityStatus: current.batch.quantityState,
    handoffStatus: current.batch.handoffState,
    onwardMovementBlocked: !current.batch.onwardDispatchAllowed || current.batch.handoffState === "needs_review",
    simulated: true as const,
    notice: "Simulated vehicle route. Not live GPS.",
  };
}

function eventTimeline(current: DemoState): IncidentTimelineEntry[] {
  return current.events.map(event => ({
    id: `history-${event.id}`,
    type: event.type,
    occurredAt: event.occurredAt,
    actorOrganizationId: event.actorId,
    relatedEventIds: [event.id],
    label: event.type === "origin"
      ? "Batch origin signed"
      : event.type === "dispatch"
        ? "Dispatch signed"
        : event.type === "receipt"
          ? "Receiver reported quantity"
          : event.label,
    simulated: true as const,
  }));
}

function holdView(current: DemoState) {
  const timeline = [...eventTimeline(current), ...current.incident.timeline].sort((first, second) => first.occurredAt.localeCompare(second.occurredAt));
  return {
    ...current.incident,
    timeline,
    notice: "Simulated hold. Acknowledgments and stock status are participant-reported, not proof of physical quarantine.",
  };
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  provenire: router({
    state: publicProcedure.query(() => snapshot(state)),
    publicVerify: publicProcedure.query(() => publicVerifier(state)),
    verifyBatch: publicProcedure
      .input(z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).strict())
      .query(({ ctx, input }) => {
        const clientKey = ctx.req.ip || ctx.req.socket?.remoteAddress || "unknown";
        if (!allowVerificationRequest(clientKey)) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Verification rate limit exceeded. Try again shortly." });
        }
        if (input.token !== state.batch.batchNumber) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Verification record not found." });
        }
        const projection = publicVerifier(state);
        return {
          productName: projection.productName,
          batchNumber: projection.batchNumber,
          manufacturer: projection.manufacturer,
          manufactureDate: projection.manufactureDate,
          expiryDate: projection.expiryDate,
          verificationStatus: projection.verificationStatus,
          recordIntegrityState: projection.recordIntegrityState,
          networkAgreement: projection.networkAgreement,
          handoffComplete: projection.handoffComplete,
          coverageComplete: projection.coverageComplete,
          quantityConsistent: projection.quantityConsistent,
          conflictOpen: projection.conflictOpen,
          notice: projection.notice,
          checkedAt: now(),
          readOnly: true as const,
        };
      }),
    reset: publicProcedure.mutation(() => {
      state = makeInitialState();
      tamperedEvents = null;
      addActivity(state, "Demo reset", "Deterministic scenario restored", "neutral");
      return snapshot(state);
    }),
    runHappyPath: publicProcedure.mutation(() => {
      state = makeInitialState();
      tamperedEvents = null;
      const first = createDispatch(state, "central-pharma");
      createReceipt(state, first.id, "central-pharma", 1000);
      const second = createDispatch(state, "ramdeobaba-pharmacy");
      createReceipt(state, second.id, "ramdeobaba-pharmacy", 1000);
      addActivity(state, "Happy path complete", "Two receiver-confirmed handoffs completed", "good");
      return snapshot(state);
    }),
    runMismatch: publicProcedure.mutation(() => {
      state = makeInitialState();
      tamperedEvents = null;
      const dispatch = createDispatch(state, "central-pharma");
      createReceipt(state, dispatch.id, "central-pharma", 950);
      addActivity(state, "Mismatch path ready", "Next dispatch is blocked pending resolution", "danger");
      return snapshot(state);
    }),
    dispatch: publicProcedure
      .input(z.object({ receiverId: z.string() }))
      .mutation(({ input }) => {
        createDispatch(state, input.receiverId);
        return snapshot(state);
      }),
    receipt: publicProcedure
      .input(z.object({ dispatchId: z.string(), receiverId: z.string(), receiverObservedQuantity: z.number().int().positive().max(MAX_QUANTITY), locationId: z.string().optional() }))
      .mutation(({ input }) => {
        createReceipt(state, input.dispatchId, input.receiverId, input.receiverObservedQuantity, input.locationId);
        return snapshot(state);
      }),
    tamper: publicProcedure.mutation(() => {
      const event = state.events.at(-1);
      if (!event) throw new TRPCError({ code: "CONFLICT", message: "No event is available to tamper." });
      tamperedEvents = structuredClone(state.events);
      const quantity = event.payload.quantity;
      event.payload = { ...event.payload, ...(typeof quantity === "number" ? { quantity: quantity + 1 } : { tampered: true }) };
      state.batch.recordIntegrityState = "tampered";
      refreshNodeHeads(state);
      addActivity(state, "Tamper detected", "A signed field no longer matches its stored proof", "danger");
      return snapshot(state);
    }),
    restore: publicProcedure.mutation(() => {
      if (tamperedEvents) {
        state.events = tamperedEvents;
        tamperedEvents = null;
      }
      state.batch.recordIntegrityState = "valid";
      refreshNodeHeads(state);
      addActivity(state, "Proof restored", "Reset or restoration returned the record to a valid state", "good");
      return snapshot(state);
    }),
    togglePeer: publicProcedure
      .input(z.object({ nodeId: z.string(), diverge: z.boolean().optional() }).strict())
      .mutation(({ input }) => {
        const node = state.network.find(item => item.id === input.nodeId);
        if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Verifier node not found." });
        if (input.diverge) node.divergent = !node.divergent;
        else node.status = node.status === "healthy" ? "unavailable" : "healthy";
        refreshNodeHeads(state);
        addActivity(state, input.diverge ? node.divergent ? "Verifier history disagreement" : "Verifier history restored" : node.status === "unavailable" ? "Verifier unavailable" : "Verifier restored", `${node.name} is ${input.diverge ? node.headHash : node.status}`, node.divergent || node.status === "unavailable" ? "warning" : "good");
        return snapshot(state);
      }),
    route: protectedProcedure.query(({ ctx }) => {
      requireBatchParticipant(ctx.user, state.batch.id);
      return routeView(state);
    }),
    locationTrace: protectedProcedure.query(({ ctx }) => {
      requireBatchParticipant(ctx.user, state.batch.id);
      return locationTraceView(state);
    }),
    incident: protectedProcedure.query(({ ctx }) => {
      requireBatchParticipant(ctx.user, state.batch.id);
      return { ...deriveIncident(state), simulated: true as const };
    }),
    statuses: protectedProcedure.query(({ ctx }) => {
      requireBatchParticipant(ctx.user, state.batch.id);
      return { ...deriveStatuses(state), simulated: true as const };
    }),
    activateSimulatedHold: protectedProcedure
      .input(z.object({ reason: z.string().trim().min(5).max(280), type: z.enum(["simulated_hold", "simulated_recall"]).default("simulated_hold") }).strict())
      .mutation(({ ctx, input }) => {
        requireBatchParticipant(ctx.user, state.batch.id);
        const actorOrganizationId = getActorOrganizationId(ctx.user);
        const derived = deriveIncident(state);
        if (!derived.quantityConflictOpen && !derived.locationConflictOpen) {
          throw new TRPCError({ code: "CONFLICT", message: "A simulated hold needs an open discrepancy." });
        }
        if (state.incident.active) throw new TRPCError({ code: "CONFLICT", message: "A simulated hold is already active." });
        const triggeredAt = now();
        const conflictDispatch = state.dispatches.at(-1);
        const conflictEventIds = state.events
          .filter(event => event.type === "dispatch" || event.type === "receipt")
          .filter(event => event.type === "dispatch"
            ? event.payload.senderId === conflictDispatch?.senderId && event.payload.receiverId === conflictDispatch?.receiverId
            : event.payload.dispatchId === conflictDispatch?.id)
          .map(event => event.id);
        state.incident = {
          id: `incident-${state.events.length + 1}`,
          active: true,
          type: input.type,
          reason: input.reason,
          triggeredAt,
          triggeredBy: actorOrganizationId,
          triggeredByEventIds: conflictEventIds,
          onwardMovementBlocked: true,
          acknowledgments: ROUTE.map(organizationId => ({
            organizationId,
            status: "pending",
            acknowledgedAt: null,
            stockStatus: "not_checked",
            stockQuantity: null,
            reported: true as const,
          })),
          timeline: [{
            id: `timeline-${state.events.length + 1}`,
            type: input.type,
            occurredAt: triggeredAt,
            actorOrganizationId,
            relatedEventIds: conflictEventIds,
            label: input.type === "simulated_recall" ? "Simulated recall activated" : "Simulated hold activated",
            simulated: true,
          }],
        };
        state.batch.onwardDispatchAllowed = false;
        const affectedLeg = conflictDispatch
          ? state.transitLegs.find(leg => leg.senderId === conflictDispatch.senderId && leg.receiverId === conflictDispatch.receiverId)
          : state.transitLegs.at(-1);
        if (affectedLeg) affectedLeg.status = input.type === "simulated_recall" ? "recalled" : "held";
        addActivity(state, input.type === "simulated_recall" ? "Simulated recall activated" : "Simulated hold activated", input.reason, "danger");
        return holdView(state);
      }),
    acknowledgeHold: protectedProcedure
      .input(z.object({}).strict())
      .mutation(({ ctx }) => {
        requireBatchParticipant(ctx.user, state.batch.id);
        const actorOrganizationId = getActorOrganizationId(ctx.user);
        if (!state.incident.active) throw new TRPCError({ code: "CONFLICT", message: "No simulated hold is active." });
        const acknowledgment = state.incident.acknowledgments.find(item => item.organizationId === actorOrganizationId);
        if (!acknowledgment) throw new TRPCError({ code: "FORBIDDEN", message: "No organization membership." });
        if (acknowledgment.status === "acknowledged") throw new TRPCError({ code: "CONFLICT", message: "Hold already acknowledged." });
        const acknowledgedAt = now();
        acknowledgment.status = "acknowledged";
        acknowledgment.acknowledgedAt = acknowledgedAt;
        state.incident.timeline.push({ id: `timeline-${state.incident.timeline.length + 1}`, type: "acknowledgment", occurredAt: acknowledgedAt, actorOrganizationId, relatedEventIds: [], label: "Simulated hold acknowledged", simulated: true });
        return holdView(state);
      }),
    reportStockStatus: protectedProcedure
      .input(z.object({ status: z.enum(["not_checked", "quarantine_reported", "stock_not_found", "stock_recovered", "dispensed_before_hold"]), quantity: z.number().int().min(0).max(MAX_QUANTITY).optional() }).strict())
      .mutation(({ ctx, input }) => {
        requireBatchParticipant(ctx.user, state.batch.id);
        const actorOrganizationId = getActorOrganizationId(ctx.user);
        if (!state.incident.active) throw new TRPCError({ code: "CONFLICT", message: "No simulated hold is active." });
        const acknowledgment = state.incident.acknowledgments.find(item => item.organizationId === actorOrganizationId);
        if (!acknowledgment) throw new TRPCError({ code: "FORBIDDEN", message: "No organization membership." });
        acknowledgment.stockStatus = input.status;
        acknowledgment.stockQuantity = input.quantity ?? null;
        const occurredAt = now();
        state.incident.timeline.push({ id: `timeline-${state.incident.timeline.length + 1}`, type: "stock_status", occurredAt, actorOrganizationId, relatedEventIds: [], label: "Participant-reported stock status", simulated: true });
        return holdView(state);
      }),
    hold: protectedProcedure.query(({ ctx }) => {
      requireBatchParticipant(ctx.user, state.batch.id);
      return holdView(state);
    }),
    advanceVehicleCheckpoint: protectedProcedure
      .input(z.object({ legId: z.string() }).strict())
      .mutation(({ ctx, input }) => {
        requireBatchParticipant(ctx.user, state.batch.id);
        const leg = state.transitLegs.find(item => item.id === input.legId);
        if (!leg) throw new TRPCError({ code: "NOT_FOUND", message: "Transit leg not found." });
        if (leg.status === "held" || leg.status === "recalled" || state.batch.handoffState === "needs_review") {
          throw new TRPCError({ code: "CONFLICT", message: "Onward movement is blocked." });
        }
        const routeKey = `${leg.originLocationId}:${leg.destinationLocationId}` as keyof typeof CHECKPOINTS_BY_ROUTE;
        const sequence = CHECKPOINTS_BY_ROUTE[routeKey] ?? [];
        const nextIndex = leg.lastCheckpointLocation
          ? sequence.findIndex(item => item.label === leg.lastCheckpointLocation?.label) + 1
          : 0;
        const nextCheckpoint = sequence[nextIndex];
        if (!nextCheckpoint) throw new TRPCError({ code: "CONFLICT", message: "The predefined checkpoint sequence is finished." });
        appendTransitCheckpoint(state, leg.id, nextCheckpoint.id);
        if (nextIndex === sequence.length - 1) leg.status = "arrived";
        return routeView(state);
      }),
  }),
});

export type AppRouter = typeof appRouter;
