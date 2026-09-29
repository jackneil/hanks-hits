// @vitest-environment node

/**
 * The clip UI must import and render on the server: no window, document or
 * navigator at import time or during a server render. The server render is
 * empty (the hidden snapshot), so the first client render matches it.
 */

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ClipServiceContext } from "../../service/context";
import { ClipUiContext } from "../uiContext";
import { createClipUiController, createClipUiStore } from "../uiStore";
import { createFakeClipService } from "./fakeClipService";

describe("clip UI on the server", () => {
  it("imports the shell parts (the dynamic-import target) with no window, document or navigator", async () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    const parts = await import("../shellParts");
    expect(typeof parts.ClipUiRuntime).toBe("function");
    expect(typeof parts.ClipButton).toBe("function");
  });

  it("renders every part to an empty string, even with a live service and a controller", async () => {
    const parts = await import("../shellParts");
    const fake = createFakeClipService({ snapshot: { unwatchedClipId: "c1", atBreak: true } });
    const controller = createClipUiController({
      store: createClipUiStore(),
      service: () => fake.service,
      snapshot: () => fake.snapshot(),
      host: () => ({}),
      platform: () => "computer",
    });
    const html = renderToString(
      <ClipServiceContext.Provider value={fake.service}>
        <ClipUiContext.Provider value={controller}>
          <parts.ClipUiRuntime pauseGame={() => {}} onController={() => {}} />
          <parts.ClipButton />
          <parts.InPlayConfirm />
          <parts.ToastSlot />
          <parts.ClipsPauseEntry />
          <parts.ResultChipClipActions />
        </ClipUiContext.Provider>
      </ClipServiceContext.Provider>,
    );
    expect(html).toBe("");
  });

  it("detects the save platform safely without a navigator", async () => {
    const { detectSavePlatform } = await import("../platform");
    expect(detectSavePlatform()).toBe("computer");
  });
});
