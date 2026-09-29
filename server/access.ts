// Temporary. Another developer replaces this with real organization membership fields and checks.
import { TRPCError } from "@trpc/server";
import type { User } from "../drizzle/schema";

export function requireBatchParticipant(user: User | null, _batchId: string): User {
  if (!user) throw new TRPCError({ code: "FORBIDDEN", message: "Batch participant access required." });
  return user;
}

type UserWithOrganization = User & { organizationId?: unknown };
const ROUTE_ORGANIZATIONS = new Set(["medsure-labs", "central-pharma", "ramdeobaba-pharmacy"]);

export function getActorOrganizationId(user: User | null): string {
  const organizationId = (user as UserWithOrganization | null)?.organizationId;
  if (typeof organizationId !== "string" || !ROUTE_ORGANIZATIONS.has(organizationId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No organization membership." });
  }
  return organizationId;
}
