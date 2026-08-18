import '@testing-library/jest-dom';
import { vi } from 'vitest';

// next-auth's useSession throws "must be wrapped in a <SessionProvider />"
// outside a provider. Shared chrome that renders LoginButton (Header,
// GameShell's header) calls it, so any test rendering those needs a session.
// Give every test a default unauthenticated session here, while keeping the
// real module (SessionProvider etc.) intact via importOriginal. Tests that
// need a real or signed-in session override useSession with their own
// vi.mock("next-auth/react") in the test file (that per-file mock wins).
vi.mock('next-auth/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth/react')>();
  return {
    ...actual,
    useSession: () => ({ data: null, status: 'unauthenticated' }),
  };
});

// jsdom does not implement localStorage/sessionStorage. Zustand's `persist`
// middleware calls setItem/getItem as soon as any persisted store is touched,
// so without these every persisted-store test throws
// "Cannot read properties of undefined (reading 'setItem')".
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}
Object.defineProperty(window, 'localStorage', {
  writable: true,
  value: new MemoryStorage(),
});
Object.defineProperty(window, 'sessionStorage', {
  writable: true,
  value: new MemoryStorage(),
});

// Mock window.matchMedia for components that use it
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock ResizeObserver for R3F components
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock WebGL context for Three.js
type CanvasGetContext = typeof HTMLCanvasElement.prototype.getContext;
const originalGetContext = HTMLCanvasElement.prototype.getContext as (
  this: HTMLCanvasElement,
  contextId: string,
  options?: unknown
) => unknown;

HTMLCanvasElement.prototype.getContext = (function (
  this: HTMLCanvasElement,
  contextId: string,
  options?: unknown
) {
    if (contextId === 'webgl' || contextId === 'webgl2') {
      return {
        canvas: this,
        getExtension: () => null,
        getParameter: () => null,
        createShader: () => ({}),
        createProgram: () => ({}),
        createBuffer: () => ({}),
        createTexture: () => ({}),
        createFramebuffer: () => ({}),
        createRenderbuffer: () => ({}),
        bindBuffer: () => {},
        bindTexture: () => {},
        bindFramebuffer: () => {},
        bindRenderbuffer: () => {},
        enable: () => {},
        disable: () => {},
        clear: () => {},
        viewport: () => {},
        useProgram: () => {},
        shaderSource: () => {},
        compileShader: () => {},
        attachShader: () => {},
        linkProgram: () => {},
        getProgramParameter: () => true,
        getShaderParameter: () => true,
        getUniformLocation: () => ({}),
        getAttribLocation: () => 0,
        enableVertexAttribArray: () => {},
        vertexAttribPointer: () => {},
        uniform1i: () => {},
        uniform1f: () => {},
        uniform2f: () => {},
        uniform3f: () => {},
        uniform4f: () => {},
        uniformMatrix4fv: () => {},
        drawArrays: () => {},
        drawElements: () => {},
        bufferData: () => {},
        texImage2D: () => {},
        texParameteri: () => {},
        pixelStorei: () => {},
        activeTexture: () => {},
        generateMipmap: () => {},
        deleteShader: () => {},
        deleteProgram: () => {},
        deleteBuffer: () => {},
        deleteTexture: () => {},
        deleteFramebuffer: () => {},
        deleteRenderbuffer: () => {},
        getShaderInfoLog: () => '',
        getProgramInfoLog: () => '',
        isContextLost: () => false,
      } as unknown as WebGLRenderingContext;
    }
    return originalGetContext.call(this, contextId, options);
}) as CanvasGetContext;
