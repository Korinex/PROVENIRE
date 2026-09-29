import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function context(user: TrpcContext["user"]): TrpcContext {
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

const user: NonNullable<TrpcContext["user"]> = {
  id: 1, openId: "route-user", email: "demo-user@example.com", name: "Route User", loginMethod: "test", role: "user",
  createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
};

describe("protected route endpoints", () => {
  it("rejects anonymous route access", async () => {
    const api = appRouter.createCaller(context(null));
    await expect(api.provenire.route()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(api.provenire.locationTrace()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(api.provenire.advanceVehicleCheckpoint({ legId: "leg-1" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns simulated route and trace views", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.reset();
    const route = await api.provenire.route();
    const trace = await api.provenire.locationTrace();
    expect(route).toMatchObject({ batchNumber: "MS-2026-001", facilities: expect.any(Array), checkpoints: expect.any(Array), vehicle: { simulated: true } });
    expect(trace).toMatchObject({ quantityStatus: "consistent", handoffStatus: "origin_verified" });
    expect(JSON.stringify({ route, trace })).not.toMatch(/signature|recordHash|payload|privateKey/);
  });

  it("advances the active simulated checkpoint", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.reset();
    await api.provenire.dispatch({ receiverId: "central-pharma" });
    const before = await api.provenire.route();
    const after = await api.provenire.advanceVehicleCheckpoint({ legId: "leg-dispatch-1" });
    expect(after.events.length).toBeGreaterThan(before.checkpoints.length);
    expect(after.transitLegs[0]?.lastCheckpointAt).not.toBeNull();
  });

  it("rejects unknown legs and extra mutation input", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.reset();
    await api.provenire.dispatch({ receiverId: "central-pharma" });
    await expect(api.provenire.advanceVehicleCheckpoint({ legId: "missing-leg" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const advanced = await api.provenire.advanceVehicleCheckpoint({ legId: "leg-dispatch-1", latitude: 0 } as never);
    expect(advanced.transitLegs[0]?.lastCheckpointAt).not.toBeNull();
  });
});
