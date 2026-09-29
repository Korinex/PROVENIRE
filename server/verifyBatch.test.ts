import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const context: TrpcContext = {
  user: null,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
};

describe("public batch verification projection", () => {
  it("returns a read-only privacy-limited record projection", async () => {
    const result = await appRouter.createCaller(context).provenire.verifyBatch({ token: "MS-2026-001" });
    expect(result).toMatchObject({
      productName: "MedSure 500 mg",
      batchNumber: "MS-2026-001",
      manufacturer: "MedSure Labs",
      readOnly: true,
    });
    expect(result.checkedAt).toEqual(expect.any(String));
    expect(result).not.toHaveProperty("initialQuantity");
    expect(result).not.toHaveProperty("events");
    expect(result).not.toHaveProperty("facilities");
    expect(result).not.toHaveProperty("organizations");
  });

  it("rejects unknown and malformed verification tokens", async () => {
    const api = appRouter.createCaller(context).provenire;
    await expect(api.verifyBatch({ token: "other-batch" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(api.verifyBatch({ token: "../redirect" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
