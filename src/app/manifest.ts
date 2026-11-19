import type { MetadataRoute } from "next";

// Makes 202 installable ("Add to Home Screen"). On iPhone a web app can only receive push notifications once it is
// installed this way, so this is part of the Web Push feature. It carries no data and no secrets.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "202",
    short_name: "202",
    description: "B2B ordering for HoReCa",
    start_url: "/start",
    scope: "/",
    display: "standalone",
    lang: "ka",
    background_color: "#ffffff",
    theme_color: "#7a1f2b",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
