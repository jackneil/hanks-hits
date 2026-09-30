import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { MobileControls } from "../components/MobileControls";
import {
  CONTEXT_SLOT,
  SHORT_MAX_HEIGHT,
  TOUCH_LAYOUT,
  boxStyle,
  contextRect,
  overlaps,
  rectOf,
  type ControlName,
} from "../lib/hudLayout";

/** The phone the mobile-playability gate uses. */
const PHONE = { width: 390, height: 844 };

/** The smallest screen a kid is likely to hold. */
const SMALL_PHONE = { width: 320, height: 568 };

/**
 * The real iPhone screens the phone gate measures, with Safari's bars
 * showing (phone UX audit 2026-09-29).
 */
const REAL_PHONES = [
  { name: "iPhone SE upright", width: 375, height: 549 },
  { name: "iPhone 15 upright", width: 390, height: 664 },
  { name: "iPhone SE sideways", width: 667, height: 311 },
  { name: "iPhone 15 sideways", width: 844, height: 340 },
];

const NAMES = Object.keys(TOUCH_LAYOUT) as ControlName[];

/** The calibrate chip only shows while tilt is on, and tilt hides the arrows. */
function neverTogether(a: ControlName, b: ControlName) {
  const pair = [a, b];
  return (
    pair.includes("calibrate") &&
    (pair.includes("steerLeft") || pair.includes("steerRight"))
  );
}

/**
 * Sideways the stylesheet moves the speedo to the middle of the top, so its
 * box in the layout only describes an upright phone.
 */
function placedByLayout(name: ControlName, height: number) {
  return !(name === "speedo" && height <= SHORT_MAX_HEIGHT);
}

function clash(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
) {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

/** Enough of the controls hook to render the buttons. */
function fakeControls() {
  const noop = () => {};
  const handlers = {
    onPointerDown: noop,
    onPointerUp: noop,
    onPointerCancel: noop,
    onPointerLeave: noop,
    onContextMenu: noop,
  };
  return {
    getControlValues: () => ({
      throttle: 0,
      steer: 0,
      brake: 0,
      handbrake: false,
      jump: false,
      horn: false,
      reset: false,
      camera: false,
      interact: false,
      nos: false,
    }),
    takeOneShot: () => false,
    isMobile: true,
    touch: {
      state: {
        gas: false,
        brake: false,
        left: false,
        right: false,
        jump: false,
        horn: false,
        jumpPending: false,
        hornPending: false,
        steerAxis: 0,
      },
      stateRef: {
        current: {
          gas: false,
          brake: false,
          left: false,
          right: false,
          jump: false,
          horn: false,
          jumpPending: false,
          hornPending: false,
          steerAxis: 0,
        },
      },
      handlers: {
        gas: handlers,
        brake: handlers,
        left: handlers,
        right: handlers,
        jump: handlers,
        horn: handlers,
      },
      setSteerAxis: noop,
    },
    tilt: {
      isSupported: true,
      isPermissionGranted: true,
      requestPermission: async () => true,
      calibrate: noop,
      steerRef: { current: 0 },
    },
    useTilt: false,
    setUseTilt: noop,
  };
}

describe("the touch controls never cover each other", () => {
  it("keeps every pair of controls apart on a phone", () => {
    const clashes: string[] = [];
    for (let i = 0; i < NAMES.length; i += 1) {
      for (let j = i + 1; j < NAMES.length; j += 1) {
        // The calibrate chip only shows while tilt is on, and tilt hides the
        // arrows, so those two pairs can never be on screen together.
        const pair = [NAMES[i], NAMES[j]];
        const tiltOnly =
          pair.includes("calibrate") &&
          (pair.includes("steerLeft") || pair.includes("steerRight"));
        if (tiltOnly) continue;
        if (overlaps(NAMES[i], NAMES[j], PHONE.width, PHONE.height)) {
          clashes.push(`${NAMES[i]} covers ${NAMES[j]}`);
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it("keeps every pair apart on the real iPhone screens, both ways up", () => {
    const clashes: string[] = [];
    for (const phone of REAL_PHONES) {
      const names = NAMES.filter((n) => placedByLayout(n, phone.height));
      for (let i = 0; i < names.length; i += 1) {
        for (let j = i + 1; j < names.length; j += 1) {
          if (neverTogether(names[i], names[j])) continue;
          if (overlaps(names[i], names[j], phone.width, phone.height)) {
            clashes.push(`${phone.name}: ${names[i]} covers ${names[j]}`);
          }
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it("keeps them apart on a small phone too", () => {
    // The TILT chip used to sit under the BRAKE pedal. This is that check.
    expect(
      overlaps("tilt", "brake", SMALL_PHONE.width, SMALL_PHONE.height),
    ).toBe(false);
    expect(overlaps("tilt", "gas", SMALL_PHONE.width, SMALL_PHONE.height)).toBe(
      false,
    );
    expect(
      overlaps("speedo", "horn", SMALL_PHONE.width, SMALL_PHONE.height),
    ).toBe(false);
    expect(
      overlaps("speedo", "jump", SMALL_PHONE.width, SMALL_PHONE.height),
    ).toBe(false);
  });

  it("keeps every control on the screen", () => {
    for (const name of NAMES) {
      const rect = rectOf(name, PHONE.width, PHONE.height);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(PHONE.width);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.bottom).toBeLessThanOrEqual(PHONE.height);
    }
  });

  it("gives every control a thumb-sized target", () => {
    for (const name of NAMES) {
      if (name === "speedo") continue; // A dial, not a button.
      expect(TOUCH_LAYOUT[name].width).toBeGreaterThanOrEqual(44);
      expect(TOUCH_LAYOUT[name].height).toBeGreaterThanOrEqual(44);
    }
    // The pedals are the biggest targets of all.
    expect(TOUCH_LAYOUT.gas.height).toBeGreaterThanOrEqual(56);
    expect(TOUCH_LAYOUT.brake.height).toBeGreaterThanOrEqual(56);
  });
});

describe("the controls render where the layout says", () => {
  it("puts every button on screen with the layout's own box", () => {
    render(
      <MobileControls
        controls={
          fakeControls() as unknown as Parameters<
            typeof MobileControls
          >[0]["controls"]
        }
      />,
    );

    const cases: [string, ControlName][] = [
      ["Gas", "gas"],
      ["Brake", "brake"],
      ["Jump", "jump"],
      ["Honk the horn", "horn"],
      ["Steer left", "steerLeft"],
      ["Steer right", "steerRight"],
    ];

    for (const [label, name] of cases) {
      const button = screen.getByLabelText(label);
      const box = boxStyle(name);
      expect(button.style.width).toBe(box.width);
      expect(button.style.height).toBe(box.height);
      expect(button.style.bottom).toBe(box.bottom);
      expect(button.style.touchAction).toBe("none");
    }
  });

  it("shows the tilt chip where the layout puts it, clear of the pedals", () => {
    render(
      <MobileControls
        controls={
          fakeControls() as unknown as Parameters<
            typeof MobileControls
          >[0]["controls"]
        }
      />,
    );
    const tilt = screen.getByText("📱 TILT");
    expect(tilt.style.bottom).toBe(boxStyle("tilt").bottom);
    expect(tilt.style.left).toBe(`${TOUCH_LAYOUT.tilt.offset}px`);
  });
});

describe("the context slot never covers a touch control", () => {
  it("stays clear with up to three rows of context buttons", () => {
    const clashes: string[] = [];
    for (const phone of REAL_PHONES) {
      for (let rows = 1; rows <= 3; rows += 1) {
        const slot = contextRect(rows, phone.width, phone.height);
        for (const name of NAMES) {
          if (!placedByLayout(name, phone.height)) continue;
          if (clash(slot, rectOf(name, phone.width, phone.height))) {
            clashes.push(`${phone.name}, ${rows} rows: covers ${name}`);
          }
        }
      }
    }
    expect(clashes).toEqual([]);
  });

  it("stays on the screen and leaves room for a real button", () => {
    for (const phone of REAL_PHONES) {
      const slot = contextRect(3, phone.width, phone.height);
      expect(slot.left).toBeGreaterThanOrEqual(0);
      expect(slot.right).toBeLessThanOrEqual(phone.width);
      expect(slot.top).toBeGreaterThanOrEqual(0);
      // Room for "Hop off" and "Use nearby thing" side by side.
      expect(slot.right - slot.left).toBeGreaterThanOrEqual(200);
    }
    expect(CONTEXT_SLOT.upright.width).toBeGreaterThanOrEqual(200);
  });
});

describe("NOS sits with the pedals on a phone", () => {
  const controls = () =>
    fakeControls() as unknown as Parameters<
      typeof MobileControls
    >[0]["controls"];

  it("shows NOS in its layout box on a ride with a boost", () => {
    render(<MobileControls controls={controls()} nos />);
    const nos = screen.getByRole("button", { name: "NOS boost" });
    expect(nos.style.bottom).toBe(boxStyle("nos").bottom);
    expect(nos.style.right).toBe(`${TOUCH_LAYOUT.nos.offset}px`);
  });

  it("has no NOS on foot", () => {
    render(<MobileControls controls={controls()} walking />);
    expect(screen.queryByRole("button", { name: "NOS boost" })).toBeNull();
  });
});
