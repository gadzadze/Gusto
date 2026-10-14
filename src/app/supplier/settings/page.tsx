import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { minorToInput } from "@/lib/money";
import { requireSupplier } from "@/server/auth/guards";
import { getSupplierSettings } from "@/server/domain/catalog/supplier-settings";
import { SupplierSettingsForm } from "./settings-form";

export default async function SupplierSettingsPage() {
  const t = await getTranslations("settings");
  return (
    <>
      <PageHeader title={t("title")} />
      <Suspense fallback={<Skeleton className="h-96 w-full max-w-2xl" />}>
        <Settings />
      </Suspense>
    </>
  );
}

async function Settings() {
  const ctx = await requireSupplier();
  const t = await getTranslations("products");
  const s = await getSupplierSettings(ctx);
  const readOnly = ctx.orgStatus === "suspended";
  return (
    <div className="space-y-6">
      {readOnly ? <FormAlert tone="error">{t("errors.suspended")}</FormAlert> : null}
      <SupplierSettingsForm
        disabled={readOnly}
        defaultValues={{
          contactName: s.contactName,
          phone: s.phone,
          minOrder: s.minOrderMinor > 0 ? minorToInput(s.minOrderMinor, ",") : "",
          pricesIncludeVat: s.pricesIncludeVat,
          deliveryArea: s.deliveryArea ?? "",
          deliveryTerms: s.deliveryTerms ?? "",
          orderCutoffNote: s.orderCutoffNote ?? "",
        }}
      />
    </div>
  );
}
