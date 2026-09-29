import { describe, expect, it } from "vitest";
import { parseSafeVerificationUrl } from "./verificationUrl";

describe("parseSafeVerificationUrl", () => {
  const origin = "https://provenire.example";

  it("accepts same-origin HTTPS verification links and relative paths", () => {
    expect(parseSafeVerificationUrl("https://provenire.example/verify/MS-2026-001", origin)).toEqual({ token: "MS-2026-001" });
    expect(parseSafeVerificationUrl("/verify/MS-2026-001", origin)).toEqual({ token: "MS-2026-001" });
  });

  it.each([
    "https://attacker.example/verify/MS-2026-001",
    "http://provenire.example/verify/MS-2026-001",
    "https://provenire.example/redirect?to=https://attacker.example",
    "https://provenire.example/verify/has%2Fslash",
    "https://provenire.example/verify/token?next=/",
    "javascript:alert(1)",
  ])("rejects unsafe URL %s", raw => {
    expect(parseSafeVerificationUrl(raw, origin)).toBeNull();
  });
});
