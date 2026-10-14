# Milestone 1 — Foundation

Read `CLAUDE.md` fully before starting.

## Goal

A deployable Next.js app where a person can sign in, create a buyer or
supplier organization, and land on an empty, correctly guarded dashboard for
that role. Everything later builds on this.

## Build

1. **Scaffold.**
   - Next.js 16 (App Router, TypeScript strict, `src/` dir), npm, Tailwind
     v4, shadcn/ui, lucide-react, ESLint.
   - Add Prettier only if ESLint's config doesn't already cover formatting.
2. **Design tokens.**
   - Implement the token table from `CLAUDE.md` as CSS variables for light and
     dark, mapped into Tailwind/shadcn theme variables.
   - Load Noto Sans Georgian + Inter with `next/font`.
3. **i18n.**
   - `next-intl` without locale routing, with `messages/ka.json`.
   - Every string in this milestone goes through it.
4. **Database.**
   - Drizzle + `postgres` driver; `src/server/db/client.ts` imports
     `server-only`.
   - Schema and migrations for: `profiles`, `organizations`,
     `organization_memberships`, `supplier_settings`, `addresses`,
     `audit_logs`.
   - A custom migration enables RLS on every `public` table and installs
     `pg_trgm`.
   - `supabase/` config for local development (`supabase init`). Document
     `supabase start`.
5. **Auth.**
   - Supabase Auth with `@supabase/ssr`: Google OAuth + email magic link, plus
     `/auth/callback` and sign-out.
   - Middleware refreshes the session.
   - Server code identifies the user with `supabase.auth.getUser()`, never
     with an unverified `getSession()`.
   - A `profiles` row is created on first sign-in.
6. **Guards.**
   - `src/server/auth/guards.ts`: `requireUser`, `requireBuyer`,
     `requireSupplier`, `requireAdmin`, returning the context described in
     `CLAUDE.md`.
   - Unauthenticated → `/login?next=…`.
   - Authenticated with no org → `/onboarding`.
   - Wrong role → 404.
7. **Onboarding** at `/onboarding`.
   - The user picks "I buy" or "I supply" and fills in a short form:
     - **buyer:** business name, business type, contact name, phone, city,
       first delivery address;
     - **supplier:** trading name, optional ID number, contact name, phone,
       city, delivery area (text).
   - A Server Action validates with Zod, then creates the org, owner
     membership and `supplier_settings` (for suppliers) in **one
     transaction**.
   - Suppliers start as `pending_review`, buyers as `active`.
   - A user who already has an org cannot run onboarding again.
8. **App shell.**
   - Role-specific layouts: sidebar on desktop, bottom nav on mobile.
   - Nav items only for the user's role. Items for later milestones are
     omitted, not shown disabled.
   - Supplier dashboard shows a "your account is awaiting review" banner while
     `pending_review`.
   - Empty-state dashboards.
9. **Admin bootstrap.**
   - `npm run admin:grant -- <email>` sets `is_platform_admin` on an existing
     profile and writes an `audit_logs` row.
   - There is no admin sign-up route; `/admin` is guarded by `requireAdmin`.
10. **Landing page** at `/`.
    - One screen: what Gusto is, for suppliers and for buyers, and a sign-in
      button.
    - Georgian, honest, no fake logos or numbers.
11. **Tooling.**
    - Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`,
      `test:integration`, `test:e2e`, `db:generate`, `db:migrate`,
      `admin:grant`. All cross-platform.
    - `.env.example` with every variable from `CLAUDE.md`.
    - GitHub Actions CI on push and PR: install, lint, typecheck, unit tests,
      build. CI does not deploy; Vercel's Git integration does.
12. **Docs.**
    - `README.md`: prerequisites, local setup, running migrations, Supabase
      auth provider setup (Google, redirect URLs, Resend SMTP for production),
      granting admin.
    - Fill in the Commands section of `CLAUDE.md`.

## Out of scope

Products, customers, orders, notifications, any admin screens beyond an empty
`/admin` page.

## Tests

- **Unit:** guard redirect logic (no session → login, no org → onboarding,
  wrong role → not found).
- **Integration** (local Supabase):
  - onboarding creates the org, membership and settings atomically;
  - a second onboarding attempt is refused;
  - a posted `orgType` or `status` outside the allowed values is rejected;
  - a client cannot make itself `active` or admin.
- **Integration:** every table in `public` has RLS enabled (query
  `pg_class.relrowsecurity`). This test stays forever.
- **E2E** (Playwright, one happy path): sign in → onboard as supplier → see the
  awaiting-review banner. Use the Supabase admin API to create the test user
  and generate a magic link; don't depend on a real inbox.

## Done when

- A new person can sign in with Google or a magic link and reach the right
  dashboard.
- Protected routes are inaccessible signed out.
- CI is green.
- `npm run build` succeeds.
