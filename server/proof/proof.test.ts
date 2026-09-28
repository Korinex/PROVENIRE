import { describe, expect, it } from "vitest";
import { buildReceiptPayload, canonicalize, chainIsValid, generateOrgKeys, sealEvent, tamperClone, verifyChain } from "./index";

const body = (seq: number, actorOrgId: string, previousHash: string, payload: unknown) => ({
  eventId: `event-${seq}`,
  batchId: "batch-1",
  seq,
  type: "dispatch",
  actorOrgId,
  occurredAt: `2026-09-28T00:0${seq}:00.000Z`,
  previousHash,
  payload,
});

describe("standalone proof module", () => {
  it("canonicalizes object keys deterministically while preserving array order", () => {
    expect(canonicalize({ b: 2, a: { d: 4, c: [2, 1] } })).toBe(canonicalize({ a: { c: [2, 1], d: 4 }, b: 2 }));
    expect(canonicalize({ values: [2, 1] })).not.toBe(canonicalize({ values: [1, 2] }));
  });

  it("rejects unsupported canonical values", () => {
    for (const value of [undefined, NaN, Infinity, -Infinity, () => 1, Symbol("x"), 1n]) {
      expect(() => canonicalize(value)).toThrow();
    }
  });

  it("seals and verifies a three-event chain", () => {
    const { keys, getPublicKeyMap } = generateOrgKeys(["org-a", "org-b"]);
    const first = sealEvent(keys["org-a"]!.privateKey, body(0, "org-a", "GENESIS", { item: "one" }));
    const second = sealEvent(keys["org-b"]!.privateKey, body(1, "org-b", first.recordHash, { item: "two" }));
    const third = sealEvent(keys["org-a"]!.privateKey, body(2, "org-a", second.recordHash, { item: "three" }));
    expect(chainIsValid(verifyChain([first, second, third], getPublicKeyMap()))).toBe(true);
    expect(chainIsValid(verifyChain(tamperClone([first, second, third], 1, ["payload", "item"], "changed"), getPublicKeyMap()))).toBe(false);
    expect(chainIsValid(verifyChain([second, first, third], getPublicKeyMap()))).toBe(false);
    expect(chainIsValid(verifyChain([first, second, third], generateOrgKeys(["org-a", "org-b"]).getPublicKeyMap()))).toBe(false);
    expect(chainIsValid(verifyChain([{ ...first, signature: "not-hex" }], getPublicKeyMap()))).toBe(false);
    expect(chainIsValid(verifyChain([{ ...first, recordHash: "altered" }], getPublicKeyMap()))).toBe(false);
    expect(chainIsValid(verifyChain([first], {}))).toBe(false);
  });

  it("detects tampering in every event field and nested payloads", () => {
    const { keys, getPublicKeyMap } = generateOrgKeys(["org-a"]);
    const event = sealEvent(keys["org-a"]!.privateKey, body(0, "org-a", "GENESIS", { nested: { value: 1 } }));
    for (const field of Object.keys(event)) {
      const replacement = field === "payload" ? { nested: { value: 2 } } : "tampered";
      expect(chainIsValid(verifyChain(tamperClone([event], 0, [field], replacement), getPublicKeyMap()))).toBe(false);
    }
    expect(chainIsValid(verifyChain(tamperClone([event], 0, ["payload", "nested", "value"], 2), getPublicKeyMap()))).toBe(false);
  });

  it("binds receipts to the dispatch record hash", () => {
    const { keys } = generateOrgKeys(["org-a"]);
    const dispatch = sealEvent(keys["org-a"]!.privateKey, body(0, "org-a", "GENESIS", { quantity: 1 }));
    expect(buildReceiptPayload(dispatch, { receipt: true })).toMatchObject({ dispatchRecordHash: dispatch.recordHash });
    expect(buildReceiptPayload({ ...dispatch, recordHash: "changed" }, { receipt: true }).dispatchRecordHash).toBe("changed");
  });

  it.todo("tamper actually invalidates the existing demo proof");
  it.todo("tamper takes Node 3 offline");
  it.todo("public state response does not leak quantities or organization IDs");
  it.todo("status priority when node is down and conflict is open");
});
