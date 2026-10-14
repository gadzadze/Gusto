import "server-only";

/**
 * Called once after an order has been committed (never inside the
 * transaction, and never for an idempotent repeat).
 *
 * Milestone 5 hooks notifications in here: outbox rows for the supplier and
 * the in-app/email delivery. Until then it deliberately does nothing — no
 * notification is sent or recorded.
 */
export async function afterOrderSubmitted(orderId: string): Promise<void> {
  void orderId;
}
