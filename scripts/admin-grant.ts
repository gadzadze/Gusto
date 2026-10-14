// Usage: npm run admin:grant -- someone@example.com
//
// Grants platform admin to an existing user (they must have signed in once).
// Connects with DATABASE_URL_DIRECT from .env, so check which database that
// points at before running it.
import "./load-env";

async function main() {
  const email = process.argv[2];
  if (!email || !email.includes("@")) {
    console.error("Usage: npm run admin:grant -- <email>");
    process.exit(2);
  }
  const direct = process.env.DATABASE_URL_DIRECT;
  if (!direct) {
    console.error("DATABASE_URL_DIRECT is not set (see .env.example).");
    process.exit(2);
  }
  process.env.DATABASE_URL = direct;

  const { grantPlatformAdmin } = await import("../src/server/domain/admin/grant-admin");
  const { closeDb } = await import("../src/server/db/client");
  try {
    const result = await grantPlatformAdmin(email, "script:admin-grant");
    const host = new URL(direct).host;
    switch (result.status) {
      case "granted":
        console.log(`Granted platform admin to ${email} on ${host}.`);
        break;
      case "already_admin":
        console.log(`${email} is already a platform admin on ${host}.`);
        break;
      case "no_such_user":
        console.error(`No user with email ${email} on ${host}. They must sign in once first.`);
        process.exitCode = 1;
        break;
    }
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
