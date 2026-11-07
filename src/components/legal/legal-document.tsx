import { intlLocaleFor, type Locale } from "@/i18n/locales";
import en from "../../../messages/en.json";
import ka from "../../../messages/ka.json";
import { LEGAL_UPDATED, legalOperator } from "@/lib/legal";
import { LegalView } from "./legal-view";

/** The terms and the privacy policy: the server supplies the dates and the operator block, the browser the text. */
export function LegalDocument({ doc }: { doc: "terms" | "privacy" }) {
  const date = (locale: Locale) =>
    new Intl.DateTimeFormat(intlLocaleFor(locale), { dateStyle: "long", timeZone: "Asia/Tbilisi" }).format(
      new Date(`${LEGAL_UPDATED}T12:00:00Z`),
    );
  const kaDate = date("ka");
  const enDate = date("en");
  const operator = legalOperator();
  return <LegalView doc={doc} operator={operator} updatedBy={{ ka: kaDate, en: enDate }} texts={{ ka: ka.legal, en: en.legal }} />;
}
