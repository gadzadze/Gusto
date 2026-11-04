"use client";

import { ImagePlus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { BackgroundRemover } from "@/components/catalog/background-remover";
import { ProductImage } from "@/components/catalog/product-image";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import {
  removeProductImageAction,
  uploadProductImageAction,
  type ImageUploadError,
} from "@/app/supplier/products/actions";

export function ProductImageManager({
  productId,
  name,
  imagePath,
  shared,
  disabled,
}: {
  productId: string;
  name: string;
  imagePath: string | null;
  /** The photo came from the shared library (Open Food Facts), not from this supplier. */
  shared?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("products");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // A chosen photo waits here so the supplier can clean its background before it is uploaded.
  const [staged, setStaged] = useState<File | null>(null);

  const imageErrorText = (code: ImageUploadError | "invalid" | "unknown") => {
    if (code === "empty" || code === "too_large" || code === "unsupported" || code === "upload_failed") {
      return t(`imageErrors.${code}`);
    }
    if (code === "suspended" || code === "category_unavailable" || code === "sku_taken" || code === "invalid" || (code as string) === "rate_limited") {
      return t(`errors.${code as "invalid"}`);
    }
    return t("errors.unknown");
  };

  const upload = (file: File) => {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("image", file);
      const result = await uploadProductImageAction(productId, formData);
      if (!result.ok) setError(imageErrorText(result.error));
      else setStaged(null);
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      const result = await removeProductImageAction(productId);
      if (!result.ok) setError(imageErrorText(result.error));
    });
  };

  return (
    <div className="space-y-3">
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <div className="flex items-center gap-4">
        <ProductImage path={imagePath} alt={name} size={112} className="border border-border" />
        <div className="flex flex-col gap-2">
          <label
            aria-disabled={disabled || pending}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            <ImagePlus aria-hidden className="size-4" />
            {pending ? t("form.uploading") : imagePath ? t("form.replaceImage") : t("form.chooseImage")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              disabled={disabled || pending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) setStaged(file);
              }}
            />
          </label>
          {imagePath ? (
            <Button type="button" variant="ghost" size="sm" disabled={disabled || pending} onClick={remove}>
              <Trash2 />
              {t("form.removeImage")}
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t("form.imageHint")}</p>
      {shared && imagePath ? <p className="text-sm text-muted-foreground">{t("form.sharedPhoto")}</p> : null}
      {staged ? (
        <div className="space-y-3">
          <BackgroundRemover file={staged} onUse={setStaged} disabled={disabled || pending} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" disabled={disabled || pending} onClick={() => upload(staged)}>
              {pending ? t("form.uploading") : t("form.uploadChosen", { name: staged.name })}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setStaged(null)}>
              {t("form.cancelChosen")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
