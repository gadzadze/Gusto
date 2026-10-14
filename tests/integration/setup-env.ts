import { afterAll } from "vitest";
import { closeDb } from "@/server/db/client";
import { testDatabaseUrl } from "./test-database";

// Domain code reads DATABASE_URL; point it at the test database.
process.env.DATABASE_URL = testDatabaseUrl();
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3000";
// Never talk to a real provider from tests: email stays in dev-log mode.
delete process.env.RESEND_API_KEY;

afterAll(async () => {
  await closeDb();
});
