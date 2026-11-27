import { Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { VoiceLauncher } from "@/components/buyer/voice/voice-launcher";
import type { VoiceSupplier } from "@/components/buyer/voice/voice-assistant";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** GET form to /buyer/search; works without JavaScript. */
/** `voiceSuppliers` is given only when voice ordering is available to this buyer; it adds the mic at the end of the field. */
export async function BuyerSearchForm({ defaultValue = "", voiceSuppliers }: { defaultValue?: string; voiceSuppliers?: VoiceSupplier[] }) {
  const t = await getTranslations("buyer");
  const tc = await getTranslations("common");
  return (
    <form method="get" action="/buyer/search" role="search" className="relative">
      <label htmlFor="buyer-q" className="sr-only">{tc("search")}</label>
      <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
      <Input
        id="buyer-q"
        name="q"
        type="search"
        enterKeyHint="search"
        defaultValue={defaultValue}
        placeholder={t("searchPlaceholder")}
        className={cn("h-12 rounded-full pl-12", voiceSuppliers ? "pr-12" : "pr-4")}
      />
      {voiceSuppliers ? <VoiceLauncher variant="field" suppliers={voiceSuppliers} /> : null}
    </form>
  );
}
