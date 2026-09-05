import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PauseMenu } from "../PauseMenu";

describe("PauseMenu restart", () => {
  it("shows restart and forwards a confirmed restart", async () => {
    const onRestart = vi.fn();
    render(
      <PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} onRestart={onRestart} gameName="2048" />
    );

    fireEvent.click(screen.getByRole("button", { name: /restart game/i }));
    expect(await screen.findByRole("dialog", { name: /restart game/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm restart/i }));

    await waitFor(() => expect(onRestart).toHaveBeenCalledTimes(1));
  });
});

type SpeechFake = {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
};

/** jsdom has no Web Speech API — install a fake one. */
function installSpeechMock() {
  const synth = {
    speak: vi.fn(),
    cancel: vi.fn(),
    getVoices: vi.fn(() => [] as SpeechSynthesisVoice[]),
    speaking: false,
    paused: false,
    pending: false,
  };
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    writable: true,
    value: synth,
  });
  class FakeUtterance {
    text: string;
    rate?: number;
    pitch?: number;
    lang?: string;
    voice?: unknown;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    configurable: true,
    writable: true,
    value: FakeUtterance,
  });
  return synth as unknown as SpeechFake;
}

function removeSpeechMock() {
  // @ts-expect-error - removing the fake API to simulate an old browser
  delete window.speechSynthesis;
  // @ts-expect-error - removing the fake API to simulate an old browser
  delete window.SpeechSynthesisUtterance;
}

/** The text handed to the most recent speak() call. */
function spokenText(synth: SpeechFake): string {
  const last = synth.speak.mock.calls[synth.speak.mock.calls.length - 1];
  return (last[0] as { text: string }).text;
}

describe("PauseMenu read aloud", () => {
  afterEach(() => {
    removeSpeechMock();
    vi.restoreAllMocks();
  });

  it("reads the whole pause menu, restart included", async () => {
    const synth = installSpeechMock();
    render(
      <PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} onRestart={vi.fn()} gameName="Snake" />
    );

    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(spokenText(synth)).toBe("Paused. Snake. Resume. Restart. Go Home");
  });

  it("leaves Restart out when the game has no restart action", async () => {
    const synth = installSpeechMock();
    render(<PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);

    fireEvent.click(await screen.findByTestId("read-aloud-button"));
    expect(spokenText(synth)).toBe("Paused. Snake. Resume. Go Home");
  });

  it("shows no read-aloud button when the browser cannot speak", () => {
    removeSpeechMock();
    render(<PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} gameName="Snake" />);
    expect(screen.queryByTestId("read-aloud-button")).not.toBeInTheDocument();
  });
});
