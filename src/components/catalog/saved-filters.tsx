"use client";

import { Bookmark, X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { deleteSavedFilterAction, saveProductFilterAction } from "@/app/supplier/products/actions";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SavedView = { id: string; name: string; href: string; active: boolean };

/**
 * The supplier's saved views of the product list: one tap applies a view (it is an ordinary link, so back, reload
 * and sharing the URL keep working), a cross removes it, and "save this view" names the filters now applied.
 */
export function SavedFilters({ views, currentQuery, canSave }: { views: SavedView[]; currentQuery: string; canSave: boolean }) {
  const t = useTranslations("products.saved");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<"name_required" | "nothing_to_save" | "too_many" | "name_taken" | "unknown" | null>(null);
  const [pending, startTransition] = useTransition();

  if (views.length === 0 && !canSave) return null;

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await saveProductFilterAction(name, currentQuery);
      if (result.ok) {
        setNaming(false);
        setName("");
      } else {
        setError(result.error === "name_required" || result.error === "nothing_to_save" || result.error === "too_many" || result.error === "name_taken" ? result.error : "unknown");
      }
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {views.length > 0 ? <span className="text-sm text-muted-foreground">{t("title")}</span> : null}
        {views.map((v) => (
          <span
            key={v.id}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border text-sm md:min-h-9",
              v.active ? "border-brand bg-brand-soft text-brand" : "border-border",
            )}
          >
            <Link href={v.href} aria-current={v.active ? "true" : undefined} className="flex min-h-11 items-center pl-3 pr-1 hover:underline md:min-h-9">
              {v.name}
            </Link>
            <button
              type="button"
              disabled={pending}
              aria-label={t("remove", { name: v.name })}
              title={t("removeShort")}
              className="flex size-11 items-center justify-center rounded-full hover:bg-muted md:size-9"
              onClick={() => startTransition(async () => { await deleteSavedFilterAction(v.id); })}
            >
              <X className="size-4" aria-hidden />
            </button>
          </span>
        ))}
        {canSave && !naming ? (
          <Button type="button" variant="outline" size="sm" onClick={() => { setError(null); setNaming(true); }}>
            <Bookmark />
            {t("save")}
          </Button>
        ) : null}
      </div>
      {canSave && naming ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="sr-only" htmlFor="saved-filter-name">{t("nameLabel")}</label>
          <Input id="saved-filter-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t("namePlaceholder")} autoFocus className="min-w-0 flex-1 sm:max-w-xs" />
          <Button type="submit" disabled={pending || !name.trim()}>{t("saveConfirm")}</Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setNaming(false)}>{t("cancel")}</Button>
        </form>
      ) : null}
      {error ? (
        <FormAlert tone="error">
          {error === "name_required" ? t("errors.name_required")
            : error === "nothing_to_save" ? t("errors.nothing_to_save")
            : error === "too_many" ? t("errors.too_many")
            : error === "name_taken" ? t("errors.name_taken")
            : t("errors.unknown")}
        </FormAlert>
      ) : null}
    </div>
  );
}
