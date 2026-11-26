import { Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { VoiceLauncher } from "@/components/buyer/voice/voice-launcher";
import type { VoiceSupplier } from "@/components/buyer/voice/voice-assistant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** GET form to /buyer/search; works without JavaScript. */
/** `voiceSuppliers` is given only when voice ordering is available to this buyer; it adds the mic at the end of the field. */
export async function BuyerSearchForm({ defaultValue = "", voiceSuppliers }: { defaultValue?: string; voiceSuppliers?: VoiceSupplier[] }) {
  const t = await getTranslations("buyer");
  const tc = await getTranslations("common");
  return (
    <form method="get" action="/buyer/search" role="search" className="flex gap-2">
      <label htmlFor="buyer-q" className="sr-only">{tc("search")}</label>
      <div className="relative min-w-0 flex-1">
        <Input id="buyer-q" name="q" type="search" defaultValue={defaultValue} placeholder={t("searchPlaceholder")} className={voiceSuppliers ? "pr-12" : undefined} />
        {voiceSuppliers ? <VoiceLauncher variant="field" suppliers={voiceSuppliers} /> : null}
      </div>
      <Button type="submit" variant="outline" aria-label={tc("search")}>
        <Search />
        <span className="hidden sm:inline">{tc("search")}</span>
      </Button>
    </form>
  );
}
