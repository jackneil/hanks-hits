import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

/**
 * Game clips carry game pixels and game sound only. No page may turn on the
 * camera, the microphone, screen capture (getDisplayMedia) or the location
 * (COPPA 16 CFR 312.2; clips plan section 10). The Permissions-Policy header
 * is the platform lock for that rule.
 *
 * Next.js sends the headers of every rule whose source matches the path. When
 * two matching rules set the same header, the later rule wins. So the
 * catch-all rule must turn off all four features, and a later rule that sets
 * its own Permissions-Policy must turn them off too.
 */

const FEATURES_OFF = ["camera", "microphone", "display-capture", "geolocation"] as const;

type HeaderRule = { source: string; headers: { key: string; value: string }[] };

async function headerRules(): Promise<HeaderRule[]> {
  if (!nextConfig.headers) throw new Error("next.config.ts has no headers() function");
  return (await nextConfig.headers()) as HeaderRule[];
}

function permissionsPolicy(rule: HeaderRule): string | undefined {
  return rule.headers.find((h) => h.key.toLowerCase() === "permissions-policy")?.value;
}

/** Parses "a=(), b=(self)" into { a: "()", b: "(self)" }. */
function parsePolicy(value: string): Map<string, string> {
  const entries = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      return [part.slice(0, eq).trim(), part.slice(eq + 1).trim()] as [string, string];
    });
  return new Map(entries);
}

describe("Permissions-Policy header", () => {
  it("turns off camera, microphone, display-capture and geolocation on every route", async () => {
    const rules = await headerRules();
    const catchAll = rules.find((rule) => rule.source === "/:path*");
    expect(catchAll, "the catch-all header rule is missing").toBeDefined();

    const value = permissionsPolicy(catchAll!);
    expect(value, "the catch-all rule sets no Permissions-Policy").toBeDefined();

    const policy = parsePolicy(value!);
    for (const feature of FEATURES_OFF) {
      expect(policy.get(feature), `${feature} is not turned off`).toBe("()");
    }
  });

  it("has no later rule that turns a capture feature back on", async () => {
    const rules = await headerRules();
    for (const rule of rules) {
      const value = permissionsPolicy(rule);
      if (value === undefined) continue; // the catch-all value applies
      const policy = parsePolicy(value);
      for (const feature of FEATURES_OFF) {
        expect(policy.get(feature), `${rule.source}: ${feature} is not turned off`).toBe("()");
      }
    }
  });

  it("uses the structured-header syntax that browsers accept", async () => {
    const rules = await headerRules();
    for (const rule of rules) {
      const value = permissionsPolicy(rule);
      if (value === undefined) continue;
      // The old Feature-Policy syntax ("camera 'none'") is ignored by
      // browsers in this header, which would silently turn nothing off.
      expect(value).toMatch(/^[a-z-]+=\([^)]*\)(,\s*[a-z-]+=\([^)]*\))*$/);
    }
  });
});
