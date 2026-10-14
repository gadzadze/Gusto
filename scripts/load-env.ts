import { config } from "dotenv";

// Same files Next.js reads, so one .env.local serves the app, drizzle-kit,
// scripts and tests. Earlier files win.
config({ path: [".env.local", ".env"], quiet: true });
