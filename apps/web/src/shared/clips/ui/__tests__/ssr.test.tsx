// @vitest-environment node

/**
 * The clip UI must import and render on the server: no window, document or
 * navigator at import time or during a server render. The server render is
 * empty (the hidden snapshot), so the first client render matches it.
 */

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ClipServiceContext } from "../../service/context";
import { createFakeClipService } from "./fakeClipService";

describe("clip UI on the server", () => {
  it("imports with no window, document or navigator", async () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    const ui = await import("../index");
    expect(typeof ui.ClipButton).toBe("function");
    expect(typeof ui.ClipUiProvider).toBe("function");
  });

  it("renders every part to an empty string, even with a live service", async () => {
    const ui = await import("../index");
    const fake = createFakeClipService({ snapshot: { unwatchedClipId: "c1", atBreak: true } });
    const html = renderToString(
      <ClipServiceContext.Provider value={fake.service}>
        <ui.ClipUiProvider pauseGame={() => {}}>
          <ui.ClipButton />
          <ui.InPlayConfirm />
          <ui.ToastSlot />
          <ui.ClipsPauseEntry />
          <ui.ResultChipClipActions runSeconds={20} />
        </ui.ClipUiProvider>
      </ClipServiceContext.Provider>,
    );
    expect(html).toBe("");
  });

  it("detects the save platform safely without a navigator", async () => {
    const { detectSavePlatform } = await import("../platform");
    expect(detectSavePlatform()).toBe("computer");
  });
});
