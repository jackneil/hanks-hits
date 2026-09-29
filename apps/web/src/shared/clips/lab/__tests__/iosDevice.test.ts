// @vitest-environment node
/** The pure parts of the iPhone driver (scripts/clips/ios-device.mjs). */
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PORT,
  LAB_PATH,
  PULL_CHUNK,
  chunkRanges,
  disabledText,
  iosCapabilities,
  parseArgs,
  parseIdeviceIds,
  parseXctraceDevices,
  pickDevice,
  press,
  tapActions,
} from "../../../../../../../scripts/clips/ios-device.mjs";

const XCTRACE = `== Devices ==
Jack’s MacBook Pro (00006000-001234560A11801E)
Jack’s iPhone (27.0) (00008110-001A2B3C4D5E801E)
iPad (26.1) (00008103-000A11112222333E)

== Devices Offline ==
Old iPhone (18.7) (00008030-000000000000002E)

== Simulators ==
iPhone 17 Pro Simulator (26.0) (6F2C3A1E-1111-2222-3333-444455556666)
`;

describe("parseXctraceDevices", () => {
  it("lists the connected devices with a version, and leaves out the Mac, offline devices and simulators", () => {
    expect(parseXctraceDevices(XCTRACE)).toEqual([
      { name: "Jack’s iPhone", os: "27.0", udid: "00008110-001A2B3C4D5E801E" },
      { name: "iPad", os: "26.1", udid: "00008103-000A11112222333E" },
    ]);
  });

  it("gives nothing for empty or strange output", () => {
    expect(parseXctraceDevices("")).toEqual([]);
    expect(parseXctraceDevices("xcrun: error: unable to find utility")).toEqual([]);
  });
});

describe("parseIdeviceIds", () => {
  it("reads one UDID per line, both the old 40-digit form and the new dashed form", () => {
    const text = "00008110-001A2B3C4D5E801E\na1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n\nnot a udid\n";
    expect(parseIdeviceIds(text)).toEqual(["00008110-001A2B3C4D5E801E", "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"]);
    expect(parseIdeviceIds("")).toEqual([]);
  });
});

describe("pickDevice", () => {
  const devices = parseXctraceDevices(XCTRACE);

  it("takes the first iPhone or iPad", () => {
    expect(pickDevice(devices)?.name).toBe("Jack’s iPhone");
    expect(pickDevice([{ name: "Apple Watch", os: "12.0", udid: "00008301-0000000000000001" }, devices[1]])?.name).toBe("iPad");
  });

  it("takes the asked UDID, also one that no tool listed", () => {
    expect(pickDevice(devices, "00008103-000a11112222333e")?.name).toBe("iPad");
    expect(pickDevice([], "00008110-FFFF")).toEqual({ name: "the asked device", os: "?", udid: "00008110-FFFF" });
  });

  it("gives null with no device", () => {
    expect(pickDevice([])).toBeNull();
  });
});

describe("WebDriver bodies", () => {
  it("asks for Safari on the USB device", () => {
    expect(iosCapabilities("00008110-X")).toEqual({
      capabilities: { alwaysMatch: { platformName: "iOS", browserName: "Safari", "safari:deviceUDID": "00008110-X" } },
    });
  });

  it("taps with a touch pointer at whole viewport pixels", () => {
    const body = tapActions(100.6, 200.2);
    expect(body.actions[0].parameters).toEqual({ pointerType: "touch" });
    expect(body.actions[0].actions).toEqual([
      { type: "pointerMove", duration: 0, x: 101, y: 200, origin: "viewport" },
      { type: "pointerDown", button: 0 },
      { type: "pause", duration: 80 },
      { type: "pointerUp", button: 0 },
    ]);
  });
});

describe("chunkRanges", () => {
  it("covers every byte once, in order", () => {
    expect(chunkRanges(0)).toEqual([]);
    expect(chunkRanges(10, 4)).toEqual([
      [0, 4],
      [4, 4],
      [8, 2],
    ]);
    const ranges = chunkRanges(3 * PULL_CHUNK + 1);
    expect(ranges).toHaveLength(4);
    expect(ranges.reduce((sum, [, length]) => sum + length, 0)).toBe(3 * PULL_CHUNK + 1);
  });

  it("refuses sizes that are not whole numbers", () => {
    expect(() => chunkRanges(-1)).toThrow(RangeError);
    expect(() => chunkRanges(1.5)).toThrow(RangeError);
    expect(() => chunkRanges(10, 0)).toThrow(RangeError);
  });
});

describe("parseArgs", () => {
  it("reads the URL and the options", () => {
    expect(parseArgs(["https://t.example/clips-lab?gl=2", "--flow", "record", "--udid", "U1", "--port", "4555", "--out", "/tmp/x"])).toEqual({
      url: "https://t.example/clips-lab?gl=2",
      flow: "record",
      udid: "U1",
      port: 4555,
      out: "/tmp/x",
    });
    const plain = parseArgs(["https://t.example/clips-lab"]);
    expect(plain.flow).toBe("clip");
    expect(plain.port).toBe(DEFAULT_PORT);
  });

  it("takes a tunnel URL with a per-session token path before /clips-lab (plan 15.3)", () => {
    expect(parseArgs(["https://t.example/s/3f9c2a/clips-lab?gl=2"]).url).toBe("https://t.example/s/3f9c2a/clips-lab?gl=2");
    expect(parseArgs(["https://t.example/tok_123/clips-lab/"]).url).toBe("https://t.example/tok_123/clips-lab/");
    for (const good of ["/clips-lab", "/clips-lab/", "/a/clips-lab", "/a/b/clips-lab/"]) expect(LAB_PATH.test(good), good).toBe(true);
    for (const bad of ["/", "/clips-labs", "/myclips-lab", "/clips-lab/x", "/games/clips"]) expect(LAB_PATH.test(bad), bad).toBe(false);
  });

  it.each([
    [[], /give the lab URL/],
    [["https://t.example/"], /the lab page/],
    [["https://t.example/tok/clips-lab/more"], /the lab page/],
    [["https://t.example/not-clips-lab"], /the lab page/],
    [["not a url"], /not a URL/],
    [["https://t.example/clips-lab", "--flow", "video"], /clip or record/],
    [["https://t.example/clips-lab", "--port", "abc"], /port number/],
    [["https://t.example/clips-lab", "--udid"], /needs a value/],
    [["https://t.example/clips-lab", "--speed", "2"], /unknown option/],
    [["https://t.example/clips-lab", "https://u.example/clips-lab"], /one URL only/],
  ])("refuses %j", (argv, message) => {
    expect(() => parseArgs(argv as string[])).toThrow(message);
  });
});

type Point = { x: number; y: number; disabled: boolean } | null;

/** A WebDriver double: `button` is what the page gives for the button; `statuses` are the lab statuses in order (the last one repeats). */
function fakeDriver(button: Point, statuses: Array<Record<string, unknown>>) {
  let next = 0;
  return {
    execute: vi.fn(async (script: string) => {
      if (script.includes("querySelector")) return button;
      const status = statuses[Math.min(next, statuses.length - 1)];
      next++;
      return status;
    }),
    tap: vi.fn(async () => undefined),
    executeAsync: vi.fn<(script: string, args?: unknown[]) => Promise<unknown>>(async () => true),
  };
}

const BUSY = { service: "ready", button: "saving", busy: "clip", reason: null, recording: false, results: 0 };

describe("press", () => {
  it("never taps a button that is off: one FAIL row with the lab status, no retry and no fallback action", async () => {
    const driver = fakeDriver({ x: 10, y: 20, disabled: true }, [BUSY]);
    const rows: Array<Record<string, unknown>> = [];
    expect(await press(driver, rows, "lab-clip", () => true, "clip", 0)).toBe(false);
    expect(driver.tap).not.toHaveBeenCalled();
    expect(driver.executeAsync).not.toHaveBeenCalled();
    expect(rows).toEqual([{ status: "FAIL", check: "lab-clip tap", value: "the button is off", limit: "an enabled button", detail: "button saving, service ready, busy (clip), recording no" }]);
  });

  it("gives a FAIL row when the button is not on the page", async () => {
    const driver = fakeDriver(null, [null as unknown as Record<string, unknown>]);
    const rows: Array<Record<string, unknown>> = [];
    expect(await press(driver, rows, "lab-record-stop", () => true, "recordStop", 0)).toBe(false);
    expect(rows[0]).toMatchObject({ status: "FAIL", value: "the button is not on the page", detail: "no lab on the page" });
    expect(driver.executeAsync).not.toHaveBeenCalled();
  });

  it("taps an enabled button once when the page sees the tap", async () => {
    const driver = fakeDriver({ x: 10.4, y: 20.6, disabled: false }, [{ ...BUSY, busy: null, results: 1 }]);
    const rows: Array<Record<string, unknown>> = [];
    expect(await press(driver, rows, "lab-clip", (s: { results: number }) => s.results > 0, "clip", 0)).toBe(true);
    expect(driver.tap).toHaveBeenCalledOnce();
    expect(driver.tap).toHaveBeenCalledWith(10.4, 20.6);
    expect(rows).toEqual([]);
  });

  it("taps twice, then uses the lab's own action and says so, when the taps do not reach the page", async () => {
    const driver = fakeDriver({ x: 1, y: 2, disabled: false }, [{ ...BUSY, busy: null, results: 0 }]);
    const rows: Array<Record<string, unknown>> = [];
    expect(await press(driver, rows, "lab-clip", (s: { results: number }) => s.results > 0, "clip", 0)).toBe(true);
    expect(driver.tap).toHaveBeenCalledTimes(2);
    expect(driver.executeAsync).toHaveBeenCalledOnce();
    expect(String(driver.executeAsync.mock.calls[0][0])).toContain("window.__clipsLab.clip()");
    expect(rows).toEqual([{ status: "INFO", check: "lab-clip tap", value: "the tap did not reach the page", limit: "-", detail: "used window.__clipsLab.clip()" }]);
    // Start has no fallback: the sound starts only inside a real tap.
    const start = fakeDriver({ x: 1, y: 2, disabled: false }, [{ running: false }]);
    expect(await press(start, [], "lab-start", (s: { running: boolean }) => s.running, null, 0)).toBe(false);
    expect(start.executeAsync).not.toHaveBeenCalled();
  });

  it("counts a late first tap that turned its own button off as reached, not as a failure", async () => {
    let call = 0;
    const driver = {
      execute: vi.fn(async (script: string) => {
        if (script.includes("querySelector")) return { x: 1, y: 2, disabled: call++ > 0 };
        // The first poll (after tap 1) does not see it yet; the next status does.
        return driver.execute.mock.calls.filter(([s]) => !String(s).includes("querySelector")).length > 1 ? { ...BUSY, results: 1 } : { ...BUSY, busy: null, results: 0 };
      }),
      tap: vi.fn(async () => undefined),
      executeAsync: vi.fn(async () => true),
    };
    const rows: Array<Record<string, unknown>> = [];
    expect(await press(driver, rows, "lab-clip", (s: { results: number }) => s.results > 0, "clip", 0)).toBe(true);
    expect(driver.tap).toHaveBeenCalledOnce();
    expect(driver.executeAsync).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it("names the state of an off button", () => {
    expect(disabledText(null)).toBe("no lab on the page");
    expect(disabledText({ button: "warming", service: "ready", busy: null, reason: "warming", recording: true })).toBe("button warming, service ready, reason warming, recording yes");
  });
});
