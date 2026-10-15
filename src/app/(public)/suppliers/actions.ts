"use server";

import { headers } from "next/headers";
import { after } from "next/server";
import { fieldErrorsFrom, type ValidationKey } from "@/lib/validation/form-errors";
import { supplierRequestSchema } from "@/lib/validation/supplier-request";
import { createSupplierRequest } from "@/server/domain/admin/supplier-requests";
import { StateError } from "@/server/domain/errors";
import { notifyAdminsSupplierRequest } from "@/server/notifications/admin-alerts";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";

export type RequestFormState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "error"; error: "invalid" | "rate_limited" | "unknown"; fieldErrors?: Record<string, ValidationKey> };

/**
 * PUBLIC on purpose (no guard): a prospective supplier has no account. It only
 * stores a request row; nothing here grants access. Abuse controls: a hidden
 * trap field bots fill in, a per-IP limit, and a generic answer that doesn't
 * reveal whether the business or address is already known.
 */
export async function submitSupplierRequest(_prev: RequestFormState, formData: FormData): Promise<RequestFormState> {
  // Honeypot: real people never see this field. Pretend success, store nothing.
  if (String(formData.get("website") ?? "") !== "") return { status: "sent" };

  const parsed = supplierRequestSchema.safeParse({
    businessName: formData.get("businessName") ?? "",
    legalId: formData.get("legalId") ?? "",
    contactName: formData.get("contactName") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    city: formData.get("city") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { status: "error", error: "invalid", fieldErrors: fieldErrorsFrom(parsed.error) };

  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  try {
    await consumeRateLimit(RATE_LIMITS.supplierRequest, ip, { hash: true });
  } catch (error) {
    if (error instanceof StateError && error.code === "rate_limited") return { status: "error", error: "rate_limited" };
    throw error;
  }

  try {
    const result = await createSupplierRequest(parsed.data);
    if (result === "created") {
      const name = parsed.data.businessName;
      after(() => notifyAdminsSupplierRequest(name).catch(() => undefined));
    }
  } catch (error) {
    // Message only: driver errors can carry the submitted values.
    console.error("[supplier-request] failed", { message: error instanceof Error ? error.message : String(error) });
    return { status: "error", error: "unknown" };
  }
  return { status: "sent" };
}
