/**
 * Test helpers: render clip UI parts with a fake service and a real
 * ClipUiProvider.
 */

import { act, render, type RenderResult } from "@testing-library/react";
import type React from "react";
import { vi } from "vitest";

import { ClipServiceContext } from "../../service/context";
import { ClipUiProvider } from "../ClipUiProvider";
import { createFakeClipService, type FakeClipService, type FakeClipServiceOptions } from "./fakeClipService";

export interface ClipRender extends RenderResult {
  fake: FakeClipService;
  pauseGame: ReturnType<typeof vi.fn>;
  resumeGame: ReturnType<typeof vi.fn>;
}

export function renderWithClips(
  ui: React.ReactNode,
  options: FakeClipServiceOptions & { fake?: FakeClipService; host?: boolean } = {},
): ClipRender {
  const fake = options.fake ?? createFakeClipService(options);
  const pauseGame = vi.fn(() => fake.set({ atBreak: true }));
  const resumeGame = vi.fn(() => fake.set({ atBreak: false }));
  const host = options.host === false ? {} : { pauseGame, resumeGame };
  const result = render(
    <ClipServiceContext.Provider value={fake.service}>
      <ClipUiProvider {...host}>{ui}</ClipUiProvider>
    </ClipServiceContext.Provider>,
  );
  return Object.assign(result, { fake, pauseGame, resumeGame });
}

/** Let pending promise callbacks run (inside act). */
export async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Stub the blob URL API that jsdom lacks. Returns the created URLs. */
export function stubObjectUrls(): { created: string[]; revoked: string[] } {
  const created: string[] = [];
  const revoked: string[] = [];
  let seq = 0;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => {
      seq += 1;
      const url = `blob:test/${seq}`;
      created.push(url);
      return url;
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn((url: string) => revoked.push(url)),
  });
  return { created, revoked };
}

/** Pointer event init for a finger or a mouse. */
export function pointer(
  overrides: Partial<{ pointerId: number; pointerType: string; button: number; clientX: number; clientY: number; isPrimary: boolean }> = {},
) {
  return { pointerId: 1, pointerType: "touch", button: 0, clientX: 20, clientY: 20, isPrimary: true, ...overrides };
}
