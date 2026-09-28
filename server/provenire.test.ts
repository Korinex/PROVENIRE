import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function caller() {
  const ctx: TrpcContext = {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

describe("Provenire custody protocol", () => {
  it("keeps sender-only dispatch receiver-pending", async () => {
    const api = caller();
    const state = await api.provenire.reset();
    expect(state.batch.currentHolder).toBe("MedSure Labs");
    const afterDispatch = await api.provenire.dispatch({ receiverId: "central-pharma" });
    expect(afterDispatch.batch.handoffState).toBe("receiver_pending");
    expect(afterDispatch.batch.currentHolder).toBe("MedSure Labs");
    expect(afterDispatch.batch.activeDispatchId).toBe("dispatch-1");
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
  });

  it("returns a truthful public verifier projection", async () => {
    const api = caller();
    const state = await api.provenire.runHappyPath();
    expect(state.publicVerifier.verificationStatus).toBe("verified_history");
    expect(state.publicVerifier.acceptedHandoffCount).toBe(2);
    expect(state.publicVerifier.physicalAuthenticityProven).toBe(false);
    expect("privateKey" in state.publicVerifier).toBe(false);
    const publicJson = JSON.stringify(state.publicVerifier);
    for (const privateField of ["senderId", "receiverId", "payload", "canonical", "privateKey"]) {
      expect(publicJson).not.toContain(privateField);
    }
    expect(publicJson).not.toContain("1000");
    expect(publicJson).not.toContain("950");
  });

  it("shows tamper and network failure without losing the record", async () => {
    const api = caller();
    await api.provenire.runHappyPath();
    const tampered = await api.provenire.tamper();
    expect(tampered.publicVerifier.verificationStatus).toBe("tampered");
    expect(tampered.publicVerifier.hashValid).toBe(false);
    expect(tampered.publicVerifier.networkAgreement).toBe(true);
    expect(tampered.network.every(node => node.status === "healthy")).toBe(true);
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

    await expect(api.provenire.dispatch({ receiverId: "ramdeobaba-pharmacy" })).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
    await expect(api.provenire.dispatch({ receiverId: "medsure-labs" })).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });

    const first = await api.provenire.dispatch({ receiverId: "central-pharma" });
    await api.provenire.receipt({ dispatchId: first.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000 });
    await expect(api.provenire.dispatch({ receiverId: "medsure-labs" })).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
    await expect(api.provenire.dispatch({ receiverId: "central-pharma" })).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
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
  });
});
