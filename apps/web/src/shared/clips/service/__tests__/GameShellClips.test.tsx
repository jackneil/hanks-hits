/**
 * GameShell mounts the clip service for a module whose metadata literal is
 * clips: true (plan 4.1), and its start card and pause menu are the breaks
 * (plan 11.1). The real GameShell, GameStartOverlay and ClipProvider; the
 * service is a double (the capture engine is tested in engineHost.test.ts).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/shared/lib/gameMetadata.generated", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/lib/gameMetadata.generated")>();
  return {
    ...actual,
    getGameMetadata: (appId: string) => ({ ...actual.getGameMetadata(appId), clips: appId === "clip-game", icon: "🎯" }),
  };
});

vi.mock("../../config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config")>();
  return { ...actual, loadClipsVerdict: vi.fn(async () => ({ mode: "on", capture: true })) };
});

const fake = vi.hoisted(() => ({ service: null as unknown }));
vi.mock("../ClipService", () => ({ startClipService: () => fake.service }));

import { GameShell } from "@/shared/components/GameShell";
import { GameStartOverlay } from "@/shared/components/GameStartOverlay";
import { useStartOverlayPresence } from "@/shared/lib/startOverlayPresence";
import { HIDDEN_SNAPSHOT, type GameAttachment } from "../contract";

function fakeService() {
  const handle = {
    registerCanvas: vi.fn(() => () => undefined),
    autoDiscover: vi.fn(() => () => undefined),
    runPhase: vi.fn(),
    markMoment: vi.fn(),
    setAtBreak: vi.fn(),
    detach: vi.fn(),
  };
  const attachments: GameAttachment[] = [];
  const service = {
    subscribe: () => () => undefined,
    getSnapshot: () => HIDDEN_SNAPSHOT,
    getServerSnapshot: () => HIDDEN_SNAPSHOT,
    attach: vi.fn((game: GameAttachment) => {
      attachments.push(game);
      return handle;
    }),
    refreshGame: vi.fn(),
  };
  return { service, handle, attachments };
}

function ClipGame() {
  const [started, setStarted] = useState(false);
  return (
    <GameShell appId="clip-game" gameName="Clip Game">
      {started ? <p>playing</p> : <GameStartOverlay title="Clip Game" emoji="🎯" onStart={() => setStarted(true)} />}
    </GameShell>
  );
}

beforeEach(() => {
  useStartOverlayPresence.setState({ count: 0 });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("GameShell with a clips: true module", () => {
  it("attaches the game with the shell's name, emoji and pause, and the start card and pause menu are breaks", async () => {
    const f = fakeService();
    fake.service = f.service;
    render(<ClipGame />);
    await act(async () => undefined);
    expect(f.service.attach).toHaveBeenCalledTimes(1);
    expect(f.attachments[0]).toMatchObject({ appId: "clip-game", gameName: "Clip Game", emoji: "🎯", canPause: true });
    const breaks = () => f.handle.setAtBreak.mock.calls.map((c) => c[0]);
    // On the start card: a break.
    expect(breaks().at(-1)).toBe(true);
    // Play: the run starts, and capture flows.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /play/i }));
    });
    expect(breaks().at(-1)).toBe(false);
    expect(f.handle.runPhase).toHaveBeenLastCalledWith("start");
    // The shell's pause menu: a break again; resume: play.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pause game" }));
    });
    expect(breaks().at(-1)).toBe(true);
    await act(async () => {
      f.attachments[0].resume?.();
    });
    expect(breaks().at(-1)).toBe(false);
    // The attachment's pause is the shell's pause (the game pauses before a clip sheet or a share).
    await act(async () => {
      f.attachments[0].pause?.();
    });
    expect(breaks().at(-1)).toBe(true);
    expect(screen.getByRole("button", { name: "Resume game" })).toBeInTheDocument();
  });

  it("detaches when the game page goes away", async () => {
    const f = fakeService();
    fake.service = f.service;
    const view = render(<ClipGame />);
    await act(async () => undefined);
    view.unmount();
    expect(f.handle.detach).toHaveBeenCalledTimes(1);
  });

  it("mounts no clip service for a module without clips: true", async () => {
    const f = fakeService();
    fake.service = f.service;
    render(
      <GameShell appId="breakout" gameName="Breakout">
        <p>game</p>
      </GameShell>,
    );
    await act(async () => undefined);
    expect(f.service.attach).not.toHaveBeenCalled();
  });
});
