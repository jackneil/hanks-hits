#!/usr/bin/env node
/**
 * Release check for the privacy notice contact details.
 *
 * The privacy notice at /privacy must show the operator name, a mailing
 * address, a phone number and an email address (COPPA, 16 CFR
 * 312.4(d)(1)). The values live in apps/web/src/config/legal.json. The
 * site still builds when they are empty, so this check is the gate that
 * stops a release with an incomplete notice.
 *
 * Usage (from the repo root):
 *
 *     node apps/web/scripts/check-legal-config.mjs
 *     node apps/web/scripts/check-legal-config.mjs path/to/legal.json
 *
 * Exit code 0: every field has a value.
 * Exit code 1: a field is empty or missing, the email has no "@", or the
 * file cannot be read.
 *
 * The output names the fields only. It never prints the values.
 *
 * This check is not part of the pre-push gate on purpose: the site must
 * keep deploying while the grown-up gets the details. Run it before the
 * privacy notice is announced or linked from new places.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Keep in step with LEGAL_CONTACT_FIELDS in src/config/legal.ts. */
const REQUIRED_FIELDS = ["operatorName", "mailingAddress", "phone", "email"];

/**
 * Return a list of problems with the contact config. An empty list means
 * the config is complete.
 */
function findLegalConfigProblems(config) {
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return ["the file must hold a JSON object"];
  }
  const problems = [];
  for (const field of REQUIRED_FIELDS) {
    const value = config[field];
    if (typeof value !== "string" || value.trim() === "") {
      problems.push(`${field} is empty`);
    }
  }
  const email = typeof config.email === "string" ? config.email.trim() : "";
  if (email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    problems.push("email is not an email address");
  }
  return problems;
}

function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const configPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(scriptDir, "../src/config/legal.json");

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    const reason = error instanceof SyntaxError ? "it is not valid JSON" : "it cannot be read";
    console.error(`[check-legal-config] FAIL: ${configPath}: ${reason}.`);
    return 1;
  }

  const problems = findLegalConfigProblems(config);
  if (problems.length > 0) {
    console.error(`[check-legal-config] FAIL: ${configPath}`);
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    console.error(
      "  The privacy notice must show all four. Use a mailing address and a phone number that are not personal."
    );
    return 1;
  }

  console.log(`[check-legal-config] PASS: ${configPath} has all ${REQUIRED_FIELDS.length} contact fields.`);
  console.log("  Reminder: the mailing address must not be a home address.");
  return 0;
}

// Always run. This file is a command, not a library. A "run only when
// called directly" guard compared paths, and a path through a symbolic link
// (for example /tmp on macOS) did not match, so the check exited 0 without
// a check. A release check must fail closed.
process.exit(main());
