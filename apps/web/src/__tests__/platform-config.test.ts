import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRailwayContext, project, type ServiceNode } from "railway/iac";

import nextConfig from "../../next.config";
import webPackage from "../../package.json";
import railwayProgram, { partial } from "../../../../.railway/railway";

/**
 * Platform pins that live in several files and must move together.
 *
 * - The Node major is set in three places: the Dockerfile (production), .nvmrc
 *   (local machines) and the root package.json "engines" field. @types/node
 *   must describe the same major. These tests compare the files with each
 *   other. They do not check the Node that runs the tests: a machine can run
 *   the suite on a newer major, which "engines" (>=) permits.
 * - next and eslint-config-next ship together. The version must stay at or
 *   above 16.3.0: 16.2.x production builds break
 *   `new Worker(new URL(..., import.meta.url))` (vercel/next.js #94015i,
 *   fixed by #96307pr in 16.3.0), and the clips encoder runs in a worker.
 * - Next 16.3 `next dev` writes AGENTS.md and CLAUDE.md into apps/web when it
 *   detects a coding agent. The repo root CLAUDE.md is the only agent guide.
 * - Railway: railway.toml (Config as Code) sets the deploy settings until the
 *   one-time migration in .railway/README.md. .railway/railway.ts (Infrastructure
 *   as Code) is the prepared replacement. While both files exist, they must
 *   hold the same values, or the migration changes production settings.
 *   `railway config apply` deletes every variable that railway.ts does not
 *   declare and detaches the service when railway.ts has no source, so these
 *   tests pin the source and keep every variable as preserve().
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

  it("keeps class names in the server bundle, so server logs can name an error", () => {
    // describeError logs the error class and no message; a minified server
    // build logged "error: 'c'" for a bucket error.
    expect(nextConfig.experimental?.serverMinification).toBe(false);
  });
});

type TomlValue = string | number | boolean;

/**
 * Reads the flat railway.toml format: [section] headers and `key = value`
 * lines with string, number or boolean values. Any other line fails the test,
 * so a setting that this parser cannot read is never skipped without a signal.
 */
function parseFlatToml(source: string): Record<string, Record<string, TomlValue>> {
  const sections: Record<string, Record<string, TomlValue>> = {};
  let current: Record<string, TomlValue> | null = null;
  const lines = source.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const where = `railway.toml line ${index + 1}`;
    const line = rawLine.replace(/\s+#[^"]*$/, "").trim();
    if (line === "" || line.startsWith("#")) continue;

    const header = line.match(/^\[([A-Za-z0-9_]+)\]$/);
    if (header) {
      current = sections[header[1]] ??= {};
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!pair || current === null) {
      throw new Error(`${where} is not a flat setting: "${rawLine}"`);
    }
    const [, key, rawValue] = pair;
    if (/^"[^"]*"$/.test(rawValue)) current[key] = rawValue.slice(1, -1);
    else if (/^-?\d+(\.\d+)?$/.test(rawValue)) current[key] = Number(rawValue);
    else if (rawValue === "true" || rawValue === "false") current[key] = rawValue === "true";
    else throw new Error(`${where} has a value this test cannot read: "${rawLine}"`);
  }

  return sections;
}

// Enum settings: Config as Code writes them in lower case ("dockerfile",
// "on_failure"), Infrastructure as Code in upper case. Paths and other
// strings must match exactly.
const ENUM_SETTINGS = new Set(["build.builder", "deploy.restartPolicyType"]);

function normalizeSetting(setting: string, value: unknown): unknown {
  return ENUM_SETTINGS.has(setting) && typeof value === "string" ? value.toUpperCase() : value;
}

// The variables that the hanks-garage service had on Railway (read-only
// `railway config plan`, 2026-09-28), and the clips variables that the app
// reads in production (CLIPS_MODE, CLIPS_DOGFOOD_USER_IDS; not set on
// Railway yet). An apply deletes a variable that is missing from
// railway.ts. Edit this list only together with railway.ts.
// NEVER add CLIPS_LAB: the /clips-lab page answers 404 in production only
// because that variable is not set.
const RAILWAY_VARIABLES = [
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_SECRET",
  "AUTH_URL",
  "CLIPS_DOGFOOD_USER_IDS",
  "CLIPS_MODE",
  "DATABASE_URL",
  "NEXT_PUBLIC_ROM_CDN_URL",
  "S3_ACCESS_KEY_ID",
  "S3_BUCKET",
  "S3_ENDPOINT",
  "S3_SECRET_ACCESS_KEY",
];

/**
 * Functions that take process.env whole, and the names that each one reads.
 * The scan below cannot see into them. It trusts this list, checks the list
 * against the source of each function, and fails on a function that gets
 * process.env and is not on the list.
 */
const ENV_READERS: Record<string, { file: string; names: string[] }> = {
  isClipsLabEnabled: { file: "apps/web/src/shared/clips/lab/labParams.ts", names: ["CLIPS_LAB"] },
};

/** Names that the app reads but that must never be Railway variables. */
const NEVER_ON_RAILWAY = new Set(["CLIPS_LAB"]);

interface EnvScan {
  /** The variable names that the source reads. */
  names: Set<string>;
  /** Reads that the scan cannot name: a dynamic key, or process.env given to a function it does not know. */
  unknown: string[];
}

/**
 * The environment variables that one source file reads: process.env.NAME,
 * process.env?.NAME, process.env["NAME"], a destructuring of process.env,
 * and process.env given whole to a function in `readers`.
 */
function scanEnvReads(source: string, readers: Record<string, { names: string[] }> = ENV_READERS): EnvScan {
  const names = new Set<string>();
  const unknown: string[] = [];
  for (const match of source.matchAll(/process\.env\b/g)) {
    const at = match.index ?? 0;
    const after = source.slice(at + match[0].length);
    const before = source.slice(0, at);
    const dot = /^\s*(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)/.exec(after);
    if (dot) {
      if (/^[A-Z][A-Z0-9_]*$/.test(dot[1])) names.add(dot[1]);
      else unknown.push(`process.env.${dot[1]}`);
      continue;
    }
    const bracket = /^\s*(?:\?\.)?\s*\[\s*(["'`])([A-Z][A-Z0-9_]*)\1\s*\]/.exec(after);
    if (bracket) {
      names.add(bracket[2]);
      continue;
    }
    if (/^\s*(?:\?\.)?\s*\[/.test(after)) {
      unknown.push("process.env[<dynamic key>]");
      continue;
    }
    const destructure = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*$/.exec(before);
    if (destructure) {
      for (const part of destructure[1].split(",")) {
        const key = part.split(/[:=]/)[0].trim().replace(/^\.\.\./, "");
        if (/^[A-Z][A-Z0-9_]*$/.test(key)) names.add(key);
        else if (key) unknown.push(`{ ${key} } = process.env`);
      }
      continue;
    }
    const call = /([A-Za-z_$][\w$]*)\s*\(\s*$/.exec(before);
    if (call && /^\s*\)/.test(after) && Object.hasOwn(readers, call[1])) {
      for (const name of readers[call[1]].names) names.add(name);
      continue;
    }
    unknown.push(call ? `${call[1]}(process.env)` : `process.env${after.slice(0, 1)}`);
  }
  return { names, unknown };
}

describe("the environment read scan", () => {
  it("finds dot, optional, bracket and destructured reads, and the names that a known reader reads", () => {
    const scan = scanEnvReads(
      [
        "const a = process.env.ALPHA;",
        "const b = process.env?.BETA;",
        'const c = process.env["GAMMA"];',
        "const d = process.env['DELTA'];",
        "const { EPSILON, ZETA: zeta = 'x' } = process.env;",
        "if (!isClipsLabEnabled(process.env)) notFound();",
      ].join("\n"),
    );
    expect([...scan.names].sort()).toEqual(["ALPHA", "BETA", "CLIPS_LAB", "DELTA", "EPSILON", "GAMMA", "ZETA"]);
    expect(scan.unknown).toEqual([]);
  });

  it("reports each read that it cannot name, so a new kind of read fails the gate", () => {
    const scan = scanEnvReads(
      ["const key = pick();", "const x = process.env[key];", "readSettings(process.env);", "const env = process.env;"].join("\n"),
    );
    expect(scan.names.size).toBe(0);
    expect(scan.unknown).toEqual(["process.env[<dynamic key>]", "readSettings(process.env)", "process.env;"]);
  });
});

describe("Railway configuration", () => {
  async function loadService(): Promise<ServiceNode> {
    const context = createRailwayContext({ environment: "production" });
    const definition = await railwayProgram(context, project);
    const resources = (definition.resources ?? []).flat();
    expect(definition.name).toBe("hanks-hits");
    expect(resources).toHaveLength(1);
    const [web] = resources;
    if (web.type !== "service") throw new Error(`Expected a service, got ${web.type}`);
    return web;
  }

  it("has one Config as Code file at most: railway.toml, never railway.json", () => {
    expect(existsSync(join(REPO_ROOT, ".railway", "railway.ts"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "railway.json"))).toBe(false);
  });

  it("is a named partial, so an apply cannot delete the rest of the project", () => {
    expect(partial).toBe("hanks-garage");
  });

  it("sets the deploy settings of the hanks-garage service", async () => {
    const web = await loadService();
    expect(web).toMatchObject({
      address: "service.hanks-garage",
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

  it("keeps the service connected to the master branch of this repository", async () => {
    const web = await loadService();
    expect(web.kind).toBe("github");
    expect(web.source).toEqual({
      type: "github",
      repo: "jackneil/hanks-hits",
      branch: "master",
    });
  });

  it("declares every service variable with preserve(), so an apply deletes none and writes no value", async () => {
    const web = await loadService();
    const variables = web.variables ?? {};
    expect(Object.keys(variables).sort()).toEqual([...RAILWAY_VARIABLES].sort());
    for (const [name, value] of Object.entries(variables)) {
      expect({ name, value }).toEqual({ name, value: { type: "preserve" } });
    }
  });

  it("declares every variable that the app reads in production, and never the lab switch", async () => {
    // A variable that the app reads but railway.ts leaves out is deleted by
    // the next apply, and the feature behind it goes quiet with no error.
    // The scan covers the app and the source of every workspace package
    // (packages/db reads DATABASE_URL).
    const packagesDir = join(REPO_ROOT, "packages");
    const roots = [
      join(REPO_ROOT, "apps", "web", "src"),
      ...readdirSync(packagesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, "src")))
        .map((entry) => join(packagesDir, entry.name, "src")),
    ];
    const read = new Set<string>();
    const unknown: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
          const scan = scanEnvReads(readFileSync(full, "utf8"));
          scan.names.forEach((name) => read.add(name));
          unknown.push(...scan.unknown.map((what) => `${full.slice(REPO_ROOT.length + 1)}: ${what}`));
        }
      }
    };
    roots.forEach(walk);
    // Every read has a name: a new kind of read is added to ENV_READERS first.
    expect(unknown).toEqual([]);
    // Each known reader still reads the names that the list gives it.
    for (const [reader, { file, names }] of Object.entries(ENV_READERS)) {
      const source = readRepoFile(file);
      expect(source, reader).toMatch(new RegExp(`function ${reader}\\b`));
      for (const name of names) expect(source, `${reader} reads ${name}`).toMatch(new RegExp(`\\benv\\.${name}\\b`));
    }
    // Names that the platform or Next.js sets, never a Railway variable.
    const PLATFORM = new Set(["NODE_ENV"]);
    const web = await loadService();
    const declared = new Set(Object.keys(web.variables ?? {}));
    const missing = [...read]
      .filter((name) => !PLATFORM.has(name) && !NEVER_ON_RAILWAY.has(name) && !declared.has(name))
      .sort();
    expect(missing).toEqual([]);
    // A control: the scan finds the clips variables, the database, and the
    // lab switch (read through isClipsLabEnabled).
    for (const name of ["CLIPS_MODE", "CLIPS_DOGFOOD_USER_IDS", "DATABASE_URL", "CLIPS_LAB"]) {
      expect(read.has(name), name).toBe(true);
    }
    // The lab switch stays out of production, in the file and in the list.
    for (const name of NEVER_ON_RAILWAY) {
      expect(declared.has(name)).toBe(false);
      expect(RAILWAY_VARIABLES).not.toContain(name);
      expect(readRepoFile(".railway/railway.ts")).not.toMatch(new RegExp(`${name}\\s*:`));
    }
  });

  it("holds the same settings in railway.toml and railway.ts while both files exist", async () => {
    const tomlPath = join(REPO_ROOT, "railway.toml");
    if (!existsSync(tomlPath)) return;

    const toml = parseFlatToml(readFileSync(tomlPath, "utf8"));
    const web = await loadService();
    const iac: Record<string, Record<string, unknown>> = {
      build: { ...web.build },
      deploy: { ...web.deploy },
    };

    expect(Object.keys(toml).sort()).toEqual(Object.keys(iac).sort());
    for (const section of Object.keys(iac)) {
      const tomlSection = toml[section];
      const iacSection = iac[section];
      expect({ section, keys: Object.keys(tomlSection).sort() }).toEqual({
        section,
        keys: Object.keys(iacSection).sort(),
      });
      for (const key of Object.keys(iacSection)) {
        const setting = `${section}.${key}`;
        expect({ setting, value: normalizeSetting(setting, tomlSection[key]) }).toEqual({
          setting,
          value: normalizeSetting(setting, iacSection[key]),
        });
      }
    }
  });

  it("reads every railway.toml line or fails with the line number", () => {
    expect(parseFlatToml('# note\n[build]\nbuilder = "dockerfile" # why\nretries = 3\n')).toEqual({
      build: { builder: "dockerfile", retries: 3 },
    });
    expect(() => parseFlatToml("[deploy]\nhealthcheckPath = [\"/\"]\n")).toThrow(/line 2/);
    expect(() => parseFlatToml('builder = "dockerfile"\n')).toThrow(/line 1/);
  });
});
