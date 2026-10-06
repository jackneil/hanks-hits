/** Source facts for the unpublished notice. Update alongside collection changes. */
export const PRIVACY_NOTICE_UPDATED = "2026-10-06";
export const SIGN_IN_COOKIE_DAYS = 30;

/** Keys correspond to the current player-entered cloud-progress inventory. */
export const KID_TEXT_LABELS = {
  "oregon-trail": "Oregon Trail",
  "four-wheeler-3d": "Four-Wheeler Adventure 3D",
  "virtual-pet": "Virtual Pet",
  "drawing-app": "Drawing",
  "drum-machine": "Drum Machine",
  weather: "Weather",
  "toy-finder": "Toy Finder",
} as const;

export const PLAYER_SAVE_DETAILS = [
  `${KID_TEXT_LABELS["oregon-trail"]}: traveler names.`,
  `${KID_TEXT_LABELS["four-wheeler-3d"]}: outfit text and feeder labels.`,
  `${KID_TEXT_LABELS["virtual-pet"]}: pet names.`,
  `${KID_TEXT_LABELS["drawing-app"]}: drawings and artwork names.`,
  `${KID_TEXT_LABELS["drum-machine"]}: saved beat names.`,
  `${KID_TEXT_LABELS.weather}: chosen places and their map positions.`,
  `${KID_TEXT_LABELS["toy-finder"]}: a saved wish list can include notes.`,
  "Retro Arcade: names and console details of games you add.",
] as const;

export const KID_SUMMARY: ReadonlyArray<{ emoji: string; text: string }> = [
  { emoji: "🎮", text: "You can play without an account. Your browser saves some progress on this device." },
  { emoji: "💾", text: "When you sign in, games can also save online. Words, names, places and drawings can be included." },
  { emoji: "🏆", text: "Leaderboards show a made-up gamer name and scores. A video you choose to post can also be public." },
  { emoji: "🚪", text: "Signing out does not delete your account or all of your saved information." },
  { emoji: "🤫", text: "Do not put your full name, address, school or phone number in a game or video." },
  { emoji: "📖", text: "Ask a grown-up before making an account or sharing, and read this page together." },
];

export function kidSummarySpeech(): string {
  return ["Here is what the site saves.", ...KID_SUMMARY.map((line) => line.text)].join(" ");
}

export function formatNoticeDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC", year: "numeric", month: "long", day: "numeric",
  });
}

/** Preserve a phone extension separately; unfamiliar formats remain readable text. */
export function phoneHref(phone: string): string | null {
  const match = phone.trim().match(/^(.*?)(?:(?:\s*(?:ext\.?|extension|x)\s*|;ext=)(\d+))?$/i);
  if (!match || !/^\+?[\d\s().-]+$/.test(match[1])) return null;
  const number = match[1].replace(/[\s().-]/g, "");
  if (!/\d/.test(number)) return null;
  return `tel:${number}${match[2] ? `;ext=${match[2]}` : ""}`;
}

export const NOTICE_SECTIONS = [
  { id: "about", title: "About this project", navLabel: "About" },
  { id: "accounts", title: "Accounts and sign-in", navLabel: "Accounts" },
  { id: "progress", title: "Game progress, words and pictures", navLabel: "Game saves" },
  { id: "retro", title: "Retro Arcade files", navLabel: "Retro Arcade" },
  { id: "public", title: "Scores and videos other people can see", navLabel: "Public scores and videos" },
  { id: "sharing", title: "Services used by the site", navLabel: "Services" },
  { id: "identifiers", title: "Network information and browser storage", navLabel: "Browser and network" },
  { id: "deletion", title: "Keeping and deleting information", navLabel: "Saved information" },
  { id: "operator", title: "Who is responsible", navLabel: "Contact" },
  { id: "requests", title: "How to ask for help", navLabel: "Requests" },
] as const;

export type NoticeSectionId = (typeof NOTICE_SECTIONS)[number]["id"];

export function sectionTitle(id: NoticeSectionId): string {
  return NOTICE_SECTIONS.find((section) => section.id === id)!.title;
}

export function sectionNavLabel(id: NoticeSectionId): string {
  return NOTICE_SECTIONS.find((section) => section.id === id)!.navLabel;
}
