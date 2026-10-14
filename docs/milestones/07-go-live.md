# Milestone 7 — Go live

> **DRAFT for review.** Nothing here is built. Read "Decisions to settle first"
> and change anything you disagree with before this goes to a session.

Read `CLAUDE.md` fully before starting. Milestones 1–6 are merged.

## Goal

Close the gaps milestone 6 left open, so that a real supplier can be onboarded
on production with a straight face: everything that has so far only run against
stand-ins or stubs has run against the real services, production exists and was
set up by following `docs/deploy.md`, and the legal and operational basics are
in place. No new product features.

Several steps need a person with the accounts (Supabase, Vercel, Resend, DNS) or
a lawyer. Where a step needs one, the session prepares everything it can,
**stops, and says exactly what it needs**. It never marks such a step done on
the strength of code alone.

## Decisions to settle first

Answer these in the prompt (or the session should ask before step 5):

1. **Error monitoring.** Vercel function logs only (no new dependency), or add
   Sentry? `CLAUDE.md` says not to add a library for a job already covered, and
   this one is not covered yet, so it needs your yes.
2. **Data deletion.** The Georgian personal data protection law gives people
   rights over their data. Build an admin-run, audited "delete this
   organization and its people" script, or handle requests by hand with a
   written runbook for the pilot?
3. **Legal text.** Who supplies the Georgian privacy policy and terms (a
   lawyer, ideally)? The session builds the pages and links; it does not
   author legal wording.
4. **Staging.** Is a second, dedicated dev Supabase project available for the
   verification steps, or is local `supabase start` enough until production?
5. **Production domain and sender domain** (needed for step 3 and step 4).

## Build

1. **Run against real Supabase locally.**
   - On a machine with Docker: `npx supabase start`, `npm run db:migrate`,
     `npm run test:e2e` with the real Auth and Storage (no stand-in).
   - Fix whatever breaks. Likely suspects: the hand-written `supabase/config.toml`,
     email template paths, the `product-images` bucket policy, the
     `auth.users` columns the code reads.
   - Add this as a CI job (Supabase CLI in GitHub Actions) so the e2e suite no
     longer depends on a stand-in. Delete any mention of the stand-in from the
     docs.
   - Try Google sign-in by hand against a dev project and record the result.
2. **Real email and cron on a dev Supabase project.**
   - Configure Resend (verified domain, API key) and the Supabase SMTP settings
     as in README.
   - Send one order's worth of emails for real: invitation, new order, confirmed.
     Check they arrive, in the inbox, in Georgian, with working links, in Gmail
     and Outlook.
   - Create the Vault secrets, let `pg_cron` fire, and confirm
     `cron.job_run_details` shows `succeeded` and `net._http_response` shows
     200. If migration `0010` fails on real Supabase, fix it.
   - Record what you saw in `docs/deploy.md` (corrections, screenshots not
     needed).
3. **Deploy to production by following `docs/deploy.md`.**
   - A person with the accounts runs it with the session (or the session
     prepares exact commands and the person executes).
   - Every deviation from the checklist becomes an edit to the checklist.
   - Finish with the checklist's smoke test, on production, and paste its
     results in the final report.
4. **Legal and support basics in the app.**
   - `/privacy` and `/terms` pages (Georgian), linked from the landing page,
     the sign-in page and the app footer. The text comes from the person in
     decision 3; until it arrives the pages are not linked.
   - A support contact (email and phone from configuration, not hard-coded)
     shown in the app shell help menu, on error pages, and in invitation and
     order emails.
   - A short consent line on first sign-in that links the two pages. Store
     nothing new unless the lawyer asks for a consent record.
5. **Operational basics.**
   - Error visibility per decision 1.
   - An uptime check on `/login` and a cron-health check (alert if no
     `notification_deliveries` row has been processed while pending rows older
     than 10 minutes exist): a small admin-overview warning, computed from real
     rows.
   - Backups: confirm daily backups/PITR on the production project, then do one
     **restore drill** into a scratch project and record how long it took.
   - Data deletion per decision 2.
6. **Close the two known hardening gaps, or decide to live with them.**
   - **Not-found status.** A guard that fails inside `<Suspense>` returns HTTP
     200 with the not-found page. Investigate whether role and ownership checks
     can run before the first byte is sent without losing Cache Components
     (for example a check in the route's layout or `proxy.ts`-adjacent code that
     does not need the full shell). Fix it if it is cheap; otherwise write down
     why it stays and leave it.
   - **CSP.** `'unsafe-inline'` for scripts and styles stays unless step 6's
     investigation shows per-request nonces are affordable. Do not trade away
     caching for it without asking.
7. **Pilot readiness check.**
   - On production, with the first supplier's real data loaded, confirm the
     dashboard and pilot-metric queries are fast (look at the slowest in
     `EXPLAIN ANALYZE`) and add an index only if one is slow.
   - Write `docs/pilot-runbook.md`: who onboards a supplier, how a supplier is
     approved, how an invitation is sent, what to do when an email does not
     arrive, how to suspend a misbehaving account, and who answers support.

## Out of scope

New product features; payments; automated WhatsApp sending; native apps;
anything on the "out of scope" list in `CLAUDE.md`; changes to the pilot's
success measures.

## Tests

- **E2E:** the existing suite, green against the real local Supabase (step 1),
  in CI.
- **Integration:** the cron-health warning on fixtures (stuck pending deliveries
  present or absent); the deletion script if built (dry run changes nothing,
  real run removes the organization's data and nothing else, is audited, and is
  refused for a platform admin's organization).
- **Manual, recorded in the final report:** Google sign-in; real emails received;
  `pg_cron` run succeeded; production smoke test; restore drill.

## Done when

- The e2e suite passes in CI against real Supabase Auth and Storage.
- Real emails were received for invitation, new order and confirmation, and the
  `pg_cron` job ran successfully.
- Production is deployed following `docs/deploy.md`, and its smoke test passed.
- The privacy policy, terms and support contact are live (or the report says
  precisely which is waiting on whom).
- A restore drill has been done and timed.
- `README.md`'s "Implemented, configured, verified" table has no row that says
  "not performed" except ones the report explains.
- The final report lists the exact commands run with their actual results and
  the gaps that remain.
