import { getRequestConfig } from "next-intl/server";
import ka from "../../messages/ka.json";

// Georgian only for now. The locale is fixed rather than read from the
// request, so pages that don't touch the session can still prerender.
export const DEFAULT_LOCALE = "ka";

export default getRequestConfig(async () => ({
  locale: DEFAULT_LOCALE,
  messages: ka,
  // Fallback for formatting only. Org-specific dates pass the org's own
  // timezone explicitly (see CLAUDE.md, "Conventions").
  timeZone: "Asia/Tbilisi",
}));
