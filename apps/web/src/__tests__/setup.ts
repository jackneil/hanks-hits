import '@testing-library/jest-dom';

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
HTMLCanvasElement.prototype.getContext = ((originalGetContext) => {
  return function (
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
  };
})(HTMLCanvasElement.prototype.getContext);
