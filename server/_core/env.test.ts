import { describe, expect, it } from "vitest";
import { assertJwtSecretConfigured } from "./env";

describe("JWT startup configuration", () => {
  it("requires JWT_SECRET outside test mode", () => {
    expect(() => assertJwtSecretConfigured("development", "")).toThrow("JWT_SECRET");
    expect(() => assertJwtSecretConfigured("production", undefined)).toThrow("JWT_SECRET");
    expect(() => assertJwtSecretConfigured("development", "configured-secret")).not.toThrow();
  });

  it("does not require JWT_SECRET in test mode", () => {
    expect(() => assertJwtSecretConfigured("test", undefined)).not.toThrow();
  });
});