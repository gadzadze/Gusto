// The public demo (a separate Supabase project with fictional data) is switched
// on with DEMO_MODE=1. Everything demo-specific hangs off this one flag, so the
// real deployment is untouched when it is unset.
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}

// Sign-ins the demo database ships with (see demo.reset() in the demo project).
// The shared password is shown on the login page, so it comes from the
// environment instead of the repository.
export const DEMO_ACCOUNTS = [
  { key: "supplier", email: "supplier@demo.gusto.example" },
  { key: "restaurant", email: "restaurant@demo.gusto.example" },
] as const;

export function demoPassword(): string | null {
  return process.env.DEMO_PASSWORD?.trim() || null;
}
