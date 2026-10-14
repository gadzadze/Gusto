"use server";

import { refresh } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { fieldErrorsFrom } from "@/lib/validation/form-errors";
import { customerSchema } from "@/lib/validation/customer";
import { whatsappLink } from "@/lib/whatsapp";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireSupplier, type SupplierContext } from "@/server/auth/guards";
import {
  createCustomer,
  getCustomer,
  regenerateInvitation,
  revokeInvitations,
  setCustomerBlocked,
  setCustomerPriceList,
  type CustomerError,
} from "@/server/domain/customers/customers";
import { serverEnv } from "@/server/env";
import { sendEmail } from "@/server/notifications/email";

export type InviteLinks = {
  customerId: string;
  inviteUrl: string;
  whatsappUrl: string | null;
  emailSent: boolean | null; // null = no email address given
};

async function inviteLinks(
  ctx: SupplierContext,
  customerId: string,
  token: string,
): Promise<InviteLinks> {
  const t = await getTranslations("customers.invite");
  const customer = await getCustomer(ctx, customerId);
  const inviteUrl = `${serverEnv().NEXT_PUBLIC_APP_URL}/invite/${token}`;
  const text = t("message", {
    name: customer.contactName ? `, ${customer.contactName}` : "",
    supplier: ctx.orgName,
    link: inviteUrl,
  });
  let emailSent: boolean | null = null;
  if (customer.contactEmail) {
    const result = await sendEmail({ to: customer.contactEmail, subject: `${ctx.orgName} — Gusto`, text });
    emailSent = result === "sent";
  }
  return {
    customerId,
    inviteUrl,
    whatsappUrl: customer.contactPhone ? whatsappLink(customer.contactPhone, text) : null,
    emailSent,
  };
}

type Err = ActionError<CustomerError>;

export async function createCustomerAction(raw: unknown): Promise<{ ok: true; links: InviteLinks } | Err> {
  const ctx = await requireSupplier();
  const parsed = customerSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrorsFrom(parsed.error) };
  return runAction<{ ok: true; links: InviteLinks }, CustomerError>("createCustomer", async () => {
    const { customerId, token } = await createCustomer(ctx, parsed.data);
    refresh();
    return { ok: true, links: await inviteLinks(ctx, customerId, token) };
  });
}

const id = z.uuid();

export async function regenerateInviteAction(customerId: string): Promise<{ ok: true; links: InviteLinks } | Err> {
  const ctx = await requireSupplier();
  if (!id.safeParse(customerId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true; links: InviteLinks }, CustomerError>("regenerateInvite", async () => {
    const token = await regenerateInvitation(ctx, customerId);
    refresh();
    return { ok: true, links: await inviteLinks(ctx, customerId, token) };
  });
}

export async function revokeInvitesAction(customerId: string): Promise<{ ok: true } | Err> {
  const ctx = await requireSupplier();
  if (!id.safeParse(customerId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, CustomerError>("revokeInvites", async () => {
    await revokeInvitations(ctx, customerId);
    refresh();
    return { ok: true };
  });
}

export async function setCustomerPriceListAction(customerId: string, priceListId: string): Promise<{ ok: true } | Err> {
  const ctx = await requireSupplier();
  if (!id.safeParse(customerId).success || (priceListId && !id.safeParse(priceListId).success)) {
    return { ok: false, error: "invalid" };
  }
  return runAction<{ ok: true }, CustomerError>("setCustomerPriceList", async () => {
    await setCustomerPriceList(ctx, customerId, priceListId || null);
    refresh();
    return { ok: true };
  });
}

export async function setCustomerBlockedAction(customerId: string, blocked: boolean): Promise<{ ok: true } | Err> {
  const ctx = await requireSupplier();
  if (!id.safeParse(customerId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, CustomerError>("setCustomerBlocked", async () => {
    await setCustomerBlocked(ctx, customerId, blocked === true);
    refresh();
    return { ok: true };
  });
}
