"use client";

import { CircleAlert, FileSpreadsheet } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { guessPriceMapping, MAX_IMPORT_ROWS, type PriceImportMapping, type RawSheet } from "@/lib/catalog/import";
import type { PriceImportAnalysis } from "@/server/domain/pricing/price-import";
import { readSpreadsheet } from "@/app/supplier/products/import/read-sheet";
import { analyzePriceImportAction, commitPriceImportAction } from "@/app/supplier/pricing/actions";

/** SKU + price import into one price list. Same file handling as product import. */
export function PriceImport({ priceListId, disabled }: { priceListId: string; disabled: boolean }) {
  const t = useTranslations("pricing");
  const ti = useTranslations("import");
  const tv = useTranslations("validation");
  const [sheet, setSheet] = useState<RawSheet | null>(null);
  const [mapping, setMapping] = useState<PriceImportMapping>({});
  const [analysis, setAnalysis] = useState<PriceImportAnalysis | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const errorText = (code: string) =>
    ["missing_columns", "has_errors", "nothing_to_import", "suspended"].includes(code)
      ? ti(`errors.${code as "has_errors"}`)
      : ti("errors.unknown");

  const reset = () => {
    setSheet(null);
    setAnalysis(null);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t("detail.importHint")}</p>
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}

      {!sheet ? (
        <label
          aria-disabled={disabled || pending}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-50"
        >
          <FileSpreadsheet aria-hidden className="size-4" />
          {pending ? ti("parsing") : ti("chooseFile")}
          <input
            type="file"
            accept=".csv,.xlsx"
            className="sr-only"
            disabled={disabled || pending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setMessage(null);
              startTransition(async () => {
                const result = await readSpreadsheet(file);
                if (typeof result === "string") {
                  setMessage({ tone: "error", text: ti(`fileErrors.${result}`, { max: MAX_IMPORT_ROWS }) });
                  return;
                }
                setSheet(result);
                setMapping(guessPriceMapping(result.headers));
              });
            }}
          />
        </label>
      ) : null}

      {sheet && !analysis ? (
        <div className="space-y-3">
          <div className="grid max-w-xl gap-3 sm:grid-cols-2">
            {(["sku", "price"] as const).map((field) => (
              <div key={field} className="space-y-2">
                <Label htmlFor={`price-map-${field}`}>{ti(`fields.${field}`)} *</Label>
                <Select
                  id={`price-map-${field}`}
                  value={mapping[field] ?? ""}
                  onChange={(e) => setMapping({ ...mapping, [field]: e.target.value || undefined })}
                >
                  <option value="">{ti("notMapped")}</option>
                  {sheet.headers.map((h, i) => (
                    <option key={`${h}-${i}`} value={h}>{h || `#${i + 1}`}</option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              disabled={pending || !mapping.sku || !mapping.price}
              onClick={() =>
                startTransition(async () => {
                  const result = await analyzePriceImportAction(priceListId, { sheet, mapping });
                  if (result.ok) setAnalysis(result.analysis);
                  else setMessage({ tone: "error", text: errorText(result.error) });
                })
              }
            >
              {pending ? ti("checking") : ti("checkRows")}
            </Button>
            <Button variant="ghost" onClick={reset}>{ti("startOver")}</Button>
          </div>
        </div>
      ) : null}

      {sheet && analysis ? (
        <div className="space-y-3">
          <p className="text-sm font-medium">{t("import.summary", analysis.counts)}</p>
          <ul className="space-y-1 text-sm">
            {analysis.rows
              .filter((r) => r.action === "error")
              .slice(0, 50)
              .map((r) =>
                r.action === "error" ? (
                  <li key={r.rowNumber} className="flex items-start gap-1.5 text-destructive">
                    <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    {ti("columns.row")} {r.rowNumber} ({r.sku || "—"}):{" "}
                    {r.errors
                      .map((e) =>
                        e.key === "unknown_sku" || e.key === "duplicate_sku_in_file"
                          ? t(`import.rowErrors.${e.key}`)
                          : tv(e.key),
                      )
                      .join(", ")}
                  </li>
                ) : null,
              )}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending || analysis.counts.error > 0 || analysis.counts.set === 0}
              onClick={() =>
                startTransition(async () => {
                  const result = await commitPriceImportAction(priceListId, { sheet, mapping, mode: "all" });
                  if (result.ok) {
                    setMessage({ tone: "success", text: t("import.done", result.result) });
                    reset();
                  } else setMessage({ tone: "error", text: errorText(result.error) });
                })
              }
            >
              {ti("importAll")}
            </Button>
            {analysis.counts.error > 0 && analysis.counts.set > 0 ? (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await commitPriceImportAction(priceListId, { sheet, mapping, mode: "valid_only" });
                    if (result.ok) {
                      setMessage({ tone: "success", text: t("import.done", result.result) });
                      reset();
                    } else setMessage({ tone: "error", text: errorText(result.error) });
                  })
                }
              >
                {ti("importValid", { count: analysis.counts.set })}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={reset}>{ti("startOver")}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
