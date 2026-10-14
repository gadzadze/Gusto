"use client";

import { ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { describedBy, Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PRODUCT_UNITS } from "@/lib/catalog/units";
import { zodFormResolver } from "@/lib/validation/form-resolver";
import { productSchema, type ProductInput } from "@/lib/validation/product";
import {
  createProductAction,
  updateProductAction,
  uploadProductImageAction,
} from "@/app/supplier/products/actions";

type Category = { id: string; name: string };

const resolver = zodFormResolver<ProductInput>(productSchema);

export function ProductForm({
  mode,
  productId,
  defaultValues,
  categories,
  pricesIncludeVat,
  disabled,
}: {
  mode: "create" | "edit";
  productId?: string;
  defaultValues: ProductInput;
  categories: Category[];
  pricesIncludeVat: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const tu = useTranslations("unitNames");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ProductInput>({ resolver, defaultValues });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    setSaved(false);
    startTransition(async () => {
      const result =
        mode === "create" ? await createProductAction(values) : await updateProductAction(productId!, values);
      if (!result.ok) {
        setFormError(t(`errors.${result.error}`));
        for (const [field, key] of Object.entries(result.fieldErrors ?? {}) as [string, string][]) {
          setError(field as keyof ProductInput, { type: "server", message: key });
        }
        return;
      }
      if (!("productId" in result) || typeof result.productId !== "string") {
        setSaved(true);
        return;
      }
      const newId = result.productId;
      let imageNote = "";
      if (image) {
        const formData = new FormData();
        formData.set("image", image);
        const upload = await uploadProductImageAction(newId, formData);
        if (!upload.ok) imageNote = `&image=${encodeURIComponent(upload.error)}`;
      }
      router.push(`/supplier/products/${newId}?created=1${imageNote}`);
    });
  });

  const err = (name: keyof ProductInput) => errors[name]?.message;
  const input = (name: keyof ProductInput, hint?: string) => ({
    id: name,
    disabled,
    "aria-invalid": err(name) ? true : undefined,
    "aria-describedby": describedBy(name, err(name), hint),
    ...register(name),
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8">
      {formError ? <FormAlert tone="error">{formError}</FormAlert> : null}
      {saved ? <FormAlert tone="success">{tc("saved")}</FormAlert> : null}

      <section className="space-y-5">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("form.sectionBasics")}</h2>
        <Field id="name" label={t("form.name")} error={err("name")}>
          <Input {...input("name")} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="categoryId" label={t("form.category")} error={err("categoryId")}>
            <Select {...input("categoryId")}>
              <option value="">{t("form.categoryPlaceholder")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="brand" label={t("form.brand")} error={err("brand")} optional>
            <Input {...input("brand")} />
          </Field>
          <Field id="sku" label={t("form.sku")} hint={t("form.skuHint")} error={err("sku")} optional>
            <Input autoComplete="off" {...input("sku", t("form.skuHint"))} />
          </Field>
          <Field id="packDescription" label={t("form.packDescription")} hint={t("form.packHint")} error={err("packDescription")} optional>
            <Input {...input("packDescription", t("form.packHint"))} />
          </Field>
        </div>
        <Field id="description" label={t("form.description")} error={err("description")} optional>
          <Textarea rows={3} {...input("description")} />
        </Field>
      </section>

      <section className="space-y-5">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("form.sectionPricing")}</h2>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field id="unit" label={t("form.unit")} error={err("unit")}>
            <Select {...input("unit")}>
              {PRODUCT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {tu(u)}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="basePrice"
            label={t("form.basePrice")}
            hint={pricesIncludeVat ? t("form.pricesIncludeVat") : t("form.pricesExcludeVat")}
            error={err("basePrice")}
          >
            <Input inputMode="decimal" {...input("basePrice")} />
          </Field>
          <Field id="vatRate" label={t("form.vatRate")} error={err("vatRate")}>
            <Input inputMode="decimal" {...input("vatRate")} />
          </Field>
          <Field id="minQty" label={t("form.minQty")} error={err("minQty")}>
            <Input inputMode="decimal" {...input("minQty")} />
          </Field>
          <Field id="qtyStep" label={t("form.qtyStep")} hint={t("form.qtyStepHint")} error={err("qtyStep")}>
            <Input inputMode="decimal" {...input("qtyStep", t("form.qtyStepHint"))} />
          </Field>
        </div>
      </section>

      {mode === "create" ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">{t("form.sectionImage")}</h2>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-dashed border-border px-4 py-3 text-sm hover:bg-muted">
            <ImagePlus aria-hidden className="size-4 text-muted-foreground" />
            <span>{image ? image.name : t("form.chooseImage")}</span>
            <input
              type="file"
              name="image"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={disabled}
              onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            />
          </label>
          <p className="text-sm text-muted-foreground">{t("form.imageHint")}</p>
        </section>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending || disabled}>
          {pending ? tc("saving") : mode === "create" ? t("form.create") : t("form.save")}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/supplier/products")}>
          {tc("cancel")}
        </Button>
      </div>
    </form>
  );
}
