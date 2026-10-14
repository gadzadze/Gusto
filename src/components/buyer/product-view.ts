import "server-only";
import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/money";
import { formatQuantityNumber } from "@/lib/quantity";
import type { BuyerProduct } from "@/server/domain/buyer/catalog";

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
): Promise<ProductView[]> {
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
      price: formatMoney(p.priceMinor, supplier.currency),
      unit,
      hints: [
        p.minQtyMilli !== 1000 ? t("minQty", { qty: formatQuantityNumber(p.minQtyMilli), unit }) : null,
        p.qtyStepMilli !== 1000 ? t("step", { qty: formatQuantityNumber(p.qtyStepMilli), unit }) : null,
      ].filter((h): h is string => h !== null),
      vatNote: `${supplier.pricesIncludeVat ? t("vatIncluded") : t("vatExcluded")} · ${t("vatRate", { rate: formatQuantityNumber(p.vatRateBp * 10) })}`,
    };
  });
}
