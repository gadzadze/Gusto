"use client";

import { ImageDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { findPhotosAction, listPhotoCandidatesAction } from "@/app/supplier/products/actions";

export type PhotoLookupTotals = { attached: number; notFound: number; failed: number; total: number; done: number; limited: boolean };

const BATCH = 20;

/** Looks up photos by barcode in small batches, reporting progress. Safe to call with any ids: the server skips what has a photo or no barcode. */
export async function lookupPhotos(ids: string[], onProgress: (t: PhotoLookupTotals) => void): Promise<PhotoLookupTotals> {
  const totals: PhotoLookupTotals = { attached: 0, notFound: 0, failed: 0, total: ids.length, done: 0, limited: false };
  onProgress({ ...totals });
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const response = await findPhotosAction(batch);
    if (!response.ok) {
      totals.limited = response.error === "rate_limited";
      totals.failed += ids.length - i;
      break;
    }
    totals.attached += response.result.attached;
    totals.notFound += response.result.notFound;
    totals.failed += response.result.failed;
    totals.done = Math.min(ids.length, i + BATCH);
    onProgress({ ...totals });
  }
  totals.done = ids.length;
  return totals;
}

export function PhotoLookupSummary({ totals }: { totals: PhotoLookupTotals }) {
  const t = useTranslations("photoLookup");
  if (totals.done < totals.total) return <FormAlert tone="warning">{t("running", { done: totals.done, total: totals.total })}</FormAlert>;
  if (totals.limited) return <FormAlert tone="warning">{t("limited")}</FormAlert>;
  return (
    <FormAlert tone={totals.failed > 0 ? "warning" : "success"}>
      {t("result", { attached: totals.attached, notFound: totals.notFound, failed: totals.failed })}
      {totals.attached > 0 ? ` ${t("credit")}` : ""}
    </FormAlert>
  );
}

/** Button on the product list: finds photos for every product that has a barcode and no photo. */
export function FindPhotosButton() {
  const t = useTranslations("photoLookup");
  const [busy, setBusy] = useState(false);
  const [totals, setTotals] = useState<PhotoLookupTotals | null>(null);
  const [none, setNone] = useState(false);

  const run = async () => {
    setBusy(true);
    setNone(false);
    setTotals(null);
    try {
      const list = await listPhotoCandidatesAction();
      if (!list.ok || list.productIds.length === 0) return setNone(true);
      await lookupPhotos(list.productIds, setTotals);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button variant="outline" disabled={busy} onClick={run}>
        <ImageDown />
        {busy ? t("searching") : t("button")}
      </Button>
      {none ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
      {totals ? <PhotoLookupSummary totals={totals} /> : null}
    </div>
  );
}
