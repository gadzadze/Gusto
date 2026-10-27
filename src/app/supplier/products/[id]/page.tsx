import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell/page-header";
import { ProductActiveToggle } from "@/components/catalog/product-active-toggle";
import { ProductForm } from "@/components/catalog/product-form";
import { ProductImageManager } from "@/components/catalog/product-image-manager";
import { ProductStatusBadge } from "@/components/catalog/product-status-badge";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { minorToInput } from "@/lib/money";
import { milliToInput } from "@/lib/quantity";
import type { ProductInput } from "@/lib/validation/product";
import { requireSupplier } from "@/server/auth/guards";
import { listActiveCategories } from "@/server/domain/catalog/categories";
import { getSupplierProduct } from "@/server/domain/catalog/products";
import { getSupplierSettings } from "@/server/domain/catalog/supplier-settings";
import { NotFoundError } from "@/server/domain/errors";
import { notFound } from "next/navigation";

export default async function EditProductPage(props: PageProps<"/supplier/products/[id]">) {
  const t = await getTranslations("products");
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3 text-muted-foreground">
        <Link href="/supplier/products">
          <ArrowLeft />
          {t("title")}
        </Link>
      </Button>
      <Suspense fallback={<Skeleton className="h-96 w-full max-w-3xl" />}>
        <EditProduct {...props} />
      </Suspense>
    </>
  );
}

const IMAGE_ERRORS = new Set(["empty", "too_large", "unsupported", "upload_failed"]);

async function EditProduct({ params, searchParams }: PageProps<"/supplier/products/[id]">) {
  const ctx = await requireSupplier();
  const t = await getTranslations("products");
  const { id } = await params;
  const query = await searchParams;

  const product = await getSupplierProduct(ctx, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const [activeCategories, settings] = await Promise.all([listActiveCategories(), getSupplierSettings(ctx)]);
  // Keep an archived category selectable for the product that already has it.
  const categories = activeCategories.some((c) => c.id === product.categoryId)
    ? activeCategories
    : [...activeCategories, { id: product.categoryId, name: "-" }];
  const readOnly = ctx.orgStatus === "suspended";

  const defaults: ProductInput = {
    name: product.name,
    description: product.description ?? "",
    brand: product.brand ?? "",
    sku: product.sku ?? "",
    categoryId: product.categoryId,
    unit: product.unit,
    packDescription: product.packDescription ?? "",
    // Georgian writes decimals with a comma; the parsers accept both.
    basePrice: minorToInput(product.basePriceMinor, ","),
    vatRate: String(product.vatRateBp / 100).replace(".", ","),
    minQty: milliToInput(product.minQtyMilli, ","),
    qtyStep: milliToInput(product.qtyStepMilli, ","),
  };
  const imageError = typeof query.image === "string" && IMAGE_ERRORS.has(query.image) ? query.image : null;

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader title={product.name} actions={<ProductStatusBadge isActive={product.isActive} />} />
      {query.created ? <FormAlert tone="success">{t("form.created")}</FormAlert> : null}
      {imageError ? (
        <FormAlert tone="error">
          {t("form.imageSaveFailed", {
            reason: t(`imageErrors.${imageError as "empty" | "too_large" | "unsupported" | "upload_failed"}`),
          })}
        </FormAlert>
      ) : null}
      {readOnly ? <FormAlert tone="error">{t("suspendedReadOnly")}</FormAlert> : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("form.sectionImage")}</h2>
        <ProductImageManager productId={product.id} name={product.name} imagePath={product.imagePath} disabled={readOnly} />
      </section>

      <ProductForm
        key={product.updatedAt.toISOString()}
        mode="edit"
        productId={product.id}
        defaultValues={defaults}
        categories={categories}
        pricesIncludeVat={settings.pricesIncludeVat}
        disabled={readOnly}
      />

      <section className="border-t border-border pt-6">
        <ProductActiveToggle productId={product.id} isActive={product.isActive} disabled={readOnly} />
      </section>
    </div>
  );
}
