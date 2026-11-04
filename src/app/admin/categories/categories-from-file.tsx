"use client";

import { FileSpreadsheet, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { buildCategoryLookup, normalizeCategoryKey, standardCategoryFor } from "@/lib/catalog/categories-standard";
import { categoryNamesInSheet, MAX_CATEGORIES_FROM_FILE, MAX_IMPORT_ROWS, type RawSheet } from "@/lib/catalog/import";
import { readSpreadsheet } from "@/lib/catalog/read-sheet";
import { createCategoriesFromFileAction } from "./actions";

/**
 * Reads a supplier's product file and creates the categories it uses that Gusto
 * does not have yet, so the import that follows has nothing to reject. The file
 * is read in the browser; only the category names are sent.
 */
export function CategoriesFromFile({ existingNames }: { existingNames: string[] }) {
  const t = useTranslations("admin.categories.fromFile");
  const [sheet, setSheet] = useState<RawSheet | null>(null);
  const [column, setColumn] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const found = sheet ? categoryNamesInSheet(sheet, column) : null;
  // A name Gusto already recognises (its own, or a standard alias of a category it has) is not missing.
  const lookup = buildCategoryLookup(existingNames.map((name) => ({ id: name, name })));
  const unknown = found ? found.names.filter((n) => !lookup.has(normalizeCategoryKey(n))) : [];
  // What would be created: the standard Georgian name where the file's spelling is a known alias.
  const toCreate = new Map<string, { target: string; from: string }>();
  for (const from of unknown) {
    const target = standardCategoryFor(from) ?? from;
    if (!toCreate.has(normalizeCategoryKey(target))) toCreate.set(normalizeCategoryKey(target), { target, from });
  }
  const missing = [...toCreate.values()];
  const known = found ? found.names.length - unknown.length : 0;
  const tooMany = missing.length > MAX_CATEGORIES_FROM_FILE;

  const onFile = (file: File) => {
    setMessage(null);
    setColumn(undefined);
    startTransition(async () => {
      const result = await readSpreadsheet(file);
      if (typeof result === "string") {
        setSheet(null);
        setMessage({ tone: "error", text: t(`fileErrors.${result}`, { max: MAX_IMPORT_ROWS }) });
      } else setSheet(result);
    });
  };

  const create = () =>
    startTransition(async () => {
      const result = await createCategoriesFromFileAction(missing.map((m) => m.from));
      if (result.ok) {
        setSheet(null);
        setMessage({ tone: "success", text: t("done", { created: result.created.length, existing: result.existing.length }) });
      } else setMessage({ tone: "error", text: t("failed") });
    });

  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <h2 className="font-semibold">{t("title")}</h2>
      <p className="text-sm text-muted-foreground">{t("hint")}</p>
      {message ? <FormAlert tone={message.tone}>{message.text}</FormAlert> : null}
      <label
        aria-disabled={pending}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        <FileSpreadsheet aria-hidden className="size-4" />
        {t("choose")}
        <input
          type="file"
          accept=".csv,.xlsx"
          className="sr-only"
          disabled={pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onFile(file);
          }}
        />
      </label>

      {sheet && !found ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("noColumn")}</p>
          <Label htmlFor="cat-column">{t("pickColumn")}</Label>
          <Select id="cat-column" value={column ?? ""} onChange={(e) => setColumn(e.target.value || undefined)}>
            <option value="">-</option>
            {sheet.headers.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </Select>
        </div>
      ) : null}

      {found ? (
        <div className="space-y-3">
          {missing.length === 0 ? (
            <p className="text-sm">{t("nothingNew", { count: found.names.length })}</p>
          ) : (
            <>
              <p className="text-sm font-medium">{t("willCreate", { count: missing.length })}</p>
              <ul className="flex flex-wrap gap-2">
                {missing.map((m) => (
                  <li key={m.target} className="rounded-full border border-border bg-brand-soft px-3 py-1 text-sm">
                    {m.from === m.target ? m.target : `${m.from} → ${m.target}`}
                  </li>
                ))}
              </ul>
              {known > 0 ? <p className="text-sm text-muted-foreground">{t("alreadyThere", { count: known })}</p> : null}
              {tooMany ? <FormAlert tone="error">{t("tooMany", { max: MAX_CATEGORIES_FROM_FILE })}</FormAlert> : null}
              <Button type="button" disabled={pending || tooMany} onClick={create}>
                <Plus />
                {t("create", { count: missing.length })}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
