import type { ProductView } from "@/components/buyer/product-view";

// A snapshot is what the assistant puts in the thread when the buyer asks to see something: the same facts a page would show, already
// formatted on the server (money, quantities, dates), as plain data the browser draws. The assistant itself never receives these views,
// only the compact facts built next to them (`forModel`), so what it says and what is shown come from the same query.

export type OrderSnap = {
  id: string;
  number: string;
  supplier: string;
  status: "pending" | "confirmed" | "delivered" | "rejected" | "cancelled";
  statusLabel: string;
  total: string;
  deliveryDay: string | null;
  ordered: string;
  href: string;
};

export type Snapshot =
  | { kind: "products"; title: string; groups: { supplier: string; more: { href: string; count: number } | null; items: ProductView[] }[] }
  | { kind: "suppliers"; items: { id: string; name: string; city: string; minOrder: string | null; delivery: string | null; products: number; href: string }[] }
  | { kind: "orders"; items: OrderSnap[]; allHref: string }
  | { kind: "order"; order: OrderSnap; lines: { name: string; qty: string; price: string; total: string }[]; reorderHref: string | null }
  | { kind: "cart"; carts: { supplier: string; lines: { name: string; qty: string; total: string }[]; total: string; shortfall: string | null; href: string }[]; checkoutHref: string | null };

export type ToolResult = { ok: true; forModel: unknown; view: Snapshot | null } | { ok: false; error: string };
