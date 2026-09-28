// @vitest-environment node
/** The pure parts of the iPhone driver (scripts/clips/ios-device.mjs). */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PORT,
  PULL_CHUNK,
  chunkRanges,
  iosCapabilities,
  parseArgs,
  parseIdeviceIds,
  parseXctraceDevices,
  pickDevice,
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

  it.each([
    [[], /give the lab URL/],
    [["https://t.example/"], /the lab page/],
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
