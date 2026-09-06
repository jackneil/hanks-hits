import { describe, it, expect, afterEach } from "vitest";
import { isInteractiveTarget } from "../keyboardTarget";

function keyOn(el: Element): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: " ", bubbles: true });
  Object.defineProperty(event, "target", { value: el, configurable: true });
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("isInteractiveTarget", () => {
  it.each(["button", "a", "input", "textarea", "select"])(
    "is true for a focused <%s>",
    (tag) => {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      expect(isInteractiveTarget(keyOn(el))).toBe(true);
    }
  );

  it("is true for a contenteditable element", () => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    document.body.appendChild(el);
    expect(isInteractiveTarget(keyOn(el))).toBe(true);
  });

  it("is true for anything inside a dialog", () => {
    document.body.innerHTML = `<div role="dialog"><span id="inner">hi</span></div>`;
    const el = document.getElementById("inner")!;
    expect(isInteractiveTarget(keyOn(el))).toBe(true);
  });

  it("is true for an element inside a button", () => {
    document.body.innerHTML = `<button><span id="label">Play</span></button>`;
    expect(isInteractiveTarget(keyOn(document.getElementById("label")!))).toBe(true);
  });

  it("is false for the body and for a plain canvas", () => {
    expect(isInteractiveTarget(keyOn(document.body))).toBe(false);
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    expect(isInteractiveTarget(keyOn(canvas))).toBe(false);
  });

  it("is false when the event has no element target", () => {
    const event = new KeyboardEvent("keydown", { key: " " });
    expect(isInteractiveTarget(event)).toBe(false);
  });
});
