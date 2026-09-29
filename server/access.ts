// Temporary. Another developer replaces this with organization membership checks.
import { TRPCError } from "@trpc/server";
import type { User } from "../drizzle/schema";

export function requireBatchParticipant(user: User | null, _batchId: string): User {
  if (!user) throw new TRPCError({ code: "FORBIDDEN", message: "Batch participant access required." });
  return user;
}
