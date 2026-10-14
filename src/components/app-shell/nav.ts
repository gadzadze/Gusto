import { LayoutDashboard, ShieldCheck, type LucideIcon } from "lucide-react";

export type Area = "buyer" | "supplier" | "admin";

export type NavItem = {
  href: string;
  /** Key under `nav.*` in messages. */
  labelKey: "dashboard" | "overview" | "admin";
  icon: LucideIcon;
};

// Only what exists. Later milestones add items here; nothing is shown
// disabled or "coming soon".
export const NAV_ITEMS: Record<Area, NavItem[]> = {
  buyer: [{ href: "/buyer", labelKey: "dashboard", icon: LayoutDashboard }],
  supplier: [{ href: "/supplier", labelKey: "dashboard", icon: LayoutDashboard }],
  admin: [{ href: "/admin", labelKey: "overview", icon: LayoutDashboard }],
};

export const ADMIN_LINK: NavItem = { href: "/admin", labelKey: "admin", icon: ShieldCheck };
