/**
 * The plain-literal fields of a game or app metadata.ts file.
 *
 * This is the discovery contract. Two readers use it:
 * - the runtime home-page scan (game-registry.ts parseMetadata), and
 * - the build-time lookup generator (scripts/generate-game-metadata.ts).
 * Both read the file text with the patterns below, so they can never
 * disagree about a field. The file is never imported or run.
 *
 * Rules:
 * - A value must be a plain literal: a string in quotes, or true / false.
 *   A computed value (a variable, a call) is not read, and the field then
 *   has its default.
 * - A field name must start at a word boundary, so "gameId:" is never read
 *   as "id:" and "clipsScrubbed:" is never read as "clips:".
 *
 * This module has no imports, so the generator script can use it.
 */

export interface MetadataLiterals {
  id?: string;
  name?: string;
  emoji?: string;
  category?: string;
  description?: string;
  hidden?: boolean;
  madeByKid?: boolean;
  /** The module records gameplay clips (plan 4.1: ClipProvider mounts only for clips: true). */
  clips?: boolean;
  /**
   * The orientation the game plays best in on a phone. GameShell shows the
   * orientation tip once per session when the phone is held the other
   * way. Absent (or "any") for a game that plays well both ways.
   */
  preferredOrientation?: "portrait" | "landscape";
}

const ORIENTATIONS = new Set(["portrait", "landscape"]);

function orientationField(content: string): "portrait" | "landscape" | undefined {
  const value = stringField(content, "preferredOrientation");
  return value && ORIENTATIONS.has(value) ? (value as "portrait" | "landscape") : undefined;
}

function stringField(content: string, field: string): string | undefined {
  const match = new RegExp(`\\b${field}:\\s*["']([^"']+)["']`).exec(content);
  return match ? match[1] : undefined;
}

function booleanField(content: string, field: string): boolean | undefined {
  const match = new RegExp(`\\b${field}:\\s*(true|false)\\b`).exec(content);
  return match ? match[1] === "true" : undefined;
}

/** Reads every plain-literal field of a metadata.ts file. A missing field is undefined. */
export function readMetadataLiterals(content: string): MetadataLiterals {
  return {
    id: stringField(content, "id"),
    name: stringField(content, "name"),
    emoji: stringField(content, "emoji"),
    category: stringField(content, "category"),
    description: stringField(content, "description"),
    hidden: booleanField(content, "hidden"),
    madeByKid: booleanField(content, "madeByKid"),
    clips: booleanField(content, "clips"),
    preferredOrientation: orientationField(content),
  };
}
