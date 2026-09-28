/**
 * Generates gameMetadata.generated.ts from the individual metadata.ts files in games/ and apps/.
 * Run with: pnpm generate:metadata (or npx tsx scripts/generate-game-metadata.ts)
 *
 * The logic is in gameMetadataGen.ts (tested in
 * src/shared/lib/__tests__/gameMetadataGenerator.test.ts). This file only runs it.
 */

import * as fs from "fs";
import * as path from "path";
import { generateOutput, scanMetadata } from "./gameMetadataGen";

const SRC_DIR = path.join(__dirname, "..", "src");
const OUTPUT_FILE = path.join(SRC_DIR, "shared", "lib", "gameMetadata.generated.ts");

const games = scanMetadata(SRC_DIR, "games");
const apps = scanMetadata(SRC_DIR, "apps");
const allItems = [...games, ...apps];

console.log(`Found ${games.length} games and ${apps.length} apps`);

fs.writeFileSync(OUTPUT_FILE, generateOutput(allItems));

console.log(`Generated ${OUTPUT_FILE}`);
