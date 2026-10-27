import { Nunito } from "next/font/google";

// Rounded Latin and digits for the landing page only. Georgian falls through to
// Noto Sans Georgian, which the root layout already loads.
export const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "600", "700", "800"],
});
