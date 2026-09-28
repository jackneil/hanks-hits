import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { useAttachedGame, useClipService, useClipSnapshot } from "../../service/context";
import type { ClipServiceApi, GameAttachment } from "../../service/contract";
import { LabClipScope, useLabServiceState } from "../LabClipScope";
import { FakeLabService } from "./fakeLabService";

const GAME: GameAttachment = Object.freeze({ appId: "clips-lab", gameName: "Clips lab", emoji: "🧪", canPause: false });

function Probe() {
  const state = useLabServiceState();
  const service = useClipService();
  const game = useAttachedGame();
  const snapshot = useClipSnapshot();
  return (
    <p data-testid="probe">{`${state}|${service ? "service" : "none"}|${game ? "game" : "none"}|${snapshot.appId ?? "-"}`}</p>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const text = () => screen.getByTestId("probe").textContent;

describe("LabClipScope", () => {
  it("renders no service on the server, so the first client render matches", () => {
    const load = vi.fn(async () => new FakeLabService() as ClipServiceApi);
    const html = renderToString(
      <LabClipScope game={GAME} loadService={load}>
        <Probe />
      </LabClipScope>,
    );
    expect(html).toContain("loading|none|none|-");
    expect(load).not.toHaveBeenCalled();
  });

  it("loads the service once after the mount, attaches the game and gives both to the children", async () => {
    const service = new FakeLabService();
    const load = vi.fn(async () => service as ClipServiceApi);
    render(
      <LabClipScope game={GAME} loadService={load}>
        <Probe />
      </LabClipScope>,
    );
    expect(text()).toBe("loading|none|none|-");
    await act(async () => undefined);
    expect(load).toHaveBeenCalledOnce();
    expect(service.attach).toHaveBeenCalledOnce();
    expect(service.attach).toHaveBeenCalledWith(GAME);
    expect(text()).toBe("ready|service|game|clips-lab");
  });

  it("says missing when the loader gives null (clips are off)", async () => {
    render(
      <LabClipScope game={GAME} loadService={async () => null}>
        <Probe />
      </LabClipScope>,
    );
    await act(async () => undefined);
    expect(text()).toBe("missing|none|none|-");
  });

  it("says error when the loader fails", async () => {
    render(
      <LabClipScope game={GAME} loadService={async () => Promise.reject(new Error("chunk load failed"))}>
        <Probe />
      </LabClipScope>,
    );
    await act(async () => undefined);
    expect(text()).toBe("error|none|none|-");
  });

  it("says error, and gives no service, when attach throws", async () => {
    const service = new FakeLabService();
    service.attach.mockImplementation(() => {
      throw new Error("disabled");
    });
    render(
      <LabClipScope game={GAME} loadService={async () => service}>
        <Probe />
      </LabClipScope>,
    );
    await act(async () => undefined);
    expect(text()).toBe("error|none|none|-");
  });

  it("detaches the game on unmount", async () => {
    const service = new FakeLabService();
    const view = render(
      <LabClipScope game={GAME} loadService={async () => service}>
        <Probe />
      </LabClipScope>,
    );
    await act(async () => undefined);
    const attached = service.games[0];
    expect(attached.detach).not.toHaveBeenCalled();
    view.unmount();
    expect(attached.detach).toHaveBeenCalledOnce();
    expect(service.listenerCount).toBe(0);
  });

  it("never attaches when it unmounts before the loader finishes", async () => {
    const service = new FakeLabService();
    const load = deferred<ClipServiceApi | null>();
    const view = render(
      <LabClipScope game={GAME} loadService={() => load.promise}>
        <Probe />
      </LabClipScope>,
    );
    view.unmount();
    await act(async () => {
      load.resolve(service);
      await load.promise;
    });
    expect(service.attach).not.toHaveBeenCalled();
  });
});
