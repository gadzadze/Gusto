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
  | { kind: "list"; title: string; rows: { primary: string; secondary: string | null; tail: string | null; href: string | null }[]; allHref: string | null; empty: string | null }
  | ProposalView
  | ChoicesView
  | SuggestionsView
  | { kind: "cart"; carts: { supplier: string; lines: { name: string; qty: string; total: string }[]; total: string; shortfall: string | null; href: string }[]; checkoutHref: string | null };

/**
 * A change the assistant proposes. Nothing happens until the person taps Confirm on the card; the tap sends this to the server, which
 * checks it again with the signed-in person's own permissions and then calls the same function the buttons on the pages call.
 * Ids are real ids (never the assistant's short ones).
 */
export type ProposalAction =
  | { type: "cart_set"; supplierId: string; productId: string; qtyMilli: number }
  | { type: "reorder"; orderId: string }
  | { type: "regular_create"; orderId: string; weekday: number; name: string }
  | { type: "orders_confirm"; orderIds: string[] }
  | { type: "order_reject"; orderId: string; reason: string }
  | { type: "orders_deliver"; orderIds: string[] }
  | { type: "products_active"; productIds: string[]; active: boolean }
  | { type: "product_price"; productId: string; priceMinor: number };

export type ProposalView = {
  kind: "proposal";
  title: string;
  /** What will change, one row per thing: a label and, where it applies, the value before and after. */
  rows: { label: string; before: string | null; after: string | null }[];
  /** A short note under the rows ("nothing is sent"). */
  note: string | null;
  /** A change that cannot be taken back (a rejection): drawn as the danger style. */
  danger: boolean;
  confirmLabel: string;
  action: ProposalAction;
  /** Where to look at the thing on its own page. */
  href: string | null;
};

export type ChoicesView = { kind: "choices"; question: string; options: string[] };
export type SuggestionsView = { kind: "suggestions"; items: { name: string; supplier: string; hint: string }[] };

export type ApplyResult = { ok: true; message: string; href: string | null } | { ok: false; error: string };

export type ToolResult = { ok: true; forModel: unknown; view: Snapshot | null } | { ok: false; error: string };
