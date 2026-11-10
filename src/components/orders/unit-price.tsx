import { formatBp } from "@/lib/pricing/conditions";

/**
 * A unit price. When conditions (payment terms, a quantity tier) changed it, the list price is shown struck
 * through with the change next to the price that applies. Strings arrive formatted from the server.
 */
export function UnitPrice({ price, listPrice, adjustBp }: { price: string; listPrice?: string | null; adjustBp: number }) {
  if (!adjustBp || !listPrice) return <>{price}</>;
  return (
    <span className="inline-flex flex-wrap items-baseline justify-end gap-x-1.5">
      <span className="text-xs text-muted-foreground line-through">{listPrice}</span>
      <span>{price}</span>
      <span className="text-xs font-medium text-brand">{formatBp(adjustBp)}</span>
    </span>
  );
}

