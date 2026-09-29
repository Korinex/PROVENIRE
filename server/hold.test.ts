import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function context(user: TrpcContext["user"]): TrpcContext {
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

function participant(email = "demo-user@example.com"): NonNullable<TrpcContext["user"]> {
  return { id: 1, openId: email, email, name: "Hold User", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
}

async function mismatch() {
  const api = appRouter.createCaller(context(participant()));
  await api.provenire.runMismatch();
  return api;
}

describe("simulated holds", () => {
  it("rejects anonymous access", async () => {
    const api = appRouter.createCaller(context(null));
    await expect(api.provenire.activateSimulatedHold({ reason: "Review variance" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(api.provenire.acknowledgeHold({ incidentId: "incident-1", organizationId: "medsure-labs" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(api.provenire.reportStockStatus({ incidentId: "incident-1", status: "not_checked" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(api.provenire.incident()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("requires an open discrepancy", async () => {
    const api = appRouter.createCaller(context(participant()));
    await api.provenire.reset();
    await expect(api.provenire.activateSimulatedHold({ reason: "Review variance" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("activates a hold and blocks onward movement", async () => {
    const api = await mismatch();
    const hold = await api.provenire.activateSimulatedHold({ reason: "Reported quantity variance" });
    expect(hold.incident).toMatchObject({ active: true, type: "simulated_hold", reason: "Reported quantity variance", triggeredBy: "medsure-labs", onwardMovementBlocked: true });
    await expect(api.provenire.dispatch({ receiverId: "ramdeobaba-pharmacy" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await api.provenire.route()).transitLegs[0]?.status).toBe("held");
  });

  it("marks recall legs as recalled", async () => {
    const api = await mismatch();
    await api.provenire.activateSimulatedHold({ reason: "Recall reported variance", type: "simulated_recall" });
    expect((await api.provenire.route()).transitLegs[0]?.status).toBe("recalled");
  });

  it("rejects invalid hold input", async () => {
    const api = await mismatch();
    await expect(api.provenire.activateSimulatedHold({ reason: "no", organizationId: "medsure-labs" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects non-route membership", async () => {
    const api = await mismatch();
    const regulatorApi = appRouter.createCaller(context(participant("demo-regulator@example.com")));
    await expect(regulatorApi.provenire.activateSimulatedHold({ reason: "Review variance" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("records acknowledgments for the caller organization", async () => {
    const api = await mismatch();
    const activated = await api.provenire.activateSimulatedHold({ reason: "Review variance" });
    const centralApi = appRouter.createCaller(context(participant("demo-distributor@example.com")));
    const acknowledged = await centralApi.provenire.acknowledgeHold({ incidentId: activated.incident.id!, organizationId: "central-pharma" });
    expect(acknowledged.incident.acknowledgments.at(-1)?.organizationId).toBe("central-pharma");
    const repeated = await centralApi.provenire.acknowledgeHold({ incidentId: activated.incident.id!, organizationId: "central-pharma" });
    expect(repeated.incident.acknowledgments.at(-1)?.organizationId).toBe("central-pharma");
  });

  it("stores participant-reported stock status", async () => {
    const api = await mismatch();
    const activated = await api.provenire.activateSimulatedHold({ reason: "Review variance" });
    const report = await api.provenire.reportStockStatus({ incidentId: activated.incident.id!, status: "stock_recovered", quantity: 950 });
    expect(report.stockReport).toMatchObject({ stockStatus: "stock_recovered", quantity: 950, evidentiaryStatus: "reported_information" });
  });

  it("rejects hold actions when no hold is active", async () => {
    const api = appRouter.createCaller(context(participant()));
    await api.provenire.reset();
    await expect(api.provenire.acknowledgeHold({ incidentId: "incident-1", organizationId: "medsure-labs" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(api.provenire.reportStockStatus({ incidentId: "incident-1", status: "not_checked" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps incident responses sanitized", async () => {
    const api = await mismatch();
    expect(JSON.stringify(await api.provenire.incident())).not.toMatch(/signature|recordHash|payload|privateKey/);
  });
});
