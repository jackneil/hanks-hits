import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installAudioMock, removeAudioMock, type AudioMock, type FakeOscillatorNode } from "@/__tests__/audio-mock";
import { FakeRealm, installCanvasContexts, type InstalledContexts } from "@/__tests__/canvas-mock";
import { installSpeechMock } from "@/__tests__/speech-mock";
import { getGameAudio, type GameAudioChannel } from "@/shared/lib/audio";

import { ClipsLabPage, LAB_CLIP_SECONDS, LAB_GAME } from "../ClipsLab";
import { LAB_AUDIO_APP_ID } from "../labBeep";
import { LAB_COPY, LAB_REASON_TEXT } from "../labCopy";
import type { ClipsLabHandle } from "../labHandle";
import { DEFAULT_LAB_OPTIONS, type ClipsLabOptions } from "../labParams";
import { FakeLabService, clipFile, clipRecord } from "./fakeLabService";

let realm: FakeRealm;
let contexts: InstalledContexts;
let audio: AudioMock;
let urls: string[];
let revoked: string[];
const savedCreate = URL.createObjectURL;
const savedRevoke = URL.revokeObjectURL;

beforeEach(() => {
  realm = new FakeRealm();
  vi.stubGlobal("requestAnimationFrame", realm.requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", realm.cancelAnimationFrame);
  contexts = installCanvasContexts(window);
  audio = installAudioMock({ initialState: "suspended" });
  installSpeechMock();
  urls = [];
  revoked = [];
  URL.createObjectURL = vi.fn(() => {
    const url = `blob:lab/${urls.length + 1}`;
    urls.push(url);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  contexts.restore();
  removeAudioMock();
  URL.createObjectURL = savedCreate;
  URL.revokeObjectURL = savedRevoke;
});

const labWindow = () => window as unknown as { __clipsLab?: ClipsLabHandle };

async function mount(options: Partial<ClipsLabOptions> = {}, service: FakeLabService | null = new FakeLabService()) {
  const view = render(<ClipsLabPage options={{ ...DEFAULT_LAB_OPTIONS, ...options }} loadService={async () => service} />);
  await act(async () => undefined);
  return { view, service, attached: service?.games[0] ?? null };
}

/** Runs display frames at 60 Hz, moving the audio clock with the page clock. */
function frames(count: number, startMs: number): number {
  let t = startMs;
  for (let i = 0; i < count; i++) {
    act(() => {
      if (audio.contexts.length) audio.lastContext().advanceTime(1 / 60);
      realm.frame(t);
    });
    t += 1000 / 60;
  }
  return t;
}

function oscillators(): FakeOscillatorNode[] {
  if (!audio.contexts.length) return [];
  return audio.lastContext().createOscillator.mock.results.map((r) => r.value as FakeOscillatorNode);
}

describe("ClipsLab", () => {
  it("shows the lab with big buttons, read-aloud buttons and the empty clip state", async () => {
    await mount();
    for (const id of ["lab-start", "lab-clip", "lab-record-start", "lab-record-stop"]) {
      expect(screen.getByTestId(id).className).toMatch(/min-h-\[48px\]/);
    }
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(LAB_COPY.title);
    expect(screen.getByText(LAB_COPY.noClip)).toBeTruthy();
    // One read-aloud button for the page, one for the empty clip state.
    expect(screen.getAllByTestId("read-aloud-button")).toHaveLength(2);
    expect(screen.getByTestId("lab-last-clip").getAttribute("data-state")).toBe("none");
  });

  it("says that clips are off, and keeps the clip buttons off, when the loader gives no service", async () => {
    await mount({}, null);
    expect(screen.getByTestId("lab-status").getAttribute("data-service")).toBe("missing");
    expect(screen.getByTestId("lab-message").textContent).toBe(LAB_COPY.serviceMissing);
    expect((screen.getByTestId("lab-clip") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("lab-record-start") as HTMLButtonElement).disabled).toBe(true);
    // The picture still runs: the lab is a game without clips.
    expect((screen.getByTestId("lab-start") as HTMLButtonElement).disabled).toBe(false);
  });

  it("attaches the lab game and registers its canvas with the target frame rate", async () => {
    const { service, attached } = await mount({ targetFps: 30 });
    expect(service?.attach).toHaveBeenCalledWith(LAB_GAME);
    const canvas = screen.getByTestId("lab-canvas");
    expect(attached?.registered).toEqual([{ canvas, options: { targetFps: 30 } }]);
    expect(canvas.getAttribute("data-path")).toBe("P");
    // Before Start, the lab is at a break, so capture waits.
    expect(attached?.setAtBreak).toHaveBeenLastCalledWith(true);
  });

  it("registers a WebGL2 canvas for ?gl=2", async () => {
    const { attached } = await mount({ gl: true });
    const canvas = screen.getByTestId("lab-canvas") as HTMLCanvasElement;
    expect(canvas.getAttribute("data-path")).toBe("E");
    expect((canvas as unknown as { getContextCalls: string[] }).getContextCalls).toEqual(["webgl2"]);
    expect(attached?.registered[0].canvas).toBe(canvas);
  });

  it("says so when the browser cannot draw the picture", async () => {
    const proto = HTMLCanvasElement.prototype as unknown as { getContext: () => null };
    const saved = Object.getOwnPropertyDescriptor(proto, "getContext");
    Object.defineProperty(proto, "getContext", { configurable: true, writable: true, value: () => null });
    try {
      await mount({ gl: true });
      frames(1, 1000);
      expect(screen.getByRole("alert").textContent).toBe(LAB_COPY.noPicture);
    } finally {
      if (saved) Object.defineProperty(proto, "getContext", saved);
    }
  });

  it("starts the sound inside the Start tap, and flashes the frame in the same frame that starts each beep", async () => {
    const { attached } = await mount();
    const canvas = screen.getByTestId("lab-canvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d") as unknown as { fillStyle: string; fillRect: (...a: number[]) => void };
    const fills: Array<{ frame: number; style: string; rect: number[] }> = [];
    let frameNo = 0;
    const draw = ctx.fillRect.bind(ctx);
    ctx.fillRect = (...rect: number[]) => {
      fills.push({ frame: frameNo, style: ctx.fillStyle, rect });
      draw(...rect);
    };

    await act(async () => {
      fireEvent.click(screen.getByTestId("lab-start"));
      await audio.flush();
    });
    const context = audio.lastContext();
    expect(context.resume).toHaveBeenCalled();
    expect(context.state).toBe("running");
    expect(attached?.runPhase).toHaveBeenCalledWith("start");
    expect(attached?.setAtBreak).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId("lab-start").textContent).toBe(LAB_COPY.stop);

    // 3.2 s of 60 Hz frames: beats at context time 1, 2 and 3.
    const beatFrames: number[] = [];
    let t = 1000;
    for (frameNo = 0; frameNo < 192; frameNo++) {
      const before = oscillators().length;
      act(() => {
        context.advanceTime(1 / 60);
        realm.frame(t);
      });
      t += 1000 / 60;
      if (oscillators().length > before) beatFrames.push(frameNo);
    }
    expect(beatFrames).toHaveLength(3);
    const whiteFrames = fills.filter((f) => f.style === "rgb(255, 255, 255)").map((f) => f.frame);
    // The flash starts in the frame of the beep and lasts the lowest rung's stride (4 frames at 60 Hz).
    expect(whiteFrames).toEqual(beatFrames.flatMap((f) => [f, f + 1, f + 2, f + 3]));
    expect(screen.getByText("4 frames")).toBeTruthy();
    for (const f of fills.filter((x) => x.style === "rgb(255, 255, 255)")) expect(f.rect).toEqual([0, 0, 640, 360]);
    // Each beep starts at the context time of its frame.
    oscillators().forEach((osc, i) => {
      expect(osc.startTime).toBeGreaterThanOrEqual(i + 1);
      expect(osc.startTime! - (i + 1)).toBeLessThan(1 / 60 + 1e-9);
    });
    expect(screen.getByTestId("lab-status").getAttribute("data-beats")).toBe("3");
    expect(labWindow().__clipsLab?.truth().map((b) => b.index)).toEqual([0, 1, 2]);
  });

  it("stops the beats at Stop and goes back to a break", async () => {
    const { attached } = await mount();
    await act(async () => {
      fireEvent.click(screen.getByTestId("lab-start"));
      await audio.flush();
    });
    const t = frames(70, 1000);
    expect(oscillators()).toHaveLength(1);
    act(() => {
      fireEvent.click(screen.getByTestId("lab-start"));
    });
    expect(attached?.runPhase).toHaveBeenLastCalledWith("end");
    expect(attached?.setAtBreak).toHaveBeenLastCalledWith(true);
    frames(120, t);
    expect(oscillators()).toHaveLength(1);
    expect(screen.getByTestId("lab-start").textContent).toBe(LAB_COPY.start);
  });

  it("plays each beep on the lab's own channel of the game-audio bus", async () => {
    await mount();
    const bus = getGameAudio()!;
    const channels: GameAudioChannel[] = [];
    const make = bus.channel.bind(bus);
    vi.spyOn(bus, "channel").mockImplementation((appId: string) => {
      const channel = make(appId);
      channels.push(channel);
      return channel;
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("lab-start"));
      await audio.flush();
    });
    frames(70, 1000);
    expect(channels.map((c) => c.appId)).toEqual([LAB_AUDIO_APP_ID]);
    const osc = oscillators()[0];
    // oscillator -> beep gain -> the lab channel's input.
    const beepGain = [...osc.outputs][0] as unknown as { outputs: Set<unknown> };
    expect(beepGain.outputs.has(channels[0].input)).toBe(true);
  });

  it("makes a 10 s clip with Clip it!, then shows it and exposes its bytes and its record", async () => {
    const service = new FakeLabService();
    const bytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112]);
    service.files.set("c-1", clipFile(bytes));
    service.clipResult = { ok: true, action: "clip", record: clipRecord({ bytes: bytes.length }), atMs: 5 };
    await mount({}, service);
    await act(async () => {
      fireEvent.click(screen.getByTestId("lab-clip"));
    });
    expect(service.clipLast).toHaveBeenCalledWith(LAB_CLIP_SECONDS);
    expect(LAB_CLIP_SECONDS).toBe(10);
    expect(service.library.file).toHaveBeenCalledWith("c-1");

    const hidden = screen.getByTestId("lab-last-clip");
    expect(hidden.hidden).toBe(true);
    expect(hidden.getAttribute("data-state")).toBe("ready");
    expect(hidden.getAttribute("data-action")).toBe("clip");
    expect(hidden.getAttribute("data-results")).toBe("1");
    expect(hidden.getAttribute("data-blob-url")).toBe("blob:lab/1");
    expect(hidden.getAttribute("data-bytes")).toBe(String(bytes.length));
    expect(screen.getByTestId("lab-last-clip-url").getAttribute("href")).toBe("blob:lab/1");
    expect(JSON.parse(screen.getByTestId("lab-last-record").textContent ?? "")).toEqual(service.clipResult.ok && service.clipResult.record);
    expect(screen.getByTestId("lab-message").textContent).toBe(LAB_COPY.clipMade);

    const handle = labWindow().__clipsLab!;
    expect(handle.status().lastClip).toMatchObject({ action: "clip", bytes: bytes.length, url: "blob:lab/1" });
    expect(handle.status().results).toBe(1);
    const back = Buffer.from(await handle.readClipBase64(0, 1024), "base64");
    expect(back.equals(Buffer.from(bytes))).toBe(true);
  });

  it("shows the reason and a next step when the clip cannot be made", async () => {
    const service = new FakeLabService();
    service.clipResult = { ok: false, action: "clip", reason: "warming", atMs: 5 };
    await mount({}, service);
    await act(async () => {
      fireEvent.click(screen.getByTestId("lab-clip"));
    });
    const hidden = screen.getByTestId("lab-last-clip");
    expect(hidden.getAttribute("data-state")).toBe("error");
    expect(hidden.getAttribute("data-reason")).toBe("warming");
    expect(hidden.getAttribute("data-results")).toBe("1");
    expect(screen.getByTestId("lab-message").textContent).toBe(LAB_REASON_TEXT.warming);
    expect(service.library.file).not.toHaveBeenCalled();
  });

  it("says the clip could not be made when its file cannot be read", async () => {
    const service = new FakeLabService();
    await mount({}, service); // no file for c-1: library.file rejects
    await act(async () => {
      fireEvent.click(screen.getByTestId("lab-clip"));
    });
    expect(screen.getByTestId("lab-last-clip").getAttribute("data-state")).toBe("error");
    expect(screen.getByTestId("lab-last-clip").getAttribute("data-reason")).toBe("mux-failed");
    expect(screen.getByTestId("lab-message").textContent).toBe(LAB_REASON_TEXT["mux-failed"]);
  });

  it("records a video with Record a video and Stop the video", async () => {
    const service = new FakeLabService();
    service.files.set("r-1", clipFile(Uint8Array.from([1, 2, 3, 4])));
    await mount({}, service);
    const startButton = screen.getByTestId("lab-record-start") as HTMLButtonElement;
    const stopButton = screen.getByTestId("lab-record-stop") as HTMLButtonElement;
    expect(stopButton.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(startButton);
    });
    expect(service.startRecording).toHaveBeenCalledOnce();
    expect(startButton.disabled).toBe(true);
    expect(stopButton.disabled).toBe(false);
    expect(screen.getByTestId("lab-status").getAttribute("data-recording")).toBe("1");
    await act(async () => {
      fireEvent.click(stopButton);
    });
    expect(service.stopRecording).toHaveBeenCalledOnce();
    expect(service.library.file).toHaveBeenCalledWith("r-1");
    expect(screen.getByTestId("lab-last-clip").getAttribute("data-action")).toBe("record");
    expect(screen.getByTestId("lab-message").textContent).toBe(LAB_COPY.videoMade);
    expect(startButton.disabled).toBe(false);
  });

  it("shows why a recording could not start", async () => {
    const service = new FakeLabService();
    service.startResult = { ok: false, action: "record", reason: "other-tab", atMs: 1 };
    await mount({}, service);
    await act(async () => {
      fireEvent.click(screen.getByTestId("lab-record-start"));
    });
    expect(screen.getByTestId("lab-message").textContent).toBe(LAB_REASON_TEXT["other-tab"]);
    expect(screen.getByTestId("lab-status").getAttribute("data-recording")).toBe("0");
  });

  it("gives drivers the same actions as the buttons", async () => {
    const service = new FakeLabService();
    service.files.set("c-1", clipFile(Uint8Array.from([9])));
    service.files.set("r-1", clipFile(Uint8Array.from([8])));
    await mount({}, service);
    const handle = labWindow().__clipsLab!;
    expect(handle.status()).toMatchObject({ service: "ready", attached: true, running: false, targetFps: 60, button: "warming", tier: "W" });
    await act(async () => {
      await handle.clip();
    });
    expect(service.clipLast).toHaveBeenCalledWith(LAB_CLIP_SECONDS);
    await act(async () => {
      await handle.recordStart();
    });
    expect(handle.status().recording).toBe(true);
    await act(async () => {
      await handle.recordStop();
    });
    expect(handle.status().lastClip?.action).toBe("record");
    expect(handle.status().results).toBe(2);
  });

  it("makes one clip for two actions in the same frame (a double tap or a driver)", async () => {
    const service = new FakeLabService();
    service.files.set("c-1", clipFile(Uint8Array.from([5])));
    let release!: () => void;
    service.clipLast.mockImplementation(() => new Promise((resolve) => (release = () => resolve(service.clipResult))));
    await mount({}, service);
    const handle = labWindow().__clipsLab!;
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = handle.clip();
      second = handle.clip();
    });
    expect(await second).toBeNull();
    expect(handle.status().busy).toBe("clip");
    await act(async () => {
      release();
      await first;
    });
    expect(service.clipLast).toHaveBeenCalledOnce();
    expect(handle.status().busy).toBeNull();
    expect(handle.status().results).toBe(1);
  });

  it("cleans up on unmount: the hook, the blob URL, the channel, the canvas and the attachment", async () => {
    const service = new FakeLabService();
    service.files.set("c-1", clipFile(Uint8Array.from([7])));
    const { view, attached } = await mount({}, service);
    const bus = getGameAudio()!;
    const channels: GameAudioChannel[] = [];
    const make = bus.channel.bind(bus);
    vi.spyOn(bus, "channel").mockImplementation((appId: string) => {
      const channel = make(appId);
      channels.push(channel);
      return channel;
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("lab-start"));
      await audio.flush();
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("lab-clip"));
    });
    expect(channels).toHaveLength(1);
    expect(channels[0].disposed).toBe(false);
    expect(labWindow().__clipsLab).toBeDefined();
    view.unmount();
    expect(labWindow().__clipsLab).toBeUndefined();
    expect(revoked).toEqual(["blob:lab/1"]);
    expect(channels[0].disposed).toBe(true);
    expect(attached?.released).toEqual([screen.queryByTestId("lab-canvas") ?? attached?.registered[0].canvas]);
    expect(attached?.detach).toHaveBeenCalledOnce();
    expect(realm.pendingNative).toBe(0);
  });
});
