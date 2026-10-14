# Milestone 2 — Supplier catalog

Read `CLAUDE.md` fully before starting. Milestone 1 is merged.

## Goal

A supplier can build a complete, accurate catalog, including by importing the
Excel price list they already have. An admin can approve suppliers and manage
categories.

## Build

1. **Schema.**
   - `categories` and `products`, as described in `CLAUDE.md`.
   - `unit` is a constrained enum: `piece`, `kg`, `g`, `l`, `ml`, `box`,
     `pack`, `case`, `bottle`.
   - Unique `(supplier_org_id, sku)` when sku is set.
   - Indexes on `(supplier_org_id, is_active)` and `category_id`, plus a GIN
     trigram index on `search_text`.
   - Check constraints:
     - prices ≥ 0;
     - `min_qty_milli` > 0 and `qty_step_milli` > 0;
     - `vat_rate_bp` between 0 and 10000.
2. **Money and quantity helpers.**
   - `src/server/domain/money.ts`: minor-unit arithmetic, half-up rounding,
     and a `formatMoney(minor, currency, locale)` used everywhere.
   - Quantity helpers for `*_milli`: parse "2,5" and "2.5" input, format per
     unit, validate min quantity and step.
3. **Transliteration.**
   - `src/server/domain/search/translit.ts`, per `CLAUDE.md`.
   - `search_text` is recomputed on every product write: name, brand and sku,
     in both scripts.
4. **Supplier settings page.**
   - Minimum order value, whether prices include VAT, delivery terms, order
     cut-off note, contact phone.
5. **Product management** under `/supplier/products`.
   - Paginated table with search, category filter and active/inactive filter.
   - Create and edit form (React Hook Form + the same Zod schema used on the
     server). Fields:
     - name, description, brand, sku, category, unit, pack description;
     - base price, VAT rate (default 18%), min quantity, step.
   - Deactivate and reactivate. No hard delete.
6. **Images.**
   - Upload through a Server Action, accepting JPEG, PNG or WebP up to 4 MB
     (Vercel rejects function request bodies above 4.5 MB).
   - Check the file's actual type from its bytes, not its extension.
   - Re-encode with `sharp` to WebP, max 1200px. This also strips metadata.
   - Store in the `product-images` bucket at
     `{supplierOrgId}/{productId}/{uuid}.webp`, using the service-role key on
     the server.
   - The bucket is public-read, server-write only.
   - Show a preview and allow replacing the image.
   - Use `next/image` with the Supabase host allowed in `next.config`.
7. **Import** from CSV and XLSX.
   - Use a maintained XLSX parser. Not the stale `xlsx` npm package.
   - Upload a file, map columns (remembering the last mapping per supplier),
     and preview rows with per-row validation errors.
   - Rows are matched to existing products by sku.
   - Then commit: create or update in one transaction, and report the counts.
   - Provide a downloadable template file.
8. **Admin.**
   - `/admin/suppliers`: list by status. A detail page shows what the supplier
     entered.
   - **Approve** (→ `active`) and **suspend** (→ `suspended`, reason required).
   - `/admin/categories`: create, rename, reorder, archive.
   - Every admin action writes `audit_logs`: actor, action, target,
     before/after, reason.
9. **Supplier status effects.**
   - A `pending_review` supplier can fully edit its catalog.
   - A suspended supplier keeps read access to its own data but cannot change
     it, and sees a banner explaining why.

## Out of scope

Price lists, customers, buyer-facing catalog, orders.

## Tests

- **Unit:**
  - money rounding and formatting, including half-up edges;
  - quantity parsing ("2,5" / "2.5" / "0" / negatives) and step validation;
  - transliteration (ყველი ↔ kveli / qveli; წყალი ↔ tsqali / wyali, using the
    variants `CLAUDE.md` defines).
- **Integration:**
  - supplier A cannot read, update or deactivate supplier B's product (404);
  - a buyer cannot reach any `/supplier` action;
  - non-admins cannot approve suppliers;
  - approvals write audit rows;
  - import is atomic: a file with one invalid row commits nothing unless the
    user chooses "import valid rows only".
- **Integration:** upload rejects a renamed `.exe`, an oversized file and an
  SVG.
- **E2E:** supplier creates a product with an image, then imports 3 products
  from a CSV. Admin approves the supplier.

## Done when

- A supplier can go from empty to a full catalog in minutes via import.
- Images are stored in Supabase Storage.
- Admin approval works and is audited.
- CI is green.
