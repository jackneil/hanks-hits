import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  LEGAL_NOTICE_CONFIG, canPublishPrivacyNotice, normalisePrivacyNoticeConfig,
  privacyNoticePublicationProblems, type PrivacyNoticeConfig,
} from "@/config/legal";

const SCRIPT = path.resolve(__dirname, "../../../../scripts/check-legal-config.mjs");
const REAL_CONFIG = path.resolve(__dirname, "../../../config/legal.json");
const workDir = mkdtempSync(path.join(tmpdir(), "privacy-publication-config-"));
let count = 0;

// Test-only readiness fixture, not a real identity, provider or selected policy.
const COMPLETE: PrivacyNoticeConfig = {
  publicationEnabled: true,
  operatorName: "Test Adult",
  mailingAddress: "",
  phone: "",
  email: "review@example.com",
  adultContactVerified: true,
  requestProcess: "Test reviewed request process.",
  requestProcessVerified: true,
  coverageAssessment: "other_reviewed",
  clipStorageProvider: "Test Storage",
  clipStorageProviderVerified: true,
  retentionDetails: "Test reviewed retention details.",
  retentionDetailsVerified: true,
};

function writeConfig(contents: unknown): string {
  const file = path.join(workDir, `legal-${++count}.json`);
  writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
  return file;
}

function runCheck(configPath?: string, script = SCRIPT) {
  const result = spawnSync(process.execPath, configPath ? [script, configPath] : [script], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterAll(() => rmSync(workDir, { recursive: true, force: true }));

describe("privacy publication configuration", () => {
  const invalid = [
    ["publication disabled", { ...COMPLETE, publicationEnabled: false }],
    ["truthy publication string", { ...COMPLETE, publicationEnabled: "true" }],
    ["missing operator", { ...COMPLETE, operatorName: " " }],
    ["placeholder operator", { ...COMPLETE, operatorName: "Coming soon" }],
    ["missing contact", { ...COMPLETE, email: "" }],
    ["invalid email", { ...COMPLETE, email: "not-an-email" }],
    ["unverified adult contact", { ...COMPLETE, adultContactVerified: false }],
    ["truthy adult verification", { ...COMPLETE, adultContactVerified: "true" }],
    ["missing request process", { ...COMPLETE, requestProcess: "" }],
    ["placeholder request process", { ...COMPLETE, requestProcess: "[Supply a process]" }],
    ["multiline request placeholder", { ...COMPLETE, requestProcess: "[Describe request handling.\nConfirm who responds.]" }],
    ["multiline contact placeholder", { ...COMPLETE, mailingAddress: "[Supply address.\nVerify delivery.]" }],
    ["unverified request process", { ...COMPLETE, requestProcessVerified: false }],
    ["unknown coverage", { ...COMPLETE, coverageAssessment: "pending" }],
    ["unrecognised coverage", { ...COMPLETE, coverageAssessment: "exempt" }],
    ["missing video provider", { ...COMPLETE, clipStorageProvider: "" }],
    ["unverified video provider", { ...COMPLETE, clipStorageProviderVerified: false }],
    ["missing retention facts", { ...COMPLETE, retentionDetails: "" }],
    ["unverified retention facts", { ...COMPLETE, retentionDetailsVerified: false }],
    ["COPPA contact incomplete", { ...COMPLETE, coverageAssessment: "coppa_applies" }],
    ["placeholder optional phone", { ...COMPLETE, phone: "TBD" }],
    ["placeholder optional address", { ...COMPLETE, mailingAddress: "Unknown" }],
    ["missing review fields", { operatorName: COMPLETE.operatorName, email: COMPLETE.email }],
    ["null config", null], ["array config", []],
  ] as const;

  it.each(invalid)("the real command and public route both reject %s", (_label, config) => {
    const result = runCheck(writeConfig(config));
    const problems = privacyNoticePublicationProblems(config);
    expect(problems.length).toBeGreaterThan(0);
    expect(canPublishPrivacyNotice(config)).toBe(false);
    expect(result.status).toBe(1);
    expect(result.output.split("\n").filter((line) => line.startsWith("  - ")).map((line) => line.slice(4))).toEqual(problems);
  });

  it("accepts explicitly enabled, fully reviewed configuration without imposing non-home address/phone rules", () => {
    expect(canPublishPrivacyNotice(COMPLETE)).toBe(true);
    expect(runCheck(writeConfig(COMPLETE)).status).toBe(0);
    const coppa = { ...COMPLETE, coverageAssessment: "coppa_applies", mailingAddress: "Test mailing address", phone: "555 555 0123" };
    expect(canPublishPrivacyNotice(coppa)).toBe(true);
    const result = runCheck(writeConfig(coppa));
    expect(result.status).toBe(0);
    expect(result.output).not.toMatch(/must not be a home|must not be personal/);
  });

  it("requires strict true booleans and trims supplied strings", () => {
    const parsed = normalisePrivacyNoticeConfig({ ...COMPLETE, publicationEnabled: "true", operatorName: "  Test Adult  " });
    expect(parsed.publicationEnabled).toBe(false);
    expect(parsed.operatorName).toBe("Test Adult");
    expect(canPublishPrivacyNotice(parsed)).toBe(false);
  });

  it("keeps the checked-in draft disabled, unidentified, and unready for public notice", () => {
    expect(LEGAL_NOTICE_CONFIG.publicationEnabled).toBe(false);
    expect(LEGAL_NOTICE_CONFIG.operatorName).toBe("");
    expect(LEGAL_NOTICE_CONFIG.email).toBe("");
    expect(LEGAL_NOTICE_CONFIG.coverageAssessment).toBe("pending");
    expect(canPublishPrivacyNotice(LEGAL_NOTICE_CONFIG)).toBe(false);
    const result = runCheck();
    expect(result.status).toBe(1);
    expect(result.output).toContain(REAL_CONFIG);
    for (const problem of privacyNoticePublicationProblems(LEGAL_NOTICE_CONFIG)) expect(result.output).toContain(problem);
  });

  it("fails closed on invalid JSON or an unreadable file", () => {
    expect(runCheck(writeConfig("{ not json")).output).toContain("not valid JSON");
    expect(runCheck(writeConfig("{ not json")).status).toBe(1);
    expect(runCheck(path.join(workDir, "missing.json")).status).toBe(1);
    expect(runCheck(path.join(workDir, "missing.json")).output).toContain("cannot be read");
  });

  it("does not skip an incomplete configuration when invoked through a symlink", () => {
    const link = path.join(workDir, "linked-scripts");
    symlinkSync(path.dirname(SCRIPT), link, "dir");
    const result = runCheck(writeConfig({ ...COMPLETE, publicationEnabled: false }), path.join(link, path.basename(SCRIPT)));
    expect(result.status).toBe(1);
    expect(result.output).toContain("publicationEnabled is not true");
  });

  it("never prints contact or request/retention values", () => {
    const result = runCheck(writeConfig({ ...COMPLETE, publicationEnabled: false }));
    for (const value of [COMPLETE.operatorName, COMPLETE.email, COMPLETE.requestProcess, COMPLETE.retentionDetails]) {
      expect(result.output).not.toContain(value);
    }
  });
});
