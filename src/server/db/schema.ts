import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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
    unit: productUnit("unit").notNull(),
    packDescription: text("pack_description"),
    // Storage path prefix of the processed image (see server/storage), or null.
    imagePath: text("image_path"),
    // In the supplier org's currency, minor units.
    basePriceMinor: bigint("base_price_minor", { mode: "number" }).notNull(),
    vatRateBp: integer("vat_rate_bp").notNull(),
    minQtyMilli: integer("min_qty_milli").notNull().default(1000),
    qtyStepMilli: integer("qty_step_milli").notNull().default(1000),
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
    priceMinor: bigint("price_minor", { mode: "number" }).notNull(),
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
    ...timestamps,
  },
  (t) => [
    uniqueIndex("supplier_customers_supplier_buyer_key")
      .on(t.supplierOrgId, t.buyerOrgId)
      .where(sql`${t.buyerOrgId} is not null`),
    index("supplier_customers_buyer_idx").on(t.buyerOrgId, t.status),
    index("supplier_customers_supplier_idx").on(t.supplierOrgId, t.status),
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
    // Current totals: ordered quantities while pending, confirmed ones after.
    subtotalMinor: bigint("subtotal_minor", { mode: "number" }).notNull(),
    vatMinor: bigint("vat_minor", { mode: "number" }).notNull(),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
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
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    // Snapshots for display, so the list needs no join.
    orderNumber: integer("order_number").notNull(),
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
    payload: jsonb("payload").$type<{ event: string; orderId: string }>().notNull(),
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
    // What this person is registered as. Null = either; set = onboarding offers
    // only this kind, and the server refuses the other.
    intendedRole: orgType("intended_role"),
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
  (t) => [uniqueIndex("allowed_emails_email_key").on(t.email), check("allowed_emails_lowercase", sql`${t.email} = lower(btrim(${t.email}))`)],
);

export const supplierRequestStatus = pgEnum("supplier_request_status", ["new", "contacted", "approved", "rejected"]);

// A prospective supplier's "please onboard me" form (public page /suppliers).
// It creates no account and no sign-in access: the admin checks the business,
// then approves, which registers the address on the allow-list.
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
