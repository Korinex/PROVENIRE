import { createHash, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import canonicalize from "canonicalize";

export const GENESIS_HASH = "GENESIS";
export const PROOF_ORGANIZATIONS = [
  "medsure-labs",
  "central-pharma",
  "ramdeobaba-pharmacy",
] as const;

export type ProofEventType = "origin" | "dispatch" | "receipt";
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ProofEventBody {
  eventId: string;
  sequence: number;
  batchId: string;
  type: ProofEventType;
  actorOrgId: string;
  occurredAt: string;
  previousHash: string;
  payload: Record<string, JsonValue>;
}

export interface SealedProofEvent extends ProofEventBody {
  recordHash: string;
  signature: string;
}

export interface ProofKeyring {
  readonly publicKeys: ReadonlyMap<string, KeyObject>;
}

export interface EventVerification {
  eventId: string;
  hashOk: boolean;
  sigOk: boolean;
  prevOk: boolean;
  identityOk: boolean;
  sequenceOk: boolean;
}

export interface ChainVerification {
  valid: boolean;
  events: EventVerification[];
}

const privateKeyrings = new WeakMap<ProofKeyring, ReadonlyMap<string, KeyObject>>();

export function canonicalJson(value: unknown): string {
  const serialized = canonicalize(value);
  if (serialized === undefined) {
    throw new TypeError("Value cannot be represented as canonical JSON.");
  }
  return serialized;
}
export function createProofKeyring(
  organizationIds: readonly string[] = PROOF_ORGANIZATIONS,
): ProofKeyring {
  if (organizationIds.length === 0 || new Set(organizationIds).size !== organizationIds.length) {
    throw new TypeError("Organization IDs must be non-empty and unique.");
  }

  const privateKeys = new Map<string, KeyObject>();
  const publicKeys = new Map<string, KeyObject>();

  for (const organizationId of organizationIds) {
    if (!organizationId) throw new TypeError("Organization IDs cannot be empty.");
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    privateKeys.set(organizationId, pair.privateKey);
    publicKeys.set(organizationId, pair.publicKey);
  }

  const keyring = Object.freeze({ publicKeys });
  privateKeyrings.set(keyring, privateKeys);
  return keyring;
}

export function sealEvent(keyring: ProofKeyring, body: ProofEventBody): SealedProofEvent {
  const privateKey = privateKeyrings.get(keyring)?.get(body.actorOrgId);
  if (!privateKey) throw new Error(`No private key registered for ${body.actorOrgId}.`);

  const canonicalBody = canonicalJson(body);
  const normalizedBody = JSON.parse(canonicalBody) as ProofEventBody;
  const bodyBytes = Buffer.from(canonicalBody, "utf8");
  const recordHash = createHash("sha256").update(bodyBytes).digest("hex");
  const signature = sign("sha256", bodyBytes, privateKey).toString("base64");

  return { ...normalizedBody, recordHash, signature };
}

export function verifyChain(
  events: readonly SealedProofEvent[],
  keyring: ProofKeyring,
): ChainVerification {
  const results = events.map((event, index): EventVerification => {
    let hashOk = false;
    let sigOk = false;
    const publicKey = keyring.publicKeys.get(event.actorOrgId);
    const identityOk = publicKey !== undefined;
    const expectedPreviousHash = index === 0 ? GENESIS_HASH : events[index - 1]!.recordHash;
    const prevOk = event.previousHash === expectedPreviousHash;
    const sequenceOk = Number.isSafeInteger(event.sequence) && event.sequence === index + 1;

    try {
      const body: ProofEventBody = {
        eventId: event.eventId,
        sequence: event.sequence,
        batchId: event.batchId,
        type: event.type,
        actorOrgId: event.actorOrgId,
        occurredAt: event.occurredAt,
        previousHash: event.previousHash,
        payload: event.payload,
      };
      const bodyBytes = Buffer.from(canonicalJson(body), "utf8");
      const recomputedHash = createHash("sha256").update(bodyBytes).digest("hex");
      hashOk = recomputedHash === event.recordHash;
      if (publicKey) {
        sigOk = verify("sha256", bodyBytes, publicKey, Buffer.from(event.signature, "base64"));
      }
    } catch {
      hashOk = false;
      sigOk = false;
    }

    return { eventId: event.eventId, hashOk, sigOk, prevOk, identityOk, sequenceOk };
  });

  return {
    valid: results.length > 0 && results.every(result =>
      result.hashOk && result.sigOk && result.prevOk && result.identityOk && result.sequenceOk,
    ),
    events: results,
  };
}

export function cloneWithEventMutation(
  events: readonly SealedProofEvent[],
  eventId: string,
  mutate: (event: SealedProofEvent) => SealedProofEvent,
): SealedProofEvent[] {
  let found = false;
  const clonedEvents = events.map(event => {
    const clone = structuredClone(event);
    if (clone.eventId !== eventId) return clone;
    found = true;
    return mutate(clone);
  });

  if (!found) throw new Error(`Event ${eventId} was not found.`);
  return clonedEvents;
}

export const serverProofKeyring = createProofKeyring();