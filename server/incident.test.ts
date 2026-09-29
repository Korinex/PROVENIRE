import { describe, expect, it } from "vitest";
import { appRouter, makeInitialState } from "./routers";
import { deriveIncident } from "./incident";
import type { TrpcContext } from "./_core/context";

function context(user: TrpcContext["user"]): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const user: NonNullable<TrpcContext["user"]> = {
  id: 1, openId: "incident-user", email: "incident@example.com", name: "Incident User", loginMethod: "test", role: "user",
  createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
};

describe("incident projection", () => {
  it("derives the mismatch projection", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.runMismatch();
    await expect(api.provenire.incident()).resolves.toMatchObject({
      lastUncontestedCustodian: "MedSure Labs",
      reportingReceiver: "Central Pharma Distributor",
      missingExpectedHandoff: { senderId: "central-pharma", receiverId: "ramdeobaba-pharmacy" },
      dispatchedQuantity: 1000, receiverObservedQuantity: 950, unresolvedQuantity: 50,
      quantityConflictOpen: true, onwardMovementBlocked: true,
    });
  });

  it("marks an accepted first handoff without a hospital receipt as incomplete", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.reset();
    const pending = await api.provenire.dispatch({ receiverId: "central-pharma" });
    await api.provenire.receipt({ dispatchId: pending.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000 });
    const incident = await api.provenire.incident();
    expect(incident).toMatchObject({ historyCoverage: "incomplete", missingExpectedHandoff: { senderId: "central-pharma", receiverId: "ramdeobaba-pharmacy" } });
  });

  it("reports a clean complete route", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.runHappyPath();
    const incident = await api.provenire.incident();
    expect(incident).toMatchObject({ unresolvedQuantity: 0, historyCoverage: "complete", affectedLocations: [] });
  });

  it("separates a location conflict from quantity conflict", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.reset();
    const pending = await api.provenire.dispatch({ receiverId: "central-pharma" });
    await api.provenire.receipt({ dispatchId: pending.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000, locationId: "ramdeobaba-pharmacy" });
    expect(await api.provenire.incident()).toMatchObject({ locationConflictOpen: true, quantityConflictOpen: false });
  });

  it("keeps affected-location reasons bounded to reported facts", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.runMismatch();
    const incident = await api.provenire.incident();
    expect(JSON.stringify(incident.affectedLocations)).not.toMatch(/lost|stolen|is at|located/i);
    expect(incident.affectedLocations.filter(item => item.organizationId === "central-pharma")).toHaveLength(2);
  });

  it("requires authentication and omits proof data", async () => {
    await expect(appRouter.createCaller(context(null)).provenire.incident()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const incident = await appRouter.createCaller(context(user)).provenire.incident();
    expect(JSON.stringify(incident)).not.toMatch(/signature|recordHash|payload|privateKey/);
  });

  it("does not mutate its input", () => {
    const state = makeInitialState();
    const before = structuredClone(state);
    deriveIncident(state);
    expect(state).toEqual(before);
  });
});
