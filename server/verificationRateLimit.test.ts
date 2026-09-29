import { describe, expect, it } from "vitest";
import { allowVerificationRequest } from "./verificationRateLimit";

describe("public verification rate limit", () => {
  it("allows 30 requests per client per minute, then resets", () => {
    const key = "verification-rate-limit-test";
    for (let count = 0; count < 30; count += 1) {
      expect(allowVerificationRequest(key, 1_000)).toBe(true);
    }
    expect(allowVerificationRequest(key, 1_001)).toBe(false);
    expect(allowVerificationRequest(key, 61_000)).toBe(true);
  });
});
