/**
 * Generates src/games/retro-arcade/lib/content-notice.generated.ts from
 * src/games/retro-arcade/lib/content-rules.json.
 * Run with: pnpm generate:content-notice (pnpm build runs it too).
 *
 * The logic is in contentNoticeGen.ts (tested in
 * src/games/retro-arcade/__tests__/content-notice.test.ts). This file only runs it.
 */

import * as fs from "fs";
import * as path from "path";
import { renderNoticeModule, type NoticeRuleSource } from "./contentNoticeGen";

const LIB_DIR = path.join(__dirname, "..", "src", "games", "retro-arcade", "lib");
const RULES_FILE = path.join(LIB_DIR, "content-rules.json");
const OUTPUT_FILE = path.join(LIB_DIR, "content-notice.generated.ts");

const data = JSON.parse(fs.readFileSync(RULES_FILE, "utf-8")) as { rules: NoticeRuleSource[] };
const output = renderNoticeModule(data.rules);
fs.writeFileSync(OUTPUT_FILE, output);

const count = data.rules.filter((rule) => rule.action === "notice").length;
console.log(`Generated ${OUTPUT_FILE} (${count} notice rules)`);
