import { Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** GET form to /buyer/search; works without JavaScript. */
export async function BuyerSearchForm({ defaultValue = "" }: { defaultValue?: string }) {
  const t = await getTranslations("buyer");
  const tc = await getTranslations("common");
  return (
    <form method="get" action="/buyer/search" role="search" className="flex gap-2">
      <label htmlFor="buyer-q" className="sr-only">{tc("search")}</label>
      <Input id="buyer-q" name="q" type="search" defaultValue={defaultValue} placeholder={t("searchPlaceholder")} />
      <Button type="submit" variant="outline" aria-label={tc("search")}>
        <Search />
        <span className="hidden sm:inline">{tc("search")}</span>
      </Button>
    </form>
  );
}
