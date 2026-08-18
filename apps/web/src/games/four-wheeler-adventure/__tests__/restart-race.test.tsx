import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FourWheelerAdventureGame } from "../Game";

const gameHtml = "<!doctype html><html><body>four-wheeler</body></html>";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(gameHtml) })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Four-Wheeler restart intent", () => {
  it("applies a restart confirmed before the child listener or iframe mounts", async () => {
    const view = render(<FourWheelerAdventureGame restartNonce={1} />);

    await waitFor(() => {
      expect(view.container.querySelector("iframe")).not.toBeNull();
    });

    const iframe = view.container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("srcdoc")).toBe(gameHtml);

    // The first non-zero nonce was supplied before the asynchronous child
    // content mounted. A later nonce must still replace the mounted iframe.
    view.rerender(<FourWheelerAdventureGame restartNonce={2} />);
    await waitFor(() => {
      expect(view.container.querySelector("iframe")).not.toBe(iframe);
    });
    expect(view.container.querySelector("iframe")?.getAttribute("srcdoc")).toBe(
      gameHtml
    );
  });
});
