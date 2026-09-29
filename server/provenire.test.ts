import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { appendTransitCheckpoint, appRouter, makeInitialState } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getLocationFreshness, STALE_LOCATION_THRESHOLD_MS } from "./location";
import { canonicalize } from "./proof";

function caller() {
  const ctx: TrpcContext = {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

describe("Provenire custody protocol", () => {
  it("runs the clean successful route repeatedly", async () => {
    const api = caller();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await api.provenire.runHappyPath();
      expect(state.batch.routeCoverageState).toBe("complete");
      expect(state.batch.acceptedHandoffs).toBe(2);
    }
  });

  it("keeps sender-only dispatch receiver-pending", async () => {
    const api = caller();
    const state = await api.provenire.reset();
    expect(state.batch.currentHolder).toBe("MedSure Labs");
    const afterDispatch = await api.provenire.dispatch({ receiverId: "central-pharma" });
    expect(afterDispatch.batch.handoffState).toBe("receiver_pending");
    expect(afterDispatch.batch.currentHolder).toBe("MedSure Labs");
    expect(afterDispatch.batch.activeDispatchId).toBe("dispatch-1");
    expect(afterDispatch.events.at(-1)?.proof.signature).not.toMatch(/^simulated-/);
    expect(afterDispatch.publicVerifier.signatureValid).toBe(true);
    expect(afterDispatch.publicVerifier.hashValid).toBe(true);
  });

  it("accepts a matching receiver receipt and advances custody", async () => {
    const api = caller();
    await api.provenire.reset();
    const pending = await api.provenire.dispatch({ receiverId: "central-pharma" });
    const afterReceipt = await api.provenire.receipt({ dispatchId: pending.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000 });
    expect(afterReceipt.batch.handoffState).toBe("accepted");
    expect(afterReceipt.batch.currentHolder).toBe("Central Pharma Distributor");
    expect(afterReceipt.batch.acceptedHandoffs).toBe(1);
    expect(afterReceipt.batch.onwardDispatchAllowed).toBe(true);
  });

  it("preserves a 1,000 versus 950 mismatch and blocks onward custody", async () => {
    const api = caller();
    const state = await api.provenire.runMismatch();
    expect(state.batch.handoffState).toBe("needs_review");
    expect(state.batch.lastUncontestedCustodian).toBe("MedSure Labs");
    expect(state.batch.observedReceiver).toBe("Central Pharma Distributor");
    expect(state.batch.receiverObservedQuantity).toBe(950);
    expect(state.batch.quantityVariance).toBe(50);
    expect(state.batch.acceptedForOnwardCustody).toBe(0);
    expect(state.batch.onwardDispatchAllowed).toBe(false);
    expect(state.conflicts[0]?.status).toBe("open");
    expect(state.batch.currentHolder).toBe("MedSure Labs");
    expect(state.batch.acceptedHandoffs).toBe(0);
    expect(state.dispatches).toHaveLength(1);
    expect(state.receipts).toHaveLength(1);
    expect(state.conflicts[0]).toMatchObject({
      expectedValue: 1000,
      observedValue: 950,
      delta: 50,
      direction: "shortage",
      dispatchId: state.dispatches[0]?.id,
      receiptId: state.receipts[0]?.id,
      status: "open",
    });
    expect(state.conflicts[0]?.createdAt).toBe(state.receipts[0]?.observedAt);
    expect(state.activity.some(item => item.label === "Quantity discrepancy")).toBe(true);
    await expect(api.provenire.receipt({
      dispatchId: state.dispatches[0]!.id,
      receiverId: "central-pharma",
      receiverObservedQuantity: 950,
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("returns a truthful public verifier projection", async () => {
    const api = caller();
    const state = await api.provenire.runHappyPath();
    expect(state.publicVerifier.verificationStatus).toBe("verified_history");
    expect(state.publicVerifier.acceptedHandoffCount).toBe(2);
    expect(state.publicVerifier.physicalAuthenticityProven).toBe(false);
    expect("privateKey" in state.publicVerifier).toBe(false);
    const publicJson = JSON.stringify(state.publicVerifier);
    const publicKeys = Object.keys(state.publicVerifier);
    for (const privateField of ["senderId", "receiverId", "payload", "canonical", "privateKey", "signature", "recordHash", "dispatches", "receipts", "events"]) {
      expect(publicKeys).not.toContain(privateField);
    }
    expect(publicJson).not.toContain("Central Pharma Distributor");
    expect(publicJson).not.toContain("Ramdeobaba Hospital Pharmacy");
    expect(publicJson).not.toContain("1000");
    expect(publicJson).not.toContain("950");
  });

  it("returns only the allowlisted public verifier projection", async () => {
    const api = caller();
    await api.provenire.runMismatch();
    const publicView = await api.provenire.publicVerify();
    const json = JSON.stringify(publicView);
    expect(Object.keys(publicView)).toEqual(expect.arrayContaining([
      "productName", "batchNumber", "acceptedHandoffCount", "verificationStatus", "recordIntegrityState",
    ]));
    for (const forbidden of ["senderId", "receiverId", "receiverObservedQuantity", "quantityVariance", "events", "dispatches", "receipts", "privateKey", "signature"]) {
      expect(Object.keys(publicView)).not.toContain(forbidden);
    }
    expect(json).not.toContain("1000");
    expect(json).not.toContain("950");
    expect(json).not.toContain("Central Pharma Distributor");
  });

  it("shows tamper and network failure without losing the record", async () => {
    const api = caller();
    await api.provenire.runHappyPath();
    const tampered = await api.provenire.tamper();
    expect(tampered.publicVerifier.verificationStatus).toBe("tampered");
    expect(tampered.publicVerifier.hashValid).toBe(false);
    expect(tampered.publicVerifier.signatureValid).toBe(false);
    expect(tampered.publicVerifier.networkAgreement).toBe(true);
    expect(tampered.network.every(node => node.status === "healthy")).toBe(true);
    expect(tampered.publicVerifier.signatureValid).toBe(false);
    const restored = await api.provenire.restore();
    expect(restored.publicVerifier.verificationStatus).toBe("verified_history");
    const incomplete = await api.provenire.togglePeer({ nodeId: "node-3" });
    expect(incomplete.publicVerifier.verificationStatus).toBe("network_disagreement");
    expect(incomplete.publicVerifier.networkAgreement).toBe(false);

    await api.provenire.runMismatch();
    const conflictAndOutage = await api.provenire.togglePeer({ nodeId: "node-3" });
    expect(conflictAndOutage.publicVerifier.verificationStatus).toBe("needs_review");
    expect(conflictAndOutage.publicVerifier.conflictOpen).toBe(true);
    expect(conflictAndOutage.publicVerifier.networkAgreement).toBe(false);
    const unavailableNode = conflictAndOutage.network.find(node => node.id === "node-3")!;
    const tamperedWithOutage = await api.provenire.tamper();
    expect(tamperedWithOutage.network.find(node => node.id === "node-3")?.checkedAt).toBe(unavailableNode.checkedAt);
    const restoredWithOutage = await api.provenire.restore();
    expect(restoredWithOutage.publicVerifier.verificationStatus).toBe("needs_review");
    expect(restoredWithOutage.publicVerifier.networkAgreement).toBe(false);
    expect(restoredWithOutage.network.find(node => node.id === "node-3")?.status).toBe("unavailable");
  });

  it("rejects dispatches that skip or reverse the configured route", async () => {
    const api = caller();
    await api.provenire.reset();

    await expect(api.provenire.dispatch({ receiverId: "not-an-organization" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(api.provenire.dispatch({ receiverId: "ramdeobaba-pharmacy" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.provenire.dispatch({ receiverId: "medsure-labs" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const first = await api.provenire.dispatch({ receiverId: "central-pharma" });
    expect(first.dispatches[0]?.senderId).toBe(first.batch.currentHolderId);
    await expect(api.provenire.receipt({ dispatchId: first.batch.activeDispatchId!, receiverId: "ramdeobaba-pharmacy", receiverObservedQuantity: 1000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await api.provenire.receipt({ dispatchId: first.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000 });
    await expect(api.provenire.receipt({ dispatchId: first.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(api.provenire.dispatch({ receiverId: "medsure-labs" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.provenire.dispatch({ receiverId: "central-pharma" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects duplicate receipts and invalid observed quantities", async () => {
    const api = caller();
    await api.provenire.reset();
    const pending = await api.provenire.dispatch({ receiverId: "central-pharma" });
    const receiptInput = { dispatchId: pending.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000 };
    await api.provenire.receipt(receiptInput);
    await expect(api.provenire.receipt(receiptInput)).rejects.toMatchObject({ code: "CONFLICT" });

    await api.provenire.reset();
    const next = await api.provenire.dispatch({ receiverId: "central-pharma" });
    const dispatchId = next.batch.activeDispatchId!;
    for (const quantity of [0, -1, 1.5, 1_000_001, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(api.provenire.receipt({ dispatchId, receiverId: "central-pharma", receiverObservedQuantity: quantity })).rejects.toBeDefined();
    }
  });

  it("distinguishes shortage and overage while preserving absolute variance", async () => {
    const api = caller();
    await api.provenire.reset();
    const shortageDispatch = await api.provenire.dispatch({ receiverId: "central-pharma" });
    const shortage = await api.provenire.receipt({ dispatchId: shortageDispatch.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 950 });
    expect(shortage.receipts[0]?.variance).toBe(50);
    expect(shortage.receipts[0]?.varianceDirection).toBe("shortage");

    await api.provenire.reset();
    const overageDispatch = await api.provenire.dispatch({ receiverId: "central-pharma" });
    const overage = await api.provenire.receipt({ dispatchId: overageDispatch.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1500 });
    expect(overage.receipts[0]?.variance).toBe(500);
    expect(overage.receipts[0]?.varianceDirection).toBe("overage");
  });

  it("blocks dispatch while pending, during conflict, and after route completion", async () => {
    const api = caller();
    await api.provenire.reset();
    await api.provenire.dispatch({ receiverId: "central-pharma" });
    await expect(api.provenire.dispatch({ receiverId: "central-pharma" })).rejects.toMatchObject({ code: "CONFLICT" });

    await api.provenire.runMismatch();
    await expect(api.provenire.dispatch({ receiverId: "central-pharma" })).rejects.toMatchObject({ code: "CONFLICT" });

    await api.provenire.runHappyPath();
    await expect(api.provenire.dispatch({ receiverId: "ramdeobaba-pharmacy" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("uses one timestamp for each event wrapper and payload", async () => {
    const api = caller();
    const state = await api.provenire.runHappyPath();
    for (const event of state.events) {
      expect(event.payload.occurredAt).toBe(event.occurredAt);
      if (event.type === "receipt") expect(event.payload.observedAt).toBe(event.occurredAt);
    }
    for (const dispatch of state.dispatches) {
      const event = state.events.find(item => item.proof.recordHash === dispatch.proof.recordHash);
      expect(dispatch.occurredAt).toBe(event?.occurredAt);
    }
    for (const receipt of state.receipts) {
      const event = state.events.find(item => item.proof.recordHash === receipt.proof.recordHash);
      expect(receipt.observedAt).toBe(event?.occurredAt);
    }
    expect(state.activity.length).toBeLessThanOrEqual(12);
    expect(new Set(state.activity.map(item => item.id)).size).toBe(state.activity.length);
  });

  it("completes three clean routes when each run starts fresh", async () => {
    const api = caller();
    for (let run = 0; run < 3; run += 1) {
      const state = await api.provenire.runHappyPath();
      expect(state.batch.handoffState).toBe("accepted");
      expect(state.batch.acceptedHandoffs).toBe(2);
      expect(state.dispatches).toHaveLength(2);
      expect(state.dispatches[1]?.senderId).toBe("central-pharma");
      expect(state.receipts).toHaveLength(2);
      expect(state.batch.onwardDispatchAllowed).toBe(false);
    }
  });

  it("enforces route and receipt state", async () => {
    const api = caller();
    await api.provenire.reset();
    await expect(api.provenire.dispatch({ receiverId: "ramdeobaba-pharmacy" })).rejects.toThrow();
    const pending = await api.provenire.dispatch({ receiverId: "central-pharma" });
    await expect(api.provenire.dispatch({ receiverId: "central-pharma" })).rejects.toThrow();
    await expect(api.provenire.receipt({ dispatchId: pending.batch.activeDispatchId!, receiverId: "ramdeobaba-pharmacy", receiverObservedQuantity: 1000 })).rejects.toThrow();
    await api.provenire.receipt({ dispatchId: pending.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000 });
    await expect(api.provenire.dispatch({ receiverId: "medsure-labs" })).rejects.toThrow();
    await expect(api.provenire.receipt({ dispatchId: pending.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000 })).rejects.toThrow();
  });

  it("validates quantity boundaries and preserves shortage/overage direction", async () => {
    const api = caller();
    for (const value of [0, -1, 1.5, NaN, Infinity, 1_000_001]) {
      await api.provenire.reset();
      const pending = await api.provenire.dispatch({ receiverId: "central-pharma" });
      await expect(api.provenire.receipt({ dispatchId: pending.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: value })).rejects.toThrow();
    }
    await api.provenire.reset();
    const shortage = await api.provenire.dispatch({ receiverId: "central-pharma" });
    const shortageState = await api.provenire.receipt({ dispatchId: shortage.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1 });
    expect(shortageState.conflicts[0]?.direction).toBe("shortage");
    await api.provenire.reset();
    const overage = await api.provenire.dispatch({ receiverId: "central-pharma" });
    const overageState = await api.provenire.receipt({ dispatchId: overage.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1_000_000 });
    expect(overageState.conflicts[0]?.direction).toBe("overage");
  });

  it("reuses one timestamp for event and payload", async () => {
    const api = caller();
    await api.provenire.reset();
    const state = await api.provenire.dispatch({ receiverId: "central-pharma" });
    const event = state.events.at(-1)!;
    expect(event.occurredAt).toBe(event.payload.occurredAt);
  });

  it("caps activity while preserving the activity shape and order", async () => {
    const api = caller();
    await api.provenire.reset();
    for (let i = 0; i < 210; i += 1) {
      await api.provenire.togglePeer({ nodeId: "node-1" });
    }
    const state = await api.provenire.state();
    expect(state.activity.length).toBeLessThanOrEqual(12);
    expect(state.activity[0]).toMatchObject({ id: expect.any(String), label: expect.any(String), occurredAt: expect.any(String) });
  });

  it("appends a signed custody location event linked to the prior record", async () => {
    const state = await caller().provenire.reset();
    const event = state.events.find(item => item.type === "custody_location")!;
    const prior = state.events[state.events.indexOf(event) - 1]!;
    expect(event.payload).toMatchObject({ facilityId: "medsure-labs", organizationId: "medsure-labs", latitude: 19.076, longitude: 72.8777 });
    expect(event.proof.previousHash).toBe(prior.proof.recordHash);
    expect(event.proof.recordHash).toMatch(/^[a-f0-9]{64}$/);
    expect(state.publicVerifier.signatureValid).toBe(true);
  });

  it("restricts simulated checkpoints to the predefined route through the internal helper", () => {
    const state = makeInitialState();
    state.transitLegs.push({ id: "leg-test-1", batchId: state.batch.id, vehicleId: "PROV-TRUCK-07", senderId: "medsure-labs", receiverId: "central-pharma", originLocationId: "medsure-labs", destinationLocationId: "central-pharma", status: "in_transit", startedAt: state.events.at(-1)!.occurredAt, lastCheckpointAt: null, lastCheckpointLocation: null });
    expect(() => appendTransitCheckpoint(state, "leg-test-1", "not-a-route-stop")).toThrow("predefined simulated route");
    appendTransitCheckpoint(state, "leg-test-1", "surat");
    const event = state.events.at(-1)!;
    expect(event.payload).toMatchObject({ vehicleId: "PROV-TRUCK-07", checkpointLabel: "Surat (simulated)", source: "simulated_gps" });
    expect(state.transitLegs[0]?.lastCheckpointAt).toBe(event.occurredAt);
    expect(state.transitLegs[0]?.lastCheckpointLocation?.label).toBe("Surat (simulated)");
  });

  it("detects tampered location and checkpoint payload hashes", async () => {
    const api = caller();
    await api.provenire.reset();
    expect((await api.provenire.tamper()).publicVerifier.hashValid).toBe(false);
    const state = makeInitialState();
    state.transitLegs.push({ id: "leg-test-2", batchId: state.batch.id, vehicleId: "PROV-TRUCK-07", senderId: "medsure-labs", receiverId: "central-pharma", originLocationId: "medsure-labs", destinationLocationId: "central-pharma", status: "in_transit", startedAt: state.events.at(-1)!.occurredAt, lastCheckpointAt: null, lastCheckpointLocation: null });
    appendTransitCheckpoint(state, "leg-test-2", "surat");
    const event = state.events.at(-1)!;
    event.payload.latitude = 0;
    const hash = createHash("sha256").update(canonicalize({ eventId: event.id, batchId: state.batch.id, seq: state.events.length - 1, type: event.type, actorOrgId: event.actorId, occurredAt: event.occurredAt, previousHash: event.proof.previousHash, payload: event.payload }), "utf8").digest("hex");
    expect(hash).not.toBe(event.proof.recordHash);
  });

  it("holds a matching-quantity receipt at the wrong simulated facility", async () => {
    const api = caller();
    await api.provenire.reset();
    const pending = await api.provenire.dispatch({ receiverId: "central-pharma" });
    const state = await api.provenire.receipt({ dispatchId: pending.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000, locationId: "ramdeobaba-pharmacy" });
    expect(state.receipts[0]).toMatchObject({ locationMismatch: true, status: "needs_review", variance: 0 });
    expect(state.batch).toMatchObject({ locationMismatch: true, quantityState: "consistent", onwardDispatchAllowed: false });
    expect(state.conflicts).toHaveLength(0);
  });

  it("classifies simulated checkpoint freshness with an injected clock", () => {
    const clock = () => Date.parse("2026-09-29T12:00:00.000Z");
    expect(getLocationFreshness(null, clock)).toBe("unknown");
    expect(getLocationFreshness("2026-09-29T11:45:00.000Z", clock)).toBe("fresh");
    expect(getLocationFreshness(new Date(clock() - STALE_LOCATION_THRESHOLD_MS - 1).toISOString(), clock)).toBe("stale");
  });

  it("seeds simulated facility and vehicle data", () => {
    const state = makeInitialState();
    expect(state.facilities).toHaveLength(3);
    expect(state.vehicles[0]).toMatchObject({ id: "PROV-TRUCK-07", carrierName: "Simulated Provenire Transport", dataSource: "Simulated GPS playback", simulated: true });
  });

  it("signs a custody arrival after an accepted receipt", async () => {
    const api = caller();
    await api.provenire.reset();
    const pending = await api.provenire.dispatch({ receiverId: "central-pharma" });
    const state = await api.provenire.receipt({ dispatchId: pending.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000 });
    expect(state.events.at(-1)).toMatchObject({ type: "custody_location", actorId: "central-pharma", payload: expect.objectContaining({ facilityId: "central-pharma", reason: "arrived_at_facility" }) });
  });

  it("marks a completed simulated transit leg as arrived", async () => {
    const api = caller();
    await api.provenire.reset();
    const pending = await api.provenire.dispatch({ receiverId: "central-pharma" });
    const state = await api.provenire.receipt({ dispatchId: pending.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000 });
    expect(state.transitLegs[0]?.status).toBe("arrived");
  });

  it("treats an invalid simulated report time as unknown", () => {
    expect(getLocationFreshness("not-a-time", () => 0)).toBe("unknown");
  });

  it("does not expose a checkpoint mutation on the Provenire router", () => {
    expect(Object.keys(appRouter._def.procedures)).not.toContain("provenire.appendTransitCheckpoint");
  });
});
