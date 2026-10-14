import { afterAll } from "vitest";
import { closeDb } from "@/server/db/client";
import { testDatabaseUrl } from "./test-database";

// Domain code reads DATABASE_URL; point it at the test database.
process.env.DATABASE_URL = testDatabaseUrl();

afterAll(async () => {
  await closeDb();
});
