import { Google_Sans } from "next/font/google";

// Google Sans for the landing page only: a clean geometric sans that has real Georgian
// letters, so Latin, digits and Georgian come from one family. The app keeps Inter and
// Noto Sans Georgian (its layouts, like the phone bottom bar, are measured with them).
export const landingFont = Google_Sans({
  variable: "--font-landing",
  subsets: ["latin", "latin-ext", "georgian"],
  weight: ["400", "500", "600", "700"],
});
