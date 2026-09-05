import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installSpeechMock,
  removeSpeechMock,
} from "@/__tests__/speech-mock";

import { ReadAloudButton } from "../ReadAloudButton";


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
    expect(synth.lastUtterance().text).toBe("Hello there");
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

describe("ReadAloudButton icon variant", () => {
  it("renders only the speaker icon with a big round touch target", async () => {
    installSpeechMock();
    render(
      <ReadAloudButton variant="icon" text="Snake" className="absolute" />
    );

    const button = await screen.findByTestId("read-aloud-button");
    expect(button).toHaveTextContent("🔊");
    expect(button).not.toHaveTextContent("Read it to me");
    expect(button).toHaveAttribute("aria-label", "Read it to me");
    expect(button.className).toMatch(/btn-circle/);
    expect(button.className).toMatch(/min-h-\[44px\]/);
    expect(button.className).toMatch(/min-w-\[44px\]/);
    expect(button.className).not.toMatch(/w-full/);
    expect(button.className).toMatch(/absolute/);
  });

  it("speaks on tap and flips to the stop icon", async () => {
    const synth = installSpeechMock();
    render(<ReadAloudButton variant="icon" text="Snake" />);

    const button = await screen.findByTestId("read-aloud-button");
    fireEvent.click(button);

    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(synth.lastUtterance().text).toBe("Snake");
    expect(button).toHaveTextContent("⏹");
    expect(button).toHaveAttribute("aria-label", "Stop reading");
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("renders nothing when the browser cannot speak", async () => {
    removeSpeechMock();
    const { container } = render(<ReadAloudButton variant="icon" text="Snake" />);

    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
