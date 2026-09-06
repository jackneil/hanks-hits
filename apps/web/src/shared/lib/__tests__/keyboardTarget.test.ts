import { describe, it, expect, afterEach } from "vitest";
import { keyBelongsToTarget } from "../keyboardTarget";

function keyOn(el: Element, key = " "): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true });
  Object.defineProperty(event, "target", { value: el, configurable: true });
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("keyBelongsToTarget", () => {
  it.each(["input", "textarea", "select"])(
    "gives a focused <%s> every key, letters included",
    (tag) => {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      expect(keyBelongsToTarget(keyOn(el, " "))).toBe(true);
      expect(keyBelongsToTarget(keyOn(el, "b"))).toBe(true);
      expect(keyBelongsToTarget(keyOn(el, "Backspace"))).toBe(true);
    }
  );

  it("gives a contenteditable element every key", () => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    document.body.appendChild(el);
    expect(keyBelongsToTarget(keyOn(el, "b"))).toBe(true);
  });

  it.each(["button", "a", "summary"])(
    "gives a focused <%s> only Space and Enter",
    (tag) => {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      expect(keyBelongsToTarget(keyOn(el, " "))).toBe(true);
      expect(keyBelongsToTarget(keyOn(el, "Enter"))).toBe(true);
      // A kid who tapped an on-screen letter keeps typing on the keyboard.
      expect(keyBelongsToTarget(keyOn(el, "b"))).toBe(false);
      expect(keyBelongsToTarget(keyOn(el, "Backspace"))).toBe(false);
      expect(keyBelongsToTarget(keyOn(el, "ArrowLeft"))).toBe(false);
    }
  );

  it("treats an element inside a button like the button", () => {
    document.body.innerHTML = `<button><span id="label">Play</span></button>`;
    const label = document.getElementById("label")!;
    expect(keyBelongsToTarget(keyOn(label, "Enter"))).toBe(true);
    expect(keyBelongsToTarget(keyOn(label, "b"))).toBe(false);
  });

  it("does not claim keys just because the target sits inside a dialog", () => {
    document.body.innerHTML = `<div role="dialog"><span id="inner">hi</span></div>`;
    expect(keyBelongsToTarget(keyOn(document.getElementById("inner")!, " "))).toBe(false);
  });

  it("is false for the body and for a plain canvas", () => {
    expect(keyBelongsToTarget(keyOn(document.body))).toBe(false);
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    expect(keyBelongsToTarget(keyOn(canvas))).toBe(false);
  });

  it("is false when the event has no element target", () => {
    const event = new KeyboardEvent("keydown", { key: " " });
    expect(keyBelongsToTarget(event)).toBe(false);
  });
});
