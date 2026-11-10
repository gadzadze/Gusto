import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { gustoDb?: Db; gustoSql?: postgres.Sql };

// One pool per process (kept on globalThis so dev hot reloads don't leak
// connections). `prepare: false` is required behind Supavisor's transaction
// pooler.
//
// Serverless instances are frozen between requests. A pooled socket that sat in a frozen instance
// can be dead when the instance wakes, and a query written to it waits for an answer that never
// comes, until the platform kills the request (seen in production as 300-second timeouts). So idle
// connections are closed after a few seconds, every connection is replaced after a few minutes,
// and connecting gives up quickly instead of hanging.
export function getDb(): Db {
  if (globalForDb.gustoDb) return globalForDb.gustoDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const client = postgres(url, {
    prepare: false,
    max: 5,
    idle_timeout: 5,
    max_lifetime: 60 * 5,
    connect_timeout: 10,
  });
  globalForDb.gustoSql = client;
  globalForDb.gustoDb = drizzle(client, { schema });
  return globalForDb.gustoDb;
}

/** Closes the pool. Scripts and tests only. */
export async function closeDb(): Promise<void> {
  await globalForDb.gustoSql?.end({ timeout: 5 });
  globalForDb.gustoSql = undefined;
  globalForDb.gustoDb = undefined;
}
