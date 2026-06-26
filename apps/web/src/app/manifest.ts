import type { MetadataRoute } from "next";
import { SITE } from "@/config/site";

// PWA manifest generated from the single branding source (src/config/site.json),
// so "Add to Home Screen" / install / splash all follow a rebrand too.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "landscape",
    background_color: "#1a1a2e",
    theme_color: "#3b82f6",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
