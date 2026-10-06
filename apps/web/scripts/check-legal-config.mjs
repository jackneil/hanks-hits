#!/usr/bin/env node
/**
 * Explicit privacy-publication check. Ordinary builds may include the disabled
 * draft; /privacy itself fails closed until this same readiness contract passes.
 * This command verifies configuration, not legal coverage or a working inbox.
 * It reports field names only, never contact or policy values.
 * Usage: node apps/web/scripts/check-legal-config.mjs [path/to/legal.json]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function supplied(value) {
  const text = clean(value);
  return text !== "" && !/^(coming soon|tbd|todo|unknown|pending|not supplied)(?:\b|$)/i.test(text)
    && !/^\[[\s\S]*\]$/.test(text);
}

/** Keep in step with privacyNoticePublicationProblems in src/config/legal.ts. */
function publicationProblems(config) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return ["the file must hold a JSON object"];
  }
  const problems = [];
  if (config.publicationEnabled !== true) problems.push("publicationEnabled is not true");
  const fields = config.coverageAssessment === "coppa_applies"
    ? ["operatorName", "mailingAddress", "phone", "email"] : ["operatorName", "email"];
  for (const field of ["operatorName", "mailingAddress", "phone", "email"]) {
    if ((fields.includes(field) || clean(config[field]) !== "") && !supplied(config[field])) {
      problems.push(`${field} is missing or a placeholder`);
    }
  }
  const email = clean(config.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push("email is not an email address");
  if (config.adultContactVerified !== true) problems.push("adultContactVerified is not true");
  if (!supplied(config.requestProcess)) problems.push("requestProcess is missing or a placeholder");
  if (config.requestProcessVerified !== true) problems.push("requestProcessVerified is not true");
  if (config.coverageAssessment !== "coppa_applies" && config.coverageAssessment !== "other_reviewed") {
    problems.push("coverageAssessment is pending or unrecognised");
  }
  if (!supplied(config.clipStorageProvider)) problems.push("clipStorageProvider is missing or a placeholder");
  if (config.clipStorageProviderVerified !== true) problems.push("clipStorageProviderVerified is not true");
  if (!supplied(config.retentionDetails)) problems.push("retentionDetails is missing or a placeholder");
  if (config.retentionDetailsVerified !== true) problems.push("retentionDetailsVerified is not true");
  return problems;
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const configPath = process.argv[2] ? path.resolve(process.argv[2])
    : path.resolve(scriptDir, "../src/config/legal.json");
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    console.error(`[check-legal-config] FAIL: ${configPath}: ${error instanceof SyntaxError ? "not valid JSON" : "cannot be read"}.`);
    return 1;
  }
  const problems = publicationProblems(config);
  if (problems.length) {
    console.error(`[check-legal-config] FAIL: ${configPath}`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log(`[check-legal-config] PASS: ${configPath}: privacy publication configuration is complete.`);
  return 0;
}

// Always run, including through macOS /tmp symlinks. Do not skip the check
// because an invocation path differs from import.meta.url.
process.exit(main());
