import { getTranslations } from "next-intl/server";
import { DEMO_ACCOUNTS, demoPassword, isDemoMode } from "@/lib/demo";

/** Login-page hint on the public demo: which fictional accounts exist. */
export async function DemoAccounts() {
  if (!isDemoMode()) return null;
  const t = await getTranslations("demo");
  const password = demoPassword();
  return (
    <section className="mt-6 w-full max-w-sm rounded-xl border bg-muted p-5 text-sm">
      <h2 className="font-semibold">{t("accountsTitle")}</h2>
      <p className="mt-1 text-muted-foreground">{t("accountsBody")}</p>
      <dl className="mt-3 space-y-2">
        {DEMO_ACCOUNTS.map((a) => (
          <div key={a.key}>
            <dt className="text-muted-foreground">{t(`role_${a.key}`)}</dt>
            <dd className="font-mono break-all">{a.email}</dd>
          </div>
        ))}
        {password ? (
          <div>
            <dt className="text-muted-foreground">{t("password")}</dt>
            <dd className="font-mono">{password}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
