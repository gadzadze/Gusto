"use client";

import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import {
  createCategoryAction,
  moveCategoryAction,
  renameCategoryAction,
  setCategoryArchivedAction,
} from "./actions";

type Category = { id: string; name: string; isArchived: boolean; productCount: number };

export function CategoryManager({ categories }: { categories: Category[] }) {
  const t = useTranslations("admin.categories");
  const tc = useTranslations("common");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, onOk?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) return onOk?.();
      setError(
        result.error === "name_taken" || result.error === "required" || result.error === "too_long"
          ? t(`errors.${result.error}`)
          : tc("error"),
      );
    });
  };

  const active = categories.filter((c) => !c.isArchived);
  const archived = categories.filter((c) => c.isArchived);

  const renderRow = (c: Category, index: number, group: Category[]) => (
    <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
      {editing?.id === c.id ? (
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => renameCategoryAction(c.id, editing.name), () => setEditing(null));
          }}
        >
          <Input
            aria-label={t("rename")}
            value={editing.name}
            onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
            autoFocus
          />
          <Button type="submit" size="icon" variant="outline" disabled={pending} aria-label={tc("save")}>
            <Check />
          </Button>
        </form>
      ) : (
        <div className="min-w-0 flex-1">
          <span className="font-medium">{c.name}</span>{" "}
          <span className="text-sm text-muted-foreground">{t("productCount", { count: c.productCount })}</span>
          {c.isArchived ? <Badge className="ml-2">{t("archived")}</Badge> : null}
        </div>
      )}
      <div className="flex gap-1">
        {!c.isArchived ? (
          <>
            <Button size="icon" variant="ghost" aria-label={t("moveUp")} title={t("moveUp")} disabled={pending || index === 0}
              onClick={() => run(() => moveCategoryAction(c.id, "up"))}>
              <ArrowUp />
            </Button>
            <Button size="icon" variant="ghost" aria-label={t("moveDown")} title={t("moveDown")} disabled={pending || index === group.length - 1}
              onClick={() => run(() => moveCategoryAction(c.id, "down"))}>
              <ArrowDown />
            </Button>
          </>
        ) : null}
        <Button size="icon" variant="ghost" aria-label={t("rename")} title={t("rename")} disabled={pending}
          onClick={() => setEditing({ id: c.id, name: c.name })}>
          <Pencil />
        </Button>
        <Button size="icon" variant="ghost" aria-label={c.isArchived ? t("restore") : t("archive")}
          title={c.isArchived ? t("restore") : t("archive")} disabled={pending}
          onClick={() => run(() => setCategoryArchivedAction(c.id, !c.isArchived))}>
          {c.isArchived ? <ArchiveRestore /> : <Archive />}
        </Button>
      </div>
    </li>
  );

  return (
    <div className="max-w-3xl space-y-5">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createCategoryAction(newName), () => setNewName(""));
        }}
      >
        <Input aria-label={t("newPlaceholder")} placeholder={t("newPlaceholder")} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button type="submit" disabled={pending}>
          <Plus />
          {t("add")}
        </Button>
      </form>

      {active.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">{active.map(renderRow)}</ul>
      )}
      {archived.length > 0 ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface-2">{archived.map(renderRow)}</ul>
      ) : null}
    </div>
  );
}
