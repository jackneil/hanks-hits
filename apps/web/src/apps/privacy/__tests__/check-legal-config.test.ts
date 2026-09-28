import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { LEGAL_CONTACT_FIELDS, missingLegalContactFields, type LegalContact } from "@/config/legal";

/**
 * The release check for the privacy notice contact details
 * (apps/web/scripts/check-legal-config.mjs). These tests run the real
 * script with node and read its exit code, the same way a grown-up runs it
 * before a release.
 */

const SCRIPT = path.resolve(__dirname, "../../../../scripts/check-legal-config.mjs");
const REAL_CONFIG = path.resolve(__dirname, "../../../config/legal.json");

const FILLED: LegalContact = {
  operatorName: "Example Games LLC",
  mailingAddress: "PO Box 123\nSpringfield, ST 00000",
  phone: "(555) 555-0123",
  email: "privacy@example.com",
};

const workDir = mkdtempSync(path.join(tmpdir(), "legal-config-"));
let fileCount = 0;

function writeConfig(contents: unknown): string {
  fileCount += 1;
  const file = path.join(workDir, `legal-${fileCount}.json`);
  writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
  return file;
}

function runCheck(configPath?: string) {
  const args = configPath ? [SCRIPT, configPath] : [SCRIPT];
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("check-legal-config.mjs", () => {
  it("passes when every field has a value", () => {
    const result = runCheck(writeConfig({ _comment: "notes", ...FILLED }));
    expect(result.status).toBe(0);
    expect(result.output).toMatch(/PASS/);
  });

  it.each(LEGAL_CONTACT_FIELDS)("fails when %s is empty", (field) => {
    const result = runCheck(writeConfig({ ...FILLED, [field]: "   " }));
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${field} is empty`);
  });

  it.each(LEGAL_CONTACT_FIELDS)("fails when %s is missing", (field) => {
    const config: Record<string, string> = { ...FILLED };
    delete config[field];
    const result = runCheck(writeConfig(config));
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${field} is empty`);
  });

  it("fails when the email is not an email address", () => {
    const result = runCheck(writeConfig({ ...FILLED, email: "not-an-email" }));
    expect(result.status).toBe(1);
    expect(result.output).toContain("email is not an email address");
  });

  it("fails when the file is not valid JSON", () => {
    const result = runCheck(writeConfig("{ not json"));
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/not valid JSON/);
  });

  it("fails when the file does not exist", () => {
    const result = runCheck(path.join(workDir, "missing.json"));
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/cannot be read/);
  });

  it("fails closed when it runs through a symbolic link", () => {
    // /tmp on macOS is a link to /private/tmp. A path check once made the
    // script skip itself there and exit 0 with an empty legal.json.
    const linkedScripts = path.join(workDir, "linked-scripts");
    symlinkSync(path.dirname(SCRIPT), linkedScripts, "dir");
    const empty = writeConfig({ operatorName: "", mailingAddress: "", phone: "", email: "" });

    const result = spawnSync(
      process.execPath,
      [path.join(linkedScripts, path.basename(SCRIPT)), empty],
      { encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("operatorName is empty");
  });

  it("never prints the contact values", () => {
    const result = runCheck(writeConfig({ ...FILLED, phone: "" }));
    expect(result.output).not.toContain(FILLED.operatorName);
    expect(result.output).not.toContain(FILLED.email);
    expect(result.output).not.toContain("PO Box 123");
  });

  it("checks the real legal.json by default, and agrees with the site about what is missing", async () => {
    const result = runCheck();
    const realConfig = (await import("@/config/legal.json")).default as LegalContact;
    const missing = missingLegalContactFields({
      operatorName: realConfig.operatorName,
      mailingAddress: realConfig.mailingAddress,
      phone: realConfig.phone,
      email: realConfig.email,
    });
    expect(result.output).toContain(REAL_CONFIG);
    // Until the grown-up fills legal.json, the release check must fail.
    expect(result.status).toBe(missing.length === 0 ? 0 : 1);
    for (const field of missing) {
      expect(result.output).toContain(`${field} is empty`);
    }
  });
});

describe("missingLegalContactFields", () => {
  it("returns nothing for a complete contact", () => {
    expect(missingLegalContactFields(FILLED)).toEqual([]);
  });

  it("returns the empty and blank fields in page order", () => {
    expect(
      missingLegalContactFields({ ...FILLED, operatorName: "", email: "  " })
    ).toEqual(["operatorName", "email"]);
  });
});
