// Makes a VAPID key pair for Web Push. Put VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in the environment (Vercel) and
// redeploy; keep the private key secret and never commit it. Making a new pair later invalidates every browser's
// subscription (people turn notifications on again), so keep the pair you start with.
import { generateVAPIDKeys } from "web-push";

const keys = generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("VAPID_SUBJECT=mailto:you@example.com   (optional; defaults to NEXT_PUBLIC_APP_URL)");
