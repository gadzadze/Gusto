import { LandingContent } from "@/components/landing/landing-content";

// The page itself is a thin shell: the landing content renders in the browser so the language
// can change instantly (components/landing/landing-content.tsx).
export default function LandingPage() {
  return <LandingContent />;
}
