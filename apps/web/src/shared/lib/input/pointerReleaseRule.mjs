// The pointer-release rule: one source of truth for the ESLint rule
// hanks-hits/no-pointerup-position (apps/web/eslint.config.mjs) and its
// tests (src/shared/lib/input/__tests__/pointerReleaseRule.test.ts).
//
// Plain ESM JavaScript, not TypeScript: eslint.config.mjs loads it with
// Node, with no build step. Paths are relative to apps/web.
//
// Why: a decision about where a pointer let go must not read the position
// of the pointerup event. iPhone Safari can send a pointerup at (0, 0).
// On an iPhone SE (iOS 27) on 2026-10-01, one tap on the clip button gave
// pointerdown at (585, 22), pointerup at (0, 0), and touchend at the real
// point. The clip button took every tap for a drag off and did nothing.
// Read the release point from createPointerTrail() in @/shared/lib/input
// (pointerTrail.ts).
//
// No esquery selector can do this check. A handler is usually bound by
// reference (onPointerUp={handleUp}, addEventListener("pointerup", up),
// { onPointerUp: end }), so the rule must find the declaration of the
// handler and follow the event into the functions that get it. Thus this
// is a small local plugin rule that uses the scope manager, like
// src/shared/lib/wholeStoreDepsRule.mjs.

/** The rule covers every source module. */
export const POINTER_RELEASE_LINT_FILES = Object.freeze([
  "src/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
]);

/** Tests may build any handler they like. */
export const POINTER_RELEASE_TEST_IGNORES = Object.freeze([
  "**/__tests__/**",
  "**/*.{test,spec}.*",
]);

/** The plugin namespace and the rule name, for eslint.config.mjs. */
export const POINTER_RELEASE_PLUGIN = "hanks-hits";
export const POINTER_RELEASE_RULE = "no-pointerup-position";

export const POINTER_RELEASE_MESSAGE =
  "Do not read the position of a pointerup event: iPhone Safari can report a pointerup at (0, 0). Read the release point from createPointerTrail() in @/shared/lib/input (trail.down, trail.move, then trail.release(event)).";

export const R3F_POINTER_UP_MESSAGE =
  "React Three Fiber finds the object for onPointerUp from the pointerup's position, and iPhone Safari can report a pointerup at (0, 0). Use onClick (it uses the click's position), act in onPointerDown, or capture the pointer in onPointerDown (e.target.setPointerCapture(e.pointerId)): a captured object gets its pointerup wherever the point is.";

export const R3F_RELEASE_FIELD_MESSAGE =
  "In a React Three Fiber onPointerUp, point, pointer, ray, unprojectedPoint and intersections do not show where the finger let go: they come from the pointerup's position (iPhone Safari can report a pointerup at (0, 0)) or, on a captured object, from the pointerdown. Keep the last point from onPointerMove.";

/** The position fields of a pointer event. x and y are aliases of clientX and clientY. */
const POSITION_FIELD = /^((client|page|screen|offset|layer)[XY]|[xy])$/;

/** The fields of a React Three Fiber event that come from the pointer position. */
const R3F_POSITION_FIELD = /^(point|pointer|ray|unprojectedPoint|intersections)$/;

/** A JSX attribute, an object key or a class member that binds a pointerup handler. */
const POINTER_UP_KEY = /^onPointerUp(Capture)?$/;

/**
 * A name of a release handler: onPointerUp, onPointerUpCapture,
 * handlePointerUp, onSurfacePointerUp, onPointerEnd, and endPointer (the
 * clip button's release decision was in endPointer). The rule checks a
 * function with such a name even where it cannot see the binding (the
 * handler is bound in another module).
 */
const RELEASE_HANDLER_NAME = /(^end[A-Za-z]*Pointer|Pointer(Up|End))(Capture)?$/;

/** three.js objects that React Three Fiber raycasts for pointer events. */
const R3F_OBJECTS = new Set([
  "mesh",
  "instancedMesh",
  "batchedMesh",
  "skinnedMesh",
  "group",
  "object3D",
  "scene",
  "sprite",
  "points",
  "lineSegments",
  "lineLoop",
  "primitive",
]);

/** Packages whose JSX components pass pointer props to a three.js object. */
const R3F_PACKAGE = /^@react-three\/(drei|fiber)(\/|$)/;

/** Components from those packages that render a DOM element, not a three.js object. */
const R3F_DOM_COMPONENTS = new Set(["Canvas", "Loader"]);

/** Hooks that give back their first argument as the handler. */
const CALLBACK_HOOKS = new Set(["useCallback", "useEffectEvent", "useEvent"]);

/** How far the rule follows a handler or an event through names and calls. */
const MAX_DEPTH = 8;

/** The name of a hook call: useCallback(...) or React.useCallback(...). */
function calleeName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
    return callee.property.name;
  }
  return null;
}

/** The static name of a key or a member property, or null. */
function staticName(node, computed) {
  if (!node) return null;
  if (!computed && node.type === "Identifier") return node.name;
  if (!computed && node.type === "PrivateIdentifier") return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

/** The static string value of an expression ("pointerup" or `pointerup`), or null. */
function staticString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

/** An expression with its TypeScript casts and non-null marks removed. */
function unwrap(node) {
  let n = node;
  while (
    n &&
    (n.type === "TSAsExpression" ||
      n.type === "TSNonNullExpression" ||
      n.type === "TSSatisfiesExpression" ||
      n.type === "TSTypeAssertion" ||
      n.type === "ChainExpression")
  ) {
    n = n.expression;
  }
  return n;
}

/** The outermost cast or chain around `node` (the node a parent sees). */
function outerOf(node) {
  let n = node;
  while (
    n.parent &&
    (n.parent.type === "TSAsExpression" ||
      n.parent.type === "TSNonNullExpression" ||
      n.parent.type === "TSSatisfiesExpression" ||
      n.parent.type === "TSTypeAssertion" ||
      n.parent.type === "ChainExpression") &&
    n.parent.expression === n
  ) {
    n = n.parent;
  }
  return n;
}

function isFunction(node) {
  return (
    node &&
    (node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression" ||
      node.type === "FunctionDeclaration")
  );
}

/** The variable that `name` refers to from `scope`, or null. */
function findVariable(scope, name) {
  for (let s = scope; s; s = s.upper) {
    const variable = s.set.get(name);
    if (variable) return variable;
  }
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
const noPointerUpPosition = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a read of a pointerup event's position (iPhone Safari can report a pointerup at (0, 0)); read createPointerTrail().release()",
    },
    messages: {
      position: POINTER_RELEASE_MESSAGE,
      r3fPointerUp: R3F_POINTER_UP_MESSAGE,
      r3fField: R3F_RELEASE_FIELD_MESSAGE,
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const visitorKeys = sourceCode.visitorKeys;
    /** Local names of the JSX components imported from an R3F package. */
    const r3fComponents = new Set();
    /** Local names of `import * as X` from an R3F package. */
    const r3fNamespaces = new Set();
    /** Nodes already reported, so two paths to one read give one message. */
    const reported = new Set();
    /** "start:param:r3f" keys of the handlers already checked. */
    const checked = new Set();

    function report(node, messageId) {
      if (reported.has(node)) return;
      reported.add(node);
      context.report({ node, messageId });
    }

    /** True when `name` is a field that a release decision must not read. */
    function isBannedField(name, r3f) {
      return POSITION_FIELD.test(name) || (r3f && R3F_POSITION_FIELD.test(name));
    }

    /** The functions that an expression evaluates to, as far as this file shows. */
    function resolveFunctions(expression, depth = 0, seen = new Set()) {
      const node = unwrap(expression);
      if (!node || depth > MAX_DEPTH || seen.has(node)) return [];
      seen.add(node);
      if (isFunction(node)) return [node];
      switch (node.type) {
        case "ConditionalExpression":
          return [
            ...resolveFunctions(node.consequent, depth + 1, seen),
            ...resolveFunctions(node.alternate, depth + 1, seen),
          ];
        case "LogicalExpression":
          return [
            ...resolveFunctions(node.left, depth + 1, seen),
            ...resolveFunctions(node.right, depth + 1, seen),
          ];
        case "CallExpression": {
          const name = calleeName(node.callee);
          // useCallback(fn, deps), useEffectEvent(fn): the handler is fn.
          if (name && CALLBACK_HOOKS.has(name)) return resolveFunctions(node.arguments[0], depth + 1, seen);
          // useMemo(() => fn, deps): the handler is what the factory gives back.
          if (name === "useMemo") {
            const factory = unwrap(node.arguments[0]);
            if (factory && factory.type === "ArrowFunctionExpression" && factory.expression) {
              return resolveFunctions(factory.body, depth + 1, seen);
            }
            return [];
          }
          // fn.bind(this): the handler is fn.
          if (name === "bind" && node.callee.type === "MemberExpression") {
            return resolveFunctions(node.callee.object, depth + 1, seen);
          }
          return [];
        }
        case "Identifier": {
          const variable = findVariable(sourceCode.getScope(node), node.name);
          if (!variable) return [];
          const found = [];
          for (const def of variable.defs) {
            if (def.type === "FunctionName") found.push(def.node);
            else if (def.type === "Variable" && def.node.id.type === "Identifier" && def.node.init) {
              found.push(...resolveFunctions(def.node.init, depth + 1, seen));
            }
          }
          return found;
        }
        case "MemberExpression": {
          const key = staticName(node.property, node.computed);
          if (!key) return [];
          const object = unwrap(node.object);
          // this.handleUp inside a class: the member of that class.
          if (object.type === "ThisExpression") {
            for (let p = node.parent; p; p = p.parent) {
              if (p.type === "ClassBody") {
                const member = p.body.find(
                  (m) =>
                    (m.type === "MethodDefinition" || m.type === "PropertyDefinition") &&
                    staticName(m.key, m.computed) === key
                );
                return member && member.value ? resolveFunctions(member.value, depth + 1, seen) : [];
              }
            }
            return [];
          }
          // handlers.up, where handlers is an object literal in this file.
          if (object.type === "Identifier") {
            const variable = findVariable(sourceCode.getScope(object), object.name);
            const def = variable && variable.defs.length === 1 ? variable.defs[0] : null;
            const init = def && def.type === "Variable" ? unwrap(def.node.init) : null;
            if (init && init.type === "ObjectExpression") {
              const property = init.properties.find(
                (p) => p.type === "Property" && staticName(p.key, p.computed) === key
              );
              return property ? resolveFunctions(property.value, depth + 1, seen) : [];
            }
          }
          return [];
        }
        default:
          return [];
      }
    }

    /** Check every handler that a pointerup binding resolves to. */
    function checkBinding(expression, r3f) {
      for (const fn of resolveFunctions(expression)) checkHandler(fn, 0, r3f, 0);
    }

    /** Check parameter `index` of `fn`: it holds the pointerup event. */
    function checkHandler(fn, index, r3f, depth) {
      if (depth > MAX_DEPTH) return;
      // A TypeScript `this` parameter is not a real argument.
      const params =
        fn.params[0] && fn.params[0].type === "Identifier" && fn.params[0].name === "this"
          ? fn.params.slice(1)
          : fn.params;
      let param = params[index];
      if (!param) return;
      const key = `${fn.range[0]}:${index}:${r3f}`;
      if (checked.has(key)) return;
      checked.add(key);
      if (param.type === "TSParameterProperty") param = param.parameter;
      if (param.type === "AssignmentPattern") param = param.left;
      if (param.type === "Identifier") {
        const variable = sourceCode
          .getDeclaredVariables(fn)
          .find((v) => v.defs.some((d) => d.name === param));
        if (variable) checkEventVariable(variable, r3f, depth + 1);
      } else if (param.type === "ObjectPattern") {
        checkPattern(param, r3f, depth + 1);
      }
    }

    /** Check each read of a variable that holds the pointerup event. */
    function checkEventVariable(variable, r3f, depth) {
      if (depth > MAX_DEPTH) return;
      for (const reference of variable.references) {
        if (!reference.isRead()) continue;
        checkEventExpression(reference.identifier, r3f, depth);
      }
    }

    /** Check a destructuring of the pointerup event: { clientX, nativeEvent: { x } } = event. */
    function checkPattern(pattern, r3f, depth) {
      for (const property of pattern.properties) {
        if (property.type === "RestElement") {
          if (property.argument.type === "Identifier") {
            const variable = findVariable(sourceCode.getScope(property.argument), property.argument.name);
            if (variable) checkEventVariable(variable, r3f, depth + 1);
          }
          continue;
        }
        const key = staticName(property.key, property.computed);
        if (!key) continue;
        if (isBannedField(key, r3f)) {
          report(property, POSITION_FIELD.test(key) ? "position" : "r3fField");
          continue;
        }
        if (key === "nativeEvent") {
          let value = property.value;
          if (value.type === "AssignmentPattern") value = value.left;
          if (value.type === "ObjectPattern") checkPattern(value, false, depth + 1);
          else if (value.type === "Identifier") {
            const variable = findVariable(sourceCode.getScope(value), value.name);
            if (variable) checkEventVariable(variable, false, depth + 1);
          }
        }
      }
    }

    /**
     * Check one use of an expression whose value is the pointerup event
     * (the parameter, an alias of it, or its nativeEvent).
     */
    function checkEventExpression(node, r3f, depth) {
      if (depth > MAX_DEPTH) return;
      const outer = outerOf(node);
      const parent = outer.parent;
      if (!parent) return;
      // event.clientX, event["pageY"], event.x, event.nativeEvent...
      if (parent.type === "MemberExpression" && parent.object === outer) {
        const key = staticName(parent.property, parent.computed);
        if (!key) return;
        if (isBannedField(key, r3f)) {
          report(parent, POSITION_FIELD.test(key) ? "position" : "r3fField");
        } else if (key === "nativeEvent") {
          checkEventExpression(parent, false, depth + 1);
        }
        return;
      }
      // const ev = event; const { clientX } = event.
      if (parent.type === "VariableDeclarator" && parent.init === outer) {
        if (parent.id.type === "Identifier") {
          const variable = sourceCode
            .getDeclaredVariables(parent)
            .find((v) => v.defs.some((d) => d.name === parent.id));
          if (variable) checkEventVariable(variable, r3f, depth + 1);
        } else if (parent.id.type === "ObjectPattern") {
          checkPattern(parent.id, r3f, depth + 1);
        }
        return;
      }
      // ({ clientX } = event).
      if (parent.type === "AssignmentExpression" && parent.right === outer && parent.left.type === "ObjectPattern") {
        checkPattern(parent.left, r3f, depth + 1);
        return;
      }
      // finish(event): follow the event into a function of this file.
      if (parent.type === "CallExpression" && parent.callee !== outer) {
        const index = parent.arguments.indexOf(outer);
        if (index < 0) return;
        for (const fn of resolveFunctions(parent.callee)) checkHandler(fn, index, r3f, depth + 1);
      }
    }

    /** True when a JSX element is a three.js object that R3F raycasts. */
    function isR3FElement(opening) {
      const name = opening.name;
      if (name.type === "JSXIdentifier") {
        if (R3F_OBJECTS.has(name.name)) return true;
        return r3fComponents.has(name.name);
      }
      if (name.type === "JSXMemberExpression") {
        let object = name.object;
        while (object.type === "JSXMemberExpression") object = object.object;
        return object.type === "JSXIdentifier" && r3fNamespaces.has(object.name);
      }
      return false;
    }

    /** True when `node` (or a function of this file that it calls) calls setPointerCapture. */
    function callsSetPointerCapture(node, depth = 0, seen = new Set()) {
      if (!node || depth > 3 || seen.has(node)) return false;
      seen.add(node);
      let found = false;
      const visit = (n) => {
        if (found || !n || typeof n.type !== "string") return;
        if (n.type === "CallExpression") {
          if (calleeName(n.callee) === "setPointerCapture") {
            found = true;
            return;
          }
          if (n.callee.type === "Identifier") {
            for (const fn of resolveFunctions(n.callee)) {
              if (callsSetPointerCapture(fn.body, depth + 1, seen)) {
                found = true;
                return;
              }
            }
          }
        }
        for (const key of visitorKeys[n.type] || []) {
          const child = n[key];
          if (Array.isArray(child)) child.forEach(visit);
          else visit(child);
        }
      };
      visit(node);
      return found;
    }

    /** True when the element's onPointerDown captures the pointer. */
    function capturesOnDown(opening) {
      for (const attribute of opening.attributes) {
        if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier") continue;
        if (!/^onPointerDown(Capture)?$/.test(attribute.name.name)) continue;
        const value = attribute.value;
        if (!value || value.type !== "JSXExpressionContainer") continue;
        for (const fn of resolveFunctions(value.expression)) {
          if (callsSetPointerCapture(fn.body)) return true;
        }
      }
      return false;
    }

    return {
      // Read the R3F imports first: an import may come after its use.
      Program(program) {
        for (const node of program.body) {
          if (node.type !== "ImportDeclaration" || !R3F_PACKAGE.test(String(node.source.value))) continue;
          for (const specifier of node.specifiers) {
            if (specifier.type === "ImportNamespaceSpecifier") {
              r3fNamespaces.add(specifier.local.name);
              continue;
            }
            const imported =
              specifier.type === "ImportSpecifier" ? staticName(specifier.imported, false) : specifier.local.name;
            if (!R3F_DOM_COMPONENTS.has(imported) && /^[A-Z]/.test(specifier.local.name)) {
              r3fComponents.add(specifier.local.name);
            }
          }
        }
      },
      // <div onPointerUp={...}>, <mesh onPointerUp={...}>.
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || !RELEASE_HANDLER_NAME.test(node.name.name)) return;
        const opening = node.parent;
        const r3f =
          opening.type === "JSXOpeningElement" && POINTER_UP_KEY.test(node.name.name) && isR3FElement(opening);
        if (r3f && !capturesOnDown(opening)) report(node, "r3fPointerUp");
        if (node.value && node.value.type === "JSXExpressionContainer") checkBinding(node.value.expression, r3f);
      },
      // { onPointerUp: end }, { onPointerUp(event) { ... } }, { endPointer }.
      Property(node) {
        if (node.parent.type !== "ObjectExpression") return;
        const key = staticName(node.key, node.computed);
        if (key && RELEASE_HANDLER_NAME.test(key)) checkBinding(node.value, false);
      },
      // class X { onPointerUp(event) { ... } } and onPointerUp = (event) => ...
      "MethodDefinition, PropertyDefinition"(node) {
        const key = staticName(node.key, node.computed);
        if (key && RELEASE_HANDLER_NAME.test(key) && node.value) checkBinding(node.value, false);
      },
      // function handlePointerUp(event) { ... }
      FunctionDeclaration(node) {
        if (node.id && RELEASE_HANDLER_NAME.test(node.id.name)) checkHandler(node, 0, false, 0);
      },
      // const endPointer = (event) => ..., const onPointerUp = useCallback(...).
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && RELEASE_HANDLER_NAME.test(node.id.name) && node.init) {
          checkBinding(node.init, false);
        }
      },
      // target.addEventListener("pointerup", handler).
      CallExpression(node) {
        if (calleeName(node.callee) !== "addEventListener") return;
        if (staticString(unwrap(node.arguments[0])) !== "pointerup") return;
        if (node.arguments[1]) checkBinding(node.arguments[1], false);
      },
      // element.onpointerup = handler.
      AssignmentExpression(node) {
        const left = node.left;
        const name =
          left.type === "Identifier"
            ? left.name
            : left.type === "MemberExpression"
              ? staticName(left.property, left.computed)
              : null;
        if (name === "onpointerup") checkBinding(node.right, false);
      },
    };
  },
};

/** The local ESLint plugin that holds the rule. */
export const pointerReleasePlugin = Object.freeze({
  meta: { name: "hanks-hits-pointer-release" },
  rules: { [POINTER_RELEASE_RULE]: noPointerUpPosition },
});
