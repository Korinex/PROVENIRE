import { createHash, verify, type KeyObject } from "node:crypto";
import { canonicalize } from "./canonical";
import type { SealedEvent } from "./seal";

export function verifyChain(events: SealedEvent[], publicKeys: Record<string, KeyObject>) {
  return events.map((event, index) => {
    const body = { ...event };
    delete (body as Partial<SealedEvent>).recordHash;
    delete (body as Partial<SealedEvent>).signature;
    const recomputedHash = createHash("sha256").update(canonicalize(body), "utf8").digest("hex");
    const hashOk = recomputedHash === event.recordHash;
    const key = publicKeys[event.actorOrgId];
    let sigOk = false;
    if (key) {
      try {
        sigOk = verify(null, Buffer.from(event.recordHash, "hex"), key, Buffer.from(event.signature, "hex"));
      } catch {
        sigOk = false;
      }
    }
    const prevOk = (() => {
      if (index === 0) return event.previousHash === "GENESIS" && event.seq === 0;
      const prev = events[index - 1];
      return event.previousHash === prev.recordHash && event.seq === prev.seq + 1;
    })();

    return {
      eventId: event.eventId,
      hashOk,
      sigOk,
      prevOk,
    };
  });
}

export function chainIsValid(results: ReturnType<typeof verifyChain>) {
  return results.every(item => item.hashOk && item.sigOk && item.prevOk);
}
