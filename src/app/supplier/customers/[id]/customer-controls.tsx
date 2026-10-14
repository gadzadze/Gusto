"use client";

import { Ban, Link2, Link2Off, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { InvitePanel } from "@/components/customers/invite-panel";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { CustomerStatus } from "@/server/db/schema";
import {
  regenerateInviteAction,
  revokeInvitesAction,
  setCustomerBlockedAction,
  setCustomerPriceListAction,
  type InviteLinks,
} from "../actions";

type Props = {
  customerId: string;
  status: CustomerStatus;
  priceListId: string | null;
  priceLists: { id: string; name: string }[];
  hasOpenInvite: boolean;
  canInvite: boolean;
  readOnly: boolean;
};

export function CustomerControls(props: Props) {
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [links, setLinks] = useState<InviteLinks | null>(null);
  const [priceListId, setPriceListId] = useState(props.priceListId ?? "");

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success?: string) => {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        if (success) setMessage({ tone: "success", text: success });
        return;
      }
      setMessage({ tone: "error", text: t(`errors.${result.error as "unknown"}`) });
    });
  };

  return (
    <div className="space-y-6">
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
      {links ? <InvitePanel links={links} /> : null}

      <section className="max-w-md space-y-2">
        <Label htmlFor="priceList">{t("detail.priceList")}</Label>
        <div className="flex gap-2">
          <Select id="priceList" value={priceListId} disabled={props.readOnly} onChange={(e) => setPriceListId(e.target.value)}>
            <option value="">{t("basePrices")}</option>
            {props.priceLists.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
          <Button
            variant="outline"
            disabled={pending || props.readOnly || priceListId === (props.priceListId ?? "")}
            onClick={() => run(() => setCustomerPriceListAction(props.customerId, priceListId), tc("saved"))}
          >
            {t("detail.savePriceList")}
          </Button>
        </div>
      </section>

      {props.status === "invited" && !props.readOnly ? (
        <section className="flex flex-wrap gap-2">
          {props.canInvite ? (
            <Button
              disabled={pending}
              onClick={() => {
                setMessage(null);
                startTransition(async () => {
                  const result = await regenerateInviteAction(props.customerId);
                  if (result.ok) setLinks(result.links);
                  else setMessage({ tone: "error", text: t(`errors.${result.error}`) });
                });
              }}
            >
              <Link2 />
              {t("detail.newLink")}
            </Button>
          ) : null}
          {props.hasOpenInvite ? (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => run(() => revokeInvitesAction(props.customerId), t("detail.revoked"))}
            >
              <Link2Off />
              {t("detail.revoke")}
            </Button>
          ) : null}
        </section>
      ) : null}

      {!props.readOnly ? (
        <section className="space-y-2 border-t border-border pt-6">
          {props.status === "blocked" ? (
            <Button variant="outline" disabled={pending} onClick={() => run(() => setCustomerBlockedAction(props.customerId, false))}>
              <RotateCcw />
              {t("detail.unblock")}
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={pending} onClick={() => run(() => setCustomerBlockedAction(props.customerId, true))}>
                <Ban />
                {t("detail.block")}
              </Button>
              <p className="text-sm text-muted-foreground">{t("detail.blockHint")}</p>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
