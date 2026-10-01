import "server-only";
import { sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";

/** One post at a time: every posting transaction takes the same advisory lock. */
export async function lock(tx: Tx) {
  await tx.execute(sql`select pg_advisory_xact_lock(424242)`);
}

export async function writeAudit(
  tx: Tx, u: { email: string }, action: string, entity: string, entityId: string | null,
  extra: { rollSerials?: string; kgBeforeG?: number; kgAfterG?: number; details?: unknown } = {},
) {
  await tx.insert(schema.audit).values({
    userEmail: u.email, action, entity, entityId,
    rollSerials: extra.rollSerials, kgBeforeG: extra.kgBeforeG, kgAfterG: extra.kgAfterG,
    details: (extra.details ?? null) as never,
  });
}

export async function nextCounter(tx: Tx, name: string) {
  const [r] = await tx
    .insert(schema.counters).values({ name, value: 1 })
    .onConflictDoUpdate({ target: schema.counters.name, set: { value: sql`${schema.counters.value} + 1` } })
    .returning();
  return r.value;
}
