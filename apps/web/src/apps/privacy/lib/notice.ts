/**
 * Facts and words for the privacy notice at /privacy.
 *
 * The notice must be true for the code that runs today. When you change
 * what the site collects, where it sends data, or how long it keeps data,
 * change the notice in the same pull request, and set
 * PRIVACY_NOTICE_UPDATED to the date of the change.
 *
 * Some facts are also checked against the code by
 * `__tests__/notice-facts.test.ts`, so a change to those facts makes a
 * test fail until the notice is updated.
 */

/** The date of the last change to the notice, as YYYY-MM-DD. */
export const PRIVACY_NOTICE_UPDATED = "2026-09-28";

/** Days that the sign-in cookie lasts. Must match session.maxAge in lib/auth.ts. */
export const SIGN_IN_COOKIE_DAYS = 30;

/** Days that Railway keeps server logs on the Pro plan (docs.railway.com/observability/logs). */
export const SERVER_LOG_DAYS = 30;

/** Days that Cloudflare keeps full Web Analytics reports (developers.cloudflare.com/web-analytics/faq). */
export const ANALYTICS_FULL_DAYS = 7;

/** Days that we keep a backup copy of the database that we make by hand. */
export const MANUAL_BACKUP_DAYS = 90;

/** Show a YYYY-MM-DD date as "September 28, 2026", the same on every time zone. */
export function formatNoticeDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * The short summary for kids, in first-to-third-grade words. The read-aloud
 * button speaks these lines, so keep each one short and complete.
 */
export const KID_SUMMARY: ReadonlyArray<{ emoji: string; text: string }> = [
  { emoji: "🎮", text: "You can play all the games without an account." },
  {
    emoji: "💾",
    text: "If you make an account, we save your games so you can keep playing.",
  },
  {
    emoji: "🏆",
    text: "Other players only see a made-up name, like TurboRacer42, and your score.",
  },
  { emoji: "🙅", text: "We never sell what we save. We never show ads." },
  {
    emoji: "🤫",
    text: "Never type your last name, your address, your school, or your phone number in a game.",
  },
  {
    emoji: "📖",
    text: "Ask a grown-up to read the rest of this page with you.",
  },
];

/** The words the read-aloud button speaks. */
export function kidSummarySpeech(): string {
  return [
    "Here is what we save.",
    ...KID_SUMMARY.map((line) => line.text),
  ].join(" ");
}

/** The sections of the notice for grown-ups, in page order. */
export const NOTICE_SECTIONS = [
  { id: "about", title: "About this notice", navLabel: "About" },
  { id: "operator", title: "Who runs this site", navLabel: "Contact us" },
  {
    id: "collect",
    title: "What we collect, why, and how long we keep it",
    navLabel: "What we collect",
  },
  { id: "public", title: "What other people can see", navLabel: "What is public" },
  { id: "never", title: "What we never do", navLabel: "What we never do" },
  {
    id: "sharing",
    title: "Companies that help us run the site",
    navLabel: "Who we share with",
  },
  {
    id: "identifiers",
    title: "Identifiers that we use to run the site",
    navLabel: "Identifiers",
  },
  { id: "rights", title: "Your rights as a parent", navLabel: "Your rights" },
  { id: "safety", title: "How we protect information", navLabel: "Safety" },
  { id: "changes", title: "Changes to this notice", navLabel: "Changes" },
] as const;

export type NoticeSectionId = (typeof NOTICE_SECTIONS)[number]["id"];

function findSection(id: NoticeSectionId) {
  const section = NOTICE_SECTIONS.find((s) => s.id === id);
  if (!section) throw new Error(`Unknown notice section: ${id}`);
  return section;
}

/** The heading of a section. */
export function sectionTitle(id: NoticeSectionId): string {
  return findSection(id).title;
}

/** The short label of a section, for the jump links. */
export function sectionNavLabel(id: NoticeSectionId): string {
  return findSection(id).navLabel;
}
