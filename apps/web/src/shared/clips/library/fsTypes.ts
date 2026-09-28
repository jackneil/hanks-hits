/**
 * The parts of the File System (OPFS), Storage and Web Locks APIs that the library
 * uses. The TypeScript DOM library puts createSyncAccessHandle only in the worker
 * library and has no async iteration or move() on directory handles, so the library
 * uses these structural types. Real browser handles fit them.
 */

/**
 * A FileSystemSyncAccessHandle. Safari 15.2 to 16.3 implement close, flush, getSize
 * and truncate as async methods (an older draft of the spec; MDN compat data), so
 * these methods can return a Promise. The library awaits every call: an await of a
 * plain value does no harm on browsers with the synchronous methods.
 */
export interface SyncAccessHandleLike {
  read(buffer: ArrayBufferView, options?: { at?: number }): number;
  write(buffer: ArrayBufferView, options?: { at?: number }): number;
  truncate(newSize: number): void | Promise<void>;
  getSize(): number | Promise<number>;
  flush(): void | Promise<void>;
  close(): void | Promise<void>;
}

export interface WritableLike {
  write(data: ArrayBufferView | ArrayBuffer | Blob): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

export interface FileHandleLike {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  createWritable?(options?: { keepExistingData?: boolean }): Promise<WritableLike>;
  /** Only in a dedicated worker. */
  createSyncAccessHandle?(): Promise<SyncAccessHandleLike>;
  /** Not in every browser. */
  move?(destination: DirectoryHandleLike, newName: string): Promise<void>;
}

export interface DirectoryHandleLike {
  readonly kind: "directory";
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, FileHandleLike | DirectoryHandleLike]>;
}

export interface StorageLike {
  getDirectory?(): Promise<DirectoryHandleLike>;
  estimate?(): Promise<{ quota?: number; usage?: number }>;
}

export interface LocksLike {
  request<T>(name: string, callback: (lock: unknown) => Promise<T> | T): Promise<T>;
}

export interface BroadcastLike {
  postMessage(message: unknown): void;
  close?(): void;
}
