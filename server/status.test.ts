import { describe, expect, it } from "vitest";
import { appRouter, makeInitialState } from "./routers";
import { deriveStatuses } from "./status";
import type { TrpcContext } from "./_core/context";

function context(user: TrpcContext["user"]): TrpcContext {
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

const user: NonNullable<TrpcContext["user"]> = {
  id: 1, openId: "status-user", email: "status@example.com", name: "Status User", loginMethod: "test", role: "user",
  createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
};

describe("derived statuses", () => {
  it("reports a clean complete route as verified", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.runHappyPath();
    expect(await api.provenire.statuses()).toMatchObject({ recordIntegrity: "valid", quantityAgreement: "consistent", historyCoverage: "complete", verifierAvailability: "agreement", headline: "verified" });
  });

  it("keeps a valid quantity conflict at needs_review", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.runMismatch();
    expect(await api.provenire.statuses()).toMatchObject({ recordIntegrity: "valid", quantityAgreement: "discrepant", handoffStatus: "needs_review", headline: "needs_review" });
  });

  it("ranks tampering above all other states", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.runHappyPath();
    await api.provenire.tamper();
    expect((await api.provenire.statuses()).headline).toBe("tampered");
  });

  it("does not call a single accepted handoff complete", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.reset();
    const pending = await api.provenire.dispatch({ receiverId: "central-pharma" });
    await api.provenire.receipt({ dispatchId: pending.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000 });
    expect(await api.provenire.statuses()).toMatchObject({ historyCoverage: "incomplete", headline: "history_incomplete" });
  });

  it("reports receiver pending", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.reset();
    await api.provenire.dispatch({ receiverId: "central-pharma" });
    expect(await api.provenire.statuses()).toMatchObject({ handoffStatus: "receiver_pending", headline: "receiver_pending" });
  });

  it("reports unavailable and disagreeing verifiers", () => {
    const state = makeInitialState();
    state.network[0]!.status = "unavailable";
    expect(deriveStatuses(state, Date.now()).verifierAvailability).toBe("incomplete");
    state.network[0]!.status = "healthy";
    state.network[0]!.headHash = "different";
    expect(deriveStatuses(state, Date.now()).verifierAvailability).toBe("disagreement");
  });

  it("ranks simulated holds and recalls below review but above history", () => {
    const held = makeInitialState();
    held.incident.active = true;
    held.incident.type = "simulated_hold";
    expect(deriveStatuses(held, Date.now()).headline).toBe("held");
    held.incident.type = "simulated_recall";
    expect(deriveStatuses(held, Date.now()).headline).toBe("recalled");
  });

  it("reports location mismatch and rejects anonymous access", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.reset();
    const pending = await api.provenire.dispatch({ receiverId: "central-pharma" });
    await api.provenire.receipt({ dispatchId: pending.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000, locationId: "ramdeobaba-pharmacy" });
    expect(await api.provenire.statuses()).toMatchObject({ locationStatus: "mismatch", headline: "needs_review" });
    await expect(appRouter.createCaller(context(null)).provenire.statuses()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("sanitizes the response and does not mutate pure derivation input", async () => {
    const api = appRouter.createCaller(context(user));
    const statuses = await api.provenire.statuses();
    expect(JSON.stringify(statuses)).not.toMatch(/signature|recordHash|payload|privateKey/);
    const state = makeInitialState();
    const before = structuredClone(state);
    deriveStatuses(state, Date.now());
    expect(state).toEqual(before);
  });
});
