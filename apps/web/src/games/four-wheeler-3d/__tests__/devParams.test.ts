import { describe, it, expect, afterEach } from "vitest";

import {
  attachDevHandle,
  devHandleEnabled,
  readDevParams,
  type DevHandle,
} from "../lib/devParams";

const handle: DevHandle = {
  pos: () => [1, 2, 3],
  speed: () => 4,
  mph: () => 8.948,
  airtime: () => 0.5,
  upDot: () => 1,
  heading: () => 0,
  steering: () => 0,
  wheels: () => 4,
  engine: () => 720,
  helmetCam: () => false,
  flip: () => {},
  teleport: () => {},
};

type HandleWindow = Window & { __fw3d?: DevHandle };

afterEach(() => {
  delete (window as HandleWindow).__fw3d;
});

describe("the address bar helpers", () => {
  it("reads the hour and the drop spot", () => {
    const params = readDevParams("?tod=14&pos=100,-50");
    expect(params.timeOfDay).toBe(14);
    expect(params.position).toEqual({ x: 100, z: -50 });
  });

  it("ignores anything that is not a number", () => {
    const params = readDevParams("?tod=soon&pos=over,there");
    expect(params.timeOfDay).toBeNull();
    expect(params.position).toBeNull();
  });
});

describe("the browser test handle", () => {
  it("is on outside a production build", () => {
    expect(devHandleEnabled()).toBe(true);
  });

  it("hangs itself on the window and takes itself back off", () => {
    const detach = attachDevHandle(handle);
    const attached = (window as HandleWindow).__fw3d;
    expect(attached).toBeDefined();
    expect(attached?.pos()).toEqual([1, 2, 3]);
    expect(attached?.wheels()).toBe(4);
    expect(attached?.engine()).toBe(720);
    expect(attached?.upDot()).toBe(1);
    detach();
    expect((window as HandleWindow).__fw3d).toBeUndefined();
  });
});
