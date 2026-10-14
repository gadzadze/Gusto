# Milestone 4 — Ordering

Read `CLAUDE.md` fully before starting. Milestones 1–3 are merged.

## Goal

The whole order loop, done correctly: cart → submit → supplier confirms
(possibly adjusting quantities) or rejects → delivered, and **one-tap
reorder**. After this milestone Gusto is usable end to end.

## Build

1. **Schema.**
   - `carts`, `cart_items`, `orders`, `order_items`, `order_status_history`,
     per `CLAUDE.md`.
   - `orders.number` comes from a Postgres sequence starting at 1001.
   - Unique `(buyer_org_id, idempotency_key)`.
   - Indexes on:
     - `(supplier_org_id, status, created_at desc)`;
     - `(buyer_org_id, created_at desc)`;
     - `order_status_history(order_id, created_at)`.
2. **Cart.**
   - Persisted in the database, one cart per (buyer, supplier).
   - Add from the catalog with a quantity stepper that respects min quantity
     and step.
   - Edit quantities and remove items.
   - A cart drawer/page per supplier. If the buyer has carts with several
     suppliers, show them as separate carts, each with its own checkout. Never
     merge them.
   - Show line totals, subtotal, VAT and total, all computed by `money.ts`.
   - Show "₾X more to reach this supplier's minimum" when below the minimum.
3. **Checkout** at `/buyer/checkout/[supplierId]`.
   - Choose a delivery address (or add one inline) and enter a note.
   - Review, then submit.
   - The page gets an `idempotency_key` (UUID) when rendered. The submit
     button disables while pending.
4. **Submit** (`src/server/domain/orders/submit.ts`), in **one transaction**:
   1. Lock the cart.
   2. Re-check that the supplier connection is active and the supplier is
      `active`.
   3. Re-load the products and re-resolve prices.
   4. Validate active status, min quantity, step and the minimum order value.
   5. If any price or availability changed, **abort and return the diff**. The
      buyer reviews it and resubmits.
   6. Insert the order, item snapshots and the first status history row.
   7. Clear the cart.

   A repeated `idempotency_key` returns the existing order instead of
   creating another. Leave one clearly named hook point after commit for
   milestone 5's notifications. Don't build notifications now.
5. **Transitions** (`transitions.ts`), exactly the table in `CLAUDE.md`.
   - Each is a domain function: guard role → conditional update on the current
     status → history row with actor and note.
   - **Supplier confirm** may change `confirmed_qty_milli` per line (including
     to 0 = unavailable) and recomputes totals.
   - Changed lines are flagged in the UI for the buyer: "ordered 10, confirmed
     8".
   - Reject and supplier-cancel require a reason.
   - Buyer cancel is allowed only while `pending`.
6. **Supplier order inbox** at `/supplier/orders`.
   - Tabs: new (pending), confirmed, done (delivered, rejected, cancelled).
   - Newest first, paginated.
   - The order page shows:
     - buyer name, address and note;
     - lines with snapshot data;
     - totals;
     - status history;
     - action buttons valid for the current status only. Disallowed actions
       are absent, not just disabled, but the server still enforces the rules.
   - A printable order view (CSS print styles). Suppliers will print orders
     for the warehouse.
7. **Buyer orders.**
   - `/buyer/orders`: list with status badges.
   - The order page shows lines, any quantity changes, totals, status history,
     and cancel while pending.
   - **Reorder:** "Order again" copies the order's products into the cart at
     the original quantities, using **current** prices. Inactive products are
     reported as skipped, and the buyer lands on the cart.
   - The buyer dashboard shows the last 5 orders, each with "order again".
8. **Order link** at `/o/[number]`.
   - Resolves to `/buyer/orders/[id]` or `/supplier/orders/[id]` if the viewer
     belongs to either side.
   - Otherwise 404.
   - Signed out → login, then back to the link.

## Out of scope

Email, in-app and WhatsApp notifications (milestone 5), dashboards and
analytics (milestone 6), delivery fees, delivered-quantity capture,
substitutions.

## Tests

- **Unit:**
  - totals: VAT included vs excluded, mixed VAT rates, weighed quantities
    (2.345 kg), rounding;
  - the transition table: every allowed and every disallowed pair.
- **Integration:**
  - submit persists the snapshot;
  - editing the product's price and name afterwards does not change the order;
  - submit with a stale price returns a diff and creates nothing;
  - submit below the minimum order value fails;
  - double submit with the same key → one order;
  - two concurrent supplier confirms → exactly one succeeds;
  - buyer cancel after confirmation is refused.
- **Integration (isolation):**
  - buyer Y cannot read or cancel buyer X's order;
  - supplier T cannot read or act on supplier S's order;
  - `/o/[number]` 404s for both.
- **Persistence:** create an order, restart the app process (start a new
  server in the test), and fetch the order and its history.
- **E2E:** buyer adds 3 products, changes a quantity, checks out → supplier
  confirms with one quantity reduced → buyer sees "confirmed" and the change →
  supplier marks delivered → buyer reorders.

## Done when

- On real data:
  - a buyer can register, add several products from one supplier, adjust
    quantities and submit;
  - both sides see the order;
  - the supplier confirms or rejects, and the buyer sees the new status and
    its history;
  - an unrelated supplier cannot see the order.
- Historical orders are immutable.
- CI is green.
