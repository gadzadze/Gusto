# Milestones

Each file is a prompt for one Claude Code session. Paste it in, or say
"do `docs/milestones/0N-….md`". Run them in order; each assumes the previous
ones are merged.

| # | Milestone | Outcome |
|---|---|---|
| 1 | [Foundation](01-foundation.md) | App runs; sign-in, onboarding, roles, empty dashboards, CI |
| 2 | [Supplier catalog](02-supplier-catalog.md) | Supplier builds a catalog; admin approves suppliers |
| 3 | [Customers and pricing](03-customers-and-pricing.md) | Supplier invites buyers; buyers see their own prices; search |
| 4 | [Ordering](04-ordering.md) | Cart → order → confirm/reject/deliver → reorder |
| 5 | [Notifications](05-notifications.md) | In-app + email via an outbox; WhatsApp share links |
| 6 | [Pilot launch](06-pilot-launch.md) | Dashboards, admin tools, security pass, deploy, docs |

After milestone 4 the product is usable end to end. After milestone 6 it is
ready for the pilot suppliers.

## Rules for every milestone

- Read `CLAUDE.md` first. It overrides anything in a milestone that
  contradicts it. If a milestone seems to need something `CLAUDE.md` rules out,
  stop and ask.
- Build the listed scope **end to end and real**: database, server logic, UI
  and tests. No mocked screens.
- Don't pull work forward from later milestones.
- Finish with lint, typecheck, tests and build all run. Report the exact
  commands and results, and anything left undone.
- Update `CLAUDE.md` (commands, decisions) and `README.md` when they change.
