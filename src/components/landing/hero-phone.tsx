import { Check, ShoppingCart } from "lucide-react";
import { getTranslations } from "next-intl/server";

/**
 * A looping, pure-CSS walk through one order: pick, cart, send, confirmed.
 * Illustrative (the page says so); the numbers match a real demo order.
 * Reduced motion shows the first scene still. Decorative: hidden from screen readers.
 */
export async function HeroPhone() {
  const t = await getTranslations("landing.demo");
  return (
    <div aria-hidden className="relative mx-auto h-[540px] w-[270px] rounded-[2.75rem] border-[10px] border-[#0b0b0c] bg-background shadow-[0_30px_80px_-20px_rgba(11,11,12,0.45)] sm:h-[600px] sm:w-[300px]">
      <div className="absolute left-1/2 top-2 h-5 w-24 -translate-x-1/2 rounded-full bg-[#0b0b0c]" />

      {/* 1. The catalog, at this buyer's prices */}
      <div className="scene scene-first absolute inset-0 flex flex-col gap-3 px-4 text-left pb-4 pt-12" style={{ animationDelay: "0s" }}>
        <p className="text-xs text-muted-foreground">{t("supplier")}</p>
        <p className="text-lg font-semibold leading-tight">{t("catalog")}</p>
        {[
          { n: t("cheese"), p: "16,65 ₾ / " + t("kg") },
          { n: t("eggs"), p: "6,40 ₾ / " + t("pack") },
          { n: t("tomato"), p: "3,20 ₾ / " + t("kg") },
        ].map((row, i) => (
          <div key={row.n} className="flex items-center justify-between rounded-2xl border border-border p-3">
            <div>
              <p className="text-sm font-medium">{row.n}</p>
              <p className="text-xs text-muted-foreground">{row.p}</p>
            </div>
            <span className={i < 2 ? "tap flex size-8 items-center justify-center rounded-full bg-foreground text-background" : "flex size-8 items-center justify-center rounded-full border border-border"} style={i === 0 ? { animationDelay: "1.2s" } : i === 1 ? { animationDelay: "1.8s" } : undefined}>
              +
            </span>
          </div>
        ))}
        <p className="mt-auto text-center text-xs text-brand">{t("ownPrices")}</p>
      </div>

      {/* 2. The cart */}
      <div className="scene absolute inset-0 flex flex-col gap-3 px-4 text-left pb-4 pt-12" style={{ animationDelay: "3s" }}>
        <p className="flex items-center gap-2 text-lg font-semibold"><ShoppingCart className="size-5" />{t("cart")}</p>
        <div className="flex justify-between rounded-2xl border border-border p-3 text-sm"><span>{t("cheese")} · 3 {t("kg")}</span><span className="tabular-nums">49,95 ₾</span></div>
        <div className="flex justify-between rounded-2xl border border-border p-3 text-sm"><span>{t("eggs")} · 6 {t("pack")}</span><span className="tabular-nums">38,40 ₾</span></div>
        <div className="mt-2 flex justify-between px-1 text-sm font-semibold"><span>{t("total")}</span><span className="tabular-nums">88,35 ₾</span></div>
        <span className="tap mt-auto rounded-xl bg-foreground py-3 text-center text-sm font-medium text-background" style={{ animationDelay: "4.6s" }}>{t("send")}</span>
      </div>

      {/* 3. Sent */}
      <div className="scene absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ animationDelay: "6s" }}>
        <span className="flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand"><Check className="size-7" /></span>
        <p className="text-lg font-semibold">{t("sent")}</p>
        <p className="text-xs text-muted-foreground">{t("sentHint")}</p>
      </div>

      {/* 4. Confirmed by the supplier */}
      <div className="scene absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center" style={{ animationDelay: "9s" }}>
        <span className="flex size-14 items-center justify-center rounded-full bg-[#dcfce7] text-[#14532d]"><Check className="size-7" /></span>
        <p className="text-lg font-semibold">{t("confirmed")}</p>
        <p className="text-xs text-muted-foreground">{t("confirmedHint")}</p>
      </div>
    </div>
  );
}
