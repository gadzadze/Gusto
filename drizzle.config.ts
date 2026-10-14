import "./scripts/load-env";
import { defineConfig } from "drizzle-kit";

// Migrations run over a direct (non-pooled) connection. Drizzle manages only
// the `public` schema; `auth` belongs to Supabase.
const url = process.env.DATABASE_URL_DIRECT;
if (!url) {
  throw new Error("DATABASE_URL_DIRECT is not set (see .env.example).");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["public"],
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
