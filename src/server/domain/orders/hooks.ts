import "server-only";
import { deliverAfterResponse } from "@/server/notifications/process";

/**
 * Called once after an order has been committed (never inside the
 * transaction, and never for an idempotent repeat). The notification rows
 * were already written inside the transaction; this only asks for their
 * delivery to be attempted once the response has been sent.
 */
export async function afterOrderSubmitted(orderId: string): Promise<void> {
  deliverAfterResponse(orderId);
}
