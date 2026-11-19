import { Check } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SetupProgress = { products: number; priceLists: number; customers: number };

/**
 * A supplier with no orders yet sees what to do first instead of an empty box: products, a price list, a first
 * customer. Each step ticks itself off from what already exists. While the company is still being reviewed it can
 * prepare the catalog and prices, but not invite, so that step says so.
 */
export async function GetStarted({ progress, canInvite }: { progress: SetupProgress; canInvite: boolean }) {
  const t = await getTranslations("supplier.getStarted");
  const steps = [
    { key: "products", done: progress.products > 0, href: "/supplier/products/new", enabled: true },
    { key: "prices", done: progress.priceLists > 0, href: "/supplier/pricing", enabled: true },
    { key: "customers", done: progress.customers > 0, href: "/supplier/customers/new", enabled: canInvite },
  ] as const;
  const firstOpen = steps.findIndex((s) => !s.done && s.enabled);
  return (
    <section aria-labelledby="get-started" className="rounded-xl border border-border bg-surface">
      <header className="border-b border-border px-4 py-4">
        <h2 id="get-started" className="font-semibold">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("intro")}</p>
      </header>
      <ol className="divide-y divide-border">
        {steps.map((step, i) => (
          <li key={step.key} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4">
            <span
              aria-hidden
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                step.done ? "border-green-600 bg-green-600 text-white" : "border-border text-muted-foreground",
              )}
            >
              {step.done ? <Check className="size-4" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1 basis-48">
              <p className="font-semibold">
                {t(`${step.key}.title`)}
                {step.done ? <span className="ml-2 text-xs font-medium text-green-700 dark:text-green-400">{t("done")}</span> : null}
              </p>
              <p className="text-sm text-muted-foreground">{step.enabled ? t(`${step.key}.body`) : t("afterApproval")}</p>
            </div>
            {step.enabled && !step.done ? (
              <Button asChild variant={i === firstOpen ? "default" : "outline"} size="sm" className="ml-12 sm:ml-0">
                <Link href={step.href}>{t(`${step.key}.action`)}</Link>
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
