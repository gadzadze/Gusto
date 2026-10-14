// Usage: npm run user:allow -- someone@example.com [--note "Winiveria, owner"] [--role supplier|buyer]
//
// Puts an address on the sign-in allow-list (the app is invite-only) and creates
// its Supabase auth user, so the person can then request a sign-in link. Does
// not give any role: they still onboard, and suppliers still need approval.
// Connects with DATABASE_URL_DIRECT and the Supabase keys from .env.local, so
// check which project those point at before running it.
import "./load-env";
import Module from "node:module";

// Domain modules import "server-only", which throws outside a React Server
// Components build; this script stubs it (same as scripts/seed-dev.ts).
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = function (this: unknown, request: string, ...rest: unknown[]) {
  return request === "server-only" ? {} : load.call(this, request, ...rest);
};

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--") && a.includes("@"));
  const noteAt = args.indexOf("--note");
  const note = noteAt >= 0 ? args[noteAt + 1] : undefined;
  const roleAt = args.indexOf("--role");
  const roleArg = roleAt >= 0 ? args[roleAt + 1] : undefined;
  if (roleArg !== undefined && roleArg !== "supplier" && roleArg !== "buyer") {
    console.error("--role must be supplier or buyer.");
    process.exit(2);
  }
  if (!email) {
    console.error('Usage: npm run user:allow -- <email> [--note "text"] [--role supplier|buyer]');
    process.exit(2);
  }
  const direct = process.env.DATABASE_URL_DIRECT;
  if (!direct) {
    console.error("DATABASE_URL_DIRECT is not set (see .env.example).");
    process.exit(2);
  }
  process.env.DATABASE_URL = direct;

  const { registerEmail } = await import("../src/server/auth/register-email");
  const { closeDb } = await import("../src/server/db/client");
  try {
    const result = await registerEmail({ userId: null, label: "script:user-allow" }, email, note, roleArg);
    const host = new URL(direct).host;
    const verb = { allowed: "Allowed", restored: "Restored access for", updated: "Updated the role of", already_allowed: "Already allowed:" }[result.status];
    console.log(`${verb} ${result.email} on ${host}. Sign-in account: ${result.authUser}.`);
    if (result.authUser === "failed") {
      console.log("The auth account could not be created now; it will be created at the first sign-in request.");
    }
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
