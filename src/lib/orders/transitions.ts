import type { OrderStatus } from "@/server/db/schema";

// The order lifecycle (CLAUDE.md, "Order lifecycle"), defined once.
//
//   pending ──confirm──▶ confirmed ──deliver──▶ delivered
//      │                     │
//      ├─reject (reason)──▶ rejected
//      ├─buyer cancel─────▶ cancelled ◀── supplier cancel (reason) ──┘

export type OrderAction = "confirm" | "reject" | "deliver" | "buyer_cancel" | "supplier_cancel";
export type ActorRole = "buyer" | "supplier";

export type TransitionRule = {
  from: OrderStatus;
  to: OrderStatus;
  actor: ActorRole;
  reasonRequired: boolean;
};

export const TRANSITIONS: Record<OrderAction, TransitionRule> = {
  confirm: { from: "pending", to: "confirmed", actor: "supplier", reasonRequired: false },
  reject: { from: "pending", to: "rejected", actor: "supplier", reasonRequired: true },
  deliver: { from: "confirmed", to: "delivered", actor: "supplier", reasonRequired: false },
  buyer_cancel: { from: "pending", to: "cancelled", actor: "buyer", reasonRequired: false },
  supplier_cancel: { from: "confirmed", to: "cancelled", actor: "supplier", reasonRequired: true },
};

export const TERMINAL_STATUSES: readonly OrderStatus[] = ["delivered", "rejected", "cancelled"];

/** Whether `actor` may move an order from `from` to `to`. */
export function canTransition(from: OrderStatus, to: OrderStatus, actor: ActorRole): boolean {
  return Object.values(TRANSITIONS).some((r) => r.from === from && r.to === to && r.actor === actor);
}

/** Actions `actor` can take on an order in `status`; drives which buttons exist. */
export function availableActions(status: OrderStatus, actor: ActorRole): OrderAction[] {
  return (Object.keys(TRANSITIONS) as OrderAction[]).filter(
    (a) => TRANSITIONS[a].from === status && TRANSITIONS[a].actor === actor,
  );
}
