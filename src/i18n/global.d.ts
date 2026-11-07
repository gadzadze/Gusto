import type ka from "../../messages/ka.json";
import type { Locale } from "./locales";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof ka;
  }
}
