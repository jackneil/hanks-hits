import { describe, expect, it } from "vitest";
import {
  inspectPersist,
  persistedSourceInventory,
} from "./persist-source-contract";
import { persistedStores } from "./persisted-store-fixtures";

const imports = `import { persist as save } from 'zustand/middleware';
import { createOwnerPersistStorage as storage } from '@/lib/owner-bound-progress/persistStorage';`;
const options = `name: 'snake-game-state', storage: storage('snake-game-state', 'snake'), skipHydration: true`;

describe("persist storage adoption", () => {
  it("requires the shared adapter on every production persist call", () => {
    const inventory = persistedSourceInventory();
    expect(inventory.length).toBeGreaterThan(0);
    expect(
      inventory.flatMap((entry) =>
        entry.findings.map((finding) => `${entry.file}: ${finding}`),
      ),
    ).toEqual([]);
    expect(
      inventory
        .flatMap((entry) => entry.stores)
        .map(({ key }) => key)
        .sort(),
    ).toEqual(
      [
        ...new Set(
          inventory.flatMap((entry) => entry.stores).map(({ key }) => key),
        ),
      ].sort(),
    );
    // Adding a store also requires a real-store write regression, not just the adapter import.
    expect(inventory.map(({ file }) => file).sort()).toEqual(
      persistedStores.map(({ file }) => file).sort(),
    );
    expect(inventory.every(({ count }) => count === 1)).toBe(true);
  });

  it("recognizes aliased and namespace imports without matching comments", () => {
    expect(
      inspectPersist(
        `${imports}\n save(() => ({}), {${options}}); // persist()`,
      ),
    ).toMatchObject({ count: 1, findings: [] });
    expect(
      inspectPersist(`import * as z from 'zustand/middleware';
      import * as a from '@/lib/owner-bound-progress/persistStorage';
      z.persist(() => ({}), {${options.replace("storage(", "a.createOwnerPersistStorage(")}});`),
    ).toMatchObject({ count: 1, findings: [] });
  });

  it.each([
    `name: 'snake-game-state', skipHydration: true`,
    options.replace("storage('snake-game-state', 'snake')", "localStorage"),
    options.replace(
      "storage('snake-game-state', 'snake')",
      "storage('wrong-key', 'snake')",
    ),
    options.replace("true", "false"),
    `...otherOptions, ${options}`,
  ])("rejects missing, mismatched or uninspectable storage: %s", (bad) => {
    expect(
      inspectPersist(`${imports}\n save(() => ({}), {${bad}});`).findings
        .length,
    ).toBeGreaterThan(0);
  });

  it("rejects foreign lookalike adapters and indirect options", () => {
    expect(
      inspectPersist(
        `${imports.replace("@/lib/owner-bound-progress/persistStorage", "./unrelated")}\n save(() => ({}), {${options}});`,
      ).findings,
    ).not.toEqual([]);
    expect(
      inspectPersist(`${imports}\n save(() => ({}), otherOptions);`).findings,
    ).not.toEqual([]);
    expect(
      inspectPersist(
        `${imports}\n const indirect = save; indirect(() => ({}), {${options}});`,
      ).findings,
    ).not.toEqual([]);
  });

  it("inspects a simple local adapter factory and checks its returned adapter", () => {
    const factory = `function runnerStorage() { return storage('snake-game-state', 'snake'); }`;
    const useFactory = options.replace(
      "storage('snake-game-state', 'snake')",
      "runnerStorage()",
    );
    expect(
      inspectPersist(
        `${imports}\n${factory}\nsave(() => ({}), {${useFactory}});`,
      ),
    ).toMatchObject({ count: 1, findings: [] });
    expect(
      inspectPersist(
        `${imports}\n${factory.replace("storage('snake-game-state', 'snake')", "localStorage")}\nsave(() => ({}), {${useFactory}});`,
      ).findings,
    ).not.toEqual([]);
  });

  it("does not hide an indirect second store behind a valid first store", () => {
    const source = `${imports}\n save(() => ({}), {${options}});
      const indirect = save; indirect(() => ({}), {name: 'unsafe'});`;
    expect(inspectPersist(source).findings).not.toEqual([]);
  });

  it.each([
    `z['persist'](() => ({}), {name: 'unsafe'});`,
    `const {persist} = z; persist(() => ({}), {name: 'unsafe'});`,
    `const another = z; another.persist(() => ({}), {name: 'unsafe'});`,
    `z[method](() => ({}), {name: 'unsafe'});`,
  ])("rejects unsafe namespace usage: %s", (usage) => {
    expect(
      inspectPersist(`import * as z from 'zustand/middleware'; ${usage}`)
        .findings,
    ).not.toEqual([]);
  });

  it.each([
    `export { persist as storePersistence } from 'zustand/middleware';`,
    `export * from 'zustand/middleware';`,
    `const {persist} = require('zustand/middleware');`,
    `const z = await import('zustand/middleware');`,
  ])(
    "keeps unsupported middleware indirection in the inventory: %s",
    (source) => {
      expect(inspectPersist(source).findings).not.toEqual([]);
    },
  );
});
