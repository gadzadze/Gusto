# Milestone 6 — Pilot launch

Read `CLAUDE.md` fully before starting. Milestones 1–5 are merged.

## Goal

Ready to put in front of the first 3–5 real suppliers: useful dashboards,
admin support tools, a security and quality pass, production deployment, and
documentation someone else could follow.

## Build

1. **Supplier dashboard** (numbers and short lists, no charts).
   - Pending orders needing action.
   - Orders this week vs last week.
   - Order value of confirmed + delivered orders, last 30 days.
   - Top 5 products by confirmed quantity, last 30 days.
   - Number of buyers who ordered more than once in 30 days.
   - Each number states its definition in a tooltip or caption.
   - Each says "order value", never "revenue".
2. **Buyer dashboard.**
   - Open orders with status.
   - Last 5 orders with "order again".
   - The 10 most-ordered products across suppliers, each with quick add to
     cart.
   - Connected suppliers.
3. **Pilot metrics** for the admin overview, computed from real tables:
   - suppliers by status, buyer orgs, active products;
   - orders by status in the last 30 days;
   - **active supplier** = received ≥1 order in 30 days;
   - **active buyer** = submitted ≥1 order in 14 days;
   - **weekly reorder rate** = buyers ordering in each of the last 2 weeks ÷
     buyers who ordered in the earlier week;
   - orders per supplier per week.

   These are the pilot's success measures; label them clearly.
4. **Admin tools.**
   - Organization list with search and suspend/reactivate (reason required,
     audited).
   - Order lookup by `GST-` number: read-only, audited view.
   - Audit log page, filterable by actor, action and date.
   - Admins see only what support needs, not every supplier's price lists.
5. **Security pass.**
   - Review every Server Action and Route Handler against the
     `CLAUDE.md` security model. Add the missing guard or tenant scope
     wherever you find one.
   - Postgres-backed rate limits on:
     - order submit: 10/min per org;
     - invite creation: 30/hour per supplier;
     - invite acceptance: 10/min per IP;
     - image upload: 30/hour per supplier.
   - Security headers in `next.config`: CSP that allows only the app, Supabase
     and the fonts; `X-Frame-Options: DENY`; `Referrer-Policy`.
   - Verify that no secret appears in the client bundle: grep the `.next`
     static output for the service-role key name and value pattern.
   - Run `npm audit` and fix high/critical issues where a fix exists.
6. **Quality pass.**
   - Every list has loading, empty and error states.
   - Mobile check at 360px for: catalog, cart, checkout, supplier order page.
   - Keyboard focus is visible (burgundy ring).
   - Contrast meets AA in both themes.
   - Georgian copy review: one consistent tone, no truncated buttons.
7. **Dev seed.**
   - `npm run db:seed` refuses unless the database host is local or matches an
     allow-listed dev project.
   - Creates `[DEMO]`-prefixed fictional data:
     - a Tbilisi restaurant, a café, a beverage distributor and a food
       distributor;
     - ~30 products, one custom price list, a few orders in different
       statuses.
8. **Production deployment.**
   - Supabase production project in `eu-central-1`:
     - migrations applied with `db:migrate` using `DATABASE_URL_DIRECT`;
     - storage bucket and policies;
     - auth providers and redirect URLs;
     - Resend SMTP;
     - the cron schedule.
   - Vercel project in region `fra1`, environment variables set, production
     domain.
   - Write `docs/deploy.md` as an exact checklist, then follow it once.
9. **Clean-database check.**
   - On a fresh local Supabase, run migrations only (no seed), grant an
     admin, then walk through the full flow by hand and by e2e.
   - The app must work with zero pre-existing rows.
10. **Docs.**
    - `README.md` covers setup, env vars, migrations, seed, auth and storage
      configuration, admin provisioning, deploy, and what is **implemented vs
      configured vs verified**. In particular: automated WhatsApp sending does
      not exist; email works once Resend is configured.
    - Add a "Before inviting real businesses" checklist: privacy policy and
      terms in Georgian, data-processing basis under Georgia's personal data
      protection law, a support contact, a backup/PITR setting check.

## Tests

- **E2E covering every core scenario**, against a migrated empty database:
  - supplier onboarding → product with image → visible to a connected buyer;
  - buyer full order;
  - notification outbox;
  - supplier processing;
  - persistence across restart;
  - isolation (other buyer, other supplier, other supplier's product,
    signed-out routes, role escalation via a tampered request, foreign order
    link);
  - clean-database run.
- **Integration:** dashboard metrics on a known fixture equal hand-computed
  values; the empty database returns zeros, not errors.

## Done when

- Production is deployed.
- A real supplier could be onboarded tomorrow.
- Every number on every dashboard comes from real rows.
- The final report lists the exact commands run with their actual results,
  and the remaining gaps before charging anyone.
