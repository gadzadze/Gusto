import "server-only";
import { getTranslations } from "next-intl/server";
import type { BuyerProduct } from "@/server/domain/buyer/catalog";
import { getFormats } from "@/server/i18n/formats";

// Display strings for a buyer product card, built on the server. Money and
// number formatting stays server-side so every browser shows the same
// Georgian format and hydration never disagrees.

export type ProductView = {
  id: string;
  supplierOrgId: string;
  minQtyMilli: number;
  qtyStepMilli: number;
  /** Already in the buyer's cart (0 = not in cart). */
  cartQtyMilli: number;
  name: string;
  description: string | null;
  brand: string | null;
  sku: string | null;
  packDescription: string | null;
  imagePath: string | null;
  price: string;
  unit: string;
  hints: string[];
  vatNote: string;
};

export async function toProductViews(
  products: BuyerProduct[],
  supplier: { id: string; currency: string; pricesIncludeVat: boolean },
  cart: ReadonlyMap<string, number> = new Map(),
  /** Quantity discounts per product, already formatted ("from 10 kg: -5%"). */
  extraHints: ReadonlyMap<string, string[]> = new Map(),
): Promise<ProductView[]> {
  const fmt = await getFormats();
  const t = await getTranslations("buyer");
  const tu = await getTranslations("units");
  return products.map((p) => {
    const unit = tu(p.unit);
    return {
      id: p.id,
      supplierOrgId: supplier.id,
      minQtyMilli: p.minQtyMilli,
      qtyStepMilli: p.qtyStepMilli,
      cartQtyMilli: cart.get(p.id) ?? 0,
      name: p.name,
      description: p.description,
      brand: p.brand,
      sku: p.sku,
      packDescription: p.packDescription,
      imagePath: p.imagePath,
      price: fmt.money(p.priceMinor, supplier.currency),
      unit,
      hints: [
        p.minQtyMilli !== 1000 ? t("minQty", { qty: fmt.qty(p.minQtyMilli), unit }) : null,
        p.qtyStepMilli !== 1000 ? t("step", { qty: fmt.qty(p.qtyStepMilli), unit }) : null,
      ]
        .filter((h): h is string => h !== null)
        .concat(extraHints.get(p.id) ?? []),
      vatNote: `${supplier.pricesIncludeVat ? t("vatIncluded") : t("vatExcluded")} · ${t("vatRate", { rate: fmt.qty(p.vatRateBp * 10) })}`,
    };
  });
}
