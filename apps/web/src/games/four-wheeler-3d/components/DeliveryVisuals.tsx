"use client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import { useGameContext } from "../lib/gameContext";
import { LANDMARKS } from "../lib/landmarks";
import { heightAt } from "../lib/terrain";
import { findOffer, isWaterVehicle } from "../lib/catalog";
import { waterDeliveryPosition } from "../lib/economy";
import {
  deliveryFlightPosition,
  helperErrandTarget,
  helperFollow,
  visualRemaining,
} from "../lib/deliveryMotion";
import { TransportModel } from "./models/TransportModel";

/** Every motion here observes the economy; only AdventureRuntime completes paid orders. */
export function DeliveryVisuals() {
  const { playerPos, playerQuat } = useGameContext();
  const plane = useRef<THREE.Group>(null),
    parcel = useRef<THREE.Group>(null),
    buddy = useRef<THREE.Group>(null),
    limbs = useRef<(THREE.Group | null)[]>([]),
    carried = useRef<THREE.Group>(null);
  const origin = useRef(
      new THREE.Vector3(
        LANDMARKS.anyStore.x,
        heightAt(LANDMARKS.anyStore.x, LANDMARKS.anyStore.z) + 22,
        LANDMARKS.anyStore.z,
      ),
    ),
    flight = useRef(new THREE.Vector3()),
    target = useRef(new THREE.Vector3()),
    buddyAt = useRef(new THREE.Vector3()),
    anchor = useRef(new THREE.Vector3()),
    errand = useRef(new THREE.Vector3()),
    heading = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const orderNextId = useRef(0),
    order = useRef<string | null>(null),
    deliveryTick = useRef(-1),
    deliverySince = useRef(0),
    helperId = useRef<string | null>(null),
    helperTick = useRef(-1),
    helperSince = useRef(0),
    departure = useRef(0),
    dropAt = useRef(new THREE.Vector3()),
    walkPhase = useRef(0),
    initialized = useRef(false),
    reduced = useRef(false);
  const bindLimb = useCallback((index: number, group: THREE.Group | null) => {
    limbs.current[index] = group;
  }, []);
  const active = useFourWheeler3dStore((s) => s.hasStarted && !s.isPaused),
    panel = useAdventureSession((s) => s.panel);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)"),
      sync = () => {
        reduced.current = query.matches;
      };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useFrame((_, raw) => {
    if (!plane.current || !parcel.current || !buddy.current) return;
    const store = useFourWheeler3dStore.getState(),
      ui = useAdventureSession.getState(),
      a = store.progress.adventure;
    const paused = store.isPaused || Boolean(ui.panel) || !store.hasStarted;
    const dt = paused ? 0 : Math.min(raw, 0.1),
      p = playerPos.current;
    const away = ["space", "planet", "interior"].includes(store.mode);
    plane.current.visible =
      !away && Boolean(a.delivery || departure.current > 0);
    parcel.current.visible = false;
    buddy.current.visible =
      !away && !["aircraft", "train"].includes(store.mode);
    heading.current.setFromQuaternion(playerQuat.current, "YXZ");
    const yaw = heading.current.y;
    if (a.delivery) {
      if (order.current !== a.delivery.id) {
        order.current = a.delivery.id;
        orderNextId.current = a.nextId;
        origin.current.set(
          LANDMARKS.anyStore.x,
          heightAt(LANDMARKS.anyStore.x, LANDMARKS.anyStore.z) + 22,
          LANDMARKS.anyStore.z,
        );
        deliveryTick.current = -1;
        departure.current = 0;
      }
      if (deliveryTick.current !== a.delivery.remainingSeconds) {
        deliveryTick.current = a.delivery.remainingSeconds;
        deliverySince.current = 0;
      } else deliverySince.current += dt;
      const item = findOffer(a.delivery.offerId);
      if (item && isWaterVehicle(item.key)) {
        const water = waterDeliveryPosition(p);
        target.current.set(water.x, water.y, water.z);
      } else if (
        item &&
        (item.kind === "vehicle" ||
          item.kind === "trailer" ||
          item.kind === "plow")
      ) {
        const x = p.x + 5 + (a.nextId % 5) * 2,
          z = p.z + 7;
        target.current.set(x, heightAt(x, z), z);
      } else target.current.set(p.x + 2, heightAt(p.x + 2, p.z), p.z);
      const remaining = visualRemaining(
        a.delivery.remainingSeconds,
        deliverySince.current,
      );
      deliveryFlightPosition(
        origin.current,
        target.current,
        remaining,
        flight.current,
      );
      plane.current.position.copy(flight.current);
      plane.current.rotation.set(
        0,
        Math.atan2(
          target.current.x - origin.current.x,
          target.current.z - origin.current.z,
        ),
        0,
      );
      dropAt.current.copy(target.current);
      if (remaining < 1.5) {
        parcel.current.visible = !away;
        const t = Math.min(0.97, 1 - remaining / 1.5);
        parcel.current.position.lerpVectors(flight.current, target.current, t);
        parcel.current.position.y += 0.4;
      }
    } else if (order.current) {
      order.current = null;
      departure.current =
        a.nextId >= orderNextId.current && deliveryTick.current <= 1.1 ? 2 : 0;
      parcel.current.position.copy(dropAt.current);
      parcel.current.position.y += 0.4;
    }
    if (!a.delivery && departure.current > 0) {
      departure.current = Math.max(0, departure.current - dt);
      const yaw = plane.current.rotation.y;
      plane.current.position.x += Math.sin(yaw) * dt * 35;
      plane.current.position.z += Math.cos(yaw) * dt * 35;
      plane.current.position.y += dt * 12;
      parcel.current.visible = !away && departure.current > 1;
      parcel.current.position.copy(dropAt.current);
      parcel.current.position.y += 0.4;
    }
    // The buddy follows a distinct anchor and never grants money or inventory.
    anchor.current.set(
      p.x - (Math.sin(yaw) * 80) / 18,
      p.y,
      p.z - (Math.cos(yaw) * 80) / 18,
    );
    if (!initialized.current) {
      buddyAt.current.copy(anchor.current);
      initialized.current = true;
    }
    if (a.helperTask) {
      if (helperId.current !== a.helperTask.id) {
        helperId.current = a.helperTask.id;
        helperTick.current = -1;
      }
      if (helperTick.current !== a.helperTask.remainingSeconds) {
        helperTick.current = a.helperTask.remainingSeconds;
        helperSince.current = 0;
      } else helperSince.current += dt;
      helperErrandTarget(
        anchor.current,
        yaw,
        visualRemaining(a.helperTask.remainingSeconds, helperSince.current),
        errand.current,
      );
    } else {
      helperId.current = null;
      errand.current.copy(anchor.current);
    }
    const beforeX = buddyAt.current.x,
      beforeZ = buddyAt.current.z,
      step = helperFollow(buddyAt.current, errand.current, dt);
    // The helper waits at the waterline while the player is aboard; no walking through the lake floor.
    const distance = Math.hypot(buddyAt.current.x, buddyAt.current.z);
    if (distance < 375 && distance > 0) {
      buddyAt.current.x *= 375 / distance;
      buddyAt.current.z *= 375 / distance;
    }
    buddyAt.current.y = heightAt(buddyAt.current.x, buddyAt.current.z);
    buddy.current.position.copy(buddyAt.current);
    if (step > 0.001)
      buddy.current.rotation.y = Math.atan2(
        buddyAt.current.x - beforeX,
        buddyAt.current.z - beforeZ,
      );
    walkPhase.current += step * 3.8;
    limbs.current.forEach((limb, i) => {
      if (limb)
        limb.rotation.x =
          !paused && !reduced.current && step > 0.001
            ? Math.sin(walkPhase.current + (i % 2) * Math.PI) * 0.45
            : 0;
    });
    if (carried.current) carried.current.visible = Boolean(a.helperTask);
  });
  return (
    <group name="deliveries-and-helper">
      <group ref={plane} visible={false}>
        <TransportModel
          type="plane"
          paint="#475b65"
          running={active && !panel}
        />
        <mesh position={[0, -0.42, 0]} castShadow>
          <boxGeometry args={[1.1, 0.8, 1.7]} />
          <meshStandardMaterial color="#b8a075" roughness={0.8} />
        </mesh>
      </group>
      <group ref={parcel} visible={false}>
        <Parcel />
      </group>
      <group ref={buddy}>
        <HelperFigure bindLimb={bindLimb} />
        <group ref={carried} position={[0, 1, 0.35]} visible={false}>
          <Parcel small />
        </group>
      </group>
    </group>
  );
}
function Parcel({ small = false }: { small?: boolean }) {
  return (
    <group scale={small ? 0.4 : 1}>
      <mesh castShadow>
        <boxGeometry args={[0.75, 0.65, 0.7]} />
        <meshStandardMaterial color="#aa8c61" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.328, 0]}>
        <boxGeometry args={[0.13, 0.007, 0.705]} />
        <meshStandardMaterial color="#d8c6a2" roughness={0.8} />
      </mesh>
    </group>
  );
}
function HelperFigure({
  bindLimb,
}: {
  bindLimb: (index: number, group: THREE.Group | null) => void;
}) {
  const cloth = useMemo(
      () =>
        new THREE.MeshStandardMaterial({ color: "#476373", roughness: 0.95 }),
      [],
    ),
    trousers = useMemo(
      () => new THREE.MeshStandardMaterial({ color: "#50554c", roughness: 1 }),
      [],
    );
  return (
    <group name="helper-buddy">
      <mesh position={[0, 1.13, 0]} castShadow material={cloth}>
        <cylinderGeometry args={[0.205, 0.16, 0.55, 14]} />
      </mesh>
      <mesh position={[0, 1.58, 0.015]} scale={[0.14, 0.18, 0.14]} castShadow>
        <sphereGeometry args={[1, 20, 16]} />
        <meshStandardMaterial color="#ba9878" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.73, 0.035]} scale={[0.155, 0.08, 0.18]} castShadow>
        <sphereGeometry args={[1, 16, 10]} />
        <meshStandardMaterial color="#304a52" roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.7, 0.17]}>
        <boxGeometry args={[0.27, 0.015, 0.14]} />
        <meshStandardMaterial color="#304a52" />
      </mesh>
      {[-1, 1].map((s, i) => (
        <group key={s}>
          <group ref={(g) => bindLimb(i, g)} position={[s * 0.215, 1.31, 0]}>
            <mesh position={[0, -0.2, 0]} castShadow material={cloth}>
              <capsuleGeometry args={[0.057, 0.28, 4, 10]} />
            </mesh>
            <mesh position={[0, -0.41, 0]}>
              <sphereGeometry args={[0.055, 10, 8]} />
              <meshStandardMaterial color="#ba9878" roughness={0.9} />
            </mesh>
          </group>
          <group
            ref={(g) => bindLimb(i + 2, g)}
            position={[s * 0.105, 0.88, 0]}
          >
            <mesh position={[0, -0.34, 0]} castShadow material={trousers}>
              <capsuleGeometry args={[0.083, 0.51, 4, 10]} />
            </mesh>
            <mesh position={[0, -0.78, 0.055]} castShadow>
              <boxGeometry args={[0.15, 0.12, 0.28]} />
              <meshStandardMaterial color="#373d35" roughness={0.9} />
            </mesh>
          </group>
          <mesh position={[s * 0.05, 1.61, 0.145]}>
            <sphereGeometry args={[0.012, 8, 6]} />
            <meshStandardMaterial color="#27352f" />
          </mesh>
        </group>
      ))}
    </group>
  );
}
/** Optional HUD content; countdown values come directly from the paid order state. */
export function DeliveryStatus() {
  const delivery = useFourWheeler3dStore((s) => s.progress.adventure.delivery),
    helper = useFourWheeler3dStore((s) => s.progress.adventure.helperTask);
  if (!delivery && !helper) return null;
  return (
    <div role="status" aria-live="polite">
      {delivery && (
        <span>Delivery plane · {Math.ceil(delivery.remainingSeconds)} s</span>
      )}
      {helper && (
        <span> Helper errand · {Math.ceil(helper.remainingSeconds)} s</span>
      )}
    </div>
  );
}
