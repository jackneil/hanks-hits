// @vitest-environment node
/** Checks that the shared OPFS double behaves like the real API where the library depends on it. */
import { afterEach, describe, expect, it } from "vitest";
import { createOpfsMock, installOpfsMock } from "../../../../__tests__/opfs-mock";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("opfs-mock", () => {
  let uninstall: (() => void) | null = null;
  afterEach(() => {
    uninstall?.();
    uninstall = null;
  });

  it("creates folders and files, and lists them with async iteration", async () => {
    const { root } = createOpfsMock();
    const lib = await root.getDirectoryHandle("lib", { create: true });
    const file = await lib.getFileHandle("a.mp4", { create: true });
    const writable = await file.createWritable();
    await writable.write(bytes(1, 2, 3));
    await writable.close();
    expect(new Uint8Array(await (await file.getFile()).arrayBuffer())).toEqual(bytes(1, 2, 3));
    const names: string[] = [];
    for await (const [name, handle] of root) names.push(`${name}:${handle.kind}`);
    expect(names).toEqual(["lib:directory"]);
    const keys: string[] = [];
    for await (const key of lib.keys()) keys.push(key);
    expect(keys).toEqual(["a.mp4"]);
    expect(await root.resolve(lib)).toEqual(["lib"]);
  });

  it("two handles to the same entry are the same entry; resolve finds files and folders", async () => {
    const { root } = createOpfsMock();
    const dir = await root.getDirectoryHandle("lib", { create: true });
    const first = await dir.getFileHandle("a.mp4", { create: true });
    const second = await (await root.getDirectoryHandle("lib")).getFileHandle("a.mp4");
    const other = await dir.getFileHandle("b.mp4", { create: true });
    expect(await first.isSameEntry(second)).toBe(true);
    expect(await first.isSameEntry(other)).toBe(false);
    expect(await dir.isSameEntry(await root.getDirectoryHandle("lib"))).toBe(true);
    expect(await root.resolve(second)).toEqual(["lib", "a.mp4"]);
    expect(await root.resolve(root)).toEqual([]);
    expect(await dir.resolve(root)).toBeNull();
  });

  it("gives the real error names", async () => {
    const { root } = createOpfsMock();
    await expect(root.getFileHandle("nope")).rejects.toMatchObject({ name: "NotFoundError" });
    await root.getDirectoryHandle("d", { create: true });
    await expect(root.getFileHandle("d")).rejects.toMatchObject({ name: "TypeMismatchError" });
    await expect(root.getFileHandle("../x", { create: true })).rejects.toThrow(TypeError);
    const d = await root.getDirectoryHandle("d");
    await d.getFileHandle("f", { create: true });
    await expect(root.removeEntry("d")).rejects.toMatchObject({ name: "InvalidModificationError" });
    await root.removeEntry("d", { recursive: true });
    await expect(d.getFileHandle("f")).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("has createSyncAccessHandle only in the worker context", async () => {
    const worker = createOpfsMock({ context: "worker" });
    const window = createOpfsMock({ context: "window" });
    const inWorker = await worker.root.getFileHandle("f", { create: true });
    const inWindow = await window.root.getFileHandle("f", { create: true });
    expect(typeof inWorker.createSyncAccessHandle).toBe("function");
    expect(inWindow.createSyncAccessHandle).toBeUndefined();
    expect(typeof window.storage.persist).toBe("function");
    expect(worker.storage.persist).toBeUndefined();
    expect(await worker.storage.persisted()).toBe(false);
  });

  it("SyncAccessHandle writes, reads at positions, truncates, flushes and locks the file", async () => {
    const mock = createOpfsMock();
    const handle = await mock.root.getFileHandle("f", { create: true });
    const access = await handle.createSyncAccessHandle!();
    expect(access.write(bytes(1, 2, 3, 4), { at: 0 })).toBe(4);
    expect(access.write(bytes(9), { at: 1 })).toBe(1);
    const out = new Uint8Array(4);
    expect(access.read(out, { at: 0 })).toBe(4);
    expect(out).toEqual(bytes(1, 9, 3, 4));
    access.truncate(2);
    expect(access.getSize()).toBe(2);
    access.flush();
    expect(mock.flushCount()).toBe(1);
    expect(mock.openSyncHandles()).toBe(1);
    await expect(handle.createSyncAccessHandle!()).rejects.toMatchObject({ name: "NoModificationAllowedError" });
    await expect(handle.createWritable()).rejects.toMatchObject({ name: "NoModificationAllowedError" });
    await expect(handle.getFile()).rejects.toMatchObject({ name: "NoModificationAllowedError" });
    await expect(mock.root.removeEntry("f")).rejects.toMatchObject({ name: "NoModificationAllowedError" });
    access.close();
    expect(mock.openSyncHandles()).toBe(0);
    expect(() => access.getSize()).toThrow(expect.objectContaining({ name: "InvalidStateError" }));
    expect(mock.readFile("f")).toEqual(bytes(1, 9));
  });

  it("counts sparse growth against the quota without using real memory", async () => {
    const mock = createOpfsMock({ quota: 2 ** 40 });
    const handle = await mock.root.getFileHandle("big", { create: true });
    const access = await handle.createSyncAccessHandle!();
    access.write(bytes(1), { at: 2 ** 39 - 1 });
    expect(access.getSize()).toBe(2 ** 39);
    expect(mock.usage()).toBe(2 ** 39);
    expect(() => access.write(bytes(1), { at: 2 ** 40 })).toThrow(expect.objectContaining({ name: "QuotaExceededError" }));
    access.truncate(0);
    expect(mock.usage()).toBe(0);
    access.close();
  });

  it("applies a writable only on close, and counts its swap file against the quota", async () => {
    const mock = createOpfsMock({ quota: 10 });
    mock.writeFile("f", bytes(1, 2, 3));
    const handle = await mock.root.getFileHandle("f");
    const writable = await handle.createWritable({ keepExistingData: true });
    await writable.write({ type: "write", position: 3, data: bytes(4, 5) });
    expect(mock.readFile("f")).toEqual(bytes(1, 2, 3));
    expect(mock.usage()).toBe(3 + 5);
    await expect(writable.write(bytes(0, 0, 0))).rejects.toMatchObject({ name: "QuotaExceededError" });
    await writable.close();
    expect(mock.readFile("f")).toEqual(bytes(1, 2, 3, 4, 5));
    expect(mock.usage()).toBe(5);
  });

  it("aborting a writable keeps the old bytes", async () => {
    const mock = createOpfsMock();
    mock.writeFile("f", bytes(7));
    const writable = await (await mock.root.getFileHandle("f")).createWritable();
    await writable.write(bytes(1, 2));
    await writable.abort();
    expect(mock.readFile("f")).toEqual(bytes(7));
    expect(mock.usage()).toBe(1);
  });

  it("moves a file to another folder and keeps the handle working", async () => {
    const mock = createOpfsMock();
    mock.writeFile("tmp/a.mp4", bytes(5));
    const tmp = await mock.root.getDirectoryHandle("tmp");
    const lib = await mock.root.getDirectoryHandle("lib", { create: true });
    const handle = await tmp.getFileHandle("a.mp4");
    await handle.move!(lib, "b.mp4");
    expect(handle.name).toBe("b.mp4");
    expect(mock.listFiles()).toEqual(["lib/b.mp4"]);
    expect(new Uint8Array(await (await handle.getFile()).arrayBuffer())).toEqual(bytes(5));
    await handle.move!("c.mp4");
    expect(mock.listFiles()).toEqual(["lib/c.mp4"]);
  });

  it("can hide move(), like older browsers", async () => {
    const mock = createOpfsMock({ move: false });
    mock.writeFile("a", bytes(1));
    expect((await mock.root.getFileHandle("a")).move).toBeUndefined();
  });

  it("private mode rejects getDirectory; estimate() can be removed", async () => {
    const privateMock = createOpfsMock({ privateMode: true });
    await expect(privateMock.storage.getDirectory()).rejects.toMatchObject({ name: "SecurityError" });
    const safari16 = createOpfsMock({ estimate: false });
    expect(safari16.storage.estimate).toBeUndefined();
    const normal = createOpfsMock({ quota: 1000 });
    normal.writeFile("a", new Uint8Array(10));
    expect(await normal.storage.estimate!()).toEqual({ quota: 1000, usage: 10 });
  });

  it("injects one-time and lasting failures", async () => {
    const mock = createOpfsMock();
    mock.failNext("getDirectory", new DOMException("x", "UnknownError"));
    await expect(mock.storage.getDirectory()).rejects.toMatchObject({ name: "UnknownError" });
    await expect(mock.storage.getDirectory()).resolves.toBe(mock.root);
    mock.failAlways("getFileHandle", new DOMException("y", "InvalidStateError"));
    await expect(mock.root.getFileHandle("a", { create: true })).rejects.toMatchObject({ name: "InvalidStateError" });
    await expect(mock.root.getFileHandle("a", { create: true })).rejects.toMatchObject({ name: "InvalidStateError" });
    mock.failAlways("getFileHandle", null);
    await expect(mock.root.getFileHandle("a", { create: true })).resolves.toMatchObject({ kind: "file" });
  });

  it("installs on navigator.storage and restores it", async () => {
    const before = (globalThis.navigator as { storage?: unknown }).storage;
    const mock = installOpfsMock();
    uninstall = mock.uninstall;
    expect((globalThis.navigator as unknown as { storage: unknown }).storage).toBe(mock.storage);
    mock.uninstall();
    uninstall = null;
    expect((globalThis.navigator as { storage?: unknown }).storage).toBe(before);
  });
});
