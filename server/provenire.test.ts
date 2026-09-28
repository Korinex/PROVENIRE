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
  });

  it("shows tamper and network failure without losing the record", async () => {
    const api = caller();
    await api.provenire.runHappyPath();
    const tampered = await api.provenire.tamper();
    expect(tampered.publicVerifier.verificationStatus).toBe("tampered");
    expect(tampered.publicVerifier.hashValid).toBe(false);
    const restored = await api.provenire.restore();
    expect(restored.publicVerifier.verificationStatus).toBe("verified_history");
    const incomplete = await api.provenire.togglePeer({ nodeId: "node-3" });
    expect(incomplete.publicVerifier.verificationStatus).toBe("network_disagreement");
    expect(incomplete.publicVerifier.networkAgreement).toBe(false);
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
