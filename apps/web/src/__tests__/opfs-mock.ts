/**
 * Shared test double for the origin private file system (OPFS) and StorageManager.
 * Keep this the single copy: every clips test that needs OPFS uses it.
 *
 * It behaves like the real APIs where the clip library depends on them:
 * - navigator.storage.getDirectory() gives the root FileSystemDirectoryHandle. In
 *   private mode it rejects (Firefox private windows reject with SecurityError).
 * - FileSystemDirectoryHandle: getDirectoryHandle, getFileHandle, removeEntry
 *   (with recursive), entries/keys/values and async iteration, isSameEntry, resolve.
 * - FileSystemFileHandle: getFile, createWritable (swap file, applied on close),
 *   move (optional, as in older browsers), and createSyncAccessHandle only in the
 *   "worker" context (the method does not exist on window handles).
 * - Locks: a SyncAccessHandle is exclusive. While one is open, createWritable,
 *   a second createSyncAccessHandle, getFile, move and removeEntry fail with
 *   NoModificationAllowedError. The mock is strict about getFile on purpose, so code
 *   must close the handle before it reads the file.
 * - Quota: the logical size of every file (plus open writable swap files) counts.
 *   Growth past the quota throws a DOMException named QuotaExceededError. Files are
 *   sparse, so a 1-byte write at a large offset uses no real memory (like APFS).
 * - storage.estimate() (removable, as in Safari before 17), persisted(), and
 *   persist() in the "window" context only (persist() is Window-only in the spec).
 */

export type OpfsContext = "worker" | "window";

export type OpfsFailOp =
  | "getDirectory"
  | "getDirectoryHandle"
  | "getFileHandle"
  | "removeEntry"
  | "getFile"
  | "createSyncAccessHandle"
  | "createWritable"
  | "syncWrite"
  | "syncFlush"
  | "syncTruncate"
  | "writableWrite"
  | "writableClose"
  | "move"
  | "estimate";

export interface OpfsMockOptions {
  /** "worker" (default) has createSyncAccessHandle; "window" has persist(). */
  context?: OpfsContext;
  /** Quota in bytes. Default 10 GiB. */
  quota?: number;
  /** Private window: getDirectory() rejects. */
  privateMode?: boolean;
  /** DOMException name for the private-mode rejection. Default "SecurityError". */
  privateErrorName?: string;
  /** False removes storage.estimate() (Safari before 17). Default true. */
  estimate?: boolean;
  /** What persist() and persisted() return. Default false (measured in a Safari tab). */
  persisted?: boolean;
  /** False removes move() from file handles. Default true. */
  move?: boolean;
  /** Clock for lastModified. Default Date.now. */
  now?: () => number;
}

const PAGE = 64 * 1024;

/** A sparse byte store: pages that were never written read as zeros. */
class SparseBytes {
  size = 0;
  private pages = new Map<number, Uint8Array>();

  read(offset: number, length: number): Uint8Array<ArrayBuffer> {
    const end = Math.min(this.size, offset + length);
    const out = new Uint8Array(Math.max(0, end - offset));
    for (let pos = offset; pos < end; ) {
      const page = Math.floor(pos / PAGE);
      const inPage = pos - page * PAGE;
      const count = Math.min(PAGE - inPage, end - pos);
      const data = this.pages.get(page);
      if (data) out.set(data.subarray(inPage, inPage + count), pos - offset);
      pos += count;
    }
    return out;
  }

  write(offset: number, bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; ) {
      const pos = offset + i;
      const page = Math.floor(pos / PAGE);
      const inPage = pos - page * PAGE;
      const count = Math.min(PAGE - inPage, bytes.length - i);
      let data = this.pages.get(page);
      if (!data) {
        data = new Uint8Array(PAGE);
        this.pages.set(page, data);
      }
      data.set(bytes.subarray(i, i + count), inPage);
      i += count;
    }
    this.size = Math.max(this.size, offset + bytes.length);
  }

  truncate(size: number): void {
    if (size < this.size) {
      for (const page of [...this.pages.keys()]) {
        if (page * PAGE >= size) this.pages.delete(page);
      }
      const lastPage = Math.floor(size / PAGE);
      const data = this.pages.get(lastPage);
      if (data) data.fill(0, size - lastPage * PAGE);
    }
    this.size = size;
  }

  clone(): SparseBytes {
    const copy = new SparseBytes();
    copy.size = this.size;
    for (const [page, data] of this.pages) copy.pages.set(page, data.slice());
    return copy;
  }
}

interface FileNode {
  kind: "file";
  data: SparseBytes;
  lastModified: number;
  exclusive: boolean;
  shared: number;
}

interface DirNode {
  kind: "directory";
  entries: Map<string, FileNode | DirNode>;
}

function domError(name: string, message: string): DOMException {
  return new DOMException(message, name);
}

function checkName(name: string): void {
  if (typeof name !== "string" || name === "" || name === "." || name === ".." || /[/\\]/.test(name)) {
    throw new TypeError(`Name is not allowed: "${name}"`);
  }
}

function toBytes(data: ArrayBufferView | ArrayBuffer): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function lockedFiles(node: FileNode | DirNode): boolean {
  if (node.kind === "file") return node.exclusive || node.shared > 0;
  for (const child of node.entries.values()) if (lockedFiles(child)) return true;
  return false;
}

export interface MockSyncAccessHandle {
  read(buffer: ArrayBufferView, options?: { at?: number }): number;
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
  truncate(newSize: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

export interface MockWritable {
  write(data: ArrayBufferView | ArrayBuffer | Blob | { type: string; position?: number; size?: number; data?: unknown }): Promise<void>;
  seek(position: number): Promise<void>;
  truncate(size: number): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

export interface MockFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<MockWritable>;
  createSyncAccessHandle?(): Promise<MockSyncAccessHandle>;
  move?(destinationOrName: MockDirectoryHandle | string, newName?: string): Promise<void>;
  isSameEntry(other: unknown): Promise<boolean>;
}

export interface MockDirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MockDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<MockFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, MockFileHandle | MockDirectoryHandle]>;
  keys(): AsyncIterableIterator<string>;
  values(): AsyncIterableIterator<MockFileHandle | MockDirectoryHandle>;
  [Symbol.asyncIterator](): AsyncIterableIterator<[string, MockFileHandle | MockDirectoryHandle]>;
  isSameEntry(other: unknown): Promise<boolean>;
  resolve(possibleDescendant: MockFileHandle | MockDirectoryHandle): Promise<string[] | null>;
}

export interface MockStorageManager {
  getDirectory(): Promise<MockDirectoryHandle>;
  estimate?(): Promise<{ quota: number; usage: number }>;
  persisted(): Promise<boolean>;
  persist?(): Promise<boolean>;
}

export interface OpfsMock {
  storage: MockStorageManager;
  root: MockDirectoryHandle;
  /** Bytes in use: all file sizes plus open writable swap files. */
  usage(): number;
  setQuota(bytes: number): void;
  /** The next call of `op` fails with `error` (default: an InvalidStateError). */
  failNext(op: OpfsFailOp, error?: Error): void;
  /** Every call of `op` fails until `failAlways(op, null)`. */
  failAlways(op: OpfsFailOp, error: Error | null): void;
  /** Bytes of the file at a path such as "lib/guest/abc.mp4", or null. */
  readFile(path: string): Uint8Array | null;
  /** Creates a file (and its folders) with these bytes. */
  writeFile(path: string, bytes: Uint8Array, options?: { lastModified?: number }): void;
  /** Every file path, sorted. */
  listFiles(): string[];
  exists(path: string): boolean;
  /** SyncAccessHandles that are open now. */
  openSyncHandles(): number;
  /** How many times flush() ran on any SyncAccessHandle. */
  flushCount(): number;
}

export function createOpfsMock(options: OpfsMockOptions = {}): OpfsMock {
  const context = options.context ?? "worker";
  const now = options.now ?? (() => Date.now());
  let quota = options.quota ?? 10 * 1024 ** 3;
  const rootNode: DirNode = { kind: "directory", entries: new Map() };
  const swaps = new Set<SparseBytes>();
  const oneShot = new Map<OpfsFailOp, Error>();
  const always = new Map<OpfsFailOp, Error>();
  let openSync = 0;
  let flushes = 0;

  const maybeFail = (op: OpfsFailOp) => {
    const once = oneShot.get(op);
    if (once) {
      oneShot.delete(op);
      throw once;
    }
    const every = always.get(op);
    if (every) throw every;
  };

  const usage = (): number => {
    let total = 0;
    const walk = (dir: DirNode) => {
      for (const node of dir.entries.values()) {
        if (node.kind === "file") total += node.data.size;
        else walk(node);
      }
    };
    walk(rootNode);
    for (const swap of swaps) total += swap.size;
    return total;
  };

  const requireGrowth = (currentSize: number, newSize: number) => {
    const growth = newSize - currentSize;
    if (growth > 0 && usage() + growth > quota) {
      throw domError("QuotaExceededError", `The quota of ${quota} bytes is used up`);
    }
  };

  // Two handles are the same entry when they point at the same node.
  const nodesByHandle = new WeakMap<object, FileNode | DirNode>();
  const sameEntry = (other: unknown, node: FileNode | DirNode) =>
    typeof other === "object" && other !== null && nodesByHandle.get(other) === node;
  const dirNodeOf = (handle: MockDirectoryHandle): DirNode => {
    const node = nodesByHandle.get(handle);
    if (!node || node.kind !== "directory") throw new TypeError("The destination is not a directory handle from this mock");
    return node;
  };

  // Handles refer to an entry by parent folder and name, like the real locators.
  const fileHandle = (parentRef: { dir: DirNode }, initialName: string, node: FileNode): MockFileHandle => {
    let parent = parentRef.dir;
    let name = initialName;
    const present = () => {
      if (parent.entries.get(name) !== node) throw domError("NotFoundError", `"${name}" is gone`);
    };

    const handle: MockFileHandle = {
      kind: "file",
      get name() {
        return name;
      },
      async getFile() {
        maybeFail("getFile");
        present();
        if (node.exclusive) throw domError("NoModificationAllowedError", `"${name}" has an open SyncAccessHandle`);
        const bytes = node.data.read(0, node.data.size);
        return new File([bytes], name, { lastModified: node.lastModified });
      },
      async createWritable(writableOptions = {}) {
        maybeFail("createWritable");
        present();
        if (node.exclusive) throw domError("NoModificationAllowedError", `"${name}" has an open SyncAccessHandle`);
        node.shared++;
        const swap = writableOptions.keepExistingData ? node.data.clone() : new SparseBytes();
        swaps.add(swap);
        let position = 0;
        let state: "open" | "closed" = "open";
        const release = () => {
          state = "closed";
          swaps.delete(swap);
          node.shared--;
        };
        const writeAt = (at: number, bytes: Uint8Array) => {
          requireGrowth(swap.size, Math.max(swap.size, at + bytes.length));
          swap.write(at, bytes);
          position = at + bytes.length;
        };
        return {
          async write(data) {
            if (state !== "open") throw new TypeError("The stream is closed");
            maybeFail("writableWrite");
            if (data instanceof Blob) return writeAt(position, new Uint8Array(await data.arrayBuffer()));
            if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) return writeAt(position, toBytes(data));
            const params = data as { type: string; position?: number; size?: number; data?: unknown };
            if (params.type === "seek") {
              position = params.position ?? 0;
              return;
            }
            if (params.type === "truncate") {
              requireGrowth(swap.size, params.size ?? 0);
              swap.truncate(params.size ?? 0);
              position = Math.min(position, swap.size);
              return;
            }
            const payload = params.data as ArrayBufferView | ArrayBuffer;
            return writeAt(params.position ?? position, toBytes(payload));
          },
          async seek(at) {
            position = at;
          },
          async truncate(size) {
            requireGrowth(swap.size, size);
            swap.truncate(size);
          },
          async close() {
            if (state !== "open") throw new TypeError("The stream is closed");
            try {
              maybeFail("writableClose");
            } catch (error) {
              release();
              throw error;
            }
            // Apply the swap file: the size change counts against the quota once.
            const next = swap;
            release();
            requireGrowth(node.data.size, next.size);
            node.data = next;
            node.lastModified = now();
          },
          async abort() {
            if (state === "open") release();
          },
        };
      },
      async isSameEntry(other) {
        return sameEntry(other, node);
      },
    };
    nodesByHandle.set(handle, node);

    if (context === "worker") {
      handle.createSyncAccessHandle = async () => {
        maybeFail("createSyncAccessHandle");
        present();
        if (node.exclusive || node.shared > 0) {
          throw domError("NoModificationAllowedError", `"${name}" is locked by another handle`);
        }
        node.exclusive = true;
        openSync++;
        let cursor = 0;
        let closed = false;
        const alive = () => {
          if (closed) throw domError("InvalidStateError", "The SyncAccessHandle is closed");
        };
        return {
          read(buffer, readOptions = {}) {
            alive();
            const at = readOptions.at ?? cursor;
            const target = toBytes(buffer);
            const bytes = node.data.read(at, target.length);
            target.set(bytes);
            cursor = at + bytes.length;
            return bytes.length;
          },
          write(buffer, writeOptions = {}) {
            alive();
            maybeFail("syncWrite");
            const at = writeOptions.at ?? cursor;
            const bytes = toBytes(buffer);
            requireGrowth(node.data.size, Math.max(node.data.size, at + bytes.length));
            node.data.write(at, bytes);
            node.lastModified = now();
            cursor = at + bytes.length;
            return bytes.length;
          },
          truncate(newSize) {
            alive();
            maybeFail("syncTruncate");
            requireGrowth(node.data.size, newSize);
            node.data.truncate(newSize);
            node.lastModified = now();
            if (cursor > newSize) cursor = newSize;
          },
          getSize() {
            alive();
            return node.data.size;
          },
          flush() {
            alive();
            maybeFail("syncFlush");
            flushes++;
          },
          close() {
            if (closed) return;
            closed = true;
            node.exclusive = false;
            openSync--;
          },
        };
      };
    }

    if (options.move !== false) {
      handle.move = async (destinationOrName, newName) => {
        maybeFail("move");
        present();
        if (node.exclusive || node.shared > 0) throw domError("NoModificationAllowedError", `"${name}" is locked`);
        const targetDir = typeof destinationOrName === "string" ? parent : dirNodeOf(destinationOrName);
        const targetName = typeof destinationOrName === "string" ? destinationOrName : (newName ?? name);
        checkName(targetName);
        const existing = targetDir.entries.get(targetName);
        if (existing && existing.kind === "directory") throw domError("TypeMismatchError", `"${targetName}" is a folder`);
        if (existing && lockedFiles(existing)) throw domError("NoModificationAllowedError", `"${targetName}" is locked`);
        parent.entries.delete(name);
        targetDir.entries.set(targetName, node);
        parent = targetDir;
        name = targetName;
      };
    }
    return handle;
  };

  const dirHandle = (node: DirNode, dirName: string, parent: DirNode | null): MockDirectoryHandle => {
    const present = () => {
      if (parent && parent.entries.get(dirName) !== node) throw domError("NotFoundError", `"${dirName}" is gone`);
    };
    const childHandle = (childName: string, child: FileNode | DirNode) =>
      child.kind === "file" ? fileHandle({ dir: node }, childName, child) : dirHandle(child, childName, node);

    async function* iterate(): AsyncIterableIterator<[string, MockFileHandle | MockDirectoryHandle]> {
      present();
      for (const childName of [...node.entries.keys()]) {
        const child = node.entries.get(childName);
        if (child) yield [childName, childHandle(childName, child)];
      }
    }

    const handle: MockDirectoryHandle = {
      kind: "directory",
      name: dirName,
      async getDirectoryHandle(childName, getOptions = {}) {
        maybeFail("getDirectoryHandle");
        present();
        checkName(childName);
        const existing = node.entries.get(childName);
        if (existing?.kind === "file") throw domError("TypeMismatchError", `"${childName}" is a file`);
        if (existing) return dirHandle(existing, childName, node);
        if (!getOptions.create) throw domError("NotFoundError", `"${childName}" does not exist`);
        const created: DirNode = { kind: "directory", entries: new Map() };
        node.entries.set(childName, created);
        return dirHandle(created, childName, node);
      },
      async getFileHandle(childName, getOptions = {}) {
        maybeFail("getFileHandle");
        present();
        checkName(childName);
        const existing = node.entries.get(childName);
        if (existing?.kind === "directory") throw domError("TypeMismatchError", `"${childName}" is a folder`);
        if (existing) return fileHandle({ dir: node }, childName, existing);
        if (!getOptions.create) throw domError("NotFoundError", `"${childName}" does not exist`);
        const created: FileNode = { kind: "file", data: new SparseBytes(), lastModified: now(), exclusive: false, shared: 0 };
        node.entries.set(childName, created);
        return fileHandle({ dir: node }, childName, created);
      },
      async removeEntry(childName, removeOptions = {}) {
        maybeFail("removeEntry");
        present();
        checkName(childName);
        const existing = node.entries.get(childName);
        if (!existing) throw domError("NotFoundError", `"${childName}" does not exist`);
        if (existing.kind === "directory" && existing.entries.size > 0 && !removeOptions.recursive) {
          throw domError("InvalidModificationError", `"${childName}" is not empty`);
        }
        if (lockedFiles(existing)) throw domError("NoModificationAllowedError", `"${childName}" is locked`);
        node.entries.delete(childName);
      },
      entries: iterate,
      async *keys() {
        for await (const [childName] of iterate()) yield childName;
      },
      async *values() {
        for await (const [, child] of iterate()) yield child;
      },
      [Symbol.asyncIterator]: iterate,
      async isSameEntry(other) {
        return sameEntry(other, node);
      },
      async resolve(possibleDescendant) {
        const target = nodesByHandle.get(possibleDescendant);
        if (target === node) return [];
        const path: string[] = [];
        const search = (dir: DirNode): boolean => {
          for (const [childName, child] of dir.entries) {
            path.push(childName);
            if (child === target) return true;
            if (child.kind === "directory" && search(child)) return true;
            path.pop();
          }
          return false;
        };
        return search(node) ? path : null;
      },
    };
    nodesByHandle.set(handle, node);
    return handle;
  };

  const root = dirHandle(rootNode, "", null);

  const storage: MockStorageManager = {
    async getDirectory() {
      maybeFail("getDirectory");
      if (options.privateMode) {
        throw domError(options.privateErrorName ?? "SecurityError", "Security error when calling GetDirectory");
      }
      return root;
    },
    async persisted() {
      return options.persisted ?? false;
    },
  };
  if (options.estimate !== false) {
    storage.estimate = async () => {
      maybeFail("estimate");
      return { quota, usage: usage() };
    };
  }
  if (context === "window") storage.persist = async () => options.persisted ?? false;

  const walkPath = (path: string, create: boolean): { dir: DirNode; name: string } | null => {
    const parts = path.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) return null;
    let dir = rootNode;
    for (const part of parts) {
      let next = dir.entries.get(part);
      if (!next && create) {
        next = { kind: "directory", entries: new Map() };
        dir.entries.set(part, next);
      }
      if (!next || next.kind !== "directory") return null;
      dir = next;
    }
    return { dir, name: fileName };
  };

  return {
    storage,
    root,
    usage,
    setQuota(bytes) {
      quota = bytes;
    },
    failNext(op, error = domError("InvalidStateError", `${op} failed (test)`)) {
      oneShot.set(op, error);
    },
    failAlways(op, error) {
      if (error) always.set(op, error);
      else always.delete(op);
    },
    readFile(path) {
      const place = walkPath(path, false);
      const node = place?.dir.entries.get(place.name);
      return node?.kind === "file" ? node.data.read(0, node.data.size) : null;
    },
    writeFile(path, bytes, writeOptions = {}) {
      const place = walkPath(path, true);
      if (!place) throw new TypeError(`bad path "${path}"`);
      const data = new SparseBytes();
      data.write(0, bytes);
      place.dir.entries.set(place.name, {
        kind: "file",
        data,
        lastModified: writeOptions.lastModified ?? now(),
        exclusive: false,
        shared: 0,
      });
    },
    listFiles() {
      const files: string[] = [];
      const walk = (dir: DirNode, prefix: string) => {
        for (const [childName, child] of dir.entries) {
          if (child.kind === "file") files.push(prefix + childName);
          else walk(child, `${prefix}${childName}/`);
        }
      };
      walk(rootNode, "");
      return files.sort();
    },
    exists(path) {
      const place = walkPath(path, false);
      return !!place && place.dir.entries.has(place.name);
    },
    openSyncHandles() {
      return openSync;
    },
    flushCount() {
      return flushes;
    },
  };
}

/**
 * Creates a mock and puts its StorageManager on globalThis.navigator.storage.
 * Call uninstall() in afterEach to restore the previous value.
 */
export function installOpfsMock(options: OpfsMockOptions = {}): OpfsMock & { uninstall(): void } {
  const mock = createOpfsMock(options);
  const holder = globalThis as { navigator?: object };
  let createdNavigator = false;
  if (!holder.navigator) {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true, writable: true });
    createdNavigator = true;
  }
  const nav = holder.navigator as object;
  const previous = Object.getOwnPropertyDescriptor(nav, "storage");
  Object.defineProperty(nav, "storage", { value: mock.storage, configurable: true, writable: true });
  return {
    ...mock,
    uninstall() {
      if (previous) Object.defineProperty(nav, "storage", previous);
      else delete (nav as { storage?: unknown }).storage;
      if (createdNavigator) delete (globalThis as { navigator?: unknown }).navigator;
    },
  };
}
