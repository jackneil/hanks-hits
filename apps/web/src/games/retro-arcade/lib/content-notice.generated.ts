// GENERATED from content-rules.json by apps/web/scripts/generate-content-notice.ts.
// Do not edit. After you change a rule, run: pnpm --filter web generate:content-notice
//
// The notice rules only (Jack, 2026-10-02). The arcade shows the heads-up
// card when a player opens a title that one of these rules matches. The
// block rules are not in this file: they stay out of the browser bundle.

export const NOTICE_RULE_PATTERNS: readonly { id: string; pattern: string }[] = [
  { id: "mortal-kombat", pattern: "mortal\\s*kombat" },
  { id: "doom", pattern: "^(?:the\\s+)?(?:ultimate\\s+|final\\s+|brutal\\s+)?doom(?!\\w)" },
  { id: "killer-instinct", pattern: "killer\\s*instinct" },
  { id: "wolfenstein", pattern: "wolfenstein" },
  { id: "alien-3", pattern: "^aliens?\\s*(?:3|³|iii)(?!\\w)" },
  { id: "alien-vs-predator", pattern: "aliens?\\s*(?:vs\\.?|versus)\\s*predator" },
  { id: "samurai-shodown", pattern: "samurai\\s*show?down" },
  { id: "super-fire-pro-wrestling-x", pattern: "super\\s*fire\\s*pro\\s*wrestling\\s*x(?!\\w)" },
  { id: "smash-tv", pattern: "smash\\s*t\\.?\\s*v(?!\\w)" },
  { id: "total-carnage", pattern: "total\\s*carnage" },
  { id: "cannon-fodder", pattern: "cannon\\s*fodder" },
  { id: "halloween-wizard-video", pattern: "^halloween$" },
  { id: "texas-chainsaw-massacre", pattern: "chain\\s*saw\\s*massacre" },
  { id: "bloody-human-freeway", pattern: "bloody\\s*human" },
  { id: "splatterhouse", pattern: "splatterhouse" },
  { id: "primal-rage", pattern: "primal\\s*rage" },
  { id: "weaponlord", pattern: "weapon\\s*lord" },
  { id: "time-killers", pattern: "time\\s*killers" },
  { id: "turok", pattern: "\\bturok\\b" },
  { id: "carmageddon", pattern: "carmageddon" },
  { id: "duke-nukem", pattern: "duke\\s*nukem" },
  { id: "quake", pattern: "\\bquake\\b" },
  { id: "resident-evil", pattern: "resident\\s*evil" },
  { id: "perfect-dark", pattern: "perfect\\s*dark" },
  { id: "grand-theft-auto", pattern: "grand\\s*theft\\s*auto" },
];
