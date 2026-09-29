import { createHash, verify, type KeyObject } from "node:crypto";
import { canonicalize } from "./canonical";
import type { SealedEvent } from "./seal";

export function verifyChain(events: SealedEvent[], publicKeys: Record<string, KeyObject>) {
  return events.map((event, index) => {
    let hashOk = false;
    let sigOk = false;
    const body = event && typeof event === "object" ? { ...event } : null;
    if (body) {
      delete (body as Partial<SealedEvent>).recordHash;
      delete (body as Partial<SealedEvent>).signature;
      try {
        const recomputedHash = createHash("sha256").update(canonicalize(body), "utf8").digest("hex");
        hashOk = recomputedHash === event.recordHash;
      } catch {
        hashOk = false;
      }
    }
    const key = event && publicKeys?.[event.actorOrgId];
    if (key && typeof event.recordHash === "string" && typeof event.signature === "string") {
      try {
        sigOk = verify(null, Buffer.from(event.recordHash, "hex"), key, Buffer.from(event.signature, "hex"));
      } catch {
        sigOk = false;
      }
    }
    const prevOk = (() => {
      if (!event || typeof event !== "object") return false;
      if (index === 0) return event.previousHash === "GENESIS" && event.seq === 0;
      const prev = events[index - 1];
      return Boolean(prev && event.previousHash === prev.recordHash && event.seq === prev.seq + 1);
    })();

    return {
      eventId: event?.eventId,
      hashOk,
      sigOk,
      prevOk,
    };
  });
}

export function chainIsValid(results: ReturnType<typeof verifyChain>) {
  return results.length > 0 && results.every(item => item.hashOk && item.sigOk && item.prevOk);
}
