import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

// Every table here must have RLS enabled in a migration (see CLAUDE.md,
// "Security model"). tests/integration/rls.test.ts enforces it.

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const orgType = pgEnum("org_type", ["buyer", "supplier"]);
export const orgStatus = pgEnum("org_status", ["pending_review", "active", "suspended"]);
export const membershipRole = pgEnum("membership_role", ["owner", "member"]);
export const orderStatus = pgEnum("order_status", ["pending", "confirmed", "delivered", "rejected", "cancelled"]);
export const notificationEvent = pgEnum("notification_event", [
  "order_submitted",
  "order_confirmed",
  "order_rejected",
  "order_cancelled",
  "order_delivered",
  // Not about an order: a customer asks for payment terms, the supplier decides, a customer joins.
  "terms_requested",
  "terms_approved",
  "terms_declined",
  "customer_connected",
  "connection_requested",
  "connection_approved",
  "connection_declined",
]);
export const deliveryChannel = pgEnum("delivery_channel", ["email"]);
export const deliveryStatus = pgEnum("delivery_status", ["pending", "sent", "skipped", "failed"]);
export const customerStatus = pgEnum("customer_status", ["invited", "active", "blocked"]);
export const productUnit = pgEnum("product_unit", [
  "piece",
  "kg",
  "g",
  "l",
  "ml",
  "box",
  "pack",
  "case",
  "bottle",
  "jar",
  "bag",
  "sack",
  "keg",
  "pallet",
  "bunch",
  "roll",
  "bucket",
]);
export const buyerBusinessType = pgEnum("buyer_business_type", [
  "restaurant",
  "cafe",
  "hotel",
  "retailer",
  "other",
]);

export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  phone: text("phone"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  // Set when the person has chosen their own password. Until then every guard
  // sends them to /account/password.
  passwordSetAt: timestamp("password_set_at", { withTimezone: true }),
  ...timestamps,
});

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Immutable after insert (enforced by a trigger in the migrations).
    type: orgType("type").notNull(),
    status: orgStatus("status").notNull(),
    name: text("name").notNull(),
    // Buyers only.
    businessType: buyerBusinessType("business_type"),
    // Company (9 digits) or individual-entrepreneur (11 digits) ID, both kinds.
    // Unique per kind. Null only on rows from before it was collected.
    legalId: text("legal_id"),
    contactName: text("contact_name").notNull(),
    phone: text("phone").notNull(),
    city: text("city").notNull(),
    // Display defaults for this org, not constants in code.
    timezone: text("timezone").notNull().default("Asia/Tbilisi"),
    currency: text("currency").notNull().default("GEL"),
    // Other businesses may look this one up by its identification code to send a connection request.
    // The business can switch it off; an off business answers every lookup like one that is not on 202.
    findable: boolean("findable").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("organizations_type_status_idx").on(t.type, t.status),
    uniqueIndex("organizations_type_legal_id_key")
      .on(t.type, t.legalId)
      .where(sql`${t.legalId} is not null`),
    check("organizations_buyer_shape", sql`${t.type} <> 'buyer' or ${t.businessType} is not null`),
    check(
      "organizations_supplier_shape",
      sql`${t.type} <> 'supplier' or ${t.businessType} is null`,
    ),
    check("organizations_currency_iso", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("organization_memberships_org_user_key").on(t.organizationId, t.userId),
    index("organization_memberships_user_idx").on(t.userId),
  ],
);

export const supplierSettings = pgTable(
  "supplier_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Minor units (tetri) in the org's currency. 0 = no minimum.
    minOrderMinor: bigint("min_order_minor", { mode: "number" }).notNull().default(0),
    pricesIncludeVat: boolean("prices_include_vat").notNull().default(true),
    deliveryArea: text("delivery_area"),
    deliveryTerms: text("delivery_terms"),
    orderCutoffNote: text("order_cutoff_note"),
    // Last column mapping used for catalog import: { field: column header }.
    importMapping: jsonb("import_mapping").$type<Record<string, string>>(),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [check("supplier_settings_min_order_nonneg", sql`${t.minOrderMinor} >= 0`)],
);

export const addresses = pgTable(
  "addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    label: text("label"),
    city: text("city").notNull(),
    addressLine: text("address_line").notNull(),
    instructions: text("instructions"),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index("addresses_org_idx").on(t.organizationId),
    uniqueIndex("addresses_one_default_per_org")
      .on(t.organizationId)
      .where(sql`${t.isDefault}`),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Georgian name. Categories are platform data managed by admins; when a
    // second language ships this becomes per-locale.
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    // Archived categories keep their products but can't be chosen for new ones.
    isArchived: boolean("is_archived").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("categories_name_key").on(sql`lower(${t.name})`),
    index("categories_sort_idx").on(t.isArchived, t.sortOrder),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    description: text("description"),
    brand: text("brand"),
    sku: text("sku"),
    // EAN/UPC/GTIN digits; used to look up a shared photo. Optional.
    barcode: text("barcode"),
    unit: productUnit("unit").notNull(),
    packDescription: text("pack_description"),
    // Storage path prefix of the processed image (see server/storage), or null.
    imagePath: text("image_path"),
    // In the supplier org's currency, minor units.
    basePriceMinor: bigint("base_price_minor", { mode: "number" }).notNull(),
    vatRateBp: integer("vat_rate_bp").notNull(),
    minQtyMilli: integer("min_qty_milli").notNull().default(1000),
    qtyStepMilli: integer("qty_step_milli").notNull().default(1000),
    // Supplier's own stock count in milli-units; null = not tracked. Moves with
    // order confirmation/cancellation and may go negative (oversold). Never
    // selected by buyer-side queries.
    stockMilli: integer("stock_milli"),
    isActive: boolean("is_active").notNull().default(true),
    // Lowercased fields + transliteration skeletons; see search/translit.ts.
    searchText: text("search_text").notNull().default(""),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("products_supplier_sku_key")
      .on(t.supplierOrgId, t.sku)
      .where(sql`${t.sku} is not null`),
    // Target for composite FKs that pin rows to the product's own supplier.
    unique("products_id_supplier_key").on(t.id, t.supplierOrgId),
    index("products_supplier_active_idx").on(t.supplierOrgId, t.isActive),
    index("products_category_idx").on(t.categoryId),
    index("products_search_trgm_idx").using("gin", sql`${t.searchText} extensions.gin_trgm_ops`),
    check("products_price_nonneg", sql`${t.basePriceMinor} >= 0`),
    check("products_min_qty_positive", sql`${t.minQtyMilli} > 0`),
    check("products_qty_step_positive", sql`${t.qtyStepMilli} > 0`),
    check("products_vat_range", sql`${t.vatRateBp} between 0 and 10000`),
  ],
);

export const priceLists = pgTable(
  "price_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Pre-selected for new customers. Customers without a list pay base prices.
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("price_lists_supplier_name_key").on(t.supplierOrgId, sql`lower(${t.name})`),
    uniqueIndex("price_lists_one_default_per_supplier")
      .on(t.supplierOrgId)
      .where(sql`${t.isDefault}`),
    unique("price_lists_id_supplier_key").on(t.id, t.supplierOrgId),
  ],
);

export const priceListItems = pgTable(
  "price_list_items",
  {
    priceListId: uuid("price_list_id").notNull(),
    productId: uuid("product_id").notNull(),
    // Denormalized so the composite FKs below can require the list and the
    // product to belong to the same supplier.
    supplierOrgId: uuid("supplier_org_id").notNull(),
    priceMinor: bigint("price_minor", { mode: "number" }),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [
    primaryKey({ columns: [t.priceListId, t.productId] }),
    foreignKey({
      name: "price_list_items_list_fk",
      columns: [t.priceListId, t.supplierOrgId],
      foreignColumns: [priceLists.id, priceLists.supplierOrgId],
    }).onDelete("cascade"),
    foreignKey({
      name: "price_list_items_product_fk",
      columns: [t.productId, t.supplierOrgId],
      foreignColumns: [products.id, products.supplierOrgId],
    }).onDelete("cascade"),
    index("price_list_items_product_idx").on(t.productId),
    check("price_list_items_price_nonneg", sql`${t.priceMinor} >= 0`),
  ],
);

// Conditions on a price list: how the price changes with the payment method, the payment interval
// and the ordered quantity. product_id null = the whole list; a product's own rows replace the list's
// for that product. adjust_bp is added up (method + interval + quantity tier) and applied to the price.
export const priceRules = pgTable(
  "price_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierOrgId: uuid("supplier_org_id").notNull(),
    priceListId: uuid("price_list_id").notNull(),
    productId: uuid("product_id"),
    kind: text("kind").notNull(),
    method: text("method"),
    intervalDays: integer("interval_days"),
    minQtyMilli: integer("min_qty_milli"),
    adjustBp: integer("adjust_bp").notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    foreignKey({
      name: "price_rules_list_fk",
      columns: [t.priceListId, t.supplierOrgId],
      foreignColumns: [priceLists.id, priceLists.supplierOrgId],
    }).onDelete("cascade"),
    foreignKey({
      name: "price_rules_product_fk",
      columns: [t.productId, t.supplierOrgId],
      foreignColumns: [products.id, products.supplierOrgId],
    }).onDelete("cascade"),
    uniqueIndex("price_rules_key").on(
      t.priceListId,
      sql`coalesce(${t.productId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.kind,
      sql`coalesce(${t.method}, '')`,
      sql`coalesce(${t.intervalDays}, -1)`,
      sql`coalesce(${t.minQtyMilli}, -1)`,
    ),
    index("price_rules_list_idx").on(t.priceListId),
    check("price_rules_kind", sql`${t.kind} in ('method', 'interval', 'qty')`),
    check(
      "price_rules_shape",
      sql`(${t.kind} = 'method' and ${t.method} in ('cash', 'transfer') and ${t.intervalDays} is null and ${t.minQtyMilli} is null)
        or (${t.kind} = 'interval' and ${t.method} is null and ${t.intervalDays} between 0 and 365 and ${t.minQtyMilli} is null)
        or (${t.kind} = 'qty' and ${t.method} is null and ${t.intervalDays} is null and ${t.minQtyMilli} > 0)`,
    ),
    check("price_rules_adjust_range", sql`${t.adjustBp} between -9000 and 5000`),
  ],
);

// A buyer's request to pay a supplier in a certain way (and so get that way's price change). The supplier
// sees the effect and approves or declines; only an approved request changes the customer's terms.
export const paymentTermRequests = pgTable(
  "payment_term_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    buyerOrgId: uuid("buyer_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    method: text("method"),
    intervalDays: integer("interval_days"),
    status: text("status").notNull().default("pending"),
    decidedByUserId: uuid("decided_by_user_id").references(() => profiles.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("payment_term_requests_one_pending")
      .on(t.supplierOrgId, t.buyerOrgId)
      .where(sql`${t.status} = 'pending'`),
    index("payment_term_requests_supplier_idx").on(t.supplierOrgId, t.status),
    check("payment_term_requests_status", sql`${t.status} in ('pending', 'approved', 'declined')`),
    check("payment_term_requests_method", sql`${t.method} is null or ${t.method} in ('cash', 'transfer')`),
  ],
);

export const supplierCustomers = pgTable(
  "supplier_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Set when the invitation is accepted; null while only invited.
    buyerOrgId: uuid("buyer_org_id").references(() => organizations.id, { onDelete: "cascade" }),
    status: customerStatus("status").notNull().default("invited"),
    // What the supplier entered (their name for this customer, the contact
    // the invitation goes to). Not shown to other suppliers.
    businessName: text("business_name").notNull(),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    // Null = base prices. Must be one of this supplier's lists (composite FK).
    priceListId: uuid("price_list_id"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    // The supplier's private remark about this customer; never shown to the buyer.
    privateNote: text("private_note"),
    // Payment terms the supplier approved for this customer (null = the standard price, no payment
    // adjustment). A change is requested by the buyer in payment_term_requests and approved by the supplier.
    termsMethod: text("terms_method"),
    termsIntervalDays: integer("terms_interval_days"),
    // The identification code the supplier entered when inviting a business that was not on 202 yet. When
    // that business joins, the invitation becomes a connection request (converted_at says it did).
    legalId: text("legal_id"),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("supplier_customers_supplier_buyer_key")
      .on(t.supplierOrgId, t.buyerOrgId)
      .where(sql`${t.buyerOrgId} is not null`),
    index("supplier_customers_buyer_idx").on(t.buyerOrgId, t.status),
    index("supplier_customers_supplier_idx").on(t.supplierOrgId, t.status),
    index("supplier_customers_open_invite_code_idx")
      .on(t.legalId)
      .where(sql`${t.status} = 'invited' and ${t.buyerOrgId} is null and ${t.legalId} is not null`),
    foreignKey({
      name: "supplier_customers_price_list_fk",
      columns: [t.priceListId, t.supplierOrgId],
      foreignColumns: [priceLists.id, priceLists.supplierOrgId],
    }),
    check(
      "supplier_customers_active_has_buyer",
      sql`${t.status} <> 'active' or ${t.buyerOrgId} is not null`,
    ),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierCustomerId: uuid("supplier_customer_id")
      .notNull()
      .references(() => supplierCustomers.id, { onDelete: "cascade" }),
    // SHA-256 of the token; the token itself is never stored.
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => profiles.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("invitations_token_hash_key").on(t.tokenHash),
    index("invitations_customer_idx").on(t.supplierCustomerId),
  ],
);

export const carts = pgTable(
  "carts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buyerOrgId: uuid("buyer_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  // One cart per buyer per supplier; carts are never merged across suppliers.
  (t) => [uniqueIndex("carts_buyer_supplier_key").on(t.buyerOrgId, t.supplierOrgId)],
);

export const cartItems = pgTable(
  "cart_items",
  {
    cartId: uuid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    qtyMilli: integer("qty_milli").notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.cartId, t.productId] }),
    check("cart_items_qty_positive", sql`${t.qtyMilli} > 0`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Human reference, shown as GST-<number>. Never used for authorization.
    number: bigint("number", { mode: "number" })
      .notNull()
      .default(sql`nextval('order_number_seq')`),
    buyerOrgId: uuid("buyer_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    status: orderStatus("status").notNull().default("pending"),
    // Snapshots at submission: later edits to orgs/addresses don't rewrite history.
    buyerName: text("buyer_name").notNull(),
    supplierName: text("supplier_name").notNull(),
    currency: text("currency").notNull(),
    pricesIncludeVat: boolean("prices_include_vat").notNull(),
    addressId: uuid("address_id").references(() => addresses.id, { onDelete: "set null" }),
    deliveryCity: text("delivery_city").notNull(),
    deliveryAddress: text("delivery_address").notNull(),
    deliveryInstructions: text("delivery_instructions"),
    note: text("note"),
    // Calendar days on the supplier's calendar: what the buyer asked for, and
    // what the supplier agreed to when confirming.
    requestedDeliveryDate: date("requested_delivery_date", { mode: "string" }),
    deliveryDate: date("delivery_date", { mode: "string" }),
    // Current totals: ordered quantities while pending, confirmed ones after.
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
    vatMinor: bigint("vat_minor", { mode: "number" }).notNull(),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    // The agreed payment terms at submission (null = standard): how the buyer pays and when.
    paymentMethod: text("payment_method"),
    paymentIntervalDays: integer("payment_interval_days"),
    createdByUserId: uuid("created_by_user_id").references(() => profiles.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("orders_number_key").on(t.number),
    uniqueIndex("orders_buyer_idempotency_key").on(t.buyerOrgId, t.idempotencyKey),
    index("orders_supplier_status_created_idx").on(t.supplierOrgId, t.status, t.createdAt.desc()),
    index("orders_buyer_created_idx").on(t.buyerOrgId, t.createdAt.desc()),
    check("orders_totals_nonneg", sql`${t.subtotalMinor} >= 0 and ${t.vatMinor} >= 0 and ${t.totalMinor} >= 0`),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    // Reference only; the snapshot below is what the order shows.
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    sku: text("sku"),
    unit: productUnit("unit").notNull(),
    packDescription: text("pack_description"),
    unitPriceMinor: bigint("unit_price_minor", { mode: "number" }).notNull(),
    // The list price before conditions (payment terms, quantity tier) and the change they made, in
    // basis points (negative = discount). unit_price_minor is the price after.
    listPriceMinor: bigint("list_price_minor", { mode: "number" }),
    adjustBp: integer("adjust_bp").notNull().default(0),
    vatRateBp: integer("vat_rate_bp").notNull(),
    orderedQtyMilli: integer("ordered_qty_milli").notNull(),
    // Null until the supplier confirms; 0 means "unavailable".
    confirmedQtyMilli: integer("confirmed_qty_milli"),
    lineTotalMinor: bigint("line_total_minor", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("order_items_order_line_key").on(t.orderId, t.lineNo),
    check("order_items_ordered_positive", sql`${t.orderedQtyMilli} > 0`),
    check("order_items_confirmed_nonneg", sql`${t.confirmedQtyMilli} is null or ${t.confirmedQtyMilli} >= 0`),
  ],
);

export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    fromStatus: orderStatus("from_status"),
    toStatus: orderStatus("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => profiles.id, { onDelete: "set null" }),
    actorOrgId: uuid("actor_org_id").references(() => organizations.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("order_status_history_order_created_idx").on(t.orderId, t.createdAt)],
);

// In-app notifications: one row per recipient user, written in the same
// transaction as the change that caused it.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    event: notificationEvent("event").notNull(),
    // Null for events that are not about an order (they carry `link` instead).
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
    // Snapshots for display, so the list needs no join.
    orderNumber: integer("order_number"),
    // Where opening the notification goes when there is no order: an internal path built by the server.
    link: text("link"),
    // The other organization's name, from the viewer's side.
    counterpartyName: text("counterparty_name").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("notifications_dedupe_key").on(t.dedupeKey),
    index("notifications_user_created_idx").on(t.userId, t.createdAt.desc()),
    index("notifications_user_unread_idx")
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
  ],
);

// The outbox for channels that leave the app (email). Rows are claimed with
// FOR UPDATE SKIP LOCKED; see server/notifications/process.ts.
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    channel: deliveryChannel("channel").notNull(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    // Ids only. The message is rendered from the persisted order at send time.
    payload: jsonb("payload").$type<{ event: string; orderId?: string }>().notNull(),
    status: deliveryStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("notification_deliveries_dedupe_key").on(t.dedupeKey),
    index("notification_deliveries_due_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

// Email on/off per event group. In-app is always on. No row = defaults (on).
export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  emailNewOrders: boolean("email_new_orders").notNull().default(true),
  emailOrderUpdates: boolean("email_order_updates").notNull().default(true),
  ...timestamps,
});

// Fixed-window counters for rate limiting (server/security/rate-limit.ts).
// `key` is "<rule>:<subject>"; subjects that are people (IPs) are hashed.
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    hits: integer("hits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] }), index("rate_limits_window_idx").on(t.windowStart)],
);

// Sign-in is invite-only: an address must be on this list, or hold a valid
// invitation, before it can get a sign-in link (server/auth/allow-list.ts).
// Rows are never deleted: revoking sets `revoked_at`, which also blocks an
// address that would otherwise be let in by an invitation.
export const allowedEmails = pgTable(
  "allowed_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Always stored lowercase and trimmed.
    email: text("email").notNull(),
    note: text("note"),
    // What this person is registered as. Null = either (buyer, supplier or both at their
    // choice); "buyer" / "supplier" = onboarding offers only that kind and the server refuses
    // the other; "both" = a business that buys and resells: onboarding creates both sides.
    intendedRole: text("intended_role").$type<"buyer" | "supplier" | "both">(),
    // What the admin verified before registering the address. With a legal ID
    // the person's organization starts `active` (already vetted); without one
    // it waits for review.
    businessName: text("business_name"),
    legalId: text("legal_id"),
    createdByUserId: uuid("created_by_user_id").references(() => profiles.id, { onDelete: "set null" }),
    // Who, when it was a script rather than a signed-in admin.
    createdByLabel: text("created_by_label"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("allowed_emails_email_key").on(t.email),
    check("allowed_emails_lowercase", sql`${t.email} = lower(btrim(${t.email}))`),
    check("allowed_emails_intended_role_check", sql`${t.intendedRole} in ('buyer', 'supplier', 'both')`),
  ],
);

export const supplierRequestStatus = pgEnum("supplier_request_status", ["new", "contacted", "approved", "rejected"]);

// A prospective supplier's "please onboard me" form (public page /suppliers).
// It creates no account and no sign-in access: the admin checks the business,
// then approves, which registers the address on the allow-list.
// A buyer invites a supplier it already works with. The link opens the public join form
// with the buyer's name and the supplier's name filled in; it grants nothing (the admin
// still approves the business). Only the SHA-256 of the token is stored.
export const buyerSupplierInvites = pgTable(
  "buyer_supplier_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buyerOrgId: uuid("buyer_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // What the buyer entered: the supplier's name and how to reach them (private to the buyer).
    supplierName: text("supplier_name").notNull(),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // The supplier sent a join request with this link.
    usedAt: timestamp("used_at", { withTimezone: true }),
    // Set when that supplier has an organization; the supplier then sees this buyer
    // under "buyers who invited you" until they connect or ignore it.
    supplierOrgId: uuid("supplier_org_id").references(() => organizations.id, { onDelete: "set null" }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    // The supplier's identification code, when the buyer entered it, and when this invitation was turned
    // into a connection request because that supplier is on 202.
    legalId: text("legal_id"),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    uniqueIndex("buyer_supplier_invites_token_hash_key").on(t.tokenHash),
    index("buyer_supplier_invites_code_idx").on(t.legalId),
    index("buyer_supplier_invites_buyer_idx").on(t.buyerOrgId, t.createdAt),
    index("buyer_supplier_invites_supplier_idx").on(t.supplierOrgId),
  ],
);

export const supplierRequests = pgTable(
  "supplier_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessName: text("business_name").notNull(),
    legalId: text("legal_id").notNull(),
    contactName: text("contact_name").notNull(),
    phone: text("phone").notNull(),
    // Lowercase, trimmed.
    email: text("email").notNull(),
    city: text("city").notNull(),
    note: text("note"),
    status: supplierRequestStatus("status").notNull().default("new"),
    // The admin's own note (what was said on the phone, why rejected).
    adminNote: text("admin_note"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => profiles.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // The buyer's invitation this request came from, if any (shown to the admin).
    inviteId: uuid("invite_id").references((): AnyPgColumn => buyerSupplierInvites.id, { onDelete: "set null" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("supplier_requests_status_idx").on(t.status, t.createdAt),
    // One open request per business and per address: a second submission is a duplicate.
    uniqueIndex("supplier_requests_open_legal_id_key")
      .on(t.legalId)
      .where(sql`${t.status} in ('new', 'contacted')`),
    uniqueIndex("supplier_requests_open_email_key")
      .on(t.email)
      .where(sql`${t.status} in ('new', 'contacted')`),
    check("supplier_requests_email_lowercase", sql`${t.email} = lower(btrim(${t.email}))`),
  ],
);

// A buyer's reusable invitation link (one per buyer): pasted under any order in WhatsApp.
// Unlike buyer_supplier_invites it isn't single use, so the raw token is kept to show the
// link again; it grants nothing (a join request the admin vets), and the buyer can replace it.
export const buyerInviteLinks = pgTable(
  "buyer_invite_links",
  {
    buyerOrgId: uuid("buyer_org_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [uniqueIndex("buyer_invite_links_token_key").on(t.token)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null when the actor is a script or the system; see actorLabel.
    actorUserId: uuid("actor_user_id").references(() => profiles.id, { onDelete: "set null" }),
    actorLabel: text("actor_label"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt.desc()),
    index("audit_logs_target_idx").on(t.targetType, t.targetId),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type OrgType = (typeof orgType.enumValues)[number];
export type SupplierRequestStatus = (typeof supplierRequestStatus.enumValues)[number];
export type OrgStatus = (typeof orgStatus.enumValues)[number];
// A company owner adds a colleague by email. The address is let into sign-in (allowed_emails, note
// "team:<org>") and joins this organization at its first sign-in; nobody at 202 has to approve it,
// because the organization itself was already vetted. Rows are kept: revoked/accepted are timestamps.
export const teamInvites = pgTable(
  "team_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Lowercase, trimmed.
    email: text("email").notNull(),
    role: membershipRole("role").notNull().default("member"),
    invitedByUserId: uuid("invited_by_user_id").references(() => profiles.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    // One open invitation per organization and address.
    uniqueIndex("team_invites_open_key")
      .on(t.organizationId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
    index("team_invites_email_idx").on(t.email),
    check("team_invites_lowercase", sql`${t.email} = lower(btrim(${t.email}))`),
  ],
);

export type MembershipRole = (typeof membershipRole.enumValues)[number];
export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type PriceList = typeof priceLists.$inferSelect;
export type SupplierCustomer = typeof supplierCustomers.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type CustomerStatus = (typeof customerStatus.enumValues)[number];
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type OrderStatus = (typeof orderStatus.enumValues)[number];
export type BuyerBusinessType = (typeof buyerBusinessType.enumValues)[number];
export type Notification = typeof notifications.$inferSelect;
export type NotificationEvent = (typeof notificationEvent.enumValues)[number];
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type AllowedEmail = typeof allowedEmails.$inferSelect;

// A buyer's saved "regular order": the products and quantities they reorder
// from one supplier, with the weekday they usually do it. It never creates an
// order by itself: on that weekday the buyer gets a reminder and puts it in
// the cart with one tap, then checks out as usual (prices and availability
// are re-resolved at that moment).
export const regularOrders = pgTable(
  "regular_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buyerOrgId: uuid("buyer_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    supplierOrgId: uuid("supplier_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // ISO weekday, Monday = 1 ... Sunday = 7, in the buyer organization's timezone.
    weekday: integer("weekday").notNull(),
    // The day (buyer's calendar) a reminder was last claimed; makes reminders at-most-once per day.
    lastRemindedOn: date("last_reminded_on", { mode: "string" }),
    createdByUserId: uuid("created_by_user_id").references(() => profiles.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("regular_orders_buyer_idx").on(t.buyerOrgId),
    check("regular_orders_weekday_range", sql`${t.weekday} between 1 and 7`),
  ],
);

export const regularOrderItems = pgTable(
  "regular_order_items",
  {
    regularOrderId: uuid("regular_order_id")
      .notNull()
      .references(() => regularOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    qtyMilli: integer("qty_milli").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.regularOrderId, t.productId] }),
    check("regular_order_items_qty_positive", sql`${t.qtyMilli} > 0`),
  ],
);

// A business asks another to connect (like a friend request): a supplier asks a buyer, or a buyer asks a
// supplier. Only an approval creates the supplier_customers row, so nothing is visible before it.
// `price_list_id` is the list a supplier offers when it is the one asking.
export const connectionRequests = pgTable(
  "connection_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromOrgId: uuid("from_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    toOrgId: uuid("to_org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    message: text("message"),
    priceListId: uuid("price_list_id").references(() => priceLists.id, { onDelete: "set null" }),
    // The supplier's invited customer row this request replaces (set when an invitation was converted), so
    // approving it connects that row instead of making a second one.
    customerId: uuid("customer_id").references(() => supplierCustomers.id, { onDelete: "set null" }),
    requestedByUserId: uuid("requested_by_user_id").references(() => profiles.id, { onDelete: "set null" }),
    decidedByUserId: uuid("decided_by_user_id").references(() => profiles.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    // One open request per pair of businesses, whichever of them asked.
    uniqueIndex("connection_requests_one_pending")
      .on(sql`least(${t.fromOrgId}, ${t.toOrgId})`, sql`greatest(${t.fromOrgId}, ${t.toOrgId})`)
      .where(sql`${t.status} = 'pending'`),
    index("connection_requests_to_idx").on(t.toOrgId, t.status),
    index("connection_requests_from_idx").on(t.fromOrgId, t.status),
    check("connection_requests_status", sql`${t.status} in ('pending', 'approved', 'declined', 'withdrawn', 'expired')`),
    check("connection_requests_distinct", sql`${t.fromOrgId} <> ${t.toOrgId}`),
    check("connection_requests_message_len", sql`${t.message} is null or char_length(${t.message}) <= 300`),
  ],
);
