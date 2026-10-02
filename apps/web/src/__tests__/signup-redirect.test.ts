import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

/**
 * Email sign-up is gone (COPPA, issue #26i): sign-in is Google only, on
 * /login. Old links and bookmarks to /signup must still land somewhere
 * useful, so next.config.ts redirects them. e2e/phone/pages.spec.ts checks
 * the same redirect on a running server.
 */
describe("/signup", () => {
  it("redirects to /login", async () => {
    if (!nextConfig.redirects) throw new Error("next.config.ts has no redirects() function");
    const rules = await nextConfig.redirects();
    expect(rules).toContainEqual({ source: "/signup", destination: "/login", permanent: true });
  });
});
