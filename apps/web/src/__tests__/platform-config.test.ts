import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRailwayContext, project } from "railway/iac";

import nextConfig from "../../next.config";
import webPackage from "../../package.json";
import railwayProgram, { partial } from "../../../../.railway/railway";

/**
 * Platform pins that live in several files and must move together.
 *
 * - The Node major is set in three places: the Dockerfile (production), .nvmrc
 *   (local machines) and the root package.json "engines" field. @types/node
 *   must describe the same major. If one of them moves alone, production runs
 *   a different Node than the one we test on.
 * - next and eslint-config-next ship together. The version must stay at or
 *   above 16.3.0: 16.2.x production builds break
 *   `new Worker(new URL(..., import.meta.url))` (vercel/next.js #94015i,
 *   fixed by #96307pr in 16.3.0), and the clips encoder runs in a worker.
 * - Next 16.3 `next dev` writes AGENTS.md and CLAUDE.md into apps/web when it
 *   detects a coding agent. The repo root CLAUDE.md is the only agent guide.
 * - Railway deploy settings live in .railway/railway.ts (Infrastructure as
 *   Code). A leftover railway.toml would win during deploys and block
 *   `railway config plan`, so it must not come back.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

function majorOf(version: string): number {
  const match = version.match(/(\d+)/);
  if (!match) throw new Error(`No version number in "${version}"`);
  return Number(match[1]);
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

describe("Node version pins", () => {
  const dockerfile = readRepoFile("Dockerfile");
  const fromLines = dockerfile
    .split("\n")
    .filter((line) => /^FROM\s+node:/i.test(line));
  const rootPackage = JSON.parse(readRepoFile("package.json")) as {
    engines?: { node?: string };
  };

  it("pins every Dockerfile node image to an exact major.minor tag", () => {
    expect(fromLines.length).toBeGreaterThan(0);
    for (const line of fromLines) {
      expect(line).toMatch(/^FROM\s+node:\d+\.\d+-alpine\b/i);
    }
  });

  it("uses the same Node major in the Dockerfile, .nvmrc, engines and @types/node", () => {
    const dockerMajor = majorOf(fromLines[0].replace(/^FROM\s+node:/i, ""));
    const nvmrcMajor = majorOf(readRepoFile(".nvmrc").trim());
    const enginesRange = rootPackage.engines?.node ?? "";
    const typesNodeRange = webPackage.devDependencies["@types/node"];

    expect(enginesRange).toBe(`>=${dockerMajor}`);
    expect(nvmrcMajor).toBe(dockerMajor);
    expect(majorOf(typesNodeRange)).toBe(dockerMajor);
    for (const line of fromLines) {
      expect(majorOf(line.replace(/^FROM\s+node:/i, ""))).toBe(dockerMajor);
    }
  });
});

describe("Next.js version", () => {
  const next = webPackage.dependencies.next;
  const eslintConfigNext = webPackage.devDependencies["eslint-config-next"];

  it("pins next to an exact version that eslint-config-next matches", () => {
    expect(next).toMatch(/^\d+\.\d+\.\d+$/);
    expect(eslintConfigNext).toBe(next);
  });

  it("stays on a release with the production Worker URL fix (16.3.0 or later)", () => {
    expect(compareVersions(next, "16.3.0")).toBeGreaterThanOrEqual(0);
  });

  it("does not let next dev write AGENTS.md or CLAUDE.md into apps/web", () => {
    expect(nextConfig.agentRules).toBe(false);
  });
});

describe("Railway Infrastructure as Code", () => {
  it("keeps no Config as Code file beside .railway/railway.ts", () => {
    expect(existsSync(join(REPO_ROOT, ".railway", "railway.ts"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "railway.toml"))).toBe(false);
    expect(existsSync(join(REPO_ROOT, "railway.json"))).toBe(false);
  });

  it("is a named partial, so an apply cannot delete the rest of the project", () => {
    expect(partial).toBe("hanks-garage");
  });

  it("keeps the deploy settings that railway.toml had", async () => {
    const context = createRailwayContext({ environment: "production" });
    const definition = await railwayProgram(context, project);

    const resources = definition.resources ?? [];

    expect(definition.name).toBe("hanks-hits");
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({
      address: "service.hanks-garage",
      type: "service",
      name: "hanks-garage",
      build: {
        builder: "DOCKERFILE",
        dockerfilePath: "Dockerfile",
      },
      deploy: {
        healthcheckPath: "/",
        healthcheckTimeout: 100,
        restartPolicyType: "ON_FAILURE",
        restartPolicyMaxRetries: 3,
      },
    });
  });
});
