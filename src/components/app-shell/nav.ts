import {
  BadgePercent,
  Building2,
  ClipboardList,
  FileSearch,
  ScrollText,
  LayoutDashboard,
  Package,
  Settings,
  Search,
  ShieldCheck,
  ShoppingCart,
  Store,
  Tags,
  Users,
  type LucideIcon,
} from "lucide-react";

export type Area = "buyer" | "supplier" | "admin";

export type NavItem = {
  href: string;
  /** Key under `nav.*` in messages. */
  labelKey:
    | "dashboard"
    | "overview"
    | "admin"
    | "products"
    | "settings"
    | "suppliers"
    | "categories"
    | "customers"
    | "pricing"
    | "search"
    | "orders"
    | "cart"
    | "organizations"
    | "orderLookup"
    | "audit";
  icon: LucideIcon;
};

// Only what exists. Later milestones add items here; nothing is shown
// disabled or "coming soon".
export const NAV_ITEMS: Record<Area, NavItem[]> = {
  buyer: [
    { href: "/buyer", labelKey: "dashboard", icon: LayoutDashboard },
    { href: "/buyer/suppliers", labelKey: "suppliers", icon: Store },
    { href: "/buyer/cart", labelKey: "cart", icon: ShoppingCart },
    { href: "/buyer/orders", labelKey: "orders", icon: ClipboardList },
    { href: "/buyer/search", labelKey: "search", icon: Search },
  ],
  supplier: [
    { href: "/supplier", labelKey: "dashboard", icon: LayoutDashboard },
    { href: "/supplier/orders", labelKey: "orders", icon: ClipboardList },
    { href: "/supplier/products", labelKey: "products", icon: Package },
    { href: "/supplier/customers", labelKey: "customers", icon: Users },
    { href: "/supplier/pricing", labelKey: "pricing", icon: BadgePercent },
    { href: "/supplier/settings", labelKey: "settings", icon: Settings },
  ],
  admin: [
    { href: "/admin", labelKey: "overview", icon: LayoutDashboard },
    { href: "/admin/suppliers", labelKey: "suppliers", icon: Store },
    { href: "/admin/organizations", labelKey: "organizations", icon: Building2 },
    { href: "/admin/orders", labelKey: "orderLookup", icon: FileSearch },
    { href: "/admin/audit", labelKey: "audit", icon: ScrollText },
    { href: "/admin/categories", labelKey: "categories", icon: Tags },
  ],
};

export const ADMIN_LINK: NavItem = { href: "/admin", labelKey: "admin", icon: ShieldCheck };
