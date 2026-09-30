import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Source scan for keyboard copy on a phone (2026 phone audit, root cause
// S5): "Press Space", "press E", "Escape to go back", "Click to launch",
// "WASD" and friends leaked to touch viewports with no branch at all. A
// finger has no Space bar. This test walks every game and app module and
// fails on a keyboard phrase that is not inside a coarse-pointer branch.
//
// A phrase passes when one of these holds:
// - it sits in a `keyboardHints` prop or a `keyboard` / `keyboardHints`
//   object slot (the shared GameStartOverlay picks the touch set on a
//   coarse pointer);
// - it sits in a ternary, `&&`/`||`, or `if` whose condition names a
//   coarse-pointer value: a variable set from useCoarsePointer(), a call to
//   isCoarsePointer(), or a prop/param named isCoarse, isCoarsePointer,
//   coarse, isMobile or mobile;
// - it sits in a statement after `if (<coarse>) return ...` in the same
//   block (the helper pattern in lib/instructions.ts and overlayCopy.ts).
//
// Key names used as code (e.key === "Escape", ["ArrowUp", ...], a switch
// case, an addEventListener name) are not copy and are skipped.

const WEB_SRC = path.resolve(__dirname, "../../../..");
const SCAN_ROOTS = ["games", "apps"].map((dir) => path.join(WEB_SRC, dir));

/** The phrases a phone must never read. */
export const KEYBOARD_COPY = new RegExp(
  [
    String.raw`\bPress [A-Z]`,
    String.raw`\bpress (E|R|T|Q|M|P|C|I|Space|Enter|Escape|any key|SPACE)\b`,
    String.raw`\bEscape\b`,
    String.raw`\bClick `,
    String.raw`\bWASD\b`,
    String.raw`\bArrow [Kk]eys?\b`,
    String.raw`\bSPACE\b`,
    String.raw`\bESC\b`,
    String.raw`\bSpace (to|bar|for|or|=|/)`,
  ].join("|")
);

/** Strings that match the regex but are not copy. */
const NOT_COPY = [
  // A font family name.
  /Press Start 2P/,
];

/** Data files whose strings are titles, not instructions (ROM catalogs). */
const NOT_COPY_FILES = [/retro-arcade\/lib\/.*catalog\.ts$/];

/** Names a coarse-pointer flag travels under when passed as a prop or param. */
const COARSE_NAMES = new Set([
  "isCoarse",
  "isCoarsePointer",
  "coarse",
  "coarsePointer",
  "isMobile",
  "mobile",
  "isTouch",
]);

type Hit = { file: string; line: number; text: string };

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      listSourceFiles(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
    out.push(full);
  }
  return out;
}

/** The coarse-pointer identifiers this file can branch on. */
function coarseIdentifiers(source: ts.SourceFile): Set<string> {
  const names = new Set(COARSE_NAMES);
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "useCoarsePointer"
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/** True when the expression mentions a coarse-pointer value. */
function mentionsCoarse(node: ts.Node, names: Set<string>): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isIdentifier(n) && names.has(n.text)) {
      found = true;
      return;
    }
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === "isCoarsePointer"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function containsReturn(node: ts.Node): boolean {
  if (ts.isReturnStatement(node)) return true;
  let found = false;
  ts.forEachChild(node, (child) => {
    if (found) return;
    // A nested function's return is not this block's return.
    if (ts.isFunctionLike(child)) return;
    if (containsReturn(child)) found = true;
  });
  return found;
}

/** `if (<coarse>) return X;` earlier in the same block. */
function precededByCoarseReturn(statement: ts.Node, names: Set<string>): boolean {
  const block = statement.parent;
  if (!block || !ts.isBlock(block)) return false;
  const index = block.statements.indexOf(statement as ts.Statement);
  if (index < 0) return false;
  return block.statements.slice(0, index).some(
    (earlier) =>
      ts.isIfStatement(earlier) &&
      mentionsCoarse(earlier.expression, names) &&
      containsReturn(earlier.thenStatement)
  );
}

/** True when the literal sits inside a coarse-pointer branch. */
function isBranched(literal: ts.Node, names: Set<string>): boolean {
  let node: ts.Node = literal;
  while (node.parent) {
    const parent = node.parent;
    if (ts.isJsxAttribute(parent) && parent.name.getText() === "keyboardHints") return true;
    if (
      ts.isPropertyAssignment(parent) &&
      /^(keyboard|keyboardHints)$/.test(parent.name.getText())
    ) {
      return true;
    }
    if (ts.isConditionalExpression(parent) && mentionsCoarse(parent.condition, names)) {
      return true;
    }
    if (
      ts.isBinaryExpression(parent) &&
      (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
      mentionsCoarse(parent.left, names)
    ) {
      return true;
    }
    if (ts.isIfStatement(parent) && mentionsCoarse(parent.expression, names)) return true;
    if (ts.isBlock(parent) && precededByCoarseReturn(node, names)) return true;
    node = parent;
  }
  return false;
}

/** Key names used as code, not as copy. */
function isCodeUse(literal: ts.Node): boolean {
  const parent = literal.parent;
  if (!parent) return false;
  if (ts.isBinaryExpression(parent)) {
    const kind = parent.operatorToken.kind;
    if (
      kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      kind === ts.SyntaxKind.EqualsEqualsToken ||
      kind === ts.SyntaxKind.ExclamationEqualsToken
    ) {
      return true;
    }
  }
  if (ts.isCaseClause(parent)) return true;
  if (ts.isArrayLiteralExpression(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === literal) return true;
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression;
    const name = ts.isPropertyAccessExpression(callee)
      ? callee.name.text
      : ts.isIdentifier(callee)
        ? callee.text
        : "";
    if (
      /^(includes|has|matches|closest|querySelector|querySelectorAll|addEventListener|removeEventListener|startsWith|endsWith|getElementById|setAttribute|test)$/.test(
        name
      )
    ) {
      return true;
    }
  }
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  return false;
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
    return node.text;
  }
  if (ts.isJsxText(node)) return node.text;
  return null;
}

export function scanForKeyboardCopy(roots: string[] = SCAN_ROOTS): Hit[] {
  const hits: Hit[] = [];
  for (const root of roots) {
    for (const file of listSourceFiles(root)) {
      if (NOT_COPY_FILES.some((pattern) => pattern.test(file))) continue;
      const text = fs.readFileSync(file, "utf8");
      const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      );
      const names = coarseIdentifiers(source);
      const visit = (node: ts.Node) => {
        const copy = literalText(node);
        if (copy !== null && KEYBOARD_COPY.test(copy)) {
          const exempt = NOT_COPY.some((pattern) => pattern.test(copy));
          if (!exempt && !isCodeUse(node) && !isBranched(node, names)) {
            const { line } = source.getLineAndCharacterOfPosition(node.getStart());
            hits.push({
              file: path.relative(WEB_SRC, file),
              line: line + 1,
              text: copy.trim().replace(/\s+/g, " ").slice(0, 80),
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return hits;
}

describe("keyboard copy on a phone", () => {
  it("every keyboard phrase in games/** and apps/** sits in a coarse-pointer branch", () => {
    const hits = scanForKeyboardCopy();
    const report = hits.map((h) => `${h.file}:${h.line}: "${h.text}"`).join("\n");
    expect(
      hits,
      `Keyboard copy outside a coarse-pointer branch (a phone has no keys). Branch it on useCoarsePointer() / isCoarsePointer(), or move it into keyboardHints:\n${report}`
    ).toEqual([]);
  });

  it("the regex catches the audit's phrases and spares the game titles", () => {
    for (const phrase of [
      "Press Space or Tap to Restart",
      "Walk up and press E",
      "Press Escape to go back",
      "Escape to pause",
      "👆 Click or press Space to launch!",
      "Use WASD or Arrow Keys to move",
      "SPACE to fire",
      "ESC to pause",
      "⌨️ Space to flap",
    ]) {
      expect(KEYBOARD_COPY.test(phrase), phrase).toBe(true);
    }
    for (const phrase of [
      "Space Invaders",
      "Tap to launch!",
      "Tap anywhere to drop bombs",
      "Drag or use arrow keys to pan",
      "Hyperspace!",
    ]) {
      expect(KEYBOARD_COPY.test(phrase), phrase).toBe(false);
    }
  });
});
