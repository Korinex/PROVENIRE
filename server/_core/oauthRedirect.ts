function parseWebOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function isOAuthRedirectOriginAllowed(
  redirectUri: string,
  allowlist = process.env.OAUTH_ALLOWED_REDIRECT_ORIGINS,
): boolean {
  if (!allowlist?.trim()) return true;

  const redirectOrigin = parseWebOrigin(redirectUri);
  if (!redirectOrigin) return false;

  const allowedOrigins = allowlist
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
    .map(parseWebOrigin)
    .filter((origin): origin is string => origin !== undefined);

  return allowedOrigins.includes(redirectOrigin);
}