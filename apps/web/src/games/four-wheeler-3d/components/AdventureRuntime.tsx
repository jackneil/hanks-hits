"use client";
import { nearestInteraction } from "../lib/interactions";
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGameContext } from "../lib/gameContext";
import { useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import {
  canBoardFleetVehicle,
  advanceDelivery,
  advanceHelper,
} from "../lib/economy";
import { isAirVehicle, isWaterVehicle } from "../lib/catalog";
import {
  DESTINATIONS,
  distanceTo,
  nearbyDestination,
} from "../lib/destinations";
import { heightAt } from "../lib/terrain";
import type { GameControls } from "../hooks/useControls";
import {
  riderResume,
  positionXYZ,
  deliveryOrigin,
  groundDeliveredFleet,
  canSwitchRide,
  nearbyCamper,
  pendingFootRelocation,
} from "../lib/rideTransitions";
import {
  canBoardPropertyVehicle,
  canManageProperty,
  nearbyPropertyInteraction,
} from "../lib/property";

import { flushFarmPoses } from "../lib/farmRuntime";
import { RAIL_BOARD_RANGE } from "../lib/rail";

export function saveRiderPosition() {
  flushFarmPoses();
  const store = useFourWheeler3dStore.getState(),
    s = useAdventureSession.getState();
  const active = store.progress.adventure.activeVehicleId;
  const rider = riderResume(store.progress.adventure, store.mode, s);
  const driving =
    rider.mode !== "foot" && active && store.progress.adventure.fleet[active];
  store.updateProgress((p) => ({
    ...p,
    adventure: {
      ...p.adventure,
      rider,
      ...(driving && active
        ? {
            fleet: {
              ...p.adventure.fleet,
              [active]: {
                ...p.adventure.fleet[active],
                position: rider.position,
                heading: rider.heading,
                parked: false,
              },
            },
          }
        : {}),
      ...(store.mode === "mount" && s.mountId?.startsWith("horse-")
        ? {
            horses: p.adventure.horses.map((h) =>
              h.id === s.mountId
                ? { ...h, position: rider.position, heading: rider.heading }
                : h,
            ),
          }
        : {}),
    },
  }));
}

export function parkActive() {
  saveRiderPosition();
  const store = useFourWheeler3dStore.getState(),
    id = store.progress.adventure.activeVehicleId;
  if (id && store.progress.adventure.fleet[id])
    store.updateProgress((p) => ({
      ...p,
      adventure: {
        ...p.adventure,
        fleet: {
          ...p.adventure.fleet,
          [id]: { ...p.adventure.fleet[id], parked: true },
        },
      },
    }));
}
export function exitVehicle() {
  const store = useFourWheeler3dStore.getState(),
    s = useAdventureSession.getState();
  if (Math.abs(s.playerSnapshot.speed) > 3) {
    store.setHint("Slow down before getting off.");
    return;
  }
  parkActive();
  const heading = s.playerSnapshot.heading,
    x = s.playerSnapshot.x + Math.cos(heading) * 2.3,
    z = s.playerSnapshot.z - Math.sin(heading) * 2.3;
  store.updateProgress((p) => ({
    ...p,
    adventure: {
      ...p.adventure,
      rider: {
        mode: "foot",
        position: { x, y: Math.max(0.1, heightAt(x, z)), z },
        heading,
      },
    },
  }));
  store.setMode("foot");
  store.clearNos();
  s.relocate({ x, y: Math.max(0.1, heightAt(x, z)), z }, heading);
  s.openPanel(null);
  store.setHint("On foot. Walk to a ride and press E to hop on.");
}
export function boardVehicle(id: string) {
  const store = useFourWheeler3dStore.getState(),
    s = useAdventureSession.getState(),
    v = store.progress.adventure.fleet[id];
  if (
    !v ||
    !canBoardFleetVehicle(store.progress.adventure, id) ||
    !canBoardPropertyVehicle(store.progress.adventure, id) ||
    distanceTo(s.playerSnapshot, v.position) > 8.4
  )
    return;
  store.updateProgress((p) => ({
    ...p,
    currentVehicle: v.type,
    paint: v.paint,
    adventure: {
      ...p.adventure,
      rider: {
        mode: isWaterVehicle(v.type)
          ? "boat"
          : isAirVehicle(v.type)
            ? "aircraft"
            : "vehicle",
        position: positionXYZ(v.position),
        heading: v.heading,
      },
      activeVehicleId: id,
      plots: Object.fromEntries(
        Object.entries(p.adventure.plots).map(([key, plot]) => [
          key,
          {
            ...plot,
            buildings: plot.buildings.map((b) => ({
              ...b,
              parkedVehicleIds: b.parkedVehicleIds.filter((v) => v !== id),
            })),
          },
        ]),
      ),
      fleet: { ...p.adventure.fleet, [id]: { ...v, parked: false } },
    },
  }));
  s.relocate(
    {
      ...v.position,
      y: isWaterVehicle(v.type)
        ? 0
        : Math.max(v.position.y, heightAt(v.position.x, v.position.z) + 1),
    },
    v.heading,
  );
  store.setMode(
    isWaterVehicle(v.type)
      ? "boat"
      : isAirVehicle(v.type)
        ? "aircraft"
        : "vehicle",
  );
  s.openPanel(null);
  store.setHint(`You’re riding the ${v.type}.`);
}
export function interact() {
  const store = useFourWheeler3dStore.getState(),
    s = useAdventureSession.getState(),
    i = s.interaction;
  if (store.mode === "interior") {
    s.requestAction(i?.kind === "interior" ? i.id : "home:exit");
    return;
  }
  if (i?.kind === "camper") {
    s.requestAction("home:camper", i.id);
    return;
  }
  if (i?.kind === "live-train" && store.mode === "foot" && i.ready) {
    s.requestAction("rail:board");
    return;
  }
  if (i?.kind === "property") {
    const [, command, plot, slot] = i.id.split(":");
    s.requestAction(`property:${command}`, `${plot}:${slot}`);
    return;
  }
  if (store.mode === "stand") {
    s.requestAction("hunt:leave");
    return;
  }
  if (store.mode === "train") {
    s.requestAction("rail:exit");
    return;
  }
  if (store.mode === "mount") {
    s.requestAction(
      s.mountId?.startsWith("horse-") ? "farm:ride" : "hunt:leave",
    );
    return;
  }
  if (i?.kind === "vehicle" && store.mode === "foot") {
    boardVehicle(i.id);
    return;
  }
  if (i?.ready && i.kind !== "vehicle") {
    if (Math.abs(s.playerSnapshot.speed) > 3) {
      store.setHint("Stop here to use this.");
      return;
    }
    const destination = DESTINATIONS.find((d) => d.id === i.id);
    if (
      !destination ||
      distanceTo(s.playerSnapshot, destination) > destination.radius
    )
      return;
    if (destination.kind === "stand") {
      s.requestAction("hunt:climb", i.id);
      return;
    }
    if (destination.kind === "sell") {
      s.openPanel("sell", destination.id);
      return;
    }
    if (destination.kind === "dog") {
      s.requestAction("dog:feed");
      return;
    }
    if (destination.kind === "wash") {
      s.requestAction("activity:wash");
      return;
    }
    if (destination.kind === "launch") {
      s.openPanel("space");
      return;
    }
    s.openPanel(destination.kind, i.id);
    return;
  }
  if (["vehicle", "boat"].includes(store.mode)) exitVehicle();
  else store.setHint("Walk closer to a ride, store, or activity.");
}
export function AdventureRuntime({ controls }: { controls: GameControls }) {
  const gl = useThree((s) => s.gl);
  const { playerPos, playerQuat, playerSpeedRef } = useGameContext();
  const elapsed = useRef(0),
    saveElapsed = useRef(0),
    deliveryElapsed = useRef(0),
    seenAction = useRef(0);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const target = window as Window & { __fw3dWorld?: unknown };
    const handle = {
      state: () => ({
        mode: useFourWheeler3dStore.getState().mode,
        progress: useFourWheeler3dStore.getState().progress,
        session: useAdventureSession.getState(),
      }),
      renderInfo: () => ({
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
      }),
      teleport: (x: number, z: number, heading = 0) => {
        if (![x, z, heading].every(Number.isFinite)) return;
        const mode = useFourWheeler3dStore.getState().mode;
        useAdventureSession
          .getState()
          .relocate(
            { x, y: heightAt(x, z) + (mode === "vehicle" ? 1.1 : 0.1), z },
            heading,
          );
      },
    };
    target.__fw3dWorld = handle;
    return () => {
      if (target.__fw3dWorld === handle) delete target.__fw3dWorld;
    };
  }, [gl]);
  useEffect(() => {
    const save = () => saveRiderPosition();
    window.addEventListener("pagehide", save);
    const unsubscribe = useFourWheeler3dStore.subscribe((state, previous) => {
      if (state.isPaused && !previous.isPaused) save();
    });
    return () => {
      window.removeEventListener("pagehide", save);
      unsubscribe();
    };
  }, []);
  useFrame((_, delta) => {
    const store = useFourWheeler3dStore.getState(),
      s = useAdventureSession.getState();
    if (!store.hasStarted || store.isPaused) return;
    if (store.mode === "space" || store.mode === "planet") return;
    const pending = pendingFootRelocation(store.mode, s);
    const dt = Math.min(delta, 0.1),
      p = pending?.position ?? playerPos.current,
      q = playerQuat.current;
    elapsed.current += dt;
    saveElapsed.current += dt;
    deliveryElapsed.current += dt;
    if (elapsed.current >= 0.1) {
      elapsed.current = 0;
      const heading =
        pending?.heading ??
        Math.atan2(
          2 * (q.w * q.y + q.x * q.z),
          1 - 2 * (q.x * q.x + q.y * q.y),
        );
      useAdventureSession.setState({
        playerSnapshot: {
          x: p.x,
          y: p.y,
          z: p.z,
          heading,
          speed: pending ? 0 : playerSpeedRef.current,
        },
      });
      const near = nearbyDestination(p);
      const vehicle =
        store.mode === "foot"
          ? Object.values(store.progress.adventure.fleet)
              .filter(
                (v) =>
                  canBoardFleetVehicle(store.progress.adventure, v.id) &&
                  canBoardPropertyVehicle(store.progress.adventure, v.id) &&
                  distanceTo(p, v.position) <= 8.4,
              )
              .sort(
                (a, b) => distanceTo(p, a.position) - distanceTo(p, b.position),
              )[0]
          : undefined;
      const property = nearbyPropertyInteraction(
        store.progress.adventure,
        useAdventureSession.getState().playerSnapshot,
        store.mode,
      );
      const camper = nearbyCamper(
        store.progress.adventure,
        { x: p.x, y: p.y, z: p.z },
        store.mode,
      );
      const next = nearestInteraction([
        property,
        store.mode === "foot" &&
        store.progress.adventure.trainOwned &&
        s.rail &&
        Math.hypot(
          p.x - s.rail.position.x,
          p.y - s.rail.position.y,
          p.z - s.rail.position.z,
        ) <= RAIL_BOARD_RANGE
          ? {
              id: "live-train",
              label: "Climb aboard train",
              icon: "▥",
              kind: "live-train",
              distance: Math.hypot(
                p.x - s.rail.position.x,
                p.y - s.rail.position.y,
                p.z - s.rail.position.z,
              ),
              ready: true,
            }
          : null,
        camper
          ? {
              id: camper.id,
              label: `Enter ${camper.type === "rv" ? "RV" : "camper"}`,
              icon: "⌂",
              kind: "camper",
              distance: distanceTo(p, camper.position),
              ready: true,
            }
          : null,
        vehicle
          ? {
              id: vehicle.id,
              label: `Ride ${vehicle.type}`,
              icon: "↗",
              kind: "vehicle",
              distance: distanceTo(p, vehicle.position),
              ready: true,
            }
          : null,
        near
          ? {
              id: near.id,
              label: near.label,
              icon: near.icon,
              kind: near.kind,
              distance: distanceTo(p, near),
              ready: true,
            }
          : null,
      ]);
      if (
        store.mode !== "interior" &&
        (next?.id !== s.interaction?.id || next?.ready !== s.interaction?.ready)
      )
        s.setInteraction(next);
      if (
        store.mode !== "interior" &&
        s.waypoint &&
        distanceTo(p, s.waypoint) < 2.5
      ) {
        store.setHint(`You’ve arrived at ${s.waypoint.label}.`);
        s.setWaypoint(null);
      }
      if (store.mode !== "interior" && s.panel && s.panelId) {
        const d = DESTINATIONS.find((d) => d.id === s.panelId);
        if (
          s.panel === "land"
            ? !canManageProperty(store.progress.adventure, s.panelId, p)
            : d && distanceTo(p, d) > d.radius + 4
        )
          s.openPanel(null);
      }
    }
    if (saveElapsed.current >= 5) {
      saveElapsed.current = 0;
      if (Math.abs(playerSpeedRef.current) > 0.2) saveRiderPosition();
    }
    if (deliveryElapsed.current >= 1) {
      const seconds = deliveryElapsed.current;
      deliveryElapsed.current = 0;
      for (const kind of ["delivery", "helperTask"] as const) {
        const current = useFourWheeler3dStore.getState().progress;
        if (current.adventure[kind]) {
          const result =
            kind === "delivery"
              ? advanceDelivery(
                  current,
                  seconds,
                  deliveryOrigin(useAdventureSession.getState()),
                )
              : advanceHelper(
                  current,
                  seconds,
                  deliveryOrigin(useAdventureSession.getState()),
                );
          if (result.ok) {
            result.patch.adventure = groundDeliveredFleet(
              current.adventure,
              result.patch.adventure,
            );
            store.updateProgress((prev) => ({ ...prev, ...result.patch }));
            if (!result.patch.adventure[kind]) {
              store.setHint(result.message);
              const newest = Object.values(result.patch.adventure.fleet).at(-1);
              if (newest && !current.adventure.fleet[newest.id])
                s.setWaypoint({
                  id: newest.id,
                  label: "Your delivery",
                  ...newest.position,
                });
            }
          }
        }
      }
    }
    if (controls.takeOneShot("interact")) interact();
    if (s.action && s.action.id !== seenAction.current) {
      seenAction.current = s.action.id;
      const action = s.action;
      if (action.name === "world:interact") interact();
      if (action.name === "world:exit") exitVehicle();
      if (action.name.startsWith("world:switch:")) {
        const id = action.name.slice("world:switch:".length),
          a = store.progress.adventure,
          current = a.fleet[a.activeVehicleId ?? ""],
          target = a.fleet[id];
        if (
          current &&
          target &&
          canSwitchRide(a, id, store.mode, s.playerSnapshot.speed)
        ) {
          parkActive();
          const live =
            useFourWheeler3dStore.getState().progress.adventure.fleet[
              current.id
            ];
          store.updateProgress((p) => ({
            ...p,
            adventure: {
              ...p.adventure,
              fleet: {
                ...p.adventure.fleet,
                [current.id]: {
                  ...live,
                  position: positionXYZ(target.position),
                  heading: target.heading,
                  parked: true,
                },
                [id]: {
                  ...target,
                  position: positionXYZ(live.position),
                  heading: live.heading,
                },
              },
            },
          }));
          boardVehicle(id);
        } else
          store.setHint(
            "Stop your ride first and choose an available ride of the same travel class.",
          );
      }
      if (action.name === "world:board" && action.payload)
        boardVehicle(action.payload);
      if (action.name === "world:wash") {
        const wash = DESTINATIONS.find((d) => d.kind === "wash")!;
        const id = store.progress.adventure.activeVehicleId;
        if (id && distanceTo(p, wash) < wash.radius) {
          store.updateProgress((prev) => ({
            ...prev,
            adventure: {
              ...prev.adventure,
              fleet: {
                ...prev.adventure.fleet,
                [id]: { ...prev.adventure.fleet[id], mud: 0 },
              },
            },
          }));
          store.setHint("Your ride is sparkling clean!");
        }
      }
    }
  });
  return null;
}
