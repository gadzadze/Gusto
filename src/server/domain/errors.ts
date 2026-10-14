// Domain errors. Actions translate them: NotFoundError → notFound() (404, so
// other tenants' IDs can't be probed); the rest → an error code for the UI.

export class NotFoundError extends Error {
  constructor(what = "resource") {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

/** The action isn't allowed in the current state (e.g. a suspended supplier editing). */
export class StateError<Code extends string = string> extends Error {
  constructor(public readonly code: Code) {
    super(code);
    this.name = "StateError";
  }
}

/** A uniqueness rule was violated (e.g. duplicate SKU). */
export class ConflictError<Code extends string = string> extends Error {
  constructor(public readonly code: Code) {
    super(code);
    this.name = "ConflictError";
  }
}

/** True if `error` (or the driver error Drizzle wraps in `cause`) is a unique violation on `constraint`. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  return candidates.some((e) => {
    const pg = e as { code?: string; constraint_name?: string; constraint?: string } | null;
    return pg?.code === "23505" && (pg.constraint_name === constraint || pg.constraint === constraint);
  });
}
