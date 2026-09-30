import { describe, expect, it, vi } from "vitest";

import { TILT_NOTES, toggleTilt } from "../lib/tiltToggle";

function input(over: Partial<Parameters<typeof toggleTilt>[0]> = {}) {
  return {
    useTilt: false,
    isSupported: true,
    requestPermission: vi.fn(async () => true),
    setUseTilt: vi.fn(),
    setNote: vi.fn(),
    ...over,
  };
}

describe("Monster Truck TILT button", () => {
  it("asks for motion permission first, and turns tilt on only when the phone says yes", async () => {
    const i = input();
    const done = toggleTilt(i);
    // The request runs in the tap (before any await), as iOS requires.
    expect(i.requestPermission).toHaveBeenCalledTimes(1);
    expect(i.setUseTilt).not.toHaveBeenCalled();
    await done;
    expect(i.setUseTilt).toHaveBeenCalledWith(true);
    expect(i.setNote).toHaveBeenLastCalledWith(null);
  });

  it("keeps the arrows and says why when the kid (or the phone) says no", async () => {
    const i = input({ requestPermission: vi.fn(async () => false) });
    await toggleTilt(i);
    expect(i.setUseTilt).not.toHaveBeenCalled();
    expect(i.setNote).toHaveBeenLastCalledWith(TILT_NOTES.denied);
  });

  it("never asks on a phone with no motion sensor", async () => {
    const i = input({ isSupported: false });
    await toggleTilt(i);
    expect(i.requestPermission).not.toHaveBeenCalled();
    expect(i.setNote).toHaveBeenLastCalledWith(TILT_NOTES.unsupported);
  });

  it("turns tilt off with no question", async () => {
    const i = input({ useTilt: true });
    await toggleTilt(i);
    expect(i.requestPermission).not.toHaveBeenCalled();
    expect(i.setUseTilt).toHaveBeenCalledWith(false);
  });
});
