import legalConfig from "./legal.json";

/**
 * Operator contact details for the privacy notice at /privacy.
 *
 * COPPA (16 CFR 312.4(d)(1)) requires the name, mailing address, phone
 * number and email address of the operator on the notice. The values come
 * from `legal.json`, so each deployment of the site can show its own
 * operator.
 *
 * An empty value is allowed in the file, so the site still builds before
 * the grown-up supplies the details. The notice then shows "Coming soon"
 * for that item. Before a release, run the release check:
 *
 *     node apps/web/scripts/check-legal-config.mjs
 *
 * The check fails when any field is empty.
 */
export type LegalContact = {
  operatorName: string;
  mailingAddress: string;
  phone: string;
  email: string;
};

/** The field names, in the order the notice shows them. */
export const LEGAL_CONTACT_FIELDS = [
  "operatorName",
  "mailingAddress",
  "phone",
  "email",
] as const satisfies readonly (keyof LegalContact)[];

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export const LEGAL_CONTACT: LegalContact = {
  operatorName: clean(legalConfig.operatorName),
  mailingAddress: clean(legalConfig.mailingAddress),
  phone: clean(legalConfig.phone),
  email: clean(legalConfig.email),
};

/** The names of the fields that have no value. */
export function missingLegalContactFields(
  contact: LegalContact
): (keyof LegalContact)[] {
  return LEGAL_CONTACT_FIELDS.filter((field) => clean(contact[field]) === "");
}
