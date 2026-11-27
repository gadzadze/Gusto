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
      {/* The icon is the submit button: a visible submit for virtual keyboards without a second control beside the field. */}
      <button type="submit" aria-label={tc("search")} className="absolute left-0.5 top-0.5 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-5">
        <Search aria-hidden />
      </button>
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
