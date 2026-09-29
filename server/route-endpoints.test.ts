import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { getLocationFreshness, getRouteStatus, isOffRoute } from "./location";

function context(user: TrpcContext["user"]): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const user: NonNullable<TrpcContext["user"]> = {
  id: 1,
  openId: "route-user",
  email: "route@example.com",
  name: "Route User",
  loginMethod: "test",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

describe("protected route endpoints", () => {
  it("rejects anonymous route access", async () => {
    const api = appRouter.createCaller(context(null));
    await expect(api.provenire.route()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(api.provenire.locationTrace()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(api.provenire.advanceVehicleCheckpoint({ legId: "leg-1" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("returns sanitized simulated route and trace views", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.reset();
    const route = await api.provenire.route();
    const trace = await api.provenire.locationTrace();
    expect(route).toMatchObject({ batchNumber: "MS-2026-001", facilities: expect.any(Array), checkpoints: expect.any(Array) });
    expect(trace).toMatchObject({ simulated: true, notice: "Simulated vehicle route. Not live GPS." });
    expect(JSON.stringify({ route, trace })).not.toMatch(/signature|recordHash|previousHash|privateKey/);
  });

  it("advances the signed predefined checkpoint sequence", async () => {
    const api = appRouter.createCaller(context(user));
    await api.provenire.reset();
    await api.provenire.dispatch({ receiverId: "central-pharma" });
    const before = await api.provenire.route();
    const after = await api.provenire.advanceVehicleCheckpoint({ legId: "leg-1" });
    expect(after.checkpoints).toHaveLength(before.checkpoints.length + 1);
    expect(after.lastReportAt).not.toBeNull();
    expect((await api.provenire.publicVerify()).signatureValid).toBe(true);
  });

  it("rejects unknown legs and extra mutation input", async () => {
    const api = appRouter.createCaller(context(user));
    await expect(api.provenire.advanceVehicleCheckpoint({ legId: "missing-leg" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(api.provenire.advanceVehicleCheckpoint({ legId: "leg-1", latitude: 0 } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("supports route status precedence and injectable freshness", () => {
    expect(getRouteStatus("recalled", "mismatch")).toBe("recalled");
    expect(getRouteStatus("held", "stale")).toBe("held");
    expect(getRouteStatus("in_transit", "mismatch")).toBe("deviation");
    expect(getRouteStatus("stale", "confirmed")).toBe("stale");
    const clock = () => Date.parse("2026-09-29T12:00:00.000Z");
    expect(getLocationFreshness("2026-09-29T11:59:00.000Z", clock)).toBe("fresh");
    expect(getLocationFreshness("2026-09-29T11:00:00.000Z", clock)).toBe("stale");
  });

  it("detects points outside the simulated route tolerance", () => {
    const route = [{ latitude: 19.076, longitude: 72.8777 }, { latitude: 21.1702, longitude: 72.8311 }];
    expect(isOffRoute({ latitude: 20, longitude: 73 }, route)).toBe(false);
    expect(isOffRoute({ latitude: 0, longitude: 0 }, route)).toBe(true);
  });
});
