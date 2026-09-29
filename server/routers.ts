import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { generateOrgKeys, sealEvent, verifyChain, chainIsValid } from "./proof/index";
import type { EventBody as ProofEventBody, SealedEvent } from "./proof/seal";

type OrgRole = "manufacturer" | "distributor" | "hospital_pharmacy" | "regulator" | "auditor";
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
  network: { id: string; name: string; status: "healthy" | "unavailable"; headHash: string; verificationResult: "valid" | "invalid"; eventIds: string[]; divergent: boolean; checkedAt: string }[];
  activity: { id: string; label: string; detail: string; tone: "neutral" | "good" | "warning" | "danger"; occurredAt: string }[];
  location: { currentLocation: { latitude: number; longitude: number; label: string } | null; checkpointIndex: number; lastReportAt: string | null; status: "confirmed" | "checkpoint_reported" | "stale" | "mismatch" | "unknown" };
  incident: { id: string | null; active: boolean; type: "simulated_hold" | "simulated_recall" | null; reason: string | null; triggeredAt: string | null; triggeredBy: string | null; triggeredByEventIds: string[]; onwardMovementBlocked: boolean; acknowledgments: { organizationId: string; acknowledgedAt: string; stockStatus?: string; quantity?: number }[]; timeline: { id: string; type: string; timestamp: string; actorOrganization: string; relatedEventIds: string[]; label: string; simulated: boolean }[] };
};

const FACILITIES = [
  { id: "medsure-labs", name: "MedSure Labs", role: "manufacturer" as const, latitude: 19.076, longitude: 72.8777, simulated: true },
  { id: "central-pharma", name: "Central Pharma Distributor", role: "distributor" as const, latitude: 28.6139, longitude: 77.209, simulated: true },
  { id: "ramdeobaba-pharmacy", name: "Ramdeobaba Hospital Pharmacy", role: "hospital_pharmacy" as const, latitude: 21.1458, longitude: 79.0882, simulated: true },
];
const CHECKPOINTS = [
  { latitude: 23.0225, longitude: 72.5714, label: "Ahmedabad (simulated)" },
  { latitude: 21.1702, longitude: 72.8311, label: "Near Surat (simulated)" },
  { latitude: 28.6139, longitude: 77.209, label: "Central Pharma Distributor" },
  { latitude: 24.879, longitude: 74.629, label: "Route checkpoint (simulated)" },
  { latitude: 21.1458, longitude: 79.0882, label: "Ramdeobaba Hospital Pharmacy" },
];
const HEADLINE_PRECEDENCE = ["tampered", "held", "recalled", "needs_review", "history_incomplete", "verifier_incomplete", "receiver_pending", "verified"] as const;

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

const LOCATION_STALE_AFTER_MS = 60 * 60 * 1000;
export function isLocationStale(lastReportAt: string | null, referenceTime = Date.now()) {
  return !lastReportAt || referenceTime - Date.parse(lastReportAt) > LOCATION_STALE_AFTER_MS;
}
export function isOnPredefinedRoute(point: { latitude: number; longitude: number } | null) {
  if (!point) return false;
  const routePoints = [...FACILITIES, ...CHECKPOINTS];
  return routePoints.some(routePoint => Math.abs(point.latitude - routePoint.latitude) <= 0.25 && Math.abs(point.longitude - routePoint.longitude) <= 0.25);
}

function membershipFor(user: { email?: string | null; role?: string } | null) {
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to access participant records." });
  if (user.role === "admin") return { organizationId: "medsure-labs", role: "manufacturer" as const, status: "approved" as const };
  const mapping: Record<string, { organizationId: string; role: OrgRole; status: "approved" | "pending" | "suspended" }> = {
    "demo-user@example.com": { organizationId: "medsure-labs", role: "manufacturer", status: "approved" },
    "demo-distributor@example.com": { organizationId: "central-pharma", role: "distributor", status: "approved" },
    "demo-hospital@example.com": { organizationId: "ramdeobaba-pharmacy", role: "hospital_pharmacy", status: "approved" },
    "demo-pending@example.com": { organizationId: "medsure-labs", role: "manufacturer", status: "pending" },
    "demo-suspended@example.com": { organizationId: "medsure-labs", role: "manufacturer", status: "suspended" },
    "demo-regulator@example.com": { organizationId: "demo-regulator", role: "regulator", status: "approved" },
    "demo-auditor@example.com": { organizationId: "demo-auditor", role: "auditor", status: "approved" },
  };
  const membership = user.email ? mapping[user.email.toLowerCase()] : undefined;
  if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "No approved organization membership is configured for this account." });
  if (membership.status !== "approved") throw new TRPCError({ code: "FORBIDDEN", message: `Organization membership is ${membership.status}.` });
  return membership;
}

function requireBatchParticipant(user: { email?: string | null; role?: string } | null, action: "read" | "dispatch" | "receipt" = "read") {
  const membership = membershipFor(user);
  if ((membership.role === "regulator" || membership.role === "auditor") && action === "read") return membership;
  if ((membership.role === "regulator" || membership.role === "auditor") && action !== "read") throw new TRPCError({ code: "FORBIDDEN", message: "Regulator and auditor demo memberships are read-only." });
  if (!ROUTE.includes(membership.organizationId as (typeof ROUTE)[number])) throw new TRPCError({ code: "FORBIDDEN" });
  if (user?.role === "admin") return membership;
  if (action === "dispatch" && !["manufacturer", "distributor"].includes(membership.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Only an authorized sender can dispatch." });
  if (action === "receipt" && !["distributor", "hospital_pharmacy"].includes(membership.role)) throw new TRPCError({ code: "FORBIDDEN", message: "Only an intended receiver can acknowledge receipt." });
  return membership;
}

function requireWritableParticipant(user: { email?: string | null; role?: string } | null) {
  const membership = requireBatchParticipant(user);
  if (membership.role === "regulator" || membership.role === "auditor") throw new TRPCError({ code: "FORBIDDEN", message: "Regulator and auditor demo memberships are read-only." });
  return membership;
}

function appendIncidentTimeline(state: DemoState, values: Omit<DemoState["incident"]["timeline"][number], "id">) {
  state.incident.timeline.push({ id: `timeline-${state.incident.timeline.length + 1}`, ...values });
}

const orgKeys = generateOrgKeys(organizations.map(org => org.id));

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
  if (type === "origin" || type === "dispatch" || type === "receipt") {
    const labels: Record<string, string> = { origin: "Batch origin signed", dispatch: "Dispatch signed", receipt: "Receiver reported receipt" };
    appendIncidentTimeline(state, { type: type === "receipt" ? "receiver_reported_receipt" : `${type}_signed`, timestamp: eventTime, actorOrganization: actorId, relatedEventIds: [eventId], label: labels[type]!, simulated: true });
  }
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
    network: ["Verifier North", "Verifier Central", "Verifier South"].map((name, index) => ({
      id: `node-${index + 1}`,
      name,
      status: "healthy" as const,
      headHash: "GENESIS",
      verificationResult: "valid" as const,
      eventIds: [] as string[],
      divergent: false,
      checkedAt: now(),
    })),
    activity: [] as DemoState["activity"],
    location: { currentLocation: { latitude: FACILITIES[0]!.latitude, longitude: FACILITIES[0]!.longitude, label: FACILITIES[0]!.name }, checkpointIndex: 0, lastReportAt: now(), status: "confirmed" as const },
    incident: { id: null, active: false, type: null, reason: null, triggeredAt: null, triggeredBy: null, triggeredByEventIds: [], onwardMovementBlocked: false, acknowledgments: [], timeline: [] },
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
  const headHash = current.events.at(-1)?.proof.recordHash ?? "GENESIS";
  const proofEvents = current.events.map((event, index) => ({ eventId: event.id, batchId: current.batch.id, seq: index, type: event.type, actorOrgId: event.actorId, occurredAt: event.occurredAt, previousHash: event.proof.previousHash, payload: event.payload, recordHash: event.proof.recordHash, signature: event.proof.signature })) satisfies SealedEvent[];
  current.network = current.network.map(node => {
    if (node.status === "unavailable") return node;
    const peerView = proofEvents;
    const computed = chainIsValid(verifyChain(peerView, orgKeys.getPublicKeyMap()));
    return { ...node, headHash: node.divergent ? "DIVERGENT-HEAD" : peerView.at(-1)?.recordHash ?? "GENESIS", verificationResult: computed ? "valid" : "invalid", eventIds: peerView.map(event => event.eventId), checkedAt: now() };
  });
  const availablePeers = current.network.filter(node => node.status === "healthy");
  current.batch.networkState = current.network.some(node => node.status === "unavailable") ? "incomplete" : new Set(availablePeers.map(node => node.headHash)).size > 1 || new Set(availablePeers.map(node => node.verificationResult)).size > 1 ? "disagreement" : "agreement";
}

function getExpectedReceiverId(current: DemoState): string | undefined {
  if (current.batch.acceptedHandoffs >= ROUTE.length - 1) return undefined;
  return ROUTE[current.batch.acceptedHandoffs + 1];
}

function createDispatch(current: DemoState, receiverId: string, quantityOverride?: number) {
  if (current.batch.conflictState === "open" || current.location.status === "mismatch" || current.incident.onwardMovementBlocked) {
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
  current.transitLegs.push({ id: `leg-${id}`, batchId: dispatch.batchId, vehicleId: "PROV-TRUCK-07", senderId: dispatch.senderId, receiverId: dispatch.receiverId, originLocationId: dispatch.originLocationId, destinationLocationId: dispatch.destinationLocationId, status: "in_transit", startedAt: dispatch.occurredAt, lastCheckpointAt: null, lastCheckpointLocation: null });
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

function createReceipt(current: DemoState, dispatchId: string, receiverId: string, observedQuantity: number, facilityId = receiverId) {
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
  const facility = FACILITIES.find(item => item.id === facilityId);
  if (!facility) throw new TRPCError({ code: "BAD_REQUEST", message: "Receipt facility is not an allowed demo facility." });
  validateQuantity(observedQuantity, "receiverObservedQuantity");
  const receiptLocation = facilityFor(current, facilityId);
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
  addEvent(current, "custody_location", "Receipt facility location signed", receiverId, {
    facilityId: facility.id, organizationId: receiverId, latitude: facility.latitude, longitude: facility.longitude,
    locationLabel: facility.name, reason: locationMismatch ? "receipt_at_unexpected_facility" : "receipt_at_expected_facility",
  }, timestamp);
  current.location.currentLocation = { latitude: facility.latitude, longitude: facility.longitude, label: facility.name };
  current.location.lastReportAt = timestamp;
  current.location.status = locationMismatch ? "mismatch" : "confirmed";
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
  const transitLeg = current.transitLegs.find(item => item.id === `leg-${dispatch.id}`);
  if (transitLeg) transitLeg.status = status === "accepted" ? "arrived" : "held";
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
    if (variance > 0) {
      current.batch.quantityState = "discrepant";
      current.batch.conflictState = "open";
    }
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
    appendIncidentTimeline(current, { type: "conflict_opened", timestamp: event.occurredAt, actorOrganization: receiverId, relatedEventIds: [event.id], label: locationMismatch ? "Location conflict opened" : "Quantity conflict opened", simulated: true });
    appendIncidentTimeline(current, { type: "onward_movement_blocked", timestamp: event.occurredAt, actorOrganization: receiverId, relatedEventIds: [event.id], label: "Onward movement blocked", simulated: true });
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

function publicVerifier(current: DemoState) {
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
  const verification = verifyChain(proofEvents, orgKeys.getPublicKeyMap());
  const tampered = !chainIsValid(verification);
  const conflictOpen = current.batch.conflictState === "open";
  const networkIncomplete = current.batch.networkState === "incomplete";
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

type PublicVerifierResponse = { batchNumber: string; productName: string; recordIntegrityState: "valid" | "invalid"; conflictOpen: boolean; status: "verified" | "needs_review" | "tampered" | "not_found" };
const NOT_FOUND_PUBLIC: PublicVerifierResponse = { batchNumber: "", productName: "", recordIntegrityState: "invalid", conflictOpen: false, status: "not_found" };
function publicVerifyByToken(token: string): PublicVerifierResponse {
  if (token !== state.batch.batchNumber) return { ...NOT_FOUND_PUBLIC };
  const verification = publicVerifier(state);
  const integrityInvalid = verification.recordIntegrityState === "invalid";
  const conflictOpen = state.batch.conflictState === "open" || state.location.status === "mismatch";
  const incomplete = state.batch.routeCoverageState === "incomplete";
  const status = integrityInvalid ? "tampered" : conflictOpen || incomplete || state.batch.handoffState === "receiver_pending" || state.batch.networkState !== "agreement" ? "needs_review" : "verified";
  // Explicit whitelist: never spread state or the detailed verifier projection here.
  return { batchNumber: state.batch.batchNumber, productName: state.batch.productName, recordIntegrityState: integrityInvalid ? "invalid" : "valid", conflictOpen, status };
}

export function deriveIncident(current: DemoState) {
  const dispatched = current.dispatches.at(-1);
  const observed = dispatched && current.receipts.find(receipt => receipt.dispatchId === dispatched.id);
  const complete = current.batch.routeCoverageState === "complete";
  const expectedSender = ROUTE[Math.min(current.batch.acceptedHandoffs + (current.batch.activeDispatchId ? 0 : 0), ROUTE.length - 2)];
  const expectedReceiver = ROUTE[Math.min(current.batch.acceptedHandoffs + 1, ROUTE.length - 1)];
  const missing = !complete && !current.batch.activeDispatchId && current.batch.acceptedHandoffs === 1
    ? { senderId: expectedSender!, receiverId: expectedReceiver! } : null;
  const quantityOpen = current.batch.conflictState === "open";
  const locationOpen = current.location.status === "mismatch";
  return {
    lastUncontestedCustodian: orgName(current, current.batch.lastUncontestedCustodianId),
    reportingReceiver: current.batch.observedReceiverId ? orgName(current, current.batch.observedReceiverId) : null,
    missingExpectedHandoff: missing,
    dispatchedQuantity: dispatched?.dispatchedQuantity ?? null,
    receiverObservedQuantity: observed?.receiverObservedQuantity ?? null,
    unresolvedQuantity: observed ? Math.abs(dispatched!.dispatchedQuantity - observed.receiverObservedQuantity) : 0,
    quantityConflictOpen: quantityOpen,
    locationConflictOpen: locationOpen,
    historyCoverage: complete ? "complete" as const : "incomplete" as const,
    onwardMovementBlocked: !current.batch.onwardDispatchAllowed || current.incident.onwardMovementBlocked,
    affectedLocations: quantityOpen || locationOpen ? [{ organizationId: current.batch.observedReceiverId ?? current.batch.currentHolderId, action: "investigate" as const, reason: quantityOpen ? "Reported quantity discrepancy" : "Receipt facility does not match expected destination" }] : [],
  };
}

function headlineStatus(current: DemoState) {
  const proof = publicVerifier(current);
  const quantityOrLocationConflict = current.batch.conflictState === "open" || current.location.status === "mismatch";
  // Precedence is explicit: evidence integrity and active safety holds outrank completeness and routine pending state.
  if (proof.recordIntegrityState === "invalid") return HEADLINE_PRECEDENCE[0];
  if (current.incident.type === "simulated_hold") return HEADLINE_PRECEDENCE[1];
  if (current.incident.type === "simulated_recall") return HEADLINE_PRECEDENCE[2];
  if (quantityOrLocationConflict) return HEADLINE_PRECEDENCE[3];
  if (current.batch.routeCoverageState === "incomplete" && current.batch.acceptedHandoffs > 0 && !current.batch.activeDispatchId) return HEADLINE_PRECEDENCE[4];
  if (current.batch.networkState === "incomplete") return HEADLINE_PRECEDENCE[5];
  if (current.batch.handoffState === "receiver_pending") return HEADLINE_PRECEDENCE[6];
  if (current.batch.routeCoverageState !== "complete") return HEADLINE_PRECEDENCE[6];
  return HEADLINE_PRECEDENCE[7];
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
    transitLegs: current.transitLegs,
    receipts: current.receipts.map(receipt => ({
      ...receipt,
      receiverName: orgName(current, receipt.receiverId),
    })),
    events: current.events.map(event => ({ ...event, actorName: orgName(current, event.actorId) })),
    conflicts: current.conflicts,
    facilities: current.facilities,
    vehicles: current.vehicles,
    network: current.network,
    activity: current.activity.slice(0, 12),
    location: current.location,
    locationMismatch: current.location.status === "mismatch",
    incident: current.incident,
    incidentProjection: deriveIncident(current),
    status: {
      recordIntegrity: current.batch.recordIntegrityState === "tampered" || publicVerifier(current).recordIntegrityState === "invalid" ? "tampered" : "valid",
      quantityAgreement: current.batch.quantityState === "discrepant" ? "discrepant" : "consistent",
      historyCoverage: current.batch.routeCoverageState,
      verifierAvailability: current.batch.networkState,
      handoffStatus: current.batch.handoffState,
      vehicleStatus: current.incident.type === "simulated_hold" ? "held" : current.incident.type === "simulated_recall" ? "recalled" : current.batch.activeDispatchId ? "in_transit" : current.batch.routeCoverageState === "complete" ? "arrived" : "not_started",
      locationStatus: current.location.status,
      incidentStatus: current.incident.type === "simulated_hold" ? "hold_active" : current.incident.type === "simulated_recall" ? "recall_simulated" : "none",
      headline: headlineStatus(current),
    },
    publicVerifier: publicVerifier(current),
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
    state: protectedProcedure.query(({ ctx }) => { requireBatchParticipant(ctx.user); return snapshot(state); }),
    publicVerifyByToken: publicProcedure.input(z.object({ token: z.string().min(1).max(128) })).query(({ input }) => publicVerifyByToken(input.token)),
    // Backward-compatible private projection for the existing dashboard; participant access only.
    publicVerify: protectedProcedure.query(({ ctx }) => { requireBatchParticipant(ctx.user); return publicVerifier(state); }),
    route: protectedProcedure.query(({ ctx }) => {
      requireBatchParticipant(ctx.user);
      const current = state.location.currentLocation;
      const lastReportAt = state.location.lastReportAt;
      const elapsed = lastReportAt ? Math.max(0, Date.now() - Date.parse(lastReportAt)) : null;
      const stale = isLocationStale(lastReportAt);
      const deviation = !stale && !isOnPredefinedRoute(current);
      const locationStatus = stale ? "stale" : state.location.status;
      const vehicleStatus = state.incident.type === "simulated_hold" ? "held" : state.incident.type === "simulated_recall" ? "recalled" : state.batch.handoffState === "accepted" && state.batch.routeCoverageState === "complete" ? "arrived" : state.batch.activeDispatchId ? "in_transit" : "not_started";
      return { batchNumber: state.batch.batchNumber, facilities: FACILITIES, transitLegs: state.transitLegs, checkpoints: state.events.filter(e => e.type === "transit_checkpoint" || e.type === "custody_location"), currentLocation: current, nextExpectedLocation: FACILITIES[Math.min(state.batch.acceptedHandoffs + 1, FACILITIES.length - 1)], lastReportAt, timeSinceLastReport: elapsed, locationStatus, vehicleStatus, routeStatus: state.incident.type === "simulated_hold" ? "held" : state.incident.type === "simulated_recall" ? "recalled" : stale ? "stale" : deviation ? "deviation" : "on_route", vehicle: { id: "PROV-TRUCK-07", label: "PROV-TRUCK-07", carrierName: "Simulated Provenire Transport", simulated: true as const, dataSource: "Simulated GPS playback" } };
    }),
    locationTrace: protectedProcedure.query(({ ctx }) => { requireBatchParticipant(ctx.user); const stale = isLocationStale(state.location.lastReportAt); const deviation = !stale && !isOnPredefinedRoute(state.location.currentLocation); return { batch: { id: state.batch.id, batchNumber: state.batch.batchNumber }, route: FACILITIES, facilityMarkers: FACILITIES, transitLegs: state.transitLegs, checkpoints: state.events.filter(e => e.type === "transit_checkpoint" || e.type === "custody_location"), lastConfirmedFacility: state.batch.currentHolderId, currentSimulatedVehiclePoint: state.location.currentLocation, destination: FACILITIES[Math.min(state.batch.acceptedHandoffs + 1, FACILITIES.length - 1)], quantityStatus: state.batch.quantityState, handoffStatus: state.batch.handoffState, holdRecallStatus: state.incident.type, routeDeviationStatus: stale ? "stale" : deviation ? "deviation" : "on_route", lastUpdateTime: state.location.lastReportAt }; }),
    incident: protectedProcedure.query(({ ctx }) => { requireBatchParticipant(ctx.user); return { ...deriveIncident(state), incident: state.incident, headlineStatus: headlineStatus(state) }; }),
    advanceVehicleCheckpoint: protectedProcedure.input(z.object({ legId: z.string() })).mutation(({ ctx, input }) => {
      const membership = requireWritableParticipant(ctx.user);
      if (state.incident.onwardMovementBlocked || state.batch.conflictState === "open") throw new TRPCError({ code: "CONFLICT", message: "Vehicle movement is blocked by an open incident or discrepancy." });
      if (!state.batch.activeDispatchId || input.legId !== `leg-${state.batch.activeDispatchId}`) throw new TRPCError({ code: "NOT_FOUND", message: "Active transit leg not found." });
      const leg = state.transitLegs.find(item => item.id === input.legId);
      if (!leg || (ctx.user.role !== "admin" && leg.senderId !== membership.organizationId)) throw new TRPCError({ code: "FORBIDDEN", message: "Only the current sender can advance this vehicle." });
      const point = CHECKPOINTS[state.location.checkpointIndex % CHECKPOINTS.length]!;
      const timestamp = now();
      addEvent(state, "transit_checkpoint", "Simulated vehicle checkpoint signed", membership.organizationId, { vehicleId: "PROV-TRUCK-07", latitude: point.latitude, longitude: point.longitude, checkpointLabel: point.label, source: "simulated_gps" }, timestamp);
      leg.lastCheckpointAt = timestamp;
      leg.lastCheckpointLocation = { latitude: point.latitude, longitude: point.longitude, label: point.label };
      state.location.currentLocation = { latitude: point.latitude, longitude: point.longitude, label: point.label };
      state.location.checkpointIndex += 1;
      state.location.lastReportAt = timestamp;
      state.location.status = "checkpoint_reported";
      refreshNodeHeads(state);
      return snapshot(state);
    }),
    activateSimulatedHold: protectedProcedure.input(z.object({ reason: z.string().min(3).max(500), type: z.enum(["simulated_hold", "simulated_recall"]).default("simulated_hold") })).mutation(({ ctx, input }) => {
      const membership = requireWritableParticipant(ctx.user);
      if (state.batch.conflictState !== "open" && state.location.status !== "mismatch") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A hold requires an open discrepancy or location conflict." });
      const timestamp = now(); state.incident.id = "incident-1"; state.incident.active = true; state.incident.type = input.type; state.incident.reason = input.reason; state.incident.triggeredAt = timestamp; state.incident.triggeredBy = membership.organizationId; state.incident.triggeredByEventIds = state.events.filter(e => e.type === "receipt" || e.type === "dispatch").map(e => e.id); state.incident.onwardMovementBlocked = true;
      for (const leg of state.transitLegs) {
        if (input.type === "simulated_recall") leg.status = "recalled";
        else if (leg.status !== "arrived") leg.status = "held";
      }
      appendIncidentTimeline(state, { type: `${input.type}_activated`, timestamp, actorOrganization: membership.organizationId, relatedEventIds: state.incident.triggeredByEventIds, label: `${input.type === "simulated_hold" ? "Simulated hold" : "Simulated recall"} activated`, simulated: true });
      return snapshot(state);
    }),
    acknowledgeHold: protectedProcedure.input(z.object({ incidentId: z.string(), organizationId: z.string() })).mutation(({ ctx, input }) => {
      const membership = requireWritableParticipant(ctx.user);
      if (!state.incident.active || input.incidentId !== state.incident.id) throw new TRPCError({ code: "NOT_FOUND", message: "Active incident not found." });
      if (membership.organizationId !== input.organizationId) throw new TRPCError({ code: "FORBIDDEN", message: "You can only acknowledge for your own organization." });
      state.incident.acknowledgments.push({ organizationId: membership.organizationId, acknowledgedAt: now() });
      appendIncidentTimeline(state, { type: "participant_acknowledgment_received", timestamp: now(), actorOrganization: membership.organizationId, relatedEventIds: [], label: "Participant acknowledgment received", simulated: true });
      return snapshot(state);
    }),
    reportStockStatus: protectedProcedure.input(z.object({ incidentId: z.string(), status: z.enum(["not_checked", "quarantine_reported", "stock_not_found", "stock_recovered", "dispensed_before_hold"]), quantity: z.number().int().nonnegative().optional() })).mutation(({ ctx, input }) => {
      const membership = requireWritableParticipant(ctx.user);
      if (!state.incident.active || input.incidentId !== state.incident.id) throw new TRPCError({ code: "NOT_FOUND", message: "Active incident not found." });
      const timestamp = now(); const report = { organizationId: membership.organizationId, acknowledgedAt: timestamp, stockStatus: input.status, ...(input.quantity === undefined ? {} : { quantity: input.quantity }) }; state.incident.acknowledgments.push(report);
      appendIncidentTimeline(state, { type: "stock_status_reported", timestamp, actorOrganization: membership.organizationId, relatedEventIds: [], label: `Stock status reported: ${input.status}`, simulated: true });
      return { ...snapshot(state), stockReport: { ...report, evidentiaryStatus: "reported_information" as const } };
    }),
    reset: protectedProcedure.mutation(({ ctx }) => {
      requireWritableParticipant(ctx.user);
      state = makeInitialState();
      tamperedEvents = null;
      addActivity(state, "Demo reset", "Deterministic scenario restored", "neutral");
      return snapshot(state);
    }),
    runHappyPath: protectedProcedure.mutation(({ ctx }) => {
      requireWritableParticipant(ctx.user);
      state = makeInitialState();
      tamperedEvents = null;
      const first = createDispatch(state, "central-pharma");
      createReceipt(state, first.id, "central-pharma", 1000);
      const second = createDispatch(state, "ramdeobaba-pharmacy");
      createReceipt(state, second.id, "ramdeobaba-pharmacy", 1000);
      addActivity(state, "Happy path complete", "Two receiver-confirmed handoffs completed", "good");
      return snapshot(state);
    }),
    runMismatch: protectedProcedure.mutation(({ ctx }) => {
      requireWritableParticipant(ctx.user);
      state = makeInitialState();
      tamperedEvents = null;
      const dispatch = createDispatch(state, "central-pharma");
      createReceipt(state, dispatch.id, "central-pharma", 950);
      addActivity(state, "Mismatch path ready", "Next dispatch is blocked pending resolution", "danger");
      return snapshot(state);
    }),
    dispatch: protectedProcedure
      .input(z.object({ receiverId: z.string() }))
      .mutation(({ ctx, input }) => {
        const membership = requireBatchParticipant(ctx.user, "dispatch");
        if (ctx.user.role !== "admin" && membership.organizationId !== state.batch.currentHolderId) throw new TRPCError({ code: "FORBIDDEN", message: "Only the current holder may dispatch." });
        createDispatch(state, input.receiverId);
        return snapshot(state);
      }),
    receipt: protectedProcedure
      .input(z.object({
        dispatchId: z.string(),
        receiverId: z.string(),
        receiverObservedQuantity: z.number().int().positive().max(MAX_QUANTITY),
        facilityId: z.enum(["medsure-labs", "central-pharma", "ramdeobaba-pharmacy"]).optional(),
        locationId: z.enum(["medsure-labs", "central-pharma", "ramdeobaba-pharmacy"]).optional(),
      }))
      .mutation(({ ctx, input }) => {
        const membership = requireBatchParticipant(ctx.user, "receipt");
        if (ctx.user.role !== "admin" && membership.organizationId !== input.receiverId) throw new TRPCError({ code: "FORBIDDEN", message: "Receipt actor must match the authenticated organization." });
        createReceipt(state, input.dispatchId, input.receiverId, input.receiverObservedQuantity, input.facilityId ?? input.locationId);
        return snapshot(state);
      }),
    tamper: protectedProcedure.mutation(({ ctx }) => {
      requireWritableParticipant(ctx.user);
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
    restore: protectedProcedure.mutation(({ ctx }) => {
      requireWritableParticipant(ctx.user);
      if (tamperedEvents) {
        state.events = tamperedEvents;
        tamperedEvents = null;
      }
      state.batch.recordIntegrityState = "valid";
      refreshNodeHeads(state);
      addActivity(state, "Proof restored", "Reset or restoration returned the record to a valid state", "good");
      return snapshot(state);
    }),
    togglePeer: protectedProcedure
      .input(z.object({ nodeId: z.string(), diverge: z.boolean().optional() }))
      .mutation(({ ctx, input }) => {
        requireWritableParticipant(ctx.user);
        const node = state.network.find(item => item.id === input.nodeId);
        if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Verifier node not found." });
        if (!input.diverge) node.status = node.status === "healthy" ? "unavailable" : "healthy";
        if (input.diverge) node.divergent = !node.divergent;
        refreshNodeHeads(state);
        addActivity(state, input.diverge ? node.divergent ? "Verifier history disagreement" : "Verifier history restored" : node.status === "unavailable" ? "Verifier unavailable" : "Verifier restored", `${node.name}: ${input.diverge ? node.headHash : node.status}`, node.divergent || node.status === "unavailable" ? "warning" : "good");
        return snapshot(state);
      }),
  }),
});

export type AppRouter = typeof appRouter;
