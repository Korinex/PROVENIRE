import { afterEach, describe, expect, it } from "vitest";
import { assertRequiredEnv } from "./_core/index";
import { getAllowedRedirectOrigins, isAllowedRedirectOrigin } from "./_core/oauth";

const originalNodeEnv = process.env.NODE_ENV;
const originalJwtSecret = process.env.JWT_SECRET;
const originalAllowedOrigins = process.env.ALLOWED_REDIRECT_ORIGINS;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
  if (originalAllowedOrigins === undefined) delete process.env.ALLOWED_REDIRECT_ORIGINS;
  else process.env.ALLOWED_REDIRECT_ORIGINS = originalAllowedOrigins;
});

describe("backend security configuration", () => {
  it("requires JWT_SECRET outside test mode", () => {
    process.env.NODE_ENV = "production";
    delete process.env.JWT_SECRET;
    expect(() => assertRequiredEnv()).toThrow("JWT_SECRET");
  });

  it("accepts a configured JWT_SECRET outside test mode", () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "configured-secret";
    expect(() => assertRequiredEnv()).not.toThrow();
  });

  it("does not require JWT_SECRET in test mode", () => {
    process.env.NODE_ENV = "test";
    delete process.env.JWT_SECRET;
    expect(() => assertRequiredEnv()).not.toThrow();
  });

  it("parses configured OAuth redirect origins and preserves unset behavior", () => {
    process.env.ALLOWED_REDIRECT_ORIGINS = "https://trusted.example, https://also-trusted.example";
    const allowed = getAllowedRedirectOrigins();
    expect(allowed).toEqual(["https://trusted.example", "https://also-trusted.example"]);
    expect(isAllowedRedirectOrigin("https://trusted.example/callback", allowed)).toBe(true);
    expect(isAllowedRedirectOrigin("https://untrusted.example/callback", allowed)).toBe(false);
    expect(isAllowedRedirectOrigin("javascript:alert(1)", allowed)).toBe(false);
    delete process.env.ALLOWED_REDIRECT_ORIGINS;
    expect(getAllowedRedirectOrigins()).toBeNull();
    expect(isAllowedRedirectOrigin("https://any.example/callback", null)).toBe(true);
  });
});
