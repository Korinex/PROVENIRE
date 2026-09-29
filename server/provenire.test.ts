import { describe, expect, it } from "vitest";
import { appRouter, isLocationStale, isOnPredefinedRoute } from "./routers";
import type { TrpcContext } from "./_core/context";

function caller() {
  const ctx: TrpcContext = {
    user: { id: 1, openId: "demo-admin", email: "demo-user@example.com", name: "Demo Admin", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

function callerForEmail(email: string) {
  const ctx: TrpcContext = {
    user: { id: 2, openId: email, email, name: "Demo User", loginMethod: "manus", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
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
    const publicView = await api.provenire.publicVerifyByToken({ token: "MS-2026-001" });
    const json = JSON.stringify(publicView);
    expect(Object.keys(publicView).sort()).toEqual(["batchNumber", "conflictOpen", "productName", "recordIntegrityState", "status"].sort());
    for (const forbidden of ["quantity", "receiverObservedQuantity", "quantityVariance", "route", "senderId", "receiverId", "organizationId", "dispatches", "receipts", "events", "payload", "signature", "recordHash", "activity"]) {
      expect(Object.keys(publicView)).not.toContain(forbidden);
    }
    expect(json).not.toContain("1000");
    expect(json).not.toContain("950");
    expect(json).not.toContain("Central Pharma Distributor");
    expect(publicView).toEqual({ batchNumber: "MS-2026-001", productName: "MedSure 500 mg", recordIntegrityState: "valid", conflictOpen: true, status: "needs_review" });
    expect(await api.provenire.publicVerifyByToken({ token: "not-a-batch" })).toEqual({ batchNumber: "", productName: "", recordIntegrityState: "invalid", conflictOpen: false, status: "not_found" });
  });

  it("denies anonymous and unmapped accounts detailed procedures while keeping token verification public", async () => {
    const anonymous = appRouter.createCaller({ user: null, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] });
    await expect(anonymous.provenire.state()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.provenire.route()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.provenire.locationTrace()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.provenire.incident()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.provenire.dispatch({ receiverId: "central-pharma" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await anonymous.provenire.publicVerifyByToken({ token: "MS-2026-001" })).status).toBe("needs_review");

    const unmapped = callerForEmail("stranger@example.com");
    await expect(unmapped.provenire.state()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const pending = callerForEmail("demo-pending@example.com");
    await expect(pending.provenire.state()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const suspended = callerForEmail("demo-suspended@example.com");
    await expect(suspended.provenire.state()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("signs simulated checkpoints, updates vehicle position, and blocks movement during a hold", async () => {
    const api = caller();
    await api.provenire.reset();
    const pending = await api.provenire.dispatch({ receiverId: "central-pharma" });
    const before = await api.provenire.route();
    const moved = await api.provenire.advanceVehicleCheckpoint({ legId: `leg-${pending.dispatches[0]!.id}` });
    expect(moved.events.at(-1)?.type).toBe("transit_checkpoint");
    expect(moved.publicVerifier.signatureValid).toBe(true);
    expect((await api.provenire.route()).lastReportAt).not.toBe(before.lastReportAt);
    await api.provenire.receipt({ dispatchId: pending.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 950 });
    const held = await api.provenire.activateSimulatedHold({ reason: "Reported quantity discrepancy" });
    expect(held.incident.onwardMovementBlocked).toBe(true);
    expect(held.status.vehicleStatus).toBe("held");
    expect(held.status.headline).toBe("held");
    await expect(api.provenire.dispatch({ receiverId: "ramdeobaba-pharmacy" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("supports stale and route-deviation classification with a deterministic clock", () => {
    const reference = Date.parse("2026-09-29T12:00:00.000Z");
    expect(isLocationStale("2026-09-29T11:30:00.000Z", reference)).toBe(false);
    expect(isLocationStale("2026-09-29T10:00:00.000Z", reference)).toBe(true);
    expect(isLocationStale(null, reference)).toBe(true);
    expect(isOnPredefinedRoute({ latitude: 28.6139, longitude: 77.209 })).toBe(true);
    expect(isOnPredefinedRoute({ latitude: 0, longitude: 0 })).toBe(false);
  });

  it("enforces approved participant roles and grants observers read-only access", async () => {
    const admin = caller();
    await admin.provenire.reset();
    const manufacturer = callerForEmail("demo-user@example.com");
    const distributor = callerForEmail("demo-distributor@example.com");
    const hospital = callerForEmail("demo-hospital@example.com");
    const dispatched = await manufacturer.provenire.dispatch({ receiverId: "central-pharma" });
    const received = await distributor.provenire.receipt({ dispatchId: dispatched.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000 });
    expect(received.batch.currentHolderId).toBe("central-pharma");
    const second = await distributor.provenire.dispatch({ receiverId: "ramdeobaba-pharmacy" });
    const completed = await hospital.provenire.receipt({ dispatchId: second.batch.activeDispatchId!, receiverId: "ramdeobaba-pharmacy", receiverObservedQuantity: 1000 });
    expect(completed.batch.routeCoverageState).toBe("complete");
    expect((await callerForEmail("demo-auditor@example.com").provenire.state()).batch.batchNumber).toBe("MS-2026-001");
    expect((await callerForEmail("demo-regulator@example.com").provenire.state()).batch.batchNumber).toBe("MS-2026-001");
    await expect(callerForEmail("demo-auditor@example.com").provenire.reset()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerForEmail("demo-regulator@example.com").provenire.dispatch({ receiverId: "central-pharma" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("treats a receipt at the wrong facility as a separate location conflict", async () => {
    const api = caller();
    await api.provenire.reset();
    const pending = await api.provenire.dispatch({ receiverId: "central-pharma" });
    const result = await api.provenire.receipt({ dispatchId: pending.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000, facilityId: "ramdeobaba-pharmacy" });
    expect(result.location.status).toBe("mismatch");
    expect(result.locationMismatch).toBe(true);
    expect(result.batch.quantityState).toBe("consistent");
    expect(result.batch.handoffState).toBe("needs_review");
    expect(result.batch.onwardDispatchAllowed).toBe(false);
    expect((await api.provenire.publicVerifyByToken({ token: "MS-2026-001" })).status).toBe("needs_review");
    await expect(api.provenire.dispatch({ receiverId: "ramdeobaba-pharmacy" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("distinguishes simulated verifier disagreement from an unavailable peer", async () => {
    const api = caller();
    await api.provenire.reset();
    const disagreement = await api.provenire.togglePeer({ nodeId: "node-2", diverge: true });
    expect(disagreement.status.verifierAvailability).toBe("disagreement");
    expect(disagreement.publicVerifier.networkAgreement).toBe(false);
    expect(disagreement.network.every(node => node.status === "healthy")).toBe(true);
    expect(disagreement.network.find(node => node.id === "node-2")?.verificationResult).toBe("valid");
    expect(disagreement.network.find(node => node.id === "node-2")?.eventIds).toHaveLength(disagreement.events.length);
    await api.provenire.reset();
    const incomplete = await api.provenire.togglePeer({ nodeId: "node-2" });
    expect(incomplete.status.verifierAvailability).toBe("incomplete");
  });

  it("activates recalls, enforces acknowledgment identity, and stores stock as reported information", async () => {
    const admin = caller();
    await admin.provenire.runMismatch();
    const recalled = await admin.provenire.activateSimulatedHold({ reason: "Reported discrepancy requires investigation", type: "simulated_recall" });
    expect(recalled.status.headline).toBe("recalled");
    expect(recalled.status.vehicleStatus).toBe("recalled");
    expect(recalled.transitLegs[0]?.status).toBe("recalled");
    const distributor = callerForEmail("demo-distributor@example.com");
    await expect(distributor.provenire.acknowledgeHold({ incidentId: "incident-1", organizationId: "medsure-labs" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const acknowledged = await distributor.provenire.acknowledgeHold({ incidentId: "incident-1", organizationId: "central-pharma" });
    expect(acknowledged.incident.acknowledgments.at(-1)?.organizationId).toBe("central-pharma");
    const report = await distributor.provenire.reportStockStatus({ incidentId: "incident-1", status: "quarantine_reported", quantity: 950 });
    expect(report.stockReport.evidentiaryStatus).toBe("reported_information");
    expect(report.incident.timeline.map(item => item.type)).toContain("stock_status_reported");
    expect(new Set(report.incident.timeline.map(item => item.id)).size).toBe(report.incident.timeline.length);
    expect(report.incident.timeline.map(item => item.type)).toContain("conflict_opened");
    expect(report.incident.timeline.map(item => item.type)).toContain("onward_movement_blocked");
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
});
