import "server-only";
import type { Db, Tx } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";

export type AuditEntry = {
  /** The acting user, or null for scripts/system (then set actorLabel). */
  actorUserId: string | null;
  actorLabel?: string;
  action: string;
  targetType: string;
  targetId: string;
  data?: Record<string, unknown>;
};

/** Records a security-relevant action. Pass the transaction doing the change. */
export async function writeAudit(db: Db | Tx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: entry.actorUserId,
    actorLabel: entry.actorLabel ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    data: entry.data ?? null,
  });
}
