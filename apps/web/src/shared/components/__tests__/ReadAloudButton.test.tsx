import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReadAloudButton } from "../ReadAloudButton";

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

afterEach(() => {
  removeSpeechMock();
  vi.restoreAllMocks();
});

describe("ReadAloudButton", () => {
  it("renders nothing when the browser cannot speak", async () => {
    removeSpeechMock();
    const { container } = render(<ReadAloudButton text="Hello there" />);

    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(screen.queryByTestId("read-aloud-button")).not.toBeInTheDocument();
  });

  it("reads the text aloud on tap and stops on a second tap", async () => {
    const synth = installSpeechMock();
    render(<ReadAloudButton text="Hello there" />);

    const button = await screen.findByTestId("read-aloud-button");
    expect(button).toHaveTextContent("🔊 Read it to me");
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(spokenText(synth)).toBe("Hello there");
    expect(button).toHaveTextContent("⏹ Stop");
    expect(button).toHaveAttribute("aria-pressed", "true");

    synth.cancel.mockClear();
    fireEvent.click(button);
    expect(synth.cancel).toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(button).toHaveTextContent("🔊 Read it to me");
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("never speaks on mount", async () => {
    const synth = installSpeechMock();
    render(<ReadAloudButton text="Hello there" />);

    await screen.findByTestId("read-aloud-button");
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it("uses a custom label and keeps a big touch target", async () => {
    installSpeechMock();
    render(<ReadAloudButton text="Hello" label="🔊 Say it" className="mb-4" />);

    const button = await screen.findByTestId("read-aloud-button");
    expect(button).toHaveTextContent("🔊 Say it");
    expect(button.className).toMatch(/min-h-\[56px\]/);
    expect(button.className).toMatch(/w-full/);
    expect(button.className).toMatch(/mb-4/);
  });
});
