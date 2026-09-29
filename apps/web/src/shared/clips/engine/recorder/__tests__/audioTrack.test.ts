// @vitest-environment node
/**
 * The game sound for tiers M and V (plan 6.3): a MediaStream destination on
 * the bus's tap point (before the sound switch), a new track when the bus
 * appears or is replaced, and suspend/resume. It never makes an
 * AudioContext.
 */
import { describe, expect, it, vi } from "vitest";
import { FakeMediaStream, FakeTrack } from "../../../../../__tests__/mediarecorder-mock";
import { RecorderAudio, type RecorderAudioBus } from "../audioTrack";

function fakeContext(name: string) {
  const tracks: FakeTrack[] = [];
  return {
    name,
    tracks,
    createMediaStreamDestination: vi.fn(() => {
      const track = new FakeTrack("audio");
      tracks.push(track);
      return { stream: new FakeMediaStream([track]) };
    }),
  };
}

function fakeBus() {
  let listener: ((bus: { context: BaseAudioContext }) => void) | null = null;
  let current: { context: unknown; tap: { context: unknown; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> } } | null = null;
  const bus: RecorderAudioBus = {
    getTapPoint: () => (current?.tap as unknown as AudioNode) ?? null,
    onCreated: (l) => {
      listener = l;
      if (current) l({ context: current.context as BaseAudioContext });
      return () => {
        listener = null;
      };
    },
  };
  return {
    bus,
    make(context: ReturnType<typeof fakeContext>) {
      current = { context, tap: { context, connect: vi.fn(), disconnect: vi.fn() } };
      listener?.({ context: context as unknown as BaseAudioContext });
      return current.tap;
    },
    get listening() {
      return listener !== null;
    },
  };
}

describe("RecorderAudio", () => {
  it("waits for the bus, then gives a track from a destination on the tap point", () => {
    const b = fakeBus();
    const audio = new RecorderAudio({ bus: b.bus, log: () => undefined });
    const changes: Array<unknown> = [];
    audio.attach((track) => changes.push(track));
    expect(audio.track).toBeNull();
    expect(changes).toEqual([]);
    const ctx = fakeContext("first");
    const tap = b.make(ctx);
    expect(ctx.createMediaStreamDestination).toHaveBeenCalledTimes(1);
    expect(tap.connect).toHaveBeenCalledTimes(1);
    expect(audio.track).toBe(ctx.tracks[0]);
    expect(changes).toEqual([ctx.tracks[0]]);
  });

  it("a new bus context gives a new track, and the old one ends", () => {
    const b = fakeBus();
    const audio = new RecorderAudio({ bus: b.bus, log: () => undefined });
    const changes: unknown[] = [];
    audio.attach((track) => changes.push(track));
    const first = fakeContext("first");
    const oldTap = b.make(first);
    const second = fakeContext("second");
    b.make(second);
    expect(oldTap.disconnect).toHaveBeenCalledTimes(1);
    expect(first.tracks[0].readyState).toBe("ended");
    expect(audio.track).toBe(second.tracks[0]);
    expect(changes).toEqual([first.tracks[0], second.tracks[0]]);
  });

  it("suspend takes the tap out of the graph and resume puts it back; the track stays", () => {
    const b = fakeBus();
    const audio = new RecorderAudio({ bus: b.bus, log: () => undefined });
    audio.attach(() => undefined);
    const ctx = fakeContext("one");
    const tap = b.make(ctx);
    audio.suspend();
    audio.suspend();
    expect(tap.disconnect).toHaveBeenCalledTimes(1);
    expect(audio.track).toBe(ctx.tracks[0]);
    audio.resume();
    expect(tap.connect).toHaveBeenCalledTimes(2);
  });

  it("detach ends the track and stops listening; a context with no MediaStream destination gives no track", () => {
    const b = fakeBus();
    const audio = new RecorderAudio({ bus: b.bus, log: () => undefined });
    audio.attach(() => undefined);
    const ctx = fakeContext("one");
    b.make(ctx);
    audio.detach();
    expect(ctx.tracks[0].readyState).toBe("ended");
    expect(audio.track).toBeNull();
    expect(b.listening).toBe(false);
    const plain = { name: "offline" };
    const again = new RecorderAudio({ bus: b.bus, log: () => undefined });
    again.attach(() => undefined);
    b.make(plain as never);
    expect(again.track).toBeNull();
  });
});
