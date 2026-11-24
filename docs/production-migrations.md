# How migrations reach the production database

**Read this before running `npm run db:migrate` against production.**

## What actually happens

The production Supabase project (`xrhaobmikrdfyremjpbr`) has been migrated through **Supabase's own migration list**
(the Supabase MCP `apply_migration`, or the SQL editor), not through `drizzle-kit migrate`. The SQL is the same file
that is committed under `drizzle/`; only the bookkeeping differs:

| Where | What it records |
|---|---|
| `supabase_migrations` (Supabase's list; `list_migrations`) | every migration applied this way, with a Supabase timestamp |
| `drizzle.__drizzle_migrations` (Drizzle's log) | stops at `0029_allowed_emails_both_role` (id 30) |

So migrations **0030 to 0038 are live in production but missing from Drizzle's log** (checked 2026-11-24: their tables
and indexes exist). `drizzle-kit migrate` decides what to run from the log's last timestamp, so against production it
would try to run 0030 first, fail on "already exists" and roll the whole batch back. It does not corrupt anything, but
it cannot be used there as things stand.

Local databases and CI are unaffected: they start empty and `db:migrate` runs every file in order.

## How to apply a new migration to production

1. `npm run db:generate`, read the SQL, commit it, merge (as in `CLAUDE.md`, "Database rules").
2. Apply the **same SQL** with Supabase's `apply_migration` (name it after the file, without the number).
3. Check it landed (`list_migrations`, and query the new table, column or index).

Never use `drizzle-kit push` against production.

## Bringing Drizzle's log up to date (not done yet)

This makes `db:migrate` safe to run against production again: it records 0030 to 0038 as applied, using the same
hash Drizzle computes (SHA-256 of the migration file; verified against the logged row for 0029). It only writes
bookkeeping rows, no schema. Run it once, in the SQL editor or with `execute_sql`, **only after confirming
that the nine migrations really are applied**, and add a row for every later migration you also apply this way.

```sql
insert into drizzle.__drizzle_migrations (id, hash, created_at) values
  (31, '74dae1f5ae55d58002a64fb0995a7ddc5a92987a8113c176dcf4be174eb3777d', 1794302850254),  -- 0030_price_conditions
  (32, '9d6c411f276ac310d1e9f5bcf10da471091d0fcac73f0c30f5368dec26bb8db6', 1794304482732),  -- 0031_notifications_beyond_orders
  (33, '07bbd532ed300fda2a6b8d24b8d4a49aaddc764c9c1413417800d5e5d43a6c16', 1794567168392),  -- 0032_connection_requests
  (34, '6399c8814632081c0d6a2f72bb018602728f651cbeae86904041bc28ba92572a', 1794569762441),  -- 0033_invitation_codes
  (35, 'c71b192a75531e503522158f1b2f4bb4728b5ef244eb9abbb1476c159fa39bd9', 1794580181042),  -- 0034_team_invites
  (36, '721062afb617823d0011d8b298d90b96a5204e5cae3e63c492d73069ac59b684', 1794932413498),  -- 0035_rsge_waybills
  (37, '296758c0086ddfaf08b1a236dd5153c4913f55200803c4beb9b5f00c2be622d7', 1795037854536),  -- 0036_saved_filters
  (38, '2c24819240083d7906269ff517dd2b1efdd8630b9cd654fb5f784f2ce4bbbcf3', 1795105578105),  -- 0037_web_push
  (39, 'ccf18daad31a76b8f3e4223de7d4fdd29bb8f83ae9f039ea6c575e9bafc5cb8f', 1795449169640);  -- 0038_product_reference_indexes
```

(If the sequence behind `id` complains, check `select max(id) from drizzle.__drizzle_migrations;` first: the ids above
assume the log still ends at 30.)
