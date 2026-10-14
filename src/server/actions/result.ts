import "server-only";
import { notFound } from "next/navigation";
import type { ValidationKey } from "@/lib/validation/form-errors";
import { ConflictError, NotFoundError, StateError } from "@/server/domain/errors";

// Server Actions return plain results the client can render; they never
// throw domain errors at the client. NotFoundError becomes a 404 so other
// tenants' IDs can't be probed.

export type ActionError<Code extends string> = {
  ok: false;
  error: Code | "invalid" | "unknown";
  fieldErrors?: Record<string, ValidationKey>;
};

export async function runAction<T, Code extends string>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | ActionError<Code>> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof StateError || error instanceof ConflictError) {
      return { ok: false, error: error.code as Code };
    }
    // Next's redirect()/notFound() signals must propagate.
    if (isNextSignal(error)) throw error;
    console.error(`[action] ${label} failed`, {
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "unknown" };
  }
}

function isNextSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"));
}
