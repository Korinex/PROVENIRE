import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";

export function generateOrgKeys(orgIds: string[]) {
  const keys = Object.fromEntries(
    orgIds.map(orgId => {
      const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      return [orgId, { publicKey, privateKey }];
    })
  ) as Record<string, { publicKey: KeyObject; privateKey: KeyObject }>;

  return {
    keys,
    getPublicKeyMap: () => Object.fromEntries(Object.entries(keys).map(([orgId, pair]) => [orgId, pair.publicKey])),
  };
}
