import { describe, expect, it } from "vitest";
import { isOAuthRedirectOriginAllowed } from "./oauthRedirect";

describe("OAuth redirect origin allowlist", () => {
  it("allows configured origins and rejects unlisted origins", () => {
    const allowlist = "https://provenire.example, http://localhost:3000";
    expect(isOAuthRedirectOriginAllowed("https://provenire.example/api/oauth/callback", allowlist)).toBe(true);
    expect(isOAuthRedirectOriginAllowed("http://localhost:3000/api/oauth/callback", allowlist)).toBe(true);
    expect(isOAuthRedirectOriginAllowed("https://attacker.example/api/oauth/callback", allowlist)).toBe(false);
    expect(isOAuthRedirectOriginAllowed("javascript:alert(1)", allowlist)).toBe(false);
  });

  it("preserves existing behavior when no allowlist is configured", () => {
    expect(isOAuthRedirectOriginAllowed("https://unlisted.example/callback", undefined)).toBe(true);
    expect(isOAuthRedirectOriginAllowed("legacy-redirect", "")).toBe(true);
  });
});