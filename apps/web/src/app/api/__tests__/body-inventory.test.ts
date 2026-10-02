// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { BODY_READER_MODULE, REQUEST_HELPERS, ROUTE_FILE } from "@/lib/boundedBodyRule.mjs";

// The route inventory: every route file under src/app, the methods that
// can carry a body, and the limits that each one reads its body with.
//
// The lint rule (hanks-hits/bounded-request-body) sees the body reads in a
// file. It does not see a library that reads the body: Auth.js read every
// POST to /api/auth/* with no limit because the route exported Auth.js's
// own handler (`export const { GET, POST } = handlers`). So this test reads
// the exports of each route from its syntax tree and fails:
// - on a route file that is not in INVENTORY (a new route must choose its
//   limits here, where a review sees them);
// - on a route whose bounded reads differ from INVENTORY;
// - on a POST, PUT, PATCH, DELETE or OPTIONS that is not a function of the
//   route file: an export of a library's handler (a member, an import, a
//   re-export, `export *`, a destructuring), a handler made by a function
//   of another module (a wrapper that can read the body first), an
//   `export let` or `export var` (it can be assigned a library's handler
//   later), or a handler whose name is assigned again (handler = ...).
// The limits of a read count only when they are a preset that the route
// imports from @/lib/read-body. A constant of the route with the same name
// (a shadow) is "<local:NAME>", so it does not match the inventory.
// It also checks that each helper in REQUEST_HELPERS takes the request in a
// parameter typed Request or NextRequest, so the lint rule follows the
// request into it, and that the app has no Pages Router (its API routes are
// outside src/app, the lint rule and this inventory).

const WEB_ROOT = path.resolve(__dirname, "../../../..");

/** The methods whose request can carry a body. Next.js gives GET and HEAD no body. */
const BODY_METHODS = ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const METHODS = new Set(["GET", "HEAD", ...BODY_METHODS]);
const READERS = new Set(["readJson", "readBody"]);

type Inventory = Record<string, { bodyMethods: string[]; reads: string[]; why?: string }>;

/**
 * Every route file, the methods that can carry a body, and its bounded reads
 * as "<reader>(<limits>)". A route with body methods and no read gives the
 * reason in `why`.
 */
const INVENTORY: Inventory = {
  "src/app/api/auth/[...nextauth]/route.ts": { bodyMethods: ["POST"], reads: ["readBody(SMALL_JSON_BODY)"] },
  "src/app/api/auth/signup/route.ts": { bodyMethods: ["POST"], reads: ["readJson(SMALL_JSON_BODY)"] },
  "src/app/api/clips-config/dogfood/route.ts": {
    bodyMethods: ["DELETE", "POST"],
    reads: [],
    why: "POST and DELETE read no body: the session, an origin check and a cookie only.",
  },
  "src/app/api/clips-config/route.ts": { bodyMethods: [], reads: [] },
  "src/app/api/gaming-profile/route.ts": { bodyMethods: ["PATCH"], reads: ["readJson(SMALL_SAVE_BODY)"] },
  "src/app/api/leaderboards/[appId]/route.ts": { bodyMethods: [], reads: [] },
  "src/app/api/leaderboards/my-ranks/route.ts": { bodyMethods: [], reads: [] },
  "src/app/api/profile/route.ts": { bodyMethods: ["PATCH"], reads: ["readJson(SMALL_SAVE_BODY)"] },
  "src/app/api/progress/[appId]/route.ts": {
    bodyMethods: ["DELETE", "POST"],
    reads: ["readJson(PROGRESS_SAVE_BODY)"],
  },
  "src/app/api/progress/route.ts": { bodyMethods: [], reads: [] },
  "src/app/api/roms/[...path]/route.ts": { bodyMethods: [], reads: [] },
};

/** What a route file exports and reads, from its syntax tree. */
interface RouteFacts {
  /** The methods that the file exports. */
  methods: Set<string>;
  /** The file has `export * from` (it can export any method). */
  starExport: boolean;
  /**
   * Each call of readJson or readBody (value imports from @/lib/read-body),
   * as "<reader>(<limits>)". <limits> is the name of a preset imported from
   * @/lib/read-body, "<local:NAME>" for any other name, or "<inline>".
   */
  reads: string[];
  /** The body methods that are not a function of this file. */
  foreignHandlers: string[];
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (/\.[cm]?tsx$/.test(fileName) || fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function unwrap(value: ts.Expression | undefined): ts.Expression | undefined {
  let target = value;
  while (
    target &&
    (ts.isAsExpression(target) ||
      ts.isNonNullExpression(target) ||
      ts.isSatisfiesExpression(target) ||
      ts.isParenthesizedExpression(target) ||
      ts.isTypeAssertionExpression(target))
  ) {
    target = target.expression;
  }
  return target;
}

function routeFacts(fileName: string, text: string): RouteFacts {
  const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const facts: RouteFacts = { methods: new Set(), starExport: false, reads: [], foreignHandlers: [] };
  const imported = new Set<string>();
  const readerNames = new Map<string, string>(); // local name -> readJson | readBody
  const presetNames = new Map<string, string>(); // local name -> the preset's export name
  const readerNamespaces = new Set<string>(); // import * as x from "@/lib/read-body"
  const localFunctions = new Set<string>();
  const localValues = new Map<string, ts.Expression | undefined>();
  const exported: Array<{ method: string; value: ts.Expression | undefined; foreign: boolean }> = [];
  const isExported = (node: ts.Node) =>
    ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause && !statement.importClause.isTypeOnly) {
      const from = (statement.moduleSpecifier as ts.StringLiteral).text;
      const clause = statement.importClause;
      if (clause.name) imported.add(clause.name.text);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        imported.add(bindings.name.text);
        if (from === BODY_READER_MODULE) readerNamespaces.add(bindings.name.text);
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue;
          imported.add(element.name.text);
          const original = (element.propertyName ?? element.name).text;
          if (from === BODY_READER_MODULE && READERS.has(original)) readerNames.set(element.name.text, original);
          else if (from === BODY_READER_MODULE) presetNames.set(element.name.text, original);
        }
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      localFunctions.add(statement.name.text);
      if (isExported(statement) && METHODS.has(statement.name.text)) {
        facts.methods.add(statement.name.text);
        // Checked like any export: `POST = handlers.POST` later in the file makes it foreign.
        exported.push({ method: statement.name.text, value: ts.factory.createIdentifier(statement.name.text), foreign: false });
      }
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      localValues.set(statement.name.text, undefined);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const init = unwrap(declaration.initializer);
          localValues.set(declaration.name.text, init);
          if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) localFunctions.add(declaration.name.text);
          if (isExported(statement) && METHODS.has(declaration.name.text)) {
            facts.methods.add(declaration.name.text);
            // export let POST = ...; POST = handlers.POST: only a const keeps the function of the file.
            const isConst = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
            exported.push({ method: declaration.name.text, value: init, foreign: !isConst });
          }
        } else if (isExported(statement)) {
          // export const { POST } = handlers: a library's handler as it is.
          for (const element of declaration.name.elements) {
            if (ts.isBindingElement(element) && ts.isIdentifier(element.name) && METHODS.has(element.name.text)) {
              facts.methods.add(element.name.text);
              exported.push({ method: element.name.text, value: undefined, foreign: true });
            }
          }
        }
      }
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
        facts.starExport = true; // export * from "...", export * as x from "..."
        continue;
      }
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly || !METHODS.has(element.name.text)) continue;
        facts.methods.add(element.name.text);
        const local = (element.propertyName ?? element.name).text;
        exported.push({
          method: element.name.text,
          value: statement.moduleSpecifier ? undefined : ts.factory.createIdentifier(local),
          foreign: Boolean(statement.moduleSpecifier),
        });
      }
    }
  }

  // Every name that the file declares (also in a function), and every name
  // that it assigns after its declaration. An import that a local name
  // shadows is not the import; a handler whose name is assigned can be any
  // function.
  const declaredNames = new Set<string>();
  const assignedNames = new Set<string>();
  const addBindingNames = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) declaredNames.add(name.text);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) addBindingNames(element.name);
  };
  const addAssignedNames = (target: ts.Expression): void => {
    const node = unwrap(target);
    if (!node) return;
    if (ts.isIdentifier(node)) assignedNames.add(node.text);
    else if (ts.isArrayLiteralExpression(node)) node.elements.forEach((element) => addAssignedNames(ts.isSpreadElement(element) ? element.expression : element));
    else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) addAssignedNames(property.initializer);
        else if (ts.isShorthandPropertyAssignment(property)) assignedNames.add(property.name.text);
        else if (ts.isSpreadAssignment(property)) addAssignedNames(property.expression);
      }
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) addAssignedNames(node.left);
  };
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) addBindingNames(node.name);
    else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) {
      declaredNames.add(node.name.text);
    } else if (ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) {
      if (ts.isIdentifier(node.name)) declaredNames.add(node.name.text);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      addAssignedNames(node.left);
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && ts.isIdentifier(node.operand)) {
      if (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) assignedNames.add(node.operand.text);
    }
    if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      if (!ts.isVariableDeclarationList(node.initializer)) addAssignedNames(node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  collect(file);
  /** True for an import of @/lib/read-body that no local name shadows. */
  const isReaderImport = (name: string) => !declaredNames.has(name) && !assignedNames.has(name);

  /** The limits argument of a read, as the inventory writes it. */
  const limitsOf = (limits: ts.Expression | undefined): string => {
    const target = unwrap(limits);
    if (target && ts.isIdentifier(target)) {
      const preset = presetNames.get(target.text);
      return preset !== undefined && isReaderImport(target.text) ? preset : `<local:${target.text}>`;
    }
    if (
      target &&
      ts.isPropertyAccessExpression(target) &&
      ts.isIdentifier(target.expression) &&
      readerNamespaces.has(target.expression.text) &&
      isReaderImport(target.expression.text)
    ) {
      return target.name.text;
    }
    return "<inline>";
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      let reader: string | undefined;
      if (callee && ts.isIdentifier(callee) && isReaderImport(callee.text)) reader = readerNames.get(callee.text);
      else if (
        callee &&
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        readerNamespaces.has(callee.expression.text) &&
        isReaderImport(callee.expression.text) &&
        READERS.has(callee.name.text)
      ) {
        reader = callee.name.text;
      }
      if (reader) facts.reads.push(`${reader}(${limitsOf(node.arguments[1])})`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  /**
   * True for a value that is not a function of this file: a member
   * (handlers.POST), an import, a name that the file does not declare, or a
   * call of a function that the file does not declare (a library wrapper).
   */
  const isForeign = (value: ts.Expression | undefined, depth = 0): boolean => {
    const target = unwrap(value);
    if (!target || depth > 8) return true;
    if (ts.isArrowFunction(target) || ts.isFunctionExpression(target)) return false;
    if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) return true;
    if (ts.isCallExpression(target)) {
      // wrap(handler): a local wrapper of local functions is the file's own code.
      const callee = unwrap(target.expression);
      if (!callee || !ts.isIdentifier(callee) || !localFunctions.has(callee.text)) return true;
      return target.arguments.some((argument) => isForeign(argument, depth + 1));
    }
    if (!ts.isIdentifier(target)) return true;
    if (imported.has(target.text)) return true;
    // handler = handlers.POST somewhere in the file: the export can be any function.
    if (assignedNames.has(target.text)) return true;
    if (localFunctions.has(target.text)) return false;
    if (localValues.has(target.text)) return isForeign(localValues.get(target.text), depth + 1);
    return true;
  };
  for (const { method, value, foreign } of exported) {
    if (!BODY_METHODS.includes(method as (typeof BODY_METHODS)[number])) continue;
    if (foreign || isForeign(value)) facts.foreignHandlers.push(method);
  }
  return facts;
}

const bodyMethodsOf = (facts: RouteFacts) =>
  BODY_METHODS.filter((method) => facts.methods.has(method)).sort();

describe("the route inventory reader (its own fixtures)", () => {
  it("sees a library's handler exported in each way (the shapes that read a body with no limit)", () => {
    const foreign = (code: string) => routeFacts("src/app/api/fx/route.ts", code).foreignHandlers;
    // The Auth.js route as it was before this change.
    expect(foreign(`import { handlers } from "@/lib/auth";\nexport const { GET, POST } = handlers;\n`)).toEqual(["POST"]);
    expect(foreign(`import { handlers } from "@/lib/auth";\nexport const POST = handlers.POST;\n`)).toEqual(["POST"]);
    expect(foreign(`import { handlers } from "@/lib/auth";\nconst p = handlers.POST;\nexport { p as POST };\n`)).toEqual(["POST"]);
    expect(foreign(`import { POST as libPost } from "lib";\nexport const POST = libPost;\n`)).toEqual(["POST"]);
    expect(foreign(`import { POST as p } from "lib";\nexport { p as DELETE };\n`)).toEqual(["DELETE"]);
    expect(foreign(`export { POST } from "lib";\n`)).toEqual(["POST"]);
    expect(foreign(`import { withAuth } from "lib";\nexport const PATCH = withAuth(async (r: Request) => new Response());\n`)).toEqual(["PATCH"]);
    expect(foreign(`import { handlers } from "@/lib/auth";\nexport const OPTIONS = handlers.POST as never;\n`)).toEqual(["OPTIONS"]);
    // An export that the file assigns a library's handler later.
    expect(foreign(`import { handlers } from "@/lib/auth";\nexport let POST = async (r: Request) => new Response();\nPOST = handlers.POST;\n`)).toEqual(["POST"]);
    expect(foreign(`export var POST = async (r: Request) => new Response();\n`)).toEqual(["POST"]);
    expect(foreign(`import { handlers } from "@/lib/auth";\nasync function handler(r: Request) { return new Response(); }\n// @ts-expect-error a function name\nhandler = handlers.POST;\nexport { handler as POST };\n`)).toEqual(["POST"]);
    expect(foreign(`import { handlers } from "@/lib/auth";\nexport async function POST(r: Request) { return new Response(); }\n// @ts-expect-error a function name\nPOST = handlers.POST;\n`)).toEqual(["POST"]);
    expect(foreign(`import { handlers } from "@/lib/auth";\nlet handler = async (r: Request) => new Response();\n[handler] = [handlers.POST];\nexport { handler as PATCH };\n`)).toEqual(["PATCH"]);
    expect(routeFacts("r.ts", `export * from "lib";\n`).starExport).toBe(true);
    expect(routeFacts("r.ts", `export * as h from "lib";\n`).starExport).toBe(true);
  });

  it("takes a function of the file (also out of line, or wrapped by a function of the file) as its own", () => {
    const foreign = (code: string) => routeFacts("src/app/api/fx/route.ts", code).foreignHandlers;
    expect(foreign(`export async function POST() { return new Response(); }\n`)).toEqual([]);
    expect(foreign(`async function handler() { return new Response(); }\nexport const POST = handler;\n`)).toEqual([]);
    expect(foreign(`async function handler() { return new Response(); }\nexport { handler as POST };\n`)).toEqual([]);
    expect(foreign(`const wrap = (f: unknown) => f;\nconst handler = wrap(async () => new Response());\nexport { handler as PUT };\n`)).toEqual([]);
    // A GET of a library is fine: Next.js gives GET no body.
    expect(foreign(`import { handlers } from "@/lib/auth";\nexport const { GET } = handlers;\n`)).toEqual([]);
  });

  it("counts only called value imports of the bounded reader, with their limits", () => {
    const reads = (code: string) => routeFacts("r.ts", code).reads;
    expect(reads(`import { readJson, SMALL_JSON_BODY } from "@/lib/read-body";\nexport async function POST(r: Request) { return Response.json(await readJson(r, SMALL_JSON_BODY)); }\n`)).toEqual(["readJson(SMALL_JSON_BODY)"]);
    expect(reads(`import { readBody as read } from "@/lib/read-body";\nexport async function POST(r: Request) { return Response.json(await read(r, { maxBytes: 1, timeoutMs: null })); }\n`)).toEqual(["readBody(<inline>)"]);
    expect(reads(`import * as b from "@/lib/read-body";\nexport async function POST(r: Request) { return Response.json(await b.readJson(r, b.SMALL_JSON_BODY)); }\n`)).toEqual(["readJson(SMALL_JSON_BODY)"]);
    expect(reads(`import { readJson, SMALL_JSON_BODY as LIMITS } from "@/lib/read-body";\nexport async function POST(r: Request) { return Response.json(await readJson(r, LIMITS)); }\n`)).toEqual(["readJson(SMALL_JSON_BODY)"]);
    expect(reads(`import { readJson } from "@/lib/read-body";\nexport async function POST() { return new Response(); }\n`)).toEqual([]);
    expect(reads(`import type { readJson } from "@/lib/read-body";\nexport async function POST() { return new Response(); }\n`)).toEqual([]);
  });

  it("records a constant of the route that has the name of a preset as <local:NAME> (it is not the preset)", () => {
    const reads = (code: string) => routeFacts("r.ts", code).reads;
    // The route's own constant in place of the import (review: no byte or time limit, and the inventory passed).
    expect(
      reads(`import { readJson, type BodyLimits } from "@/lib/read-body";\nconst SMALL_JSON_BODY: BodyLimits = { maxBytes: Number.MAX_SAFE_INTEGER, timeoutMs: null };\nexport async function POST(r: Request) { return Response.json(await readJson(r, SMALL_JSON_BODY as never)); }\n`)
    ).toEqual(["readJson(<local:SMALL_JSON_BODY>)"]);
    // A shadow inside the handler, with the real import also there.
    expect(
      reads(`import { readJson, SMALL_JSON_BODY } from "@/lib/read-body";\nexport async function POST(r: Request) { const SMALL_JSON_BODY = { maxBytes: 1e12, timeoutMs: null, maxJsonValues: null }; return Response.json(await readJson(r, SMALL_JSON_BODY)); }\n`)
    ).toEqual(["readJson(<local:SMALL_JSON_BODY>)"]);
    // A local function with the name of a reader is not the reader.
    expect(
      reads(`import { readJson, SMALL_JSON_BODY } from "@/lib/read-body";\nexport async function POST(r: Request) { const readJson = async (x: Request, _l: unknown) => x; return Response.json(await readJson(r, SMALL_JSON_BODY)); }\n`)
    ).toEqual([]);
  });

  it("sees a route.tsx file and the other extensions", () => {
    for (const file of ["a/route.ts", "a/route.tsx", "a/route.js", "a/route.jsx", "a/route.mts", "a/route.cjs"]) {
      expect(ROUTE_FILE.test(file)).toBe(true);
    }
    expect(ROUTE_FILE.test("a/route.test.ts")).toBe(false);
    const facts = routeFacts("src/app/api/fx/route.tsx", `export async function POST() { return <div />; }\n`);
    expect([...facts.methods]).toEqual(["POST"]);
  });
});

describe("the route inventory", () => {
  it("the app has no Pages Router and no app folder outside src (their API routes are outside the lint rule and this inventory)", () => {
    // A Pages Router API route has its own body parser (bodyParser: false
    // turns it off; a 300 MiB body raised the RSS by 300 MiB), and Next.js
    // uses a root app/ folder in place of src/app.
    for (const folder of ["src/pages", "pages", "app"]) {
      expect(existsSync(path.join(WEB_ROOT, folder)), `${folder} must not exist; add it to the lint rule and the inventory first`).toBe(false);
    }
  });

  const routes = (readdirSync(path.join(WEB_ROOT, "src/app"), { recursive: true }) as string[])
    .map((file) => `src/app/${file.split(path.sep).join("/")}`)
    .filter((file) => ROUTE_FILE.test(file) && !file.includes("/__tests__/"))
    .sort();
  const facts = new Map(routes.map((file) => [file, routeFacts(file, readFileSync(path.join(WEB_ROOT, file), "utf8"))]));

  it("lists every route file under src/app, and nothing else", () => {
    expect(routes).toEqual(Object.keys(INVENTORY).sort());
  });

  it.each(Object.keys(INVENTORY).sort())("%s reads its body with the limits in the inventory", (file) => {
    const route = facts.get(file);
    expect(route, "the route file exists").toBeDefined();
    const expected = INVENTORY[file];
    expect(route!.starExport).toBe(false);
    expect(route!.foreignHandlers).toEqual([]);
    expect(bodyMethodsOf(route!)).toEqual([...expected.bodyMethods].sort());
    expect([...new Set(route!.reads)].sort()).toEqual([...expected.reads].sort());
    if (expected.bodyMethods.length > 0 && expected.reads.length === 0) {
      expect(expected.why ?? "", "a route with body methods and no read gives the reason").not.toBe("");
    }
  });
});

describe("the request helpers (functions outside a route that may get the request)", () => {
  it.each(Object.entries(REQUEST_HELPERS).flatMap(([source, helpers]) => Object.entries(helpers).map(([name, index]) => [source, name, index] as const)))(
    "%s %s takes the request in a parameter typed Request, so the lint rule follows it",
    (source, name, index) => {
      expect(source.startsWith("@/lib/")).toBe(true);
      const base = path.join(WEB_ROOT, "src", source.slice(2));
      const fileName = [".ts", ".tsx", "/index.ts"].map((ext) => base + ext).find((candidate) => existsSync(candidate));
      expect(fileName, `${source} exists`).toBeDefined();
      const file = ts.createSourceFile(fileName!, readFileSync(fileName!, "utf8"), ts.ScriptTarget.Latest, true);
      const fn = file.statements.find(
        (statement): statement is ts.FunctionDeclaration =>
          ts.isFunctionDeclaration(statement) &&
          statement.name?.text === name &&
          (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      );
      expect(fn, `${source} exports function ${name}`).toBeDefined();
      const param = fn!.parameters[index];
      expect(param, `${name} has a parameter at ${index}`).toBeDefined();
      const type = param.type?.getText(file) ?? "";
      expect(type.split("|").map((part) => part.trim())).toEqual(expect.arrayContaining([expect.stringMatching(/^(Request|NextRequest)$/)]));
    }
  );
});
