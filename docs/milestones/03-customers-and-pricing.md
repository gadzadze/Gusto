# Milestone 3 — Customers and pricing

Read `CLAUDE.md` fully before starting. Milestones 1–2 are merged.

## Goal

A supplier invites the businesses it already serves, assigns each a price
list, and those buyers see that supplier's catalog with **their own** prices.
Nobody else sees it.

## Build

1. **Schema.**
   - `price_lists`, `price_list_items`, `supplier_customers` and
     `invitations`, per `CLAUDE.md`.
   - Unique `(supplier_org_id, buyer_org_id)` on `supplier_customers`.
   - At most one default price list per supplier.
2. **Price resolution.**
   - `src/server/domain/pricing/resolve.ts`: given a supplier, buyer and
     products, return the effective unit price per product.
   - Rule: the customer's price list item, else the product base price.
   - This is the **only** place prices are resolved: the catalog, the cart and
     order submission all call it.
   - Batch it, so a catalog page makes one query, not one per product.
3. **Price lists UI** under `/supplier/pricing`.
   - Create, rename and delete price lists.
   - Edit an override price per product in a table.
   - Bulk "set all to base −X%" with an explicit preview before saving.
   - Import overrides via the same CSV/XLSX mapper as milestone 2.
4. **Customers UI** under `/supplier/customers`.
   - List with status and assigned price list.
   - "Add customer": business name, contact name and phone, optional email,
     price list.
   - Only `active` suppliers can invite.
5. **Invitations.**
   - Generate 32 random bytes and store only the SHA-256 hash.
   - Expires after 14 days, can be revoked, single use.
   - The supplier gets:
     - a copyable link;
     - a **"Send on WhatsApp"** button opening `wa.me/<digits>?text=…` with a
       Georgian message containing the link;
     - email delivery if an email was entered. Log it with the `[DEV EMAIL]`
       fallback for now; real sending arrives in milestone 5.
   - Accepting an invite (`/invite/[token]`):
     - Not signed in → sign in, then return to the invite.
     - Signed in with no org → a short buyer onboarding, prefilled from what
       the supplier entered.
     - Signed in as a buyer org → connect it.
     - Signed in as a supplier → explain that an invite is for buyers.
     - Expired, revoked or used → a clear message, not a stack trace.
   - Invalid tokens return the same response whether or not they ever existed.
6. **Buyer side.**
   - `/buyer/suppliers`: the buyer's connected suppliers only.
   - `/buyer/suppliers/[id]`: supplier info (delivery terms, minimum order,
     contact) and the catalog:
     - active products of an `active` supplier, with the buyer's resolved
       prices;
     - category filter, search, pagination;
     - unit, pack size and "min. 2 boxes" style hints on each product.
   - A product detail sheet.
   - Prices are labelled with VAT status (`ფასი დღგ-ს ჩათვლით` or
     `დღგ-ს გარეშე`, per supplier setting).
7. **Search.**
   - The buyer can search across all connected suppliers' catalogs at once:
     trigram match on `search_text`, with the query transliterated the same
     way.
   - Results are grouped by supplier.
   - Bounded: max 50 results, plus "show more" per supplier.

## Out of scope

Cart, orders, notifications beyond the invite link.

## Tests

- **Unit:**
  - price resolution: override vs base; a deleted price list falls back to
    base;
  - invite token hashing and expiry;
  - the `wa.me` builder: phone normalization and URL encoding of Georgian
    text.
- **Integration (isolation):**
  - buyer X cannot see supplier S's catalog until connected (404);
  - buyer X never sees the prices from buyer Y's price list;
  - a blocked customer loses access;
  - a suspended or pending supplier's catalog is invisible to buyers;
  - a supplier cannot read another supplier's customers or price lists.
- **Integration:** an invitation can be accepted once; expired, revoked and
  forged tokens all fail identically.
- **Integration:** search "kveli" finds "ყველი", but only within connected
  suppliers.
- **E2E:** supplier invites a customer with a custom price list → buyer opens
  the link, signs up, sees the supplier and the custom price.

## Done when

- The invite → join → see-your-prices loop works.
- Price isolation is proven by tests.
- CI is green.
