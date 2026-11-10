import type { Role } from "@lalcha/domain";
import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "./config.ts";
import { auditLog } from "./schema.ts";

export const db = drizzle(postgres(config.appDatabaseUrl, { max: 10 }));
export const platformDb = drizzle(postgres(config.platformDatabaseUrl, { max: 3 }));
export type Tx = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];

/** Every store-owned query runs here, so row-level security limits it to that one store. */
export function withStore<T>(storeId: string, fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.store_id', ${storeId}, true)`);
    return fn(tx);
  });
}

/** Records who did what, inside the same transaction as the change it describes. */
export async function audit(tx: Tx, storeId: string, actorId: string | null, action: string, entityId?: string | null, detail?: Record<string, unknown>) {
  await tx.insert(auditLog).values({ storeId, actorId, action, entityId: entityId ?? null, detail: detail ?? null });
}

export type Env = {
  Variables: {
    store: { id: string; name: string };
    device: { id: string; branchId: string };
    user: { id: string; name: string; role: Role };
    /** The signed-in superadmin's email, on superadmin routes only. */
    platformAdmin: string;
  };
};

export const pgCode = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code ?? err.cause?.code;
};
