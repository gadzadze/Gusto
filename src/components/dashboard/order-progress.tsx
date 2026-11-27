import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";

/** Sent / Confirmed / Delivered as three segments. `step` = how many are reached (1 to 3). */
export async function OrderProgress({ step }: { step: 1 | 2 | 3 }) {
  const t = await getTranslations("buyer.home");
  const labels = [t("stepSent"), t("stepConfirmed"), t("stepDelivered")];
  return (
    <ol className="mt-2.5 grid grid-cols-3 gap-1" aria-label={labels[step - 1]}>
      {labels.map((label, i) => (
        <li key={label} className="space-y-1">
          <span className={cn("block h-1 rounded-full", i < step ? "bg-brand" : "bg-border")} aria-hidden />
          <span className={cn("block text-xs", i === step - 1 ? "font-medium text-foreground" : "text-muted-foreground", i === 1 && "text-center", i === 2 && "text-right")}>
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The same three steps as a slim bar with no labels (the status word is shown next to it); the current step is its accessible name. */
export async function OrderSteps({ step }: { step: 1 | 2 | 3 }) {
  const t = await getTranslations("buyer.home");
  const labels = [t("stepSent"), t("stepConfirmed"), t("stepDelivered")];
  return (
    <ol className="mt-1 grid grid-cols-3 gap-1" aria-label={labels[step - 1]}>
      {labels.map((label, i) => (
        <li key={label} aria-hidden className={cn("h-1 rounded-full", i < step ? "bg-brand" : "bg-border")} />
      ))}
    </ol>
  );
}
