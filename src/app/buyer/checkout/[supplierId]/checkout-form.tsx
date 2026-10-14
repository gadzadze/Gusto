"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { submitOrderAction } from "./actions";

type Address = { id: string; label: string };

export function CheckoutForm({
  supplierOrgId,
  expected,
  addresses,
  canSubmit,
}: {
  supplierOrgId: string;
  expected: { productId: string; qtyMilli: number; unitPriceMinor: number }[];
  addresses: Address[];
  canSubmit: boolean;
}) {
  const t = useTranslations("checkout");
  const router = useRouter();
  // One key per rendered checkout: a double click or a retry after a lost
  // response returns the same order instead of creating another.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [addressId, setAddressId] = useState(addresses[0]?.id ?? "new");
  const [newAddress, setNewAddress] = useState({ city: "", addressLine: "", instructions: "" });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    setChanges(null);
    startTransition(async () => {
      const result = await submitOrderAction(supplierOrgId, {
        idempotencyKey,
        expected,
        note: note || undefined,
        ...(addressId === "new"
          ? { newAddress: { ...newAddress, instructions: newAddress.instructions || undefined } }
          : { addressId }),
      });
      // Success redirects to the order and never returns here.
      if (result.error === "changed") setChanges(result.changes);
      else setError(t(`errors.${result.error}`));
    });
  };

  return (
    <div className="space-y-6">
      {changes ? (
        <div role="alert" className="space-y-3 rounded-xl border border-[var(--status-amber-fg)]/30 bg-[var(--status-amber-bg)] p-4 text-[var(--status-amber-fg)]">
          <p className="font-semibold">{t("changedTitle")}</p>
          <p className="text-sm">{t("changedBody")}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {changes.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
          <Button variant="outline" onClick={() => router.refresh()}>
            <RefreshCw />
            {t("reviewAgain")}
          </Button>
        </div>
      ) : null}
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold">{t("address")}</legend>
        {addresses.map((a) => (
          <label
            key={a.id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              addressId === a.id ? "border-brand bg-brand-soft" : "border-border",
            )}
          >
            <input type="radio" name="address" value={a.id} checked={addressId === a.id} onChange={() => setAddressId(a.id)} className="mt-0.5 accent-[var(--ink)]" />
            <span>{a.label}</span>
          </label>
        ))}
        <label
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
            addressId === "new" ? "border-brand bg-brand-soft" : "border-border",
          )}
        >
          <input type="radio" name="address" value="new" checked={addressId === "new"} onChange={() => setAddressId("new")} className="mt-0.5 accent-[var(--ink)]" />
          <span>{t("newAddress")}</span>
        </label>
        {addressId === "new" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-city">{t("city")}</Label>
              <Input id="new-city" value={newAddress.city} onChange={(e) => setNewAddress({ ...newAddress, city: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-line">{t("addressLine")}</Label>
              <Input id="new-line" value={newAddress.addressLine} onChange={(e) => setNewAddress({ ...newAddress, addressLine: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="new-instructions">{t("instructions")}</Label>
              <Input id="new-instructions" value={newAddress.instructions} onChange={(e) => setNewAddress({ ...newAddress, instructions: e.target.value })} />
            </div>
          </div>
        ) : null}
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="note">{t("note")}</Label>
        <Textarea id="note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby="note-hint" />
        <p id="note-hint" className="text-sm text-muted-foreground">{t("noteHint")}</p>
      </div>

      <div className="space-y-2">
        <Button className="w-full sm:w-auto" size="lg" disabled={!canSubmit || pending || changes !== null} onClick={submit}>
          {pending ? t("submitting") : t("submit")}
        </Button>
        <p className="text-sm text-muted-foreground">{t("paymentNote")}</p>
      </div>
    </div>
  );
}
