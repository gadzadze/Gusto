import "./load-env";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Fails if anything secret can be found in the client-facing build output
// (.next/static is what browsers download). Checks, in the built files:
//  - the NAME of the service-role variable;
//  - the VALUE of every server-only secret present in the environment;
//  - anything shaped like a Supabase secret key (`sb_secret_...`) or a JWT
//    whose payload says role=service_role.
// Run after `npm run build`:  npm run check:secrets

const ROOT = join(process.cwd(), ".next", "static");
const SECRET_ENV = ["SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "RESEND_API_KEY", "DATABASE_URL", "DATABASE_URL_DIRECT"];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(js|css|html|json|map|txt)$/.test(name)) yield path;
  }
}

function isServiceRoleJwt(token: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { role?: string };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

try {
  statSync(ROOT);
} catch {
  console.error("No .next/static found. Run `npm run build` first.");
  process.exit(2);
}

const needles = SECRET_ENV.flatMap((name) => {
  const value = process.env[name];
  // Short values (placeholders, "postgres") would match anywhere; only real-looking secrets are searched for.
  return value && value.length >= 16 ? [{ what: `value of ${name}`, text: value }] : [];
});
needles.push({ what: "the name SUPABASE_SERVICE_ROLE_KEY", text: "SUPABASE_SERVICE_ROLE_KEY" });
needles.push({ what: "a Supabase secret key (sb_secret_)", text: "sb_secret_" });

let files = 0;
const findings: string[] = [];
for (const file of walk(ROOT)) {
  files += 1;
  const content = readFileSync(file, "utf8");
  for (const n of needles) if (content.includes(n.text)) findings.push(`${file}: contains ${n.what}`);
  for (const m of content.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
    if (isServiceRoleJwt(m[0])) findings.push(`${file}: contains a service_role JWT`);
  }
}

if (findings.length > 0) {
  console.error(`Secrets found in the client bundle (${findings.length}):\n${findings.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(`OK: scanned ${files} client files in .next/static; no server secret names, values or service-role keys.`);
