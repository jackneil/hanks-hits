import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: "standalone",

  // Next 16.3 `next dev` writes AGENTS.md and CLAUDE.md into apps/web when it
  // detects an AI coding agent. The repo root CLAUDE.md is the one source of
  // agent instructions, so turn the generator off.
  // https://nextjs.org/docs/app/guides/ai-agents#opting-out
  agentRules: false,

  // Transpile three.js for proper bundling
  transpilePackages: ["three"],

  // Email sign-up is gone (COPPA, issue #26i): a grown-up signs in with
  // Google on /login. Old links and bookmarks to /signup land there.
  async redirects() {
    return [{ source: "/signup", destination: "/login", permanent: true }];
  },

  // Security headers to prevent clickjacking, XSS, MIME sniffing
  // IMPORTANT: Order matters! When multiple rules match, LAST one wins for each header.
  // So put general rules FIRST, specific overrides LAST.
  async headers() {
    return [
      // All other routes - strict security (no framing allowed)
      // This is FIRST so the emulator rule below can override it
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            // No page may use the camera, the microphone, screen capture
            // (getDisplayMedia) or the location. Game clips record only game
            // pixels and game sound (COPPA). The emulator rule below does not
            // set this header, so this value applies to /emulator too.
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), display-capture=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; connect-src 'self' https:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none';",
          },
        ],
      },
      // Emulator needs to be framed by same origin (retro-arcade game loads it in iframe)
      // This is LAST so it overrides the global rule above for /emulator/* paths
      {
        source: "/emulator/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            // The emulator page shares this origin with the clip library, so
            // it loads no code from another site: EmulatorJS is served from
            // /emulator/ejs/<version>/. connect-src has no https: source on
            // purpose. When a core file is missing, EmulatorJS downloads it
            // from the EmulatorJS CDN and runs it; this blocks that download.
            // Keep the meta CSP in public/emulator/index.html the same.
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; connect-src 'self' blob:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'self';",
          },
        ],
      },
      // The self-hosted EmulatorJS files. The version is in the path, and the
      // files under one version never change (a test checks their SHA-256),
      // so browsers and the Cloudflare edge can keep them for a year.
      {
        source: "/emulator/ejs/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      // NOTICE.txt tells where the licenses and the source code of these files
      // are. We write it, and a fix to it keeps its path, so it gets a short
      // cache. This rule is after the rule above, so its Cache-Control wins.
      {
        source: "/emulator/ejs/:version/NOTICE.txt",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
      },
    ];
  },
};

export default nextConfig;
