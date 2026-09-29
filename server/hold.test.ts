import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function context(user: TrpcContext["user"]): TrpcContext {
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

function user(organizationId = "medsure-labs"): NonNullable<TrpcContext["user"]> {
  return {
    id: 1, openId: `${organizationId}-hold-user`, email: `${organizationId}@example.com`, name: "Hold User",
    loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    organizationId,
  } as NonNullable<TrpcContext["user"]>;
}

async function mismatch() {
  const api = appRouter.createCaller(context(user()));
  await api.provenire.runMismatch();
  return api;
}

describe("simulated holds", () => {
  it("rejects anonymous access to hold procedures", async () => {
    const api = appRouter.createCaller(context(null));
    await expect(api.provenire.activateSimulatedHold({ reason: "Review variance" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(api.provenire.acknowledgeHold({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(api.provenire.reportStockStatus({ status: "not_checked" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(api.provenire.hold()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("requires an open discrepancy", async () => {
    const api = appRouter.createCaller(context(user()));
    await api.provenire.reset();
    await expect(api.provenire.activateSimulatedHold({ reason: "Review variance" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("activates a hold and blocks onward movement", async () => {
    const api = await mismatch();
    const hold = await api.provenire.activateSimulatedHold({ reason: "Reported quantity variance" });
    expect(hold).toMatchObject({ active: true, type: "simulated_hold", reason: "Reported quantity variance", triggeredBy: "medsure-labs", onwardMovementBlocked: true });
    expect(hold.triggeredAt).toEqual(expect.any(String));
    expect(hold.triggeredByEventIds.length).toBeGreaterThan(0);
    expect(hold.acknowledgments).toHaveLength(3);
    expect(hold.acknowledgments.every(item => item.status === "pending")).toBe(true);
    await expect(api.provenire.dispatch({ receiverId: "ramdeobaba-pharmacy" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await api.provenire.route()).transitLegs[0]?.status).toBe("held");
  });

  it("marks recall legs as recalled", async () => {
    const api = await mismatch();
    await api.provenire.activateSimulatedHold({ reason: "Recall reported variance", type: "simulated_recall" });
    expect((await api.provenire.route()).transitLegs[0]?.status).toBe("recalled");
  });

  it("rejects extra keys and short reasons", async () => {
    const api = await mismatch();
    await expect(api.provenire.activateSimulatedHold({ reason: "no", organizationId: "medsure-labs" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(api.provenire.activateSimulatedHold({ reason: "no" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects non-route organization membership", async () => {
    const api = appRouter.createCaller(context(user("not-a-route-org")));
    await api.provenire.runMismatch();
    await expect(api.provenire.activateSimulatedHold({ reason: "Review variance" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("acknowledges only the caller organization and rejects repeats", async () => {
    const api = await mismatch();
    await api.provenire.activateSimulatedHold({ reason: "Review variance" });
    const centralApi = appRouter.createCaller(context(user("central-pharma")));
    const acknowledged = await centralApi.provenire.acknowledgeHold({});
    expect(acknowledged.acknowledgments.find(item => item.organizationId === "central-pharma")?.status).toBe("acknowledged");
    expect(acknowledged.acknowledgments.find(item => item.organizationId === "medsure-labs")?.status).toBe("pending");
    await expect(centralApi.provenire.acknowledgeHold({})).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("stores participant-reported stock status", async () => {
    const api = await mismatch();
    await api.provenire.activateSimulatedHold({ reason: "Review variance" });
    const report = await api.provenire.reportStockStatus({ status: "stock_recovered", quantity: 950 });
    expect(report.acknowledgments.find(item => item.organizationId === "medsure-labs")).toMatchObject({ stockStatus: "stock_recovered", stockQuantity: 950, reported: true });
    await expect(api.provenire.reportStockStatus({ status: "stock_recovered", quantity: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects hold actions when no hold is active", async () => {
    const api = appRouter.createCaller(context(user()));
    await api.provenire.reset();
    await expect(api.provenire.acknowledgeHold({})).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(api.provenire.reportStockStatus({ status: "not_checked" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("resets the simulated incident and keeps responses sanitized", async () => {
    const api = await mismatch();
    await api.provenire.activateSimulatedHold({ reason: "Review variance" });
    expect(JSON.stringify(await api.provenire.hold())).not.toMatch(/signature|recordHash|payload|privateKey/);
    const reset = await api.provenire.reset();
    expect(reset).not.toHaveProperty("incident");
    expect((await api.provenire.hold()).active).toBe(false);
  });
});
