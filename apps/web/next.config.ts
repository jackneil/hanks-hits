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
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
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
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.emulatorjs.org https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://cdn.emulatorjs.org; img-src 'self' data: https: blob:; font-src 'self' data: https://cdn.emulatorjs.org; connect-src 'self' https: blob:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'self';",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
