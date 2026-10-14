import {
  LayoutDashboard,
  Package,
  Settings,
  ShieldCheck,
  Store,
  Tags,
  type LucideIcon,
} from "lucide-react";

export type Area = "buyer" | "supplier" | "admin";

export type NavItem = {
  href: string;
  /** Key under `nav.*` in messages. */
  labelKey: "dashboard" | "overview" | "admin" | "products" | "settings" | "suppliers" | "categories";
  icon: LucideIcon;
};

// Only what exists. Later milestones add items here; nothing is shown
// disabled or "coming soon".
export const NAV_ITEMS: Record<Area, NavItem[]> = {
  buyer: [{ href: "/buyer", labelKey: "dashboard", icon: LayoutDashboard }],
  supplier: [
    { href: "/supplier", labelKey: "dashboard", icon: LayoutDashboard },
    { href: "/supplier/products", labelKey: "products", icon: Package },
    { href: "/supplier/settings", labelKey: "settings", icon: Settings },
  ],
  admin: [
    { href: "/admin", labelKey: "overview", icon: LayoutDashboard },
    { href: "/admin/suppliers", labelKey: "suppliers", icon: Store },
    { href: "/admin/categories", labelKey: "categories", icon: Tags },
  ],
};

export const ADMIN_LINK: NavItem = { href: "/admin", labelKey: "admin", icon: ShieldCheck };
