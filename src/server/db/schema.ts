import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
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
    // Suppliers only: company or individual-entrepreneur ID number, optional.
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
    check(
      "organizations_buyer_shape",
      sql`${t.type} <> 'buyer' or (${t.businessType} is not null and ${t.status} <> 'pending_review')`,
    ),
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
export type OrgStatus = (typeof orgStatus.enumValues)[number];
export type MembershipRole = (typeof membershipRole.enumValues)[number];
export type BuyerBusinessType = (typeof buyerBusinessType.enumValues)[number];
