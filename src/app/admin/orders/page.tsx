import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/server/auth/guards";

/** "GST-1001", "gst 1001" or "1001" → 1001, else null. */
function parseOrderNumber(input: string): number | null {
  const m = /^\s*(?:gst[-\s]?)?(\d{1,12})\s*$/i.exec(input);
  return m ? Number.parseInt(m[1], 10) : null;
}

export default async function AdminOrderLookupPage({ searchParams }: PageProps<"/admin/orders">) {
  const t = await getTranslations("admin.orders");
  return (
    <>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-40 w-full max-w-xl" />}>
        <Lookup searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Lookup({ searchParams }: Pick<PageProps<"/admin/orders">, "searchParams">) {
  await requireAdmin();
  const t = await getTranslations("admin.orders");
  const params = await searchParams;
  const raw = typeof params.number === "string" ? params.number : "";
  let invalid = false;
  if (raw) {
    const n = parseOrderNumber(raw);
    if (n) redirect(`/admin/orders/${n}`);
    invalid = true;
  }
  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      {invalid ? <FormAlert tone="error">{t("invalid")}</FormAlert> : null}
      <form className="flex items-end gap-2" role="search">
        <div className="flex-1 space-y-2">
          <Label htmlFor="number">{t("label")}</Label>
          <Input id="number" name="number" defaultValue={raw} placeholder={t("placeholder")} autoComplete="off" />
        </div>
        <Button type="submit">{t("find")}</Button>
      </form>
    </div>
  );
}
