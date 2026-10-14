import "../../scripts/load-env";

/**
 * The disposable database integration tests run against. Refuses anything
 * that doesn't look like a local test database, because setup wipes it.
 */
export function testDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      "DATABASE_URL_TEST is not set. Point it at a disposable local Postgres (see README, 'Tests').",
    );
  }
  const parsed = new URL(url);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!localHosts.has(parsed.hostname) || !/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run integration tests against ${parsed.hostname}/${dbName}: ` +
        "the host must be local and the database name must contain 'test'.",
    );
  }
  return url;
}
