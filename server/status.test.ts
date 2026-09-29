import { describe, expect, it } from "vitest";
import { appRouter, makeInitialState } from "./routers";
import { deriveStatuses, HEADLINE_STATUS_PRECEDENCE } from "./status";
import type { TrpcContext } from "./_core/context";

function user(organizationId = "medsure-labs"): NonNullable<TrpcContext["user"]> {
  return {
    id: 1,
    openId: `${organizationId}-status-user`,
    email: `${organizationId}@example.com`,
    name: "Status User",
    loginMethod: "test",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    organizationId,
  } as NonNullable<TrpcContext["user"]>;
}

function caller(authenticated = true) {
  const ctx: TrpcContext = {
    user: authenticated ? user() : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
  return appRouter.createCaller(ctx);
}

describe("separate status model", () => {
  it("uses the documented named headline precedence", () => {
    expect(HEADLINE_STATUS_PRECEDENCE).toEqual([
      "tampered", "held", "recalled", "needs_review", "receiver_pending", "history_incomplete", "verifier_incomplete", "verified",
    ]);
  });

  it("returns separate statuses and rejects anonymous status access", async () => {
    await expect(caller(false).provenire.statuses()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const result = await caller().provenire.statuses();
    expect(result).toEqual({
      recordIntegrity: "valid",
      quantityAgreement: "unknown",
      historyCoverage: "incomplete",
      verifierAvailability: "agreement",
      handoffStatus: "origin_verified",
      vehicleStatus: "not_started",
      locationStatus: "confirmed",
      incidentStatus: "none",
      headlineStatus: "history_incomplete",
    });
  });

  it("reports a clean complete route as verified", async () => {
    const api = caller();
    await api.provenire.runHappyPath();
    expect(await api.provenire.statuses()).toEqual({
      recordIntegrity: "valid",
      quantityAgreement: "consistent",
      historyCoverage: "complete",
      verifierAvailability: "agreement",
      handoffStatus: "accepted",
      vehicleStatus: "arrived",
      locationStatus: "confirmed",
      incidentStatus: "none",
      headlineStatus: "verified",
    });
  });

  it("shows a pending receiver handoff before generic incomplete history", async () => {
    const api = caller();
    await api.provenire.reset();
    await api.provenire.dispatch({ receiverId: "central-pharma" });
    expect(await api.provenire.statuses()).toMatchObject({ handoffStatus: "receiver_pending", historyCoverage: "incomplete", headlineStatus: "receiver_pending" });
  });

  it("keeps quantity, location, and integrity outcomes distinct", async () => {
    const api = caller();
    await api.provenire.runMismatch();
    expect(await api.provenire.statuses()).toMatchObject({
      recordIntegrity: "valid", quantityAgreement: "discrepant", historyCoverage: "incomplete", handoffStatus: "needs_review", headlineStatus: "needs_review",
    });
    await api.provenire.reset();
    const dispatch = await api.provenire.dispatch({ receiverId: "central-pharma" });
    await api.provenire.receipt({ dispatchId: dispatch.batch.activeDispatchId!, receiverId: "central-pharma", receiverObservedQuantity: 1000, locationId: "ramdeobaba-pharmacy" });
    expect(await api.provenire.statuses()).toMatchObject({ quantityAgreement: "consistent", locationStatus: "mismatch", headlineStatus: "needs_review" });
    await api.provenire.tamper();
    expect(await api.provenire.statuses()).toMatchObject({ recordIntegrity: "tampered", headlineStatus: "tampered" });
  });

  it("reports verifier outage separately from divergent verifier heads", async () => {
    const api = caller();
    await api.provenire.runHappyPath();
    await api.provenire.togglePeer({ nodeId: "node-1" });
    expect(await api.provenire.statuses()).toMatchObject({ verifierAvailability: "incomplete", headlineStatus: "verifier_incomplete" });
    await api.provenire.runHappyPath();
    await api.provenire.togglePeer({ nodeId: "node-2", diverge: true });
    expect(await api.provenire.statuses()).toMatchObject({ verifierAvailability: "disagreement", headlineStatus: "verifier_incomplete" });
  });

  it("keeps hold and recall headlines visible over the triggering discrepancy", async () => {
    const api = caller();
    await api.provenire.runMismatch();
    await api.provenire.activateSimulatedHold({ reason: "Reported mismatch requires review" });
    expect(await api.provenire.statuses()).toMatchObject({ quantityAgreement: "discrepant", incidentStatus: "hold_active", vehicleStatus: "held", headlineStatus: "held" });
    await api.provenire.runMismatch();
    await api.provenire.activateSimulatedHold({ reason: "Reported mismatch requires review", type: "simulated_recall" });
    expect(await api.provenire.statuses()).toMatchObject({ incidentStatus: "recall_simulated", vehicleStatus: "recalled", headlineStatus: "recalled" });
  });

  it("supports deterministic stale status derivation", () => {
    const state = makeInitialState();
    const locationEvent = [...state.events].reverse().find(event => event.type === "custody_location")!;
    locationEvent.occurredAt = "2000-01-01T00:00:00.000Z";
    expect(deriveStatuses(state, () => Date.parse("2026-09-29T12:00:00.000Z"))).toMatchObject({ locationStatus: "stale", headlineStatus: "history_incomplete" });
  });
});
