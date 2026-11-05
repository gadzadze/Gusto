"use server";

import { refresh } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { fieldErrorsFrom } from "@/lib/validation/form-errors";
import { supplierInviteSchema } from "@/lib/validation/supplier-invite";
import { whatsappLink } from "@/lib/whatsapp";
import { runAction, type ActionError } from "@/server/actions/result";
import { requireBuyer } from "@/server/auth/guards";
import { createSupplierInvite, getOrCreateInviteLink, regenerateInviteLink, revokeSupplierInvite, type SupplierInviteError } from "@/server/domain/buyer/supplier-invites";
import { serverEnv } from "@/server/env";
import { sendEmail } from "@/server/notifications/email";

export type SupplierInviteLinks = {
  inviteUrl: string;
  whatsappUrl: string | null;
  emailSent: boolean | null; // null = no email address given
};

type Err = ActionError<SupplierInviteError | "rate_limited">;

export async function createSupplierInviteAction(raw: unknown): Promise<{ ok: true; links: SupplierInviteLinks } | Err> {
  const ctx = await requireBuyer();
  const parsed = supplierInviteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid", fieldErrors: fieldErrorsFrom(parsed.error) };
  return runAction<{ ok: true; links: SupplierInviteLinks }, SupplierInviteError | "rate_limited">("createSupplierInvite", async () => {
    const { token } = await createSupplierInvite(ctx, parsed.data);
    refresh();
    const inviteUrl = `${serverEnv().NEXT_PUBLIC_APP_URL}/suppliers/invite/${token}`;
    const t = await getTranslations("supplierInvite");
    const text = t("message", { buyer: ctx.orgName, link: inviteUrl });
    let emailSent: boolean | null = null;
    if (parsed.data.email) {
      // Sent directly, not through the outbox: the text holds the raw link, which is never
      // persisted. A provider error must not fail the invitation (the link can still be copied).
      try {
        emailSent = (await sendEmail({ to: parsed.data.email, subject: t("emailSubject", { buyer: ctx.orgName }), text })) === "sent";
      } catch (error) {
        console.error("[supplier-invite] email failed", { message: error instanceof Error ? error.message : String(error) });
        emailSent = false;
      }
    }
    return { ok: true, links: { inviteUrl, whatsappUrl: parsed.data.phone ? whatsappLink(parsed.data.phone, text) : null, emailSent } };
  });
}

export async function revokeSupplierInviteAction(inviteId: string): Promise<{ ok: true } | Err> {
  const ctx = await requireBuyer();
  if (!z.uuid().safeParse(inviteId).success) return { ok: false, error: "invalid" };
  return runAction<{ ok: true }, SupplierInviteError | "rate_limited">("revokeSupplierInvite", async () => {
    await revokeSupplierInvite(ctx, inviteId);
    refresh();
    return { ok: true };
  });
}

export type PersonalLink = { url: string; text: string };

async function personalLink(token: string): Promise<PersonalLink> {
  const t = await getTranslations("supplierInvite");
  const url = `${serverEnv().NEXT_PUBLIC_APP_URL}/suppliers/invite/${token}`;
  return { url, text: t("orderFooter", { link: url }) };
}

/** The buyer's own reusable link (made on first use). */
export async function personalLinkAction(regenerate = false): Promise<{ ok: true; link: PersonalLink } | Err> {
  const ctx = await requireBuyer();
  return runAction<{ ok: true; link: PersonalLink }, SupplierInviteError | "rate_limited">("personalInviteLink", async () => {
    const token = regenerate ? await regenerateInviteLink(ctx) : await getOrCreateInviteLink(ctx);
    return { ok: true, link: await personalLink(token) };
  });
}
