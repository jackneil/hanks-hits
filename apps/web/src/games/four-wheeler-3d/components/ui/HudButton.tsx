"use client";

import type { ButtonHTMLAttributes } from "react";

import { usePointerTap, useSecondFingerClick } from "@/shared/lib/input";

type PressProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "type"> & {
  onPress: () => void;
};

/**
 * A HUD button that works for a tap by either thumb.
 *
 * A browser makes no click for a second finger, so while one thumb holds
 * GAS an onClick button did nothing (phone check, 2026-09-30). Use it for
 * a button that opens or changes something: a panel, Hop off, the camera.
 */
export function HudButton({ onPress, ...rest }: PressProps) {
  const tap = useSecondFingerClick<HTMLButtonElement>(onPress);
  return <button type="button" {...rest} {...tap} />;
}

/**
 * A game action that happens on the press, for every finger: NOS, Climb,
 * Descend, Parachute, Spray. The browser's click after the tap is ignored,
 * so one tap is one action.
 */
export function ActionButton({ onPress, ...rest }: PressProps) {
  const tap = usePointerTap<HTMLButtonElement>(() => onPress());
  return <button type="button" {...rest} {...tap} />;
}
