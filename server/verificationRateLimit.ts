const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;
const MAX_TRACKED_CLIENTS = 10_000;

type Quota = { count: number; resetAt: number };
const quotas = new Map<string, Quota>();

export function allowVerificationRequest(clientKey: string, timestamp = Date.now()) {
  let quota = quotas.get(clientKey);
  if (!quota || timestamp >= quota.resetAt) {
    if (!quota && quotas.size >= MAX_TRACKED_CLIENTS) {
      quotas.forEach((tracked, key) => {
        if (timestamp >= tracked.resetAt) quotas.delete(key);
      });
      if (quotas.size >= MAX_TRACKED_CLIENTS) return false;
    }
    quota = { count: 0, resetAt: timestamp + WINDOW_MS };
    quotas.set(clientKey, quota);
  }
  if (quota.count >= MAX_REQUESTS) return false;
  quota.count += 1;
  return true;
}
