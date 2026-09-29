const VERIFY_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

/** Parse only a same-origin verification link; callers must validate before navigating. */
export function parseSafeVerificationUrl(raw: string, currentOrigin = window.location.origin): { token: string } | null {
  try {
    const base = new URL(currentOrigin);
    const url = new URL(raw, base);
    const protocolAllowed = url.protocol === "https:" || (base.protocol !== "https:" && url.protocol === "http:");
    if (!protocolAllowed || url.origin !== base.origin || url.username || url.password || url.search || url.hash) return null;

    const match = /^\/verify\/([^/]+)$/.exec(url.pathname);
    if (!match) return null;
    const token = decodeURIComponent(match[1]);
    return VERIFY_TOKEN.test(token) ? { token } : null;
  } catch {
    return null;
  }
}
