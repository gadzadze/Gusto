// Public URL of a stored product image variant. Product images live in a
// public bucket under unguessable paths; see server/storage/images.ts.
const WIDTHS = [400, 1200] as const;

export function productImageUrl(pathPrefix: string, width: number): string {
  const variant = WIDTHS.find((w) => width <= w) ?? WIDTHS[WIDTHS.length - 1];
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return `${base}/storage/v1/object/public/product-images/${pathPrefix}-w${variant}.webp`;
}
