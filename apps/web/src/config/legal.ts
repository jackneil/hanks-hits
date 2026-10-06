import legalConfig from "./legal.json";

export type LegalContact = {
  operatorName: string;
  mailingAddress: string;
  phone: string;
  email: string;
};

export type CoverageAssessment = "pending" | "coppa_applies" | "other_reviewed";

export type PrivacyNoticeConfig = LegalContact & {
  publicationEnabled: boolean;
  adultContactVerified: boolean;
  requestProcess: string;
  requestProcessVerified: boolean;
  coverageAssessment: CoverageAssessment;
  clipStorageProvider: string;
  clipStorageProviderVerified: boolean;
  retentionDetails: string;
  retentionDetailsVerified: boolean;
};

export const LEGAL_CONTACT_FIELDS = [
  "operatorName", "mailingAddress", "phone", "email",
] as const satisfies readonly (keyof LegalContact)[];

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Recognised placeholders are not usable public contact or policy details. */
function supplied(value: unknown): boolean {
  const text = clean(value);
  return text !== "" && !/^(coming soon|tbd|todo|unknown|pending|not supplied)(?:\b|$)/i.test(text)
    && !/^\[[\s\S]*\]$/.test(text);
}

export function normalisePrivacyNoticeConfig(value: unknown): PrivacyNoticeConfig {
  const config = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  return {
    publicationEnabled: config.publicationEnabled === true,
    operatorName: clean(config.operatorName),
    mailingAddress: clean(config.mailingAddress),
    phone: clean(config.phone),
    email: clean(config.email),
    adultContactVerified: config.adultContactVerified === true,
    requestProcess: clean(config.requestProcess),
    requestProcessVerified: config.requestProcessVerified === true,
    coverageAssessment: config.coverageAssessment === "coppa_applies"
      || config.coverageAssessment === "other_reviewed" ? config.coverageAssessment : "pending",
    clipStorageProvider: clean(config.clipStorageProvider),
    clipStorageProviderVerified: config.clipStorageProviderVerified === true,
    retentionDetails: clean(config.retentionDetails),
    retentionDetailsVerified: config.retentionDetailsVerified === true,
  };
}

/**
 * Publication readiness, not a legal-coverage decision or a compliance claim.
 * The confirmations represent completed human/operational review. Merely
 * entering an email address does not verify that an adult handles requests.
 * Keep the command-line checker in step with these rules.
 */
export function privacyNoticePublicationProblems(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return ["the file must hold a JSON object"];
  }
  const config = normalisePrivacyNoticeConfig(value);
  const problems: string[] = [];
  if (!config.publicationEnabled) problems.push("publicationEnabled is not true");
  const contactFields: readonly (keyof LegalContact)[] = config.coverageAssessment === "coppa_applies"
    ? LEGAL_CONTACT_FIELDS : ["operatorName", "email"];
  for (const field of LEGAL_CONTACT_FIELDS) {
    if ((contactFields.includes(field) || config[field] !== "") && !supplied(config[field])) {
      problems.push(`${field} is missing or a placeholder`);
    }
  }
  if (config.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) {
    problems.push("email is not an email address");
  }
  if (!config.adultContactVerified) problems.push("adultContactVerified is not true");
  if (!supplied(config.requestProcess)) problems.push("requestProcess is missing or a placeholder");
  if (!config.requestProcessVerified) problems.push("requestProcessVerified is not true");
  if (config.coverageAssessment === "pending") problems.push("coverageAssessment is pending or unrecognised");
  if (!supplied(config.clipStorageProvider)) problems.push("clipStorageProvider is missing or a placeholder");
  if (!config.clipStorageProviderVerified) problems.push("clipStorageProviderVerified is not true");
  if (!supplied(config.retentionDetails)) problems.push("retentionDetails is missing or a placeholder");
  if (!config.retentionDetailsVerified) problems.push("retentionDetailsVerified is not true");
  return problems;
}

export function canPublishPrivacyNotice(config: unknown): boolean {
  return privacyNoticePublicationProblems(config).length === 0;
}

export const LEGAL_NOTICE_CONFIG = normalisePrivacyNoticeConfig(legalConfig);
export const LEGAL_CONTACT: LegalContact = {
  operatorName: LEGAL_NOTICE_CONFIG.operatorName,
  mailingAddress: LEGAL_NOTICE_CONFIG.mailingAddress,
  phone: LEGAL_NOTICE_CONFIG.phone,
  email: LEGAL_NOTICE_CONFIG.email,
};
