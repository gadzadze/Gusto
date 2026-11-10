import "server-only";

/**
 * fetch with a deadline, for calls to Supabase Auth. Node's fetch has no overall timeout of its own,
 * so a stalled connection would hold the page until the platform gives up; 15 seconds is far above
 * a normal answer and far below that.
 */
export const timedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(15_000) });
