// Usage: npm run admin:grant -- someone@example.com
//
// Grants platform admin. Sign-in is invite-only, so the address is also put on
// the allow-list and its auth account is created if it does not exist yet: the
// person does not have to sign in first.
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
  const { registerEmail } = await import("../src/server/auth/register-email");
  const { closeDb } = await import("../src/server/db/client");
  try {
    let result = await grantPlatformAdmin(email, "script:admin-grant");
    if (result.status === "no_such_user") {
      // Not signed in before: register the address, then try again.
      await registerEmail({ userId: null, label: "script:admin-grant" }, email, "Platform admin");
      result = await grantPlatformAdmin(email, "script:admin-grant");
    }
    const host = new URL(direct).host;
    switch (result.status) {
      case "granted":
        console.log(`Granted platform admin to ${email} on ${host}.`);
        break;
      case "already_admin":
        console.log(`${email} is already a platform admin on ${host}.`);
        break;
      case "no_such_user":
        console.error(`No user with email ${email} on ${host}, and one could not be created (check the Supabase URL and keys in .env.local).`);
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
