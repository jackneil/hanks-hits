"use client";
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useAdventureSession, type TravelMode } from "../lib/adventureSession";
import { useFourWheeler3dStore } from "../lib/store";
import { DESTINATIONS } from "../lib/destinations";
import {
  propertyDoor,
  propertySlot,
  propertySize,
  PROPERTY_RANGE,
  canBoardPropertyVehicle,
} from "../lib/property";
import { canBoardFleetVehicle } from "../lib/economy";
import { LAND_PLOTS } from "../lib/landmarks";
import type {
  AdventureProgress,
  AdventurePosition,
} from "../lib/adventureTypes";
import type { RailSession } from "../lib/rail";
import { RAIL_BOARD_RANGE } from "../lib/rail";
import { heightAt } from "../lib/terrain";

type Marker = {
  id: string;
  label: string;
  icon: string;
  point: AdventurePosition;
  distance: number;
  ready: boolean;
  action: string;
  payload?: string;
  panel?: string;
};
/** Approach and ready ranges are separate; every button carries its own target. */
export function resolveInteractionMarker(
  a: AdventureProgress,
  mode: TravelMode,
  player: AdventurePosition,
  rail: RailSession | null,
): Marker | null {
  if (!["foot", "vehicle", "boat", "deck"].includes(mode)) return null;
  const candidates: Marker[] = [];
  const add = (
    id: string,
    label: string,
    icon: string,
    point: { x: number; y?: number; z: number },
    range: number,
    action: string,
    payload?: string,
    panel?: string,
  ) => {
    const distance = Math.hypot(
      point.x - player.x,
      point.z - player.z,
      point.y === undefined ? 0 : point.y - player.y,
    );
    if (distance <= range + 2)
      candidates.push({
        id,
        label,
        icon,
        point: { ...point, y: point.y ?? heightAt(point.x, point.z) },
        distance,
        ready: distance <= range,
        action,
        payload,
        panel,
      });
  };
  if (mode === "foot") {
    for (const v of Object.values(a.fleet)) {
      const camper = v.type === "camper" || v.type === "rv";
      if (
        (camper
          ? Object.values(a.fleet).some((parent) => parent.cargo.includes(v.id))
          : !canBoardFleetVehicle(a, v.id)) ||
        !canBoardPropertyVehicle(a, v.id)
      )
        continue;
      if (v.type === "camper" || v.type === "rv")
        add(
          v.id,
          `Enter ${v.type === "rv" ? "RV" : "camper"}`,
          "⌂",
          v.position,
          8.4,
          "home:camper",
          v.id,
        );
      else
        add(v.id, `Ride ${v.type}`, "↗", v.position, 8.4, "world:board", v.id);
    }
    if (a.trainOwned && rail)
      add(
        "live-train",
        "Climb aboard train",
        "▥",
        rail.position,
        RAIL_BOARD_RANGE,
        "rail:board",
      );
  }
  if (mode === "foot" || mode === "vehicle")
    for (const plot of LAND_PLOTS) {
      const saved = a.plots[plot.id];
      if (!saved) continue;
      if (!saved.owned) {
        if (mode === "foot")
          add(
            `property:manage:${plot.id}`,
            "Buy this land",
            "⌂",
            plot,
            PROPERTY_RANGE,
            "property:manage",
            plot.id,
          );
        continue;
      }
      for (const slot of [0, 1] as const) {
        if (slot === 1 && !saved.buildings.some((b) => b.slot === 0)) continue;
        const building = saved.buildings.find((b) => b.slot === slot),
          point =
            propertyDoor(a, plot.id, slot) ?? propertySlot(a, plot.id, slot)!;
        if (!building) {
          if (mode === "foot")
            add(
              `property:manage:${plot.id}:${slot}`,
              `Build in spot ${slot + 1}`,
              "⌂",
              point,
              PROPERTY_RANGE,
              "property:manage",
              `${plot.id}:${slot}`,
            );
          continue;
        }
        if (mode === "vehicle" && building.type !== "garage") continue;
        const command =
          mode === "vehicle"
            ? "park"
            : building.type === "garage"
              ? "manage"
              : "enter";
        add(
          `property:${command}:${plot.id}:${slot}`,
          command === "park"
            ? "Park in your garage"
            : building.type === "garage"
              ? "Your garage"
              : "Enter your house",
          "⌂",
          point,
          building.type === "garage" ? PROPERTY_RANGE : 5,
          `property:${command}`,
          `${plot.id}:${slot}`,
        );
      }
      if (mode === "foot")
        add(
          `property:expand:${plot.id}`,
          "Expand your land",
          "⌂",
          { x: plot.x - propertySize(a, plot.id) * 0.55, z: plot.z },
          PROPERTY_RANGE,
          "property:manage",
          plot.id,
        );
    }
  for (const d of DESTINATIONS) {
    if (d.kind === "land") continue; // Property markers above follow actual upgraded slots and signs.
    const action =
      d.kind === "stand"
        ? "hunt:climb"
        : d.kind === "dog"
          ? "dog:feed"
          : d.kind === "wash"
            ? "activity:wash"
            : "panel";
    add(
      d.id,
      d.label,
      d.icon,
      d,
      d.radius,
      action,
      d.id,
      action === "panel" ? (d.kind === "launch" ? "space" : d.kind) : undefined,
    );
  }
  return candidates.sort((a, b) => a.distance - b.distance)[0] ?? null;
}
export function InteractionMarker() {
  const session = useAdventureSession(),
    a = useFourWheeler3dStore((s) => s.progress.adventure),
    mode = useFourWheeler3dStore((s) => s.mode);
  const ring = useRef<THREE.Mesh>(null),
    reduced = useRef(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)"),
      sync = () => {
        reduced.current = query.matches;
      };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useFrame(({ clock }) => {
    ring.current?.scale.setScalar(
      reduced.current ? 1 : 1 + Math.sin(clock.elapsedTime * 2.3) * 0.05,
    );
  });
  const marker = resolveInteractionMarker(
    a,
    mode,
    session.playerSnapshot,
    session.rail,
  );
  if (!marker || session.panel) return null;
  const color = marker.ready ? "#e8c879" : "#b6d798";
  const activate = () => {
    const store = useFourWheeler3dStore.getState(),
      s = useAdventureSession.getState();
    if (store.isPaused || !store.hasStarted) return;
    const live = resolveInteractionMarker(
      store.progress.adventure,
      store.mode,
      s.playerSnapshot,
      s.rail,
    );
    if (!live || live.id !== marker.id || !live.ready) {
      store.setHint("Move closer to use this.");
      return;
    }
    if (Math.abs(s.playerSnapshot.speed) > 3) {
      store.setHint("Stop here to use this.");
      return;
    }
    if (live.panel)
      s.openPanel(
        live.panel as Parameters<typeof s.openPanel>[0],
        live.payload,
      );
    else s.requestAction(live.action, live.payload);
  };
  return (
    <group position={[marker.point.x, marker.point.y + 0.06, marker.point.z]}>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.5, 1.63, 48]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.8}
          depthWrite={false}
        />
      </mesh>
      <Html center position={[0, 2.8, 0]} zIndexRange={[35, 30]}>
        <button
          className="fw-world-bubble"
          onClick={activate}
          aria-label={`${marker.label}${marker.ready ? "" : ". Move closer"}`}
        >
          <span>{marker.icon}</span>
          {marker.label}
          {marker.ready ? <kbd>Use</kbd> : <small>Move closer</small>}
        </button>
      </Html>
    </group>
  );
}
