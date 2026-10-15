// Usage: npm run env:local
//
// Writes the local Supabase URL and keys into .env.local, so you don't copy them
// by hand. Run it after `npx supabase start`. It starts from your existing
// .env.local (or .env.example), keeps every other value, saves the old file as
// .env.local.bak, and refuses anything that is not a local Supabase.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { applyLocalSupabase, parseStatusEnv } from "./env-local";

function main() {
  const run = spawnSync("npx supabase status -o env", { shell: true, encoding: "utf8" });
  const output = `${run.stdout ?? ""}`;
  if (!output.includes("API_URL=")) {
    console.error("Could not read the local Supabase status. Is it running? Try: npx supabase start");
    if (run.stderr) console.error(run.stderr.trim());
    process.exit(1);
  }

  const target = ".env.local";
  const base = existsSync(target) ? readFileSync(target, "utf8") : existsSync(".env.example") ? readFileSync(".env.example", "utf8") : "";
  const { text, changed } = applyLocalSupabase(base, parseStatusEnv(output), () => randomBytes(24).toString("hex"));

  if (existsSync(target)) copyFileSync(target, `${target}.bak`);
  writeFileSync(target, text);
  console.log(changed.length ? `Updated ${target}: ${changed.join(", ")}.` : `${target} already matches the local Supabase. Nothing changed.`);
  console.log("If `npm run dev` is running, stop it (Ctrl+C) and start it again so it reads the new values.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
