import { build } from "esbuild";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

let id = process.env.RAILWAY_GIT_COMMIT_SHA;
if (!id) { try { id = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { id = "local"; } }
// A build timestamp orders overlapping deployments without prompting old
// pages to downgrade when a load balancer briefly serves the older replica.
const builtAt = Date.now();
const release = { id: `${id}-${builtAt}`, builtAt };
fs.writeFileSync(".release.json", JSON.stringify(release));
await build({ entryPoints: ["scripts/live-server.ts"], outfile: "dist/live-server.mjs",
  bundle: true, platform: "node", format: "esm", packages: "bundle",
  external: ["pg-native"], banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' }, target: "node24" });
fs.copyFileSync("scripts/live-child-watch.mjs", "dist/live-child-watch.mjs");
