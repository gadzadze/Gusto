import type ka from "../../messages/ka.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: "ka";
    Messages: typeof ka;
  }
}
