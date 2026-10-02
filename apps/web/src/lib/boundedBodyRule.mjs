// The bounded-body rule: one source of truth for the ESLint rule
// hanks-hits/bounded-request-body (apps/web/eslint.config.mjs), its test
// and the route inventory (src/lib/__tests__/boundedBodyRule.test.ts).
//
// Plain ESM JavaScript, not TypeScript: eslint.config.mjs loads it with
// Node, with no build step. Paths are relative to apps/web.
//
// Why: a Next.js route handler has no body limit of its own (this app has
// no middleware), and the Railway service domain answers with no Cloudflare
// in front of it. request.json(), request.text(), request.formData(),
// request.arrayBuffer(), request.blob() and request.bytes() hold a body of
// ANY size in memory before the route can check it, also a chunked body
// with no Content-Length. A library that gets the request (Auth.js) does
// the same. Read a body with readJson or readBody (src/lib/read-body.ts).
// See design/ARCHITECTURE.md, section "Request bodies".
//
// The rule uses the scope manager, not only names. It finds the requests:
// - the first parameter of a route handler (GET, POST, PUT, PATCH, DELETE,
//   HEAD, OPTIONS) whatever its name and type: export function POST,
//   export const POST = (...) => ..., export const POST = handler,
//   export { handler as POST }, and the function arguments of a wrapper
//   (export const POST = wrap(async (x) => ...)); a rest parameter and
//   `arguments` of a handler hold the request too;
// - every parameter or variable typed Request or NextRequest (also in a
//   union: Request | null);
// - every variable whose name ends in the word "req" or "request" (request,
//   req, _request, incomingReq; not frequency or requestInit).
// It follows a request through an alias (const x = request; x = request;
// const y = (x = request)), a TypeScript cast or a non-null mark, ?:, ||,
// ??, a comma expression, await, new Request(...) or new NextRequest(...)
// with the request at any place (the new request can hold the same body),
// an array or an object that holds it (at any depth: [request],
// { a: { r: request } }, then x[0], o.a.r, a destructuring of it, also in
// an assignment, or a for-of loop over it), a call of a function in the
// same file (the parameter at the same place, every place from a spread
// argument on, also an IIFE), and the constructor of a class in the file.
//
// It fails closed. A use of a request that is not on its list of safe uses
// is "forwarded". The safe uses: a member that is not a body member
// (request.headers, request.url), a test (if, while, ?:, !, typeof), a
// comparison or other binary operator, an untagged template, a statement
// of its own, and the uses that it follows (above). So a request that is
// returned, thrown, yielded, given as a default value, stored in a member
// (o.r = request) or a class field (constructor(public r: Request)), given
// to a method of an array or a promise (map, forEach, then), or given to a
// function of the file that is assigned again, is reported.
//
// It reports:
// - "unbounded": a body member of a request (json, text, formData,
//   arrayBuffer, blob, bytes, body, clone), by name, by a string key
//   (request["json"]), or by a key that it cannot read (request[name]); the
//   same names in a destructuring (POST({ json }), const { text } = request);
//   Request.prototype.json (and the other members, with .call or .apply);
//   Reflect.get or Reflect.apply on a request.
// - "forwarded": a request (or an array or object that holds one) given to
//   code outside the file: a package (next-auth, any npm module), another
//   module of the app, a global function (fetch), a callback, or a method of
//   another object. A library can read the body with no limit (Auth.js
//   does), and the rule does not follow a request into another file. The
//   only code outside the file that may get a request is @/lib/read-body
//   and the helpers in REQUEST_HELPERS (the route inventory test checks
//   that each one takes the request in a parameter typed Request, so this
//   rule follows it in the helper's own file). A relative import of one of
//   them counts as the same module. Every other use that is not on the safe
//   list (above) is "forwarded" too.
//
// What it cannot see: a request that it does not know is one (a value
// with a neutral name and no Request type that is not the first parameter
// of a handler, for example one that a library gives back), and an
// eslint-disable comment for this rule (the rule's test fails on one,
// outside src/lib/read-body.ts). The route inventory test covers the export
// side: every route that exports POST, PUT, PATCH, DELETE or OPTIONS must
// export a function of its own file (never a library's handler, never an
// export let, never a name that the file assigns again), and every route
// must be in the inventory with the limits that it reads its body with.

/**
 * The rule covers the routes, the server library, and a Next.js middleware
 * or proxy file if one is added, in each extension that Next.js compiles.
 */
export const BOUNDED_BODY_LINT_FILES = Object.freeze([
  "src/app/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
  "src/lib/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
  "src/{middleware,proxy}.{js,mjs,ts,mts}",
]);

/** The extensions of a Next.js route file (route.ts, route.tsx, ...). */
export const ROUTE_FILE = /(^|\/)route\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;

/** Tests build requests and read answers freely. */
export const BOUNDED_BODY_TEST_IGNORES = Object.freeze(["**/__tests__/**", "**/*.{test,spec}.*"]);

/** The plugin namespace and the rule name, for eslint.config.mjs. */
export const BOUNDED_BODY_PLUGIN = "hanks-hits";
export const BOUNDED_BODY_RULE = "bounded-request-body";

export const UNBOUNDED_BODY_MESSAGE =
  "This reads a request body of any size into memory. Use readJson or readBody from @/lib/read-body (a byte limit counted while the body arrives).";

export const FORWARDED_BODY_MESSAGE =
  "This gives the request to code that this rule does not follow (code outside this file such as a package, another module, a global, a callback or a method of another object; or a return, a throw, a member, a class field or a default value), and that code can read the body with no limit. Read the body with readBody from @/lib/read-body, then give the code a new Request that holds the bytes (see src/app/api/auth/[...nextauth]/route.ts). A helper that reads only headers can go on REQUEST_HELPERS in src/lib/boundedBodyRule.mjs.";

/** The module of the bounded reader. Every export of it may get a request. */
export const BODY_READER_MODULE = "@/lib/read-body";

/**
 * The helpers outside the file that may get a request, by module and
 * export name, with the index of the parameter that takes it. Each one
 * reads headers only. The route inventory test checks that each parameter
 * is typed Request or NextRequest, so this rule follows the request into
 * the helper and reports a body read there.
 */
export const REQUEST_HELPERS = Object.freeze({
  "@/lib/rate-limit": Object.freeze({ getClientIP: 0 }),
});

/** The members of a Request that read (or copy) its body. */
const BODY_MEMBERS = new Set(["json", "text", "formData", "arrayBuffer", "blob", "bytes", "body", "clone"]);

/** The classes whose instances are requests (a type annotation, new X(request), X.prototype.json). */
const REQUEST_CLASSES = new Set(["Request", "NextRequest"]);

/** The exported functions of a route file that get the request as their first parameter. */
export const ROUTE_HANDLERS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/** Globals whose methods may get a request: they do not read a body. */
const HARMLESS_GLOBAL_OBJECTS = new Set(["console"]);

/** TypeScript wrappers that do not change the value: request as X, request!, request satisfies X. */
const TRANSPARENT = new Set([
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);
const FUNCTION_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/**
 * True for a variable name whose last word is "req" or "request" (request,
 * req, _request, incomingReq, nextRequest, REQUEST). Words split at
 * camelCase, "_", "$" and digits, so frequency, required and requestInit do
 * not count.
 */
function isRequestName(name) {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z]+/)
    .filter(Boolean);
  const last = words.at(-1)?.toLowerCase();
  return last === "req" || last === "request";
}

/**
 * The name of a member or a destructured key. Null when the key is computed
 * and cannot be read (request[name]); undefined for a key that is not a name.
 */
function keyName(key, computed) {
  if (!computed && key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  if (key.type === "TemplateLiteral" && key.expressions.length === 0) return key.quasis[0].value.cooked;
  return computed ? null : undefined;
}

/** True for a member name that is (or may be) a body member. */
function isBodyKey(name) {
  return name === null || (name !== undefined && BODY_MEMBERS.has(name));
}

/** True for a type that is (or holds, in a union) Request or NextRequest. */
function isRequestType(type) {
  if (!type) return false;
  if (type.type === "TSTypeAnnotation") return isRequestType(type.typeAnnotation);
  if (type.type === "TSUnionType" || type.type === "TSIntersectionType") return type.types.some(isRequestType);
  if (type.type !== "TSTypeReference") return false;
  const name = type.typeName.type === "TSQualifiedName" ? type.typeName.right.name : type.typeName.name;
  return REQUEST_CLASSES.has(name);
}

/** True for X.prototype where X is a request class. */
function isRequestPrototype(node) {
  return (
    node.type === "MemberExpression" &&
    keyName(node.property, node.computed) === "prototype" &&
    node.object.type === "Identifier" &&
    REQUEST_CLASSES.has(node.object.name)
  );
}

/**
 * The import source in its "@/" form when it is a relative path into src
 * ("../../lib/read-body" from src/app/x/route.ts is "@/lib/read-body"), so a
 * relative import of an allowed module counts as that module.
 */
function normalizeSource(source, filename) {
  if (!source.startsWith(".")) return source;
  const from = filename.replace(/\\/g, "/").split("/");
  const at = from.lastIndexOf("src");
  if (at < 0) return source;
  const parts = from.slice(at + 1, -1);
  for (const part of source.split("/")) {
    if (part === "..") {
      if (parts.length === 0) return source; // outside src
      parts.pop();
    } else if (part !== "." && part !== "") parts.push(part);
  }
  return `@/${parts.join("/").replace(/\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/, "")}`;
}

/** @type {import("eslint").Rule.RuleModule} */
const boundedRequestBodyRule = {
  meta: {
    type: "problem",
    docs: { description: "Ban unbounded request body reads (use src/lib/read-body.ts)." },
    messages: { unbounded: UNBOUNDED_BODY_MESSAGE, forwarded: FORWARDED_BODY_MESSAGE },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const filename = context.filename;
    /** The functions that the file exports as route handlers (their first parameter is the request). */
    const handlerFunctions = [];
    /** Identifiers that name an exported route handler (export { x as POST }, export const POST = x, wrap(x)). */
    const handlerNames = [];
    const assertedRequests = [];

    /** The nodes reported so far: two paths can reach one node. */
    const reported = new Set();
    function report(node, messageId) {
      if (reported.has(node)) return;
      reported.add(node);
      context.report({ node, messageId });
    }

    /** Note the value of an exported route handler: a function, a name, or a wrapper call. */
    function noteHandlerValue(value) {
      if (!value) return;
      if (FUNCTION_TYPES.has(value.type)) handlerFunctions.push(value);
      else if (value.type === "Identifier") handlerNames.push(value);
      else if (value.type === "CallExpression") for (const argument of value.arguments) noteHandlerValue(argument);
      else if (TRANSPARENT.has(value.type)) noteHandlerValue(value.expression);
    }

    /** Report a destructuring pattern that takes a body member out of a request. */
    function checkPattern(pattern) {
      if (pattern.type === "AssignmentPattern") return checkPattern(pattern.left);
      if (pattern.type !== "ObjectPattern") return;
      for (const property of pattern.properties) {
        if (property.type !== "Property") continue;
        if (isBodyKey(keyName(property.key, property.computed))) report(property, "unbounded");
      }
    }

    return {
      "TSAsExpression, TSTypeAssertion"(node) {
        if (isRequestType(node.typeAnnotation)) assertedRequests.push(node);
      },
      "ExportNamedDeclaration > FunctionDeclaration"(node) {
        if (node.id && ROUTE_HANDLERS.has(node.id.name)) handlerFunctions.push(node);
      },
      "ExportNamedDeclaration > VariableDeclaration > VariableDeclarator"(node) {
        if (node.id.type === "Identifier" && ROUTE_HANDLERS.has(node.id.name)) noteHandlerValue(node.init);
      },
      "ExportNamedDeclaration > ExportSpecifier"(node) {
        const exported = node.exported.type === "Identifier" ? node.exported.name : node.exported.value;
        if (!node.parent.source && ROUTE_HANDLERS.has(exported) && node.local.type === "Identifier") {
          handlerNames.push(node.local);
        }
      },
      // A destructured parameter typed Request: function f({ json }: Request).
      ":function"(node) {
        for (const param of node.params) {
          const target = param.type === "AssignmentPattern" ? param.left : param;
          if (target.type === "ObjectPattern" && isRequestType(target.typeAnnotation)) checkPattern(target);
        }
      },
      // Request.prototype.json(.call), NextRequest.prototype["text"]: a body read with no request in sight.
      MemberExpression(node) {
        if (!isRequestPrototype(node.object)) return;
        if (isBodyKey(keyName(node.property, node.computed))) report(node, "unbounded");
      },
      "Program:exit"() {
        const scopeManager = sourceCode.scopeManager;
        /** Each identifier node, to its reference (to follow an assignment to a variable). */
        const referenceOf = new Map();
        for (const scope of scopeManager.scopes) {
          for (const reference of scope.references) referenceOf.set(reference.identifier, reference);
        }

        /**
         * Each tracked variable, to what it holds: "request", or "container"
         * (an array or object that holds a request at some depth).
         */
        const tracked = new Map();
        const queue = [];
        const track = (variable, kind = "request") => {
          if (!variable) return;
          const known = tracked.get(variable);
          if (known === kind || known === "container") return;
          // A container is the wider kind: a body member and a deeper member are both followed.
          tracked.set(variable, known ? "container" : kind);
          queue.push(variable);
        };

        /** The variable that a declared name (a parameter, a function name) is. */
        const variableOf = (scopeNode, name) =>
          sourceCode.getDeclaredVariables(scopeNode).find((variable) => variable.defs.some((def) => def.name === name));

        /**
         * Track parameter `index` of a function (a handler, a local helper,
         * an IIFE, a constructor). With `spread`, the argument was a spread
         * (f(...[a, request])), so the value can be at that place or at any
         * place after it: each of them is tracked as a container.
         */
        const trackParam = (fn, index, kind = "request", spread = false) => {
          // `arguments` holds every argument (function f() { arguments[0].json() }).
          trackArguments(fn);
          let position = 0;
          for (const param of fn.params) {
            if (param.type === "RestElement") {
              // (...args): args holds the value at args[index - position].
              if (spread || index >= position) {
                if (param.argument.type === "Identifier") track(variableOf(fn, param.argument), "container");
                else trackParamPattern(fn, param.argument);
              }
              return;
            }
            if (position === index || (spread && position > index)) {
              if (param.type === "TSParameterProperty") {
                // constructor(public r: Request): the request goes into a class field, which the rule does not follow.
                report(param, "forwarded");
              } else {
                const target = param.type === "AssignmentPattern" ? param.left : param;
                const paramKind = spread ? "container" : kind;
                if (target.type === "Identifier") track(variableOf(fn, target), paramKind);
                else if (paramKind === "container") trackParamPattern(fn, target);
                else checkPattern(target);
              }
              if (!spread) return;
            }
            position++;
          }
        };

        /** Track every name that a destructured parameter binds, as a container. */
        const trackParamPattern = (fn, pattern) => {
          for (const variable of sourceCode.getDeclaredVariables(fn)) {
            if (variable.defs.some((def) => def.type === "Parameter" && def.node === fn && isInside(def.name, pattern))) {
              track(variable, "container");
            }
          }
        };

        /**
         * Track the targets of a destructuring assignment of a container
         * (([x] = [request]), ({ a: x } = { a: request })), as containers. A
         * member as a target (([o.r] = [request])) is reported: the rule does
         * not follow a member.
         */
        const trackAssignedPattern = (pattern) => {
          if (!pattern) return;
          switch (pattern.type) {
            case "Identifier":
              track(referenceOf.get(pattern)?.resolved, "container");
              return;
            case "MemberExpression":
              report(pattern, "forwarded");
              return;
            case "AssignmentPattern":
              trackAssignedPattern(pattern.left);
              return;
            case "RestElement":
              trackAssignedPattern(pattern.argument);
              return;
            case "ArrayPattern":
              for (const element of pattern.elements) trackAssignedPattern(element);
              return;
            case "ObjectPattern":
              for (const property of pattern.properties) {
                trackAssignedPattern(property.type === "Property" ? property.value : property);
              }
              return;
            default:
              report(pattern, "forwarded");
          }
        };

        /** Track `arguments` of a function (not an arrow function: it has none of its own). */
        const trackArguments = (fn) => {
          if (fn.type === "ArrowFunctionExpression") return;
          const scope = scopeManager.acquire(fn);
          const variable = scope?.set.get("arguments");
          if (variable) track(variable, "container");
        };

        /** True when node is inside pattern (a name bound by a destructuring). */
        const isInside = (node, pattern) => node.range[0] >= pattern.range[0] && node.range[1] <= pattern.range[1];

        /** The definition of the variable that an identifier names, if any. */
        const definitionOf = (identifier) => referenceOf.get(identifier)?.resolved?.defs ?? null;

        /** True when the variable that an identifier names is assigned again after its declaration. */
        const isReassigned = (identifier) => {
          const variable = referenceOf.get(identifier)?.resolved;
          return Boolean(variable && variable.references.some((reference) => reference.isWrite() && !reference.init));
        };

        /**
         * The function that an identifier names in this file, if any. A
         * function that is assigned again (f = handlers.POST) can be any
         * function at the call, so it is not one of this file: unless
         * `evenIfReassigned` (to seed the parameter of a handler, which only
         * adds checks).
         */
        const functionOf = (identifier, evenIfReassigned = false) => {
          if (!evenIfReassigned && isReassigned(identifier)) return null;
          for (const def of definitionOf(identifier) ?? []) {
            // A parameter (a callback) is not a function of this file: its def.node is the function that takes it.
            if (def.type === "FunctionName") return def.node;
            if (def.type === "Variable" && def.node.type === "VariableDeclarator" && def.node.init) {
              let init = def.node.init;
              while (TRANSPARENT.has(init.type)) init = init.expression;
              if (FUNCTION_TYPES.has(init.type)) return init;
            }
          }
          return null;
        };

        /** The class that an identifier names in this file (and that is not assigned again), if any. */
        const localClassOf = (identifier) => {
          if (isReassigned(identifier)) return null;
          return (definitionOf(identifier) ?? []).find((def) => def.type === "ClassName")?.node ?? null;
        };

        /** The import of an identifier: { source, imported } (imported is "*" for a namespace), or null. */
        const importOf = (identifier) => {
          for (const def of definitionOf(identifier) ?? []) {
            if (def.type !== "ImportBinding") continue;
            const specifier = def.node;
            const imported =
              specifier.type === "ImportSpecifier"
                ? specifier.imported.type === "Identifier"
                  ? specifier.imported.name
                  : specifier.imported.value
                : specifier.type === "ImportDefaultSpecifier"
                  ? "default"
                  : "*";
            return { source: normalizeSource(def.parent.source.value, filename), imported };
          }
          return null;
        };

        /**
         * True when a request may go to export `name` of module `source` at
         * argument `index`. A spread argument can put it at any place, so
         * only the bounded reader (every export, every place) may get one.
         */
        const mayGetRequest = (source, name, index, spread) => {
          if (source === BODY_READER_MODULE) return true;
          if (spread) return false;
          const helpers = REQUEST_HELPERS[source];
          return Boolean(helpers && Object.hasOwn(helpers, name) && helpers[name] === index);
        };

        /** True for the class Request (the global) or NextRequest (from next/server). */
        const isRequestClass = (callee) => {
          if (callee.type !== "Identifier") return false;
          if (REQUEST_CLASSES.has(callee.name) && !definitionOf(callee)?.length) return true;
          const imported = importOf(callee);
          return Boolean(imported && REQUEST_CLASSES.has(imported.imported) && imported.source === "next/server");
        };

        /** A request (or a container of one) is argument `index` of a call or new: where does it go? */
        const followArgument = (call, index, kind, spread) => {
          let callee = call.callee;
          while (TRANSPARENT.has(callee.type)) callee = callee.expression;
          if (call.type === "NewExpression") {
            if (isRequestClass(callee)) {
              // new Request(request), new Request(url, request) (the init's
              // body is the request's body): the new request can hold the
              // same body, so it is a request too.
              follow(call, "request");
              return;
            }
            if (callee.type === "Identifier") {
              const cls = localClassOf(callee);
              if (cls) {
                // A class of this file: follow the request into its constructor.
                const constructor = cls.body.body.find(
                  (member) => member.type === "MethodDefinition" && member.kind === "constructor"
                );
                if (constructor) trackParam(constructor.value, index, kind, spread);
                else if (cls.superClass) report(call, "forwarded"); // the parent class's constructor gets it
                return;
              }
              const imported = importOf(callee);
              if (imported && mayGetRequest(imported.source, imported.imported, index, spread)) return;
            }
            report(call, "forwarded");
            return;
          }
          if (FUNCTION_TYPES.has(callee.type)) {
            trackParam(callee, index, kind, spread); // an IIFE
            return;
          }
          if (callee.type === "Identifier") {
            const fn = functionOf(callee);
            if (fn) {
              trackParam(fn, index, kind, spread); // a function of this file
              return;
            }
            const imported = importOf(callee);
            if (imported && mayGetRequest(imported.source, imported.imported, index, spread)) return;
            report(call, "forwarded");
            return;
          }
          if (callee.type === "MemberExpression") {
            const object = callee.object;
            if (object.type === "Identifier") {
              if (object.name === "Reflect" && !definitionOf(object)?.length) {
                report(call, "unbounded"); // Reflect.get(request, "json"), Reflect.apply(...)
                return;
              }
              if (HARMLESS_GLOBAL_OBJECTS.has(object.name) && !definitionOf(object)?.length) return;
              const imported = importOf(object);
              const name = keyName(callee.property, callee.computed);
              if (imported && imported.imported === "*" && typeof name === "string") {
                if (mayGetRequest(imported.source, name, index, spread)) return; // import * as m; m.readJson(request)
              }
            }
            report(call, "forwarded");
            return;
          }
          report(call, "forwarded");
        };

        /** True for a numeric index (x[0]): not a body member of a container. */
        const isIndexKey = (member) =>
          member.computed && member.property.type === "Literal" && typeof member.property.value === "number";

        /**
         * True for a use of a value that cannot hand it on, and cannot read
         * its body: a statement of its own, a test, a comparison, ! typeof
         * void, an untagged template, a value that a comma expression drops.
         */
        const isHarmlessUse = (parent, node) => {
          switch (parent.type) {
            case "ExpressionStatement":
            case "BinaryExpression":
              return true;
            case "UnaryExpression":
              return parent.operator === "!" || parent.operator === "typeof" || parent.operator === "void";
            case "IfStatement":
            case "WhileStatement":
            case "DoWhileStatement":
            case "ForStatement":
            case "ConditionalExpression":
              return parent.test === node;
            case "SwitchStatement":
              return parent.discriminant === node;
            case "SwitchCase":
              return parent.test === node;
            case "SequenceExpression":
              return parent.expressions.at(-1) !== node;
            case "TemplateLiteral":
              return parent.parent.type !== "TaggedTemplateExpression";
            default:
              return false;
          }
        };

        /** Follow a value that is a request (or holds one) to where it goes. */
        const follow = (start, kind) => {
          let node = start;
          for (;;) {
            const parent = node.parent;
            if (!parent) return;
            if (TRANSPARENT.has(parent.type) || parent.type === "AwaitExpression" || parent.type === "ChainExpression") {
              node = parent;
              continue;
            }
            if (
              (parent.type === "ConditionalExpression" && parent.test !== node) ||
              parent.type === "LogicalExpression" ||
              (parent.type === "SequenceExpression" && parent.expressions.at(-1) === node)
            ) {
              node = parent;
              continue;
            }
            if (parent.type === "ArrayExpression" || parent.type === "SpreadElement") {
              node = parent;
              kind = "container";
              continue;
            }
            if (parent.type === "Property" && parent.value === node && parent.parent.type === "ObjectExpression") {
              node = parent.parent;
              kind = "container";
              continue;
            }
            break;
          }
          const parent = node.parent;

          if (parent.type === "MemberExpression" && parent.object === node) {
            const name = keyName(parent.property, parent.computed);
            if (kind === "request") {
              // Another member (headers, url, method, nextUrl, cookies) holds no body.
              if (isBodyKey(name)) report(parent, "unbounded");
              return;
            }
            // A member of a container can be the request, or a deeper
            // container. An index (x[0]) is not a body member; a key that the
            // rule cannot read (x[name]) can be one.
            if (!isIndexKey(parent) && isBodyKey(name)) {
              report(parent, "unbounded");
              return;
            }
            let use = parent;
            while (use.parent && (TRANSPARENT.has(use.parent.type) || use.parent.type === "ChainExpression")) use = use.parent;
            if (use.parent?.type === "CallExpression" && use.parent.callee === use) {
              // A method of a container (map, forEach, then) gives its elements to a callback.
              report(use.parent, "forwarded");
              return;
            }
            follow(parent, "container");
            return;
          }

          if (parent.type === "VariableDeclarator" && parent.init === node) {
            if (parent.id.type === "Identifier" || kind === "container") {
              for (const alias of sourceCode.getDeclaredVariables(parent)) track(alias, kind);
            }
            if (parent.id.type !== "Identifier") checkPattern(parent.id);
            return;
          }

          if (parent.type === "AssignmentExpression" && parent.right === node) {
            const left = parent.left;
            if (left.type === "Identifier") track(referenceOf.get(left)?.resolved, kind);
            else if (left.type === "MemberExpression") {
              report(parent, "forwarded"); // o.r = request: the rule does not follow a member
              return;
            } else {
              if (kind === "container") trackAssignedPattern(left);
              checkPattern(left);
            }
            // The assignment is a value too: const y = (x = request).
            follow(parent, kind);
            return;
          }

          if ((parent.type === "CallExpression" || parent.type === "NewExpression") && parent.arguments.includes(node)) {
            followArgument(parent, parent.arguments.indexOf(node), kind, node.type === "SpreadElement");
            return;
          }

          if (parent.type === "ForOfStatement" && parent.right === node && kind === "container") {
            // for (const x of [request]), for (x of [request]): x is the request (or deeper).
            const left = parent.left;
            if (left.type === "VariableDeclaration") {
              for (const declaration of left.declarations) {
                for (const variable of sourceCode.getDeclaredVariables(declaration)) track(variable, "container");
              }
            } else trackAssignedPattern(left);
            return;
          }

          if (isHarmlessUse(parent, node)) return;

          // return, throw, yield, a default value, a tagged template, an
          // arrow body, a class field, a computed key, JSX: the value goes
          // somewhere that this rule does not follow.
          report(node, "forwarded");
        };

        /**
         * True for a binding that holds a value: a parameter, a catch
         * parameter, or a variable that is not a function or a class. A name
         * alone does not make an import (NextRequest), a function
         * (getRequest) or a class a request.
         */
        const isValueBinding = (variable) =>
          variable.defs.length > 0 &&
          variable.defs.every((def) => {
            if (def.type === "Parameter" || def.type === "CatchClause") return true;
            if (def.type !== "Variable") return false;
            let init = def.node.init;
            while (init && TRANSPARENT.has(init.type)) init = init.expression;
            return !(init && (FUNCTION_TYPES.has(init.type) || init.type === "ClassExpression"));
          });

        // A typed assertion can introduce a request even when its input is unknown.
        for (const node of assertedRequests) follow(node, "request");
        // Seeds: names with "req" (of a value), and names typed Request or NextRequest.
        for (const scope of scopeManager.scopes) {
          for (const variable of scope.variables) {
            if (isRequestName(variable.name) && isValueBinding(variable)) track(variable);
            else if (variable.defs.some((def) => isRequestType(def.name?.typeAnnotation))) track(variable);
          }
        }
        // Seeds: the first parameter of every route handler.
        const seenNames = new Set();
        for (const identifier of handlerNames) {
          const variable = referenceOf.get(identifier)?.resolved;
          if (!variable || seenNames.has(variable)) continue;
          seenNames.add(variable);
          // Seed the parameter also of a handler that is assigned again (the
          // assignment itself is a "forwarded" at its call, and the route
          // inventory fails on it).
          const fn = functionOf(identifier, true);
          if (fn) handlerFunctions.push(fn);
          else {
            // export const POST = handler, where handler = wrap(async (x) => ...)
            for (const def of variable.defs) {
              if (def.node.type === "VariableDeclarator") noteHandlerValue(def.node.init);
            }
          }
        }
        for (const fn of handlerFunctions) {
          if (FUNCTION_TYPES.has(fn.type)) trackParam(fn, 0);
        }

        while (queue.length > 0) {
          const variable = queue.shift();
          const kind = tracked.get(variable);
          for (const reference of variable.references) {
            // A write (x = request) is not a use of the value.
            if (reference.isWrite() && !reference.isRead()) continue;
            // A type (typeof request in a type) is not a use of the value either.
            if (reference.isTypeReference && !reference.isValueReference) continue;
            follow(reference.identifier, kind);
          }
        }
      },
    };
  },
};

/** The rules of this module, for the shared hanks-hits plugin in eslint.config.mjs. */
export const boundedBodyPlugin = Object.freeze({
  rules: { [BOUNDED_BODY_RULE]: boundedRequestBodyRule },
});
