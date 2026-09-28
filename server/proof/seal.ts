import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { canonicalize } from "./canonical";

export type EventBody = {
  eventId: string;
  batchId: string;
  seq: number;
  type: string;
  actorOrgId: string;
  occurredAt: string;
  previousHash: string;
  payload: unknown;
};

export type SealedEvent = EventBody & {
  recordHash: string;
  signature: string;
};

export function sealEvent(privateKey: KeyObject, body: EventBody): SealedEvent {
  const recordHash = createHash("sha256").update(canonicalize(body), "utf8").digest("hex");
  const signature = sign(null, Buffer.from(recordHash, "hex"), privateKey).toString("hex");
  return { ...body, recordHash, signature };
}

export function buildReceiptPayload(dispatchEvent: SealedEvent, fields: Record<string, unknown>) {
  return {
    ...fields,
    dispatchRecordHash: dispatchEvent.recordHash,
  };
}
