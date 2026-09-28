import { describe, expect, it } from "vitest";
import {
<<<<<<< HEAD
  buildReceiptPayload,
=======
>>>>>>> 9ffc937 (Add standalone signed proof chain primitives)
  canonicalJson,
  cloneWithEventMutation,
  createProofKeyring,
  GENESIS_HASH,
  sealEvent,
  verifyChain,
  type ProofEventBody,
  type SealedProofEvent,
} from "./proof";

const keyring = createProofKeyring();

function makeValidChain() {
  const originBody: ProofEventBody = {
    eventId: "event-1",
    sequence: 1,
    batchId: "MS-2026-001",
    type: "origin",
    actorOrgId: "medsure-labs",
    occurredAt: "2026-09-28T12:00:00.000Z",
    previousHash: GENESIS_HASH,
    payload: { product: "MedSure 500 mg", quantity: 1000 },
  };
  const origin = sealEvent(keyring, originBody);
  const dispatch = sealEvent(keyring, {
    eventId: "event-2",
    sequence: 2,
    batchId: "MS-2026-001",
    type: "dispatch",
    actorOrgId: "medsure-labs",
    occurredAt: "2026-09-28T12:05:00.000Z",
    previousHash: origin.recordHash,
    payload: { receiverId: "central-pharma", quantityDispatched: 1000 },
  });
  const receipt = sealEvent(keyring, {
    eventId: "event-3",
    sequence: 3,
    batchId: "MS-2026-001",
    type: "receipt",
    actorOrgId: "central-pharma",
    occurredAt: "2026-09-28T12:10:00.000Z",
    previousHash: dispatch.recordHash,
<<<<<<< HEAD
    payload: buildReceiptPayload(dispatch.recordHash, { receiverObservedQuantity: 1000 }),
=======
    payload: { dispatchRecordHash: dispatch.recordHash, receiverObservedQuantity: 1000 },
>>>>>>> 9ffc937 (Add standalone signed proof chain primitives)
  });

  return [origin, dispatch, receipt];
}

describe("Provenire proof primitives", () => {
  it("canonicalizes object member order and numbers deterministically", () => {
    expect(canonicalJson({ z: -0, b: 1e-6, a: "é" })).toBe('{"a":"é","b":0.000001,"z":0}');
  });

  it("accepts a valid signed chain rooted at GENESIS", () => {
    const events = makeValidChain();
    const result = verifyChain(events, keyring);

    expect(events[0]?.previousHash).toBe(GENESIS_HASH);
    expect(result.valid).toBe(true);
    expect(result.events).toHaveLength(3);
    expect(result.events.every(item => item.hashOk && item.sigOk && item.prevOk && item.identityOk && item.sequenceOk)).toBe(true);
  });

  it("detects modified payload, event type, actor, and timestamp", () => {
    const events = makeValidChain();
    const mutations: Array<[string, (event: SealedProofEvent) => SealedProofEvent]> = [
      ["payload", event => ({ ...event, payload: { ...event.payload, quantityDispatched: 1500 } })],
      ["event type", event => ({ ...event, type: "receipt" })],
      ["actor", event => ({ ...event, actorOrgId: "central-pharma" })],
      ["timestamp", event => ({ ...event, occurredAt: "2026-09-28T12:05:01.000Z" })],
    ];

    for (const [field, mutate] of mutations) {
      const changedEvents = cloneWithEventMutation(events, "event-2", mutate);
      const result = verifyChain(changedEvents, keyring);
      expect(result.valid, field).toBe(false);
      expect(result.events[1]?.hashOk, field).toBe(false);
      expect(result.events[1]?.sigOk, field).toBe(false);
    }
  });

  it("detects changed predecessor hashes and sequence numbers", () => {
    const events = makeValidChain();
    const wrongPredecessor = cloneWithEventMutation(events, "event-2", event => ({ ...event, previousHash: "not-the-origin-hash" }));
    const wrongSequence = cloneWithEventMutation(events, "event-2", event => ({ ...event, sequence: 7 }));

    expect(verifyChain(wrongPredecessor, keyring).events[1]).toMatchObject({ hashOk: false, sigOk: false, prevOk: false });
    expect(verifyChain(wrongSequence, keyring).events[1]).toMatchObject({ hashOk: false, sigOk: false, sequenceOk: false });
  });

  it("binds a receipt to the exact dispatch record hash", () => {
    const events = makeValidChain();
    const receipt = events[2]!;
    const changedReceipt = cloneWithEventMutation(events, receipt.eventId, event => ({
      ...event,
      payload: { ...event.payload, dispatchRecordHash: "different-dispatch-hash" },
    }));

    expect(verifyChain(changedReceipt, keyring).events[2]).toMatchObject({ hashOk: false, sigOk: false });
  });

<<<<<<< HEAD
  it("builds receipt payloads with an immutable SHA-256 dispatch link", () => {
    const dispatchRecordHash = "a".repeat(64);
    expect(buildReceiptPayload(dispatchRecordHash, { receiverObservedQuantity: 950 })).toEqual({
      receiverObservedQuantity: 950,
      dispatchRecordHash,
    });
    expect(() => buildReceiptPayload("not-a-hash", {})).toThrow("SHA-256");
    expect(() => buildReceiptPayload(dispatchRecordHash, { dispatchRecordHash })).toThrow("set by the proof module");
  });

=======
>>>>>>> 9ffc937 (Add standalone signed proof chain primitives)
  it("rejects invalid signatures and unknown actors", () => {
    const events = makeValidChain();
    const invalidSignature = cloneWithEventMutation(events, "event-2", event => ({ ...event, signature: "not-a-valid-signature" }));
    const unknownActor = cloneWithEventMutation(events, "event-2", event => ({ ...event, actorOrgId: "unknown-org" }));

    expect(verifyChain(invalidSignature, keyring).events[1]).toMatchObject({ hashOk: true, sigOk: false, identityOk: true });
    expect(verifyChain(unknownActor, keyring).events[1]).toMatchObject({ hashOk: false, sigOk: false, identityOk: false });
  });

  it("keeps tampering confined to the returned clone", () => {
    const events = makeValidChain();
    const changed = cloneWithEventMutation(events, "event-2", event => ({
      ...event,
      payload: { ...event.payload, quantityDispatched: 1500 },
    }));

    expect(events[1]?.payload.quantityDispatched).toBe(1000);
    expect(changed[1]?.payload.quantityDispatched).toBe(1500);
    expect(verifyChain(events, keyring).valid).toBe(true);
    expect(verifyChain(changed, keyring).valid).toBe(false);
  });
});