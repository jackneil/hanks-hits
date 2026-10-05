import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { PROGRESS_STORAGE_KEYS } from "@/lib/owner-bound-progress/keys";

export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "__tests__" ? [] : sourceFiles(full);
    return /\.[cm]?[jt]sx?$/.test(entry.name) &&
      !/\.(test|spec|d)\.[cm]?[jt]sx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

/** Fail closed on options the static contract cannot inspect. */
export function inspectPersist(source: string) {
  const file = ts.createSourceFile(
    "store.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const imports = new Map<string, { module: string; member: string }>();
  const factories = new Map<string, ts.Expression>();
  const findings: string[] = [];
  for (const statement of file.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "zustand/middleware"
    ) {
      const clause = statement.exportClause;
      if (
        !clause ||
        !ts.isNamedExports(clause) ||
        clause.elements.some(
          (item) =>
            !item.isTypeOnly &&
            (item.propertyName ?? item.name).text === "persist",
        )
      ) {
        findings.push(
          "persist must not be hidden behind a middleware re-export",
        );
      }
    }
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      statement.parameters.length === 0 &&
      statement.body?.statements.length === 1
    ) {
      const result = statement.body.statements[0];
      if (ts.isReturnStatement(result) && result.expression)
        factories.set(statement.name.text, result.expression);
    }
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements)
        imports.set(binding.name.text, {
          module: statement.moduleSpecifier.text,
          member: (binding.propertyName ?? binding.name).text,
        });
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      imports.set(bindings.name.text, {
        module: statement.moduleSpecifier.text,
        member: "*",
      });
    }
  }
  const isImported = (node: ts.Expression, module: string, member: string) => {
    if (ts.isIdentifier(node)) {
      const imported = imports.get(node.text);
      return imported?.module === module && imported.member === member;
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression)
    ) {
      const imported = imports.get(node.expression.text);
      return (
        imported?.module === module &&
        imported.member === "*" &&
        node.name.text === member
      );
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      const imported = imports.get(node.expression.text);
      return (
        imported?.module === module &&
        imported.member === "*" &&
        node.argumentExpression.text === member
      );
    }
    return false;
  };
  const literal = (node: ts.Node | undefined) =>
    node && ts.isStringLiteralLike(node) ? node.text : undefined;
  const stores: { key: string; appId: string }[] = [];
  let count = 0;
  let referencesPersist = [...imports.values()].some(
    ({ module, member }) =>
      module === "zustand/middleware" && member === "persist",
  );
  const visit = (node: ts.Node) => {
    if (!node.parent) {
      ts.forEachChild(node, visit);
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.arguments.some(
        (argument) =>
          ts.isStringLiteral(argument) &&
          argument.text === "zustand/middleware",
      ) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      findings.push("middleware must use a statically inspectable import");
    }
    const parent = node.parent;
    const declarationName =
      ts.isImportSpecifier(parent) ||
      ts.isNamespaceImport(parent) ||
      (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
      (ts.isPropertyAssignment(parent) && parent.name === node);
    if (
      !declarationName &&
      (ts.isIdentifier(node) ||
        ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      isImported(node, "zustand/middleware", "persist")
    ) {
      referencesPersist = true;
      if (!ts.isCallExpression(parent) || parent.expression !== node)
        findings.push("persist references must be direct inspectable calls");
    }
    if (ts.isIdentifier(node) && !declarationName) {
      const imported = imports.get(node.text);
      if (
        imported?.module === "zustand/middleware" &&
        imported.member === "*"
      ) {
        const property =
          ts.isPropertyAccessExpression(parent) && parent.expression === node;
        const element =
          ts.isElementAccessExpression(parent) &&
          parent.expression === node &&
          ts.isStringLiteralLike(parent.argumentExpression);
        if (!property && !element)
          findings.push(
            "middleware namespace usage must name an inspectable member",
          );
      }
    }
    if (
      ts.isCallExpression(node) &&
      isImported(node.expression, "zustand/middleware", "persist")
    ) {
      count++;
      const options = node.arguments[1];
      if (!options || !ts.isObjectLiteralExpression(options)) {
        findings.push("persist options must be an inspectable object literal");
      } else {
        const properties = new Map<string, ts.Expression>();
        for (const property of options.properties) {
          if (
            !ts.isPropertyAssignment(property) ||
            (!ts.isIdentifier(property.name) &&
              !ts.isStringLiteral(property.name))
          ) {
            findings.push("persist options must use explicit properties");
            continue;
          }
          properties.set(property.name.text, property.initializer);
        }
        const name = properties.get("name");
        const key = literal(name);
        let storage = properties.get("storage");
        // The runner exposes a zero-argument factory returning the shared adapter.
        if (
          storage &&
          ts.isCallExpression(storage) &&
          storage.arguments.length === 0 &&
          ts.isIdentifier(storage.expression)
        ) {
          storage = factories.get(storage.expression.text) ?? storage;
        }
        if (
          !storage ||
          !ts.isCallExpression(storage) ||
          !isImported(
            storage.expression,
            "@/lib/owner-bound-progress/persistStorage",
            "createOwnerPersistStorage",
          )
        ) {
          findings.push(
            "persist must use the shared createOwnerPersistStorage adapter",
          );
        } else {
          const storageKey = literal(storage.arguments[0]);
          const appId = literal(storage.arguments[1]);
          // Named constants are checked by the real-store integration test.
          const inspectableName = !!key || (name && ts.isIdentifier(name));
          if (
            !inspectableName ||
            (key && storageKey !== key) ||
            !appId ||
            !storageKey ||
            PROGRESS_STORAGE_KEYS[appId] !== storageKey
          ) {
            findings.push(
              "persist name and adapter arguments must match the registered app/key",
            );
          } else stores.push({ key: storageKey, appId });
        }
        if (properties.get("skipHydration")?.kind !== ts.SyntaxKind.TrueKeyword)
          findings.push("persist must defer hydration to the owner binding");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (referencesPersist && count === 0)
    findings.push("persist import must have a directly inspectable call");
  return { count, stores, findings };
}

export function persistedSourceInventory() {
  const src = path.resolve(__dirname, "..");
  return sourceFiles(src)
    .map((file) => ({
      file: path.relative(src, file),
      ...inspectPersist(readFileSync(file, "utf8")),
    }))
    .filter((entry) => entry.count > 0 || entry.findings.length > 0);
}
