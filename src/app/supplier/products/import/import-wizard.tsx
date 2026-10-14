"use client";

import { CircleAlert, CircleCheck, Download, FileSpreadsheet, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  guessMapping,
  IMPORT_FIELDS,
  MAX_IMPORT_ROWS,
  missingRequiredFields,
  REQUIRED_IMPORT_FIELDS,
  type ImportMapping,
  type RawSheet,
} from "@/lib/catalog/import";
import { NEW_PRODUCT_DEFAULTS } from "@/lib/validation/product";
import type { ImportAnalysis, ImportCommitResult } from "@/server/domain/catalog/import";
import { analyzeImportAction, commitImportAction } from "./actions";
import { readSpreadsheet } from "./read-sheet";

type Step =
  | { kind: "file" }
  | { kind: "mapping"; fileName: string; sheet: RawSheet; mapping: ImportMapping }
  | { kind: "preview"; fileName: string; sheet: RawSheet; mapping: ImportMapping; analysis: ImportAnalysis }
  | { kind: "done"; result: ImportCommitResult };

const PREVIEW_LIMIT = 200;

export function ImportWizard({ savedMapping }: { savedMapping: ImportMapping | null }) {
  const t = useTranslations("import");
  const tv = useTranslations("validation");
  const [step, setStep] = useState<Step>({ kind: "file" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const actionErrorText = (code: string) =>
    ["missing_columns", "has_errors", "nothing_to_import", "suspended"].includes(code)
      ? t(`errors.${code as "missing_columns" | "has_errors" | "nothing_to_import" | "suspended"}`)
      : t("errors.unknown");

  const onFile = (file: File) => {
    setError(null);
    startTransition(async () => {
      const result = await readSpreadsheet(file);
      if (typeof result === "string") {
        setError(t(`fileErrors.${result}`, { max: MAX_IMPORT_ROWS }));
        return;
      }
      setStep({ kind: "mapping", fileName: file.name, sheet: result, mapping: guessMapping(result.headers, savedMapping) });
    });
  };

  const analyze = (s: Extract<Step, { kind: "mapping" | "preview" }>) => {
    setError(null);
    startTransition(async () => {
      const result = await analyzeImportAction({ sheet: s.sheet, mapping: s.mapping });
      if (!result.ok) return setError(actionErrorText(result.error));
      setStep({ kind: "preview", fileName: s.fileName, sheet: s.sheet, mapping: s.mapping, analysis: result.analysis });
    });
  };

  const commit = (s: Extract<Step, { kind: "preview" }>, mode: "all" | "valid_only") => {
    setError(null);
    startTransition(async () => {
      const result = await commitImportAction({ sheet: s.sheet, mapping: s.mapping, mode });
      if (!result.ok) return setError(actionErrorText(result.error));
      setStep({ kind: "done", result: result.result });
    });
  };

  const rowErrorText = (key: string) =>
    key === "invalid_unit" || key === "unknown_category" || key === "duplicate_sku_in_file"
      ? t(`rowErrors.${key}`)
      : tv(key as "required");

  return (
    <div className="max-w-4xl space-y-6">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      {step.kind === "file" ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("intro")}</p>
          <div className="flex flex-wrap gap-3">
            <label
              aria-disabled={pending}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 aria-disabled:opacity-50"
            >
              <FileSpreadsheet aria-hidden className="size-4" />
              {pending ? t("parsing") : t("chooseFile")}
              <input
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                disabled={pending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) onFile(file);
                }}
              />
            </label>
            <Button asChild variant="outline">
              <a href="/templates/gusto-products.csv" download>
                <Download />
                {t("template")}
              </a>
            </Button>
          </div>
        </div>
      ) : null}

      {step.kind === "mapping" ? (
        <div className="space-y-5">
          <p className="text-sm">
            <span className="font-medium">{step.fileName}</span>{" "}
            <span className="text-muted-foreground">· {t("rowsFound", { count: step.sheet.rows.length })}</span>
          </p>
          <p className="text-sm text-muted-foreground">{t("mappingIntro")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {IMPORT_FIELDS.map((field) => (
              <div key={field} className="space-y-2">
                <Label htmlFor={`map-${field}`}>
                  {t(`fields.${field}`)}
                  {REQUIRED_IMPORT_FIELDS.includes(field) ? " *" : ""}
                </Label>
                <Select
                  id={`map-${field}`}
                  value={step.mapping[field] ?? ""}
                  onChange={(e) =>
                    setStep({ ...step, mapping: { ...step.mapping, [field]: e.target.value || undefined } })
                  }
                >
                  <option value="">{t("notMapped")}</option>
                  {step.sheet.headers.map((h, i) => (
                    <option key={`${h}-${i}`} value={h}>
                      {h || `#${i + 1}`}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {t("defaultsNote", { vat: NEW_PRODUCT_DEFAULTS.vatRate })}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={pending || missingRequiredFields(step.mapping).length > 0} onClick={() => analyze(step)}>
              {pending ? t("checking") : t("checkRows")}
            </Button>
            <Button variant="outline" onClick={() => setStep({ kind: "file" })}>
              {t("startOver")}
            </Button>
          </div>
        </div>
      ) : null}

      {step.kind === "preview" ? (
        <div className="space-y-5">
          <p className="text-sm font-medium">
            {t("summary", {
              create: step.analysis.counts.create,
              update: step.analysis.counts.update,
              error: step.analysis.counts.error,
            })}
          </p>
          {step.analysis.counts.error > 0 ? <FormAlert tone="error">{t("hasErrorsNote")}</FormAlert> : null}
          <Table>
            <THead>
              <TR>
                <TH className="w-16">{t("columns.row")}</TH>
                <TH>{t("columns.product")}</TH>
                <TH>{t("columns.result")}</TH>
              </TR>
            </THead>
            <TBody>
              {/* Errors first: they are what needs attention. */}
              {[...step.analysis.rows]
                .sort((a, b) => Number(b.action === "error") - Number(a.action === "error") || a.rowNumber - b.rowNumber)
                .slice(0, PREVIEW_LIMIT)
                .map((row) => (
                  <TR key={row.rowNumber}>
                    <TD className="tabular-nums text-muted-foreground">{row.rowNumber}</TD>
                    <TD>{row.name || "—"}</TD>
                    <TD>
                      {row.action === "error" ? (
                        <span className="flex flex-col gap-1">
                          {row.errors.map((e) => (
                            <span key={e.field} className="flex items-center gap-1.5 text-destructive">
                              <CircleAlert aria-hidden className="size-3.5 shrink-0" />
                              {t(`fields.${e.field}`)}: {rowErrorText(e.key)}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <Badge tone={row.action === "create" ? "green" : "blue"}>
                          {row.action === "create" ? <CircleCheck aria-hidden /> : <RefreshCw aria-hidden />}
                          {t(`action.${row.action}`)}
                        </Badge>
                      )}
                    </TD>
                  </TR>
                ))}
            </TBody>
          </Table>
          <div className="flex flex-wrap gap-3">
            <Button disabled={pending || step.analysis.counts.error > 0} onClick={() => commit(step, "all")}>
              {pending ? t("importing") : t("importAll")}
            </Button>
            {step.analysis.counts.error > 0 && step.analysis.counts.create + step.analysis.counts.update > 0 ? (
              <Button variant="outline" disabled={pending} onClick={() => commit(step, "valid_only")}>
                {t("importValid", { count: step.analysis.counts.create + step.analysis.counts.update })}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setStep({ kind: "mapping", fileName: step.fileName, sheet: step.sheet, mapping: step.mapping })}>
              {t("stepMapping")}
            </Button>
          </div>
        </div>
      ) : null}

      {step.kind === "done" ? (
        <div className="space-y-4">
          <FormAlert tone="success">
            {t("doneTitle")}. {t("doneBody", step.result)}
          </FormAlert>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/supplier/products">{t("toProducts")}</Link>
            </Button>
            <Button variant="outline" onClick={() => setStep({ kind: "file" })}>
              {t("another")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
