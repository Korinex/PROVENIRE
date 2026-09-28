import { createHash } from "node:crypto";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { prependActivity } from "./_core/activity";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";

type OrgRole = "manufacturer" | "distributor" | "hospital_pharmacy";
type HandoffState = "receiver_pending" | "accepted" | "needs_review";
type VarianceDirection = "shortage" | "overage";
const MAX_QUANTITY = 1_000_000;

type Organization = { id: string; name: string; role: OrgRole; shortRole: string };
type Proof = {
  recordHash: string;
  previousHash: string;
  signature: string;
  signer: string;
  signatureValid: boolean;
};
type Event = {
  id: string;
  type: "origin" | "dispatch" | "receipt";
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
  observedAt: string;
  status: HandoffState;
  variance: number;
  varianceDirection: VarianceDirection | null;
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
  direction: VarianceDirection;
  status: "open" | "resolved";
  createdAt: string;
};
type DemoState = {
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
    varianceDirection: VarianceDirection | null;
    acceptedForOnwardCustody: number;
    handoffState: HandoffState | "origin_verified";
    recordIntegrityState: "valid" | "tampered";
    routeCoverageState: "complete" | "incomplete";
    quantityState: "consistent" | "discrepant";
    conflictState: "none" | "open" | "resolved";
    networkState: "agreement" | "incomplete";
    onwardDispatchAllowed: boolean;
    acceptedHandoffs: number;
    activeDispatchId: string | null;
  };
  events: Event[];
  dispatches: Dispatch[];
  receipts: Receipt[];
  conflicts: Conflict[];
  network: { id: string; name: string; status: "healthy" | "unavailable"; headHash: string; checkedAt: string }[];
  activity: { id: string; label: string; detail: string; tone: "neutral" | "good" | "warning" | "danger"; occurredAt: string }[];
  activitySequence: number;
};

const organizations: Organization[] = [
  { id: "medsure-labs", name: "MedSure Labs", role: "manufacturer", shortRole: "Manufacturer" },
  { id: "central-pharma", name: "Central Pharma Distributor", role: "distributor", shortRole: "Distributor" },
  { id: "ramdeobaba-pharmacy", name: "Ramdeobaba Hospital Pharmacy", role: "hospital_pharmacy", shortRole: "Hospital pharmacy" },
];

function now() {
  return new Date().toISOString();
}

function stableHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function orgName(state: DemoState, id: string | null | undefined) {
  return state.organizations.find(org => org.id === id)?.name ?? "Unknown organization";
}

function proofFor(state: DemoState, type: string, actorId: string, occurredAt: string, payload: Record<string, unknown>, previousHash?: string): Proof {
  const predecessor = previousHash ?? state.events.at(-1)?.proof.recordHash ?? "GENESIS";
  const recordHash = stableHash({ type, actorId, occurredAt, previousHash: predecessor, payload });
  return {
    recordHash,
    previousHash: predecessor,
    signature: `simulated-${actorId}-${recordHash.slice(0, 16)}`,
    signer: orgName(state, actorId),
    signatureValid: true,
  };
}

function addActivity(state: DemoState, label: string, detail: string, tone: DemoState["activity"][number]["tone"]) {
  state.activitySequence += 1;
  prependActivity(state.activity, { id: `activity-${state.activitySequence}`, label, detail, tone, occurredAt: now() });
}

function addEvent(state: DemoState, type: Event["type"], label: string, actorId: string, payload: Record<string, unknown>, occurredAt = now()) {
  const eventPayload = { ...payload, occurredAt };
  const event: Event = {
    id: `event-${state.events.length + 1}`,
    type,
    label,
    actorId,
    occurredAt,
    payload: eventPayload,
    proof: proofFor(state, type, actorId, occurredAt, eventPayload),
  };
  state.events.push(event);
  return event;
}

function makeInitialState(): DemoState {
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
    },
    events: [] as Event[],
    dispatches: [] as Dispatch[],
    receipts: [] as Receipt[],
    conflicts: [] as Conflict[],
    network: ["Verifier North", "Verifier Central", "Verifier South"].map((name, index) => ({
      id: `node-${index + 1}`,
      name,
      status: "healthy" as const,
      headHash: "GENESIS",
      checkedAt: now(),
    })),
    activity: [] as DemoState["activity"],
    activitySequence: 0,
  } satisfies DemoState;

  addEvent(state, "origin", "Origin signed", "medsure-labs", {
    product: state.batch.productName,
    batchNumber: state.batch.batchNumber,
    quantity: state.batch.initialQuantity,
    unit: state.batch.unit,
    manufactureDate: state.batch.manufactureDate,
    expiryDate: state.batch.expiryDate,
  });
  refreshNodeHeads(state);
  addActivity(state, "Origin verified", "MedSure Labs signed the batch origin record", "good");
  return state;
}

let state = makeInitialState();

function refreshNodeHeads(current: DemoState) {
  const headHash = current.events.at(-1)?.proof.recordHash ?? "GENESIS";
  current.network = current.network.map(node => node.status === "unavailable" ? node : ({ ...node, headHash, checkedAt: now() }));
}

function createDispatch(current: DemoState, receiverId: string) {
  if (!current.batch.onwardDispatchAllowed) {
    throw new TRPCError({ code: "CONFLICT", message: "Next dispatch is blocked pending resolution or route completion." });
  }
  if (current.batch.activeDispatchId) {
    throw new TRPCError({ code: "CONFLICT", message: "A receiver-pending handoff already requires a receipt." });
  }
  const receiver = current.organizations.find(org => org.id === receiverId);
  if (!receiver) throw new TRPCError({ code: "NOT_FOUND", message: "Receiver organization not found." });
  if (receiverId === current.batch.currentHolderId) {
    throw new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: "Sender and receiver must be different organizations." });
  }
  const expectedReceiverId = ["central-pharma", "ramdeobaba-pharmacy"][current.batch.acceptedHandoffs];
  if (receiverId !== expectedReceiverId) {
    throw new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: "Dispatch must follow the configured custody route." });
  }
  const id = `dispatch-${current.dispatches.length + 1}`;
  const quantity = current.batch.acceptedForOnwardCustody;
  const payload = {
    type: "dispatch",
    batchId: current.batch.batchNumber,
    senderId: current.batch.currentHolderId,
    receiverId,
    quantityDispatched: quantity,
    unit: current.batch.unit,
    location: orgName(current, current.batch.currentHolderId),
  };
  const event = addEvent(current, "dispatch", "Sender dispatch signed", current.batch.currentHolderId, payload);
  const dispatch: Dispatch = {
    id,
    batchId: current.batch.id,
    senderId: current.batch.currentHolderId,
    receiverId,
    dispatchedQuantity: quantity,
    unit: current.batch.unit,
    location: orgName(current, current.batch.currentHolderId),
    occurredAt: event.occurredAt,
    status: "receiver_pending",
    proof: event.proof,
  };
  current.dispatches.push(dispatch);
  current.batch.handoffState = "receiver_pending";
  current.batch.activeDispatchId = id;
  current.batch.observedReceiverId = null;
  current.batch.receiverObservedQuantity = null;
  current.batch.quantityVariance = 0;
  current.batch.quantityState = "consistent";
  addActivity(current, "Receiver pending", `${orgName(current, current.batch.currentHolderId)} dispatched ${quantity} units to ${receiver.name}`, "warning");
  refreshNodeHeads(current);
  return dispatch;
}

function createReceipt(current: DemoState, dispatchId: string, receiverId: string, observedQuantity: number) {
  if (!Number.isFinite(observedQuantity) || !Number.isInteger(observedQuantity) || observedQuantity <= 0 || observedQuantity > MAX_QUANTITY) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Observed quantity must be a whole number between 1 and ${MAX_QUANTITY}.` });
  }
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
  const variance = Math.abs(dispatch.dispatchedQuantity - observedQuantity);
  const varianceDirection: VarianceDirection | null = variance === 0 ? null : observedQuantity < dispatch.dispatchedQuantity ? "shortage" : "overage";
  const status: HandoffState = variance === 0 ? "accepted" : "needs_review";
  const id = `receipt-${current.receipts.length + 1}`;
  const observedAt = now();
  const payload = {
    type: "receipt",
    dispatchId,
    batchId: current.batch.batchNumber,
    receiverId,
    receiverObservedQuantity: observedQuantity,
    unit: current.batch.unit,
    location: receiver.name,
    observedAt,
  };
  const event = addEvent(current, "receipt", "Receiver receipt signed", receiverId, payload, observedAt);
  const receipt: Receipt = {
    id,
    dispatchId,
    receiverId,
    receiverObservedQuantity: observedQuantity,
    unit: current.batch.unit,
    location: receiver.name,
    observedAt: event.occurredAt,
    status,
    variance,
    varianceDirection,
    proof: event.proof,
  };
  current.receipts.push(receipt);
  dispatch.status = status;
  current.batch.activeDispatchId = null;
  current.batch.observedReceiverId = receiverId;
  current.batch.receiverObservedQuantity = observedQuantity;
  current.batch.quantityVariance = variance;
  current.batch.varianceDirection = varianceDirection;
  current.batch.handoffState = status;

  if (status === "accepted") {
    current.batch.currentHolderId = receiverId;
    current.batch.lastUncontestedCustodianId = receiverId;
    current.batch.acceptedForOnwardCustody = observedQuantity;
    current.batch.quantityState = "consistent";
    current.batch.conflictState = "none";
    current.batch.acceptedHandoffs += 1;
    current.batch.routeCoverageState = current.batch.acceptedHandoffs >= 2 ? "complete" : "incomplete";
    current.batch.onwardDispatchAllowed = current.batch.acceptedHandoffs < 2;
    addActivity(current, "Handoff accepted", `${receiver.name} confirmed ${observedQuantity} units`, "good");
  } else {
    current.batch.quantityState = "discrepant";
    current.batch.conflictState = "open";
    current.batch.acceptedForOnwardCustody = 0;
    current.batch.onwardDispatchAllowed = false;
    current.batch.routeCoverageState = "incomplete";
    const conflict: Conflict = {
      id: `conflict-${current.conflicts.length + 1}`,
      dispatchId,
      receiptId: id,
      type: "quantity_discrepancy",
      expectedValue: dispatch.dispatchedQuantity,
      observedValue: observedQuantity,
      delta: variance,
      direction: varianceDirection!,
      status: "open",
      createdAt: event.occurredAt,
    };
    current.conflicts.push(conflict);
    addActivity(current, "Quantity discrepancy", `${receiver.name} observed ${observedQuantity}; variance ${variance}`, "danger");
  }

  refreshNodeHeads(current);
  return receipt;
}

function publicVerifier(current: DemoState) {
  const tampered = current.batch.recordIntegrityState === "tampered";
  const conflictOpen = current.batch.conflictState === "open";
  const networkIncomplete = current.batch.networkState === "incomplete";
  let verificationStatus = "verified_history";
  if (tampered) verificationStatus = "tampered";
  else if (conflictOpen) verificationStatus = "needs_review";
  else if (networkIncomplete) verificationStatus = "network_disagreement";
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
    identityValid: !tampered,
    hashValid: !tampered,
    signatureValid: !tampered,
    predecessorValid: !tampered,
    handoffComplete: current.batch.handoffState === "accepted",
    coverageComplete: current.batch.routeCoverageState === "complete",
    quantityConsistent: current.batch.quantityState === "consistent",
    recallClear: true,
    expiryClear: true,
    conflictOpen,
    networkAgreement: !networkIncomplete,
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
    network: current.network,
    activity: current.activity.slice(0, 12),
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
    state: publicProcedure.query(() => snapshot(state)),
    reset: publicProcedure.mutation(() => {
      state = makeInitialState();
      addActivity(state, "Demo reset", "Deterministic scenario restored", "neutral");
      return snapshot(state);
    }),
    runHappyPath: publicProcedure.mutation(() => {
      state = makeInitialState();
      const first = createDispatch(state, "central-pharma");
      createReceipt(state, first.id, "central-pharma", 1000);
      const second = createDispatch(state, "ramdeobaba-pharmacy");
      createReceipt(state, second.id, "ramdeobaba-pharmacy", 1000);
      addActivity(state, "Happy path complete", "Two receiver-confirmed handoffs completed", "good");
      return snapshot(state);
    }),
    runMismatch: publicProcedure.mutation(() => {
      state = makeInitialState();
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
      .input(z.object({ dispatchId: z.string(), receiverId: z.string(), receiverObservedQuantity: z.number().finite().int().positive().max(MAX_QUANTITY) }))
      .mutation(({ input }) => {
        createReceipt(state, input.dispatchId, input.receiverId, input.receiverObservedQuantity);
        return snapshot(state);
      }),
    tamper: publicProcedure.mutation(() => {
      state.batch.recordIntegrityState = "tampered";
      addActivity(state, "Tamper detected", "A signed field no longer matches its stored proof", "danger");
      return snapshot(state);
    }),
    restore: publicProcedure.mutation(() => {
      state.batch.recordIntegrityState = "valid";
      addActivity(state, "Proof restored", "Reset or restoration returned the record to a valid state", "good");
      return snapshot(state);
    }),
    togglePeer: publicProcedure
      .input(z.object({ nodeId: z.string() }))
      .mutation(({ input }) => {
        const node = state.network.find(item => item.id === input.nodeId);
        if (!node) throw new TRPCError({ code: "NOT_FOUND", message: "Verifier node not found." });
        node.status = node.status === "healthy" ? "unavailable" : "healthy";
        state.batch.networkState = state.network.some(item => item.status === "unavailable") ? "incomplete" : "agreement";
        addActivity(state, node.status === "unavailable" ? "Verifier unavailable" : "Verifier restored", `${node.name} is ${node.status}`, node.status === "unavailable" ? "warning" : "good");
        return snapshot(state);
      }),
  }),
});

export type AppRouter = typeof appRouter;
