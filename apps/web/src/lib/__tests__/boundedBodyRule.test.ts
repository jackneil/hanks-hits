// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

import {
  BOUNDED_BODY_LINT_FILES,
  BOUNDED_BODY_PLUGIN,
  BOUNDED_BODY_RULE,
  FORWARDED_BODY_MESSAGE,
  UNBOUNDED_BODY_MESSAGE,
} from "../boundedBodyRule.mjs";

// The ESLint ban on unbounded request body reads (request.json() and its
// friends, and a request given to code that can read it with no limit) in
// src/app and src/lib. This test lints fixtures through the real
// eslint.config.mjs, so a change to the config or the rule that lets an
// unbounded read back in fails here. The route inventory
// (src/app/api/__tests__/body-inventory.test.ts) checks the exports of
// every route.

const WEB_ROOT = path.resolve(__dirname, "../../..");
const RULE_ID = `${BOUNDED_BODY_PLUGIN}/${BOUNDED_BODY_RULE}`;
const ROUTE = "src/app/api/fixture/route.ts";

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({
    cwd: WEB_ROOT,
    overrideConfigFile: path.join(WEB_ROOT, "eslint.config.mjs"),
    // Only this rule: `pnpm lint` runs the others.
    ruleFilter: ({ ruleId }) => [RULE_ID, "no-eval", "no-implied-eval", "no-new-func"].includes(ruleId),
    // src/middleware.ts and src/proxy.ts are in the rule's files but do not exist today.
    errorOnUnmatchedPattern: false,
  });
});

/** The messages of this rule for a fixture: "unbounded" or "forwarded". */
async function bodyMessages(code: string, filePath = ROUTE): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(WEB_ROOT, filePath) });
  expect(result.messages.filter((m) => m.fatal), "the fixture must parse").toEqual([]);
  return result.messages
    .filter((m) => m.ruleId === RULE_ID)
    .map((m) =>
      m.message === UNBOUNDED_BODY_MESSAGE ? "unbounded" : m.message === FORWARDED_BODY_MESSAGE ? "forwarded" : m.message
    );
}

describe("the bounded-body lint rule: body reads", () => {
  it("bans dynamic evaluation that hides reads from static analysis", async () => {
    const [result] = await eslint.lintText(
      `export async function POST(request: Request) { return Response.json(await eval("request.json()")); }`,
      { filePath: path.join(WEB_ROOT, ROUTE) }
    );
    expect(result.messages.some((message) => message.ruleId === "no-eval" && message.severity === 2)).toBe(true);
  });

  it("tracks a request asserted inside a factory-produced handler", async () => {
    const code = `import { handlers } from "@/lib/auth"; function make() { return (input: unknown) => handlers.POST(input as NextRequest); } export const POST = make();`;
    expect(await bodyMessages(code)).toContain("forwarded");
  });

  it.each(["json", "text", "formData", "arrayBuffer", "blob", "bytes"])("bans request.%s() in a route", async (method) => {
    const code = `export async function POST(request: Request) { return Response.json(await request.${method}()); }\n`;
    expect(await bodyMessages(code)).toEqual(["unbounded"]);
  });

  it("bans req.json() in server code under src/lib", async () => {
    const code = `export async function read(req: Request) { return req.json(); }\n`;
    expect(await bodyMessages(code, "src/lib/fixture-server.ts")).toEqual(["unbounded"]);
  });

  it.each([
    ["optional chaining", `export async function POST(request: Request) { return Response.json(await request?.json()); }`],
    ["a handler parameter with any name and no type", `export async function POST(r) { return Response.json(await r.json()); }`],
    ["an arrow handler with any name", `export const PUT = async (x) => Response.json(await x.text());`],
    ["an underscore name", `export async function POST(_request: Request) { return Response.json(await _request.formData()); }`],
    // Aliases and destructuring of the request.
    ["an alias", `export async function POST(r) { const incoming = r; return Response.json(await incoming.json()); }`],
    ["an alias by assignment", `export async function POST(r) { let other = null; other = r; return Response.json(await other.json()); }`],
    ["a TypeScript cast", `import type { NextRequest } from "next/server"; export async function POST(r: unknown) { return Response.json(await (r as NextRequest).json()); }`],
    ["a non-null mark", `export async function POST(request?: Request) { return Response.json(await request!.json()); }`],
    ["a logical-or alias", `export async function POST(r) { const x = r || null; return Response.json(await x!.json()); }`],
    ["a ternary alias", `export async function POST(r) { const x = true ? r : r; return Response.json(await x.json()); }`],
    ["a comma alias", `export async function POST(r) { const x = (0, r); return Response.json(await x.json()); }`],
    ["destructuring in the parameter", `export async function POST({ json }: Request) { return Response.json(await json()); }`],
    ["destructuring of the request", `export async function POST(r) { const { text } = r; return Response.json(await text()); }`],
    ["destructuring by assignment", `export async function POST(r) { let text; ({ text } = r); return Response.json(await text()); }`],
    ["destructuring with a string key", `export async function POST(r) { const { "arrayBuffer": read } = r; return Response.json(await read()); }`],
    ["clone", `export async function POST(request: Request) { return Response.json(await request.clone().json()); }`],
    ["a string key", `export async function POST(r) { return Response.json(await r["json"]()); }`],
    ["a template key", "export async function POST(r) { return Response.json(await r[`text`]()); }"],
    ["a key that cannot be read", `export async function POST(r) { const m = "json" as const; return Response.json(await r[m]()); }`],
    ["new Response(request.body)", `export async function POST(r) { return Response.json(await new Response(r.body).arrayBuffer()); }`],
    ["for await over request.body", `export async function POST(r) { let n = 0; for await (const c of r.body) n += c.length; return Response.json(n); }`],
    ["new Request(request)", `export async function POST(r) { const copy = new Request(r); return Response.json(await copy.json()); }`],
    ["new NextRequest(request)", `import { NextRequest } from "next/server";\nexport async function POST(x) { return Response.json(await new NextRequest(x).text()); }`],
    ["Request.prototype.json.call", `export async function POST(r) { return Response.json(await Request.prototype.json.call(r)); }`],
    ["Reflect.get", `export async function POST(r) { const f = Reflect.get(r, "json") as () => Promise<unknown>; return Response.json(await f.call(r)); }`],
    // Handlers declared out of line.
    ["export const POST = handler", `async function handler(x) { return Response.json(await x.json()); }\nexport const POST = handler;`],
    ["export { handler as POST }", `async function handler(x) { return Response.json(await x.json()); }\nexport { handler as POST };`],
    ["export { handler as POST } for an arrow function", `const handler = async (x) => Response.json(await x.text());\nexport { handler as POST };`],
    ["a wrapper of this file", `const wrap = (f) => f;\nexport const POST = wrap(async (x) => Response.json(await x.json()));`],
    ["a wrapped handler exported by name", `const wrap = (f) => f;\nconst handler = wrap(async (x) => Response.json(await x.text()));\nexport { handler as PUT };`],
    ["a rest parameter", `export async function POST(...args) { return Response.json(await args[0].json()); }`],
    ["arguments", `export async function POST() { return Response.json(await arguments[0].json()); }`],
    // Reads through helper functions of the file.
    ["an untyped helper with a neutral name", `async function parse(input) { return input.json(); }\nexport async function POST(r) { return Response.json(await parse(r)); }`],
    ["a helper at the second place", `async function parse(limit, input) { return input.text(); }\nexport async function POST(r) { return Response.json(await parse(1, r)); }`],
    ["a helper that destructures", `async function parse({ formData }) { return formData(); }\nexport async function POST(r) { return Response.json(await parse(r)); }`],
    ["an IIFE", `export async function POST(r) { return Response.json(await ((x) => x.json())(r)); }`],
    ["a typed helper that nobody calls", `export async function parseBody(input: Request) { return input.json(); }`],
    ["a parameter typed Request | null", `export async function parseBody(input: Request | null) { return input?.json(); }`],
    ["a class method with a typed parameter", `class H { async run(x: Request) { return x.json(); } }\nexport async function POST(r) { return Response.json(await new H().run(r)); }`],
    // Containers.
    ["an array", `export async function POST(r) { const [x] = [r]; return Response.json(await x.json()); }`],
    ["an object", `export async function POST(r) { const o = { r }; return Response.json(await o.r.json()); }`],
    ["an object two deep", `export async function POST(r) { const o = { a: { b: r } }; return Response.json(await o.a.b.json()); }`],
    ["an object and a key that cannot be read", `export async function POST(r) { const o = { r }; const m = "json"; return Response.json(await o.r[m]()); }`],
    ["a container given to a helper", `function parse(o) { return o.inner.json(); }\nexport async function POST(r) { return Response.json(await parse({ inner: r })); }`],
    ["a container destructured by a helper", `function parse({ inner }) { return inner.json(); }\nexport async function POST(r) { return Response.json(await parse({ inner: r })); }`],
    ["a for-of over a container", `export async function POST(r) { for (const x of [r]) return Response.json(await x.json()); }`],
  ])("bans %s", async (_name, code) => {
    // Some shapes also give the request to a call (Reflect.get(r, ...), f.call(r)), which is "forwarded" too.
    expect(await bodyMessages(`${code}\n`)).toContain("unbounded");
  });

  it.each([
    ["a route.tsx file", "src/app/api/fixture/route.tsx"],
    ["a route.jsx file", "src/app/api/fixture/route.jsx"],
    ["a server helper under src/lib", "src/lib/fixture/helper.ts"],
    ["a page module under src/app", "src/app/fixture/actions.ts"],
    ["a Next.js middleware file", "src/middleware.ts"],
    ["a Next.js proxy file", "src/proxy.ts"],
  ])("lints %s", async (_name, file) => {
    const code = `export async function read(x: Request) { return x.json(); }\n`;
    expect(await bodyMessages(code, file)).toEqual(["unbounded"]);
  });

  it("does not take a name that only holds the letters req for a request (frequency, requestInit)", async () => {
    const code = `
export function play(frequencies: number[], step: number, requestInit: { body: string }, required: { text: string }) {
  return [frequencies[step % 4], requestInit.body, required.text];
}
`;
    expect(await bodyMessages(code, "src/lib/fixture-sounds.ts")).toEqual([]);
  });

  it("is off outside its folders (client code under src/shared and src/games has no requests)", async () => {
    const code = `export async function read(x: Request) { return x.json(); }\n`;
    expect(await bodyMessages(code, "src/shared/lib/fixture.ts")).toEqual([]);
  });

  it("is off in tests", async () => {
    const code = `export async function read(request: Request) { return request.json(); }\n`;
    expect(await bodyMessages(code, "src/app/api/fixture/__tests__/route.test.ts")).toEqual([]);
  });
});

describe("the bounded-body lint rule: a request given to code that the rule does not see", () => {
  it.each([
    ["a library's handler (Auth.js)", `import { handlers } from "@/lib/auth";\nexport async function POST(r) { return handlers.POST(r); }`],
    ["a package function", `import { Auth } from "@auth/core";\nexport async function POST(r) { return Auth(r, {} as never); }`],
    ["a package function through an alias", `import { Auth } from "@auth/core";\nexport async function POST(r) { const x = r; return Auth(x, {} as never); }`],
    ["a module outside src/app and src/lib", `import { parse } from "@/shared/lib/parse";\nexport async function POST(r) { return Response.json(await parse(r)); }`],
    ["a relative module outside src/app and src/lib", `import { parse } from "../../../shared/lib/parse";\nexport async function POST(r) { return Response.json(await parse(r)); }`],
    ["fetch", `export async function POST(r) { return fetch(r); }`],
    ["a callback parameter", `export function make(read: (x: Request) => Promise<Response>) { return async function POST(r: Request) { return read(r); }; }`],
    ["a method of another object", `const lib = { read: async (x: unknown) => x };\nexport async function POST(r) { return Response.json(await lib.read(r)); }`],
    ["a package class", `import { Parser } from "some-parser";\nexport async function POST(r) { return Response.json(new Parser(r)); }`],
    ["a container given to a package", `import { Auth } from "@auth/core";\nexport async function POST(r) { return Auth({ request: r } as never, {} as never); }`],
    ["an allowed helper at the wrong place", `import { getClientIP } from "@/lib/rate-limit";\nexport async function POST(r) { return Response.json((getClientIP as (a: unknown, b: unknown) => string)(null, r)); }`],
    ["a helper of a linted module that is not on the list", `import { other } from "@/lib/rate-limit";\nexport async function POST(r) { return Response.json(other(r)); }`],
    ["a class of another module of the app", `import { Parser } from "@/lib/parser";\nexport async function POST(r) { return Response.json(new Parser(r)); }`],
    ["a relative import of a module that is not on the list", `import { parse } from "../../../lib/parse";\nexport async function POST(r) { return Response.json(await parse(r)); }`],
  ])("reports %s", async (_name, code) => {
    expect(await bodyMessages(`${code}\n`)).toContain("forwarded");
  });

  // The shapes that the review of the first rule (which only followed a
  // short list of uses) proved: each one read a body with no limit and
  // passed lint, typecheck and the route inventory. The rule now fails
  // closed: a use that is not on its safe list is "forwarded".
  it.each([
    ["S01 a default parameter value", `export async function POST(request: Request) { const peek = async (x = request) => x.json(); return Response.json(await peek()); }`],
    ["S02 a destructuring default", `export async function POST(request: Request) { const { x = request } = {} as { x?: Request }; return Response.json(await x.json()); }`],
    ["S03 an assignment into an object member", `export async function POST(request: Request) { const box: { r?: Request } = {}; box.r = request; return Response.json(await box.r.json()); }`],
    ["S04 throw and catch", `export async function POST(request: Request) { try { throw request; } catch (e) { return Response.json(await (e as Request).json()); } }`],
    ["S05 a callback of Array.map", `export async function POST(request: Request) { return Response.json(await Promise.all([request].map((x) => x.json()))); }`],
    ["S06 a promise that resolves to the request", `export async function POST(request: Request) { return Response.json(await Promise.resolve().then(() => request).then((x) => x.json())); }`],
    ["S07 a tagged template", "export async function POST(request: Request) { const tag = (_s: TemplateStringsArray, ...xs: Request[]) => xs[0].json(); return Response.json(await tag`${request}`); }"],
    ["S08 a class field from a constructor parameter", `export async function POST(request: Request) { class Box { constructor(public x: Request) {} } return Response.json(await new Box(request).x.json()); }`],
    ["S09 a function of the file that returns the request", `export async function POST(request: Request) { const same = <T,>(v: T): T => v; return Response.json(await same(request).json()); }`],
    ["S10 a getter that returns the request", `export async function POST(request: Request) { const o = { get r() { return request; } }; return Response.json(await o.r.json()); }`],
    ["S11 a value kept on globalThis", `export async function POST(request: Request) { const g = globalThis as { stash?: Request }; g.stash = request; return Response.json(await g.stash.json()); }`],
    ["S12 an assignment to an array place", `export async function POST(request: Request) { const a: Request[] = []; a[0] = request; return Response.json(await a[0].json()); }`],
    ["S14 a DELETE handler and Array.map", `export async function DELETE(request: Request) { return Response.json(await Promise.all([request].map((x) => x.text()))); }`],
    ["S16 a function of the file that is assigned a library's handler", `import { handlers } from "@/lib/auth";\nfunction pass(r: unknown): Promise<Response> { return Promise.resolve(new Response(String(typeof r))); }\n// @ts-expect-error a function name\npass = handlers.POST;\nexport async function POST(incoming: Request) { return pass(incoming); }`],
    ["a spread argument that puts the request at a later place", `async function parse(a, b) { return b.json(); }\nexport async function POST(r) { return Response.json(await parse(...[0, r])); }`],
    ["a destructuring assignment of a container", `export async function POST(r) { let x; [x] = [r]; return Response.json(await x.json()); }`],
    ["a for-of loop that assigns a name declared before it", `export async function POST(r) { let x; for (x of [r]) break; return Response.json(await x.json()); }`],
    ["an assignment used as a value", `export async function POST(r) { let x; const y = (x = r); return Response.json(await y.json()); }`],
    ["new Request(url, request) (the init gives the new request the same body)", `export async function POST(r) { const copy = new Request("http://localhost/x", r); return Response.json(await copy.json()); }`],
    ["a class of the file with a constructor", `class Box { r; constructor(x) { this.r = x; } }\nexport async function POST(r) { return Response.json(await new Box(r).r.json()); }`],
    ["a class of the file with no constructor of its own", `import { Base } from "lib";\nclass Box extends Base {}\nexport async function POST(r) { return Response.json(new Box(r)); }`],
    ["a returned request", `function pick(r) { return r; }\nexport async function POST(r) { return Response.json(await pick(r).json()); }`],
    ["a generator that yields the request", `function* give(r) { yield r; }\nexport async function POST(r) { for (const x of give(r)) return Response.json(await x.json()); }`],
    ["a computed key", `export async function POST(r) { const o = {}; return Response.json(o[r]); }`],
  ])("reports %s", async (_name, code) => {
    const messages = await bodyMessages(`${code}\n`);
    expect(messages.length, "the shape is reported").toBeGreaterThan(0);
    expect(messages.every((m) => m === "forwarded" || m === "unbounded")).toBe(true);
  });

  it("allows the safe uses of a request: tests, comparisons, typeof, templates, switch, a dropped comma value", async () => {
    const code = `
export async function POST(request: Request) {
  if (!request) return new Response(null, { status: 400 });
  const kind = typeof request;
  const same = request === null || request instanceof Request;
  const label = \`\${request}\`;
  switch (request) {
    case null:
      break;
  }
  void request;
  const x = (request, 1);
  const y = request ? 1 : 2;
  while (!request) break;
  return Response.json([kind, same, label, x, y, request.method, request.headers.get("x")]);
}
`;
    expect(await bodyMessages(code)).toEqual([]);
  });

  it("allows the bounded reader, the header helpers, headers, URL, console and a new request that holds the read bytes", async () => {
    const code = `
import { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { readBody, readJson, SMALL_JSON_BODY } from "@/lib/read-body";
import * as bodies from "@/lib/read-body";
import { readJson as relativeRead } from "../../../lib/read-body";
import { getClientIP } from "@/lib/rate-limit";
import { getClientIP as relativeIp } from "../../../lib/rate-limit.ts";
function local(request: Request) { return request.headers.get("x"); }
export async function POST(request: NextRequest) {
  const read = await readBody(request, SMALL_JSON_BODY);
  if (!read.ok) return new Response(null, { status: 400 });
  const parsed = await readJson(request, SMALL_JSON_BODY);
  const other = await bodies.readJson(request, SMALL_JSON_BODY);
  const ip = getClientIP(request);
  const again = [await relativeRead(request, SMALL_JSON_BODY), relativeIp(request)];
  const type = request.headers.get("content-type");
  const url = new URL(request.url);
  console.log("seen", request.method, local(request));
  const { headers, method } = request;
  const blob = new Blob(["x"]);
  void [parsed, other, ip, again, type, url, headers, method, await blob.arrayBuffer(), await (await fetch("https://example.com")).json()];
  return handlers.POST(new NextRequest(request.url, { method: "POST", headers: request.headers, body: read.bytes as BodyInit }));
}
`;
    expect(await bodyMessages(code)).toEqual([]);
  });
});

/**
 * The eslint-disable and eslint config comments in a source text that turn
 * the rule off: a directive that names it, a directive with no rule list
 * (it turns every rule off), and a config comment that names it.
 */
function disablesOfTheRule(text: string): string[] {
  const found: string[] = [];
  const comments = text.match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g) ?? [];
  for (const comment of comments) {
    const body = comment.startsWith("//") ? comment.slice(2) : comment.slice(2, -2);
    const directive = /^\s*(eslint-disable(?:-next-line|-line)?|eslint)(?:\s|$)([\s\S]*)$/.exec(body);
    if (!directive) continue;
    const rules = directive[2].split(/\s--\s|\s--$/)[0];
    if (directive[1] === "eslint") {
      if (rules.includes(RULE_ID)) found.push(comment.trim());
      continue;
    }
    const names = rules.split(",").map((name) => name.trim()).filter(Boolean);
    if (names.length === 0 || names.includes(RULE_ID)) found.push(comment.trim());
  }
  return found;
}

describe("the bounded-body lint rule: no comment turns it off", () => {
  it("finds the comments that turn the rule off (its own fixtures)", () => {
    expect(disablesOfTheRule(`// eslint-disable-next-line ${RULE_ID}\nawait request.json();`)).toHaveLength(1);
    expect(disablesOfTheRule(`await request.json(); // eslint-disable-line ${RULE_ID} -- why`)).toHaveLength(1);
    expect(disablesOfTheRule(`/* eslint-disable ${RULE_ID} */`)).toHaveLength(1);
    expect(disablesOfTheRule(`/* eslint-disable */`)).toHaveLength(1);
    expect(disablesOfTheRule(`// eslint-disable-next-line`)).toHaveLength(1);
    expect(disablesOfTheRule(`/* eslint ${RULE_ID}: "off" */`)).toHaveLength(1);
    expect(disablesOfTheRule(`// eslint-disable-next-line react-hooks/exhaustive-deps, ${RULE_ID}`)).toHaveLength(1);
    expect(disablesOfTheRule(`// eslint-disable-next-line react-hooks/exhaustive-deps -- ${RULE_ID} is fine`)).toEqual([]);
    expect(disablesOfTheRule(`// eslint-disable-next-line react-hooks/exhaustive-deps`)).toEqual([]);
    expect(disablesOfTheRule(`/* eslint-enable */`)).toEqual([]);
  });

  it("is never turned off in its files, except once in src/lib/read-body.ts (the bounded reader itself)", async () => {
    // The review of the first rule: one eslint-disable-next-line comment
    // above request.json() passed lint and the route inventory.
    const results = await eslint.lintFiles([...BOUNDED_BODY_LINT_FILES]);
    const offenders: string[] = [];
    let readerDisables = 0;
    for (const result of results) {
      const file = path.relative(WEB_ROOT, result.filePath);
      // The rule is off in tests (BOUNDED_BODY_TEST_IGNORES), and their fixtures hold these comments as text.
      if (/(^|\/)__tests__\/|\.(test|spec)\./.test(file)) continue;
      const found = disablesOfTheRule(readFileSync(result.filePath, "utf8"));
      if (file === "src/lib/read-body.ts") {
        readerDisables = found.length;
        expect(found).toEqual([`// eslint-disable-next-line ${RULE_ID} -- the bounded reader itself`]);
      } else {
        offenders.push(...found.map((comment) => `${file}: ${comment}`));
      }
    }
    expect(offenders).toEqual([]);
    expect(readerDisables).toBe(1);
  });
});

describe("the bounded-body lint rule on the repo", () => {
  it("passes on every file that it lints today, and the files include the routes", async () => {
    const results = await eslint.lintFiles([...BOUNDED_BODY_LINT_FILES]);
    const linted = results.map((result) => path.relative(WEB_ROOT, result.filePath));
    expect(linted).toEqual(
      expect.arrayContaining([
        "src/app/api/progress/[appId]/route.ts",
        "src/app/api/auth/[...nextauth]/route.ts",
        "src/lib/read-body.ts",
        "src/lib/rate-limit.ts",
      ])
    );
    const hits = results.flatMap((result) =>
      result.messages.filter((m) => m.ruleId === RULE_ID).map((m) => `${path.relative(WEB_ROOT, result.filePath)}:${m.line}`)
    );
    expect(hits).toEqual([]);
  });
});
