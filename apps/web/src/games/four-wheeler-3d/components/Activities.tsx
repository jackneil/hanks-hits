"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import {
  BallCollider,
  ConvexHullCollider,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import * as THREE from "three";
import { useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import { useGameContext } from "../lib/gameContext";
import { heightAt } from "../lib/terrain";
import { LANDMARKS, WONDERLAND } from "../lib/landmarks";
import {
  advanceTrailer,
  mergeActivitiesSnapshot,
  createActivitiesProgress,
  inMud,
  loadOrUnload,
  MUD_PATCHES,
  mowSwath,
  NOZZLE,
  PLAY_LOCATIONS,
  regrowGrass,
  scrapeSnow,
  toggleHitch,
  YARD_PROPS,
  type ActivitiesProgress,
} from "../lib/activities";
import {
  resetActivitiesSession,
  trailerTransforms,
  useActivitiesSession,
} from "../lib/activitiesSession";
import { tuningFor } from "../lib/vehicles";
import type { FleetVehicle } from "../lib/adventureTypes";
import { YardProp } from "./YardProp";

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);
const RAMPS = Array.from({ length: 84 }, (_, i) => {
  const angle = i * 2.3999632297,
    radius = 490 + (i % 13) * 110;
  return {
    x: Math.sin(angle) * radius,
    z: Math.cos(angle) * radius,
    heading: angle + Math.PI / 2,
  };
});
const WEDGE = new Float32Array([
  -2.5, 0, -5, 2.5, 0, -5, -2.5, 0, 5, 2.5, 0, 5, -2.5, 2.2, 5, 2.5, 2.2, 5,
]);
const REQUEST = (name: string, payload?: string) =>
  useAdventureSession.getState().requestAction(`activity:${name}`, payload);

export function useActivitiesRuntime() {
  const { playerPos, playerQuat, playerSpeedRef } = useGameContext();
  const trailers = useRef(new Map<string, FleetVehicle>()),
    mud = useRef(new Map<string, number>()),
    pending = useRef<ActivitiesProgress | null>(null);
  const timer = useRef(0),
    simulation = useRef(0),
    lastHour = useRef(-1),
    trampolineCooldown = useRef(0);
  const liveHeading = useRef(new THREE.Euler());
  const air = useRef({ time: 0, height: 0 });
  const flush = useRef(() => {});
  useEffect(() => {
    const persist = () => {
      if (!pending.current && !trailers.current.size && !mud.current.size)
        return;
      useFourWheeler3dStore.getState().updateProgress((p) => {
        const fleet = { ...p.adventure.fleet };
        for (const [id, v] of trailers.current)
          if (fleet[id])
            fleet[id] = {
              ...fleet[id],
              position: v.position,
              heading: v.heading,
            };
        for (const [id, amount] of mud.current)
          if (fleet[id]) fleet[id] = { ...fleet[id], mud: amount };
        let feeders = p.adventure.feeders;
        for (const trailer of trailers.current.values()) {
          const saved = fleet[trailer.id];
          if (!saved?.cornLoad) continue;
          feeders = feeders.map((f) => {
            if (
              dist(f.position, trailer.position) > 8.34 ||
              f.corn >= 18 ||
              saved.cornLoad <= 0
            )
              return f;
            const take = Math.min(18 - f.corn, saved.cornLoad);
            saved.cornLoad -= take;
            return { ...f, corn: f.corn + take };
          });
        }
        return {
          ...p,
          adventure: {
            ...p.adventure,
            fleet,
            feeders,
            activities: pending.current
              ? mergeActivitiesSnapshot(p.adventure.activities, pending.current)
              : p.adventure.activities,
          },
        };
      });
      pending.current = null;
      mud.current.clear();
    };
    flush.current = persist;
    const unactivity = useActivitiesSession.subscribe((s, p) => {
      if (s.generation !== p.generation) {
        trailers.current.clear();
        mud.current.clear();
        pending.current = null;
        timer.current = 0;
        simulation.current = 0;
        lastHour.current = -1;
        trampolineCooldown.current = 0;
        air.current = { time: 0, height: 0 };
      }
    });
    const unstore = useFourWheeler3dStore.subscribe((s, old) => {
      if (
        s.progress.adventure.nextId < old.progress.adventure.nextId ||
        s.hasStarted !== old.hasStarted
      ) {
        resetActivitiesSession();
        return;
      }
      if ((s.isPaused && !old.isPaused) || s.mode !== old.mode) persist();
    });
    const unsub = useAdventureSession.subscribe((s, old) => {
      if (
        !s.action ||
        s.action.id === old.action?.id ||
        !s.action.name.startsWith("activity:")
      )
        return;
      persist();
      const store = useFourWheeler3dStore.getState(),
        a = store.progress.adventure,
        pos = s.playerSnapshot,
        active = a.fleet[a.activeVehicleId ?? ""],
        name = s.action.name.slice(9),
        local = useActivitiesSession.getState();
      const update = (next: typeof a, message: string) => {
        store.updateProgress((p) => ({ ...p, adventure: next }));
        useActivitiesSession.setState({ liveActivities: next.activities });
        store.setHint(message);
      };
      if (name === "hitch") {
        const result = toggleHitch(
          a,
          store.mode === "vehicle" ? a.activeVehicleId : null,
        );
        update(result.adventure, result.message);
        trailers.current.clear();
        trailerTransforms.clear();
      }
      if (name === "load") {
        const result = loadOrUnload(
          a,
          pos,
          ["vehicle", "boat"].includes(store.mode) ? a.activeVehicleId : null,
        );
        update(result.adventure, result.message);
        if (result.exitVehicle) {
          store.setMode("foot");
          s.relocate(
            { x: pos.x + 2.5, y: heightAt(pos.x + 2.5, pos.z), z: pos.z },
            pos.heading,
          );
        }
      }
      if (name === "mower") {
        if (!active?.hitch || a.fleet[active.hitch]?.type !== "mower")
          return store.setHint("Hitch the mower first.");
        update(
          {
            ...a,
            activities: { ...a.activities, mowerOn: !a.activities.mowerOn },
          },
          a.activities.mowerOn
            ? "Mower stopped."
            : "Mower running. Drive across the grass.",
        );
      }
      if (name === "plow") {
        if (a.activities.plowVehicleId !== active?.id)
          return store.setHint("Hitch a snow plow first.");
        update(
          {
            ...a,
            activities: {
              ...a.activities,
              plowDown: !a.activities.plowDown,
              plowLoad: 0,
            },
          },
          a.activities.plowDown ? "Plow raised. Snow dumped." : "Plow lowered.",
        );
      }
      if (name === "nozzle") {
        if (local.nozzle) {
          useActivitiesSession.setState({ nozzle: false, spraying: false });
          return;
        }
        if (store.mode !== "foot" || dist(pos, NOZZLE) > 6.12)
          return store.setHint("Walk beside the car wash to pick up the hose.");
        useActivitiesSession.setState({ nozzle: true });
        s.openPanel(null);
        store.setHint("Hose ready. Hold Spray to wash nearby vehicles.");
      }
      if (name === "spray-start" && local.nozzle)
        useActivitiesSession.setState({ spraying: true });
      if (name === "spray-stop")
        useActivitiesSession.setState({ spraying: false });
      if (name === "wash") {
        if (!active || dist(pos, LANDMARKS.carWash) > 5)
          return store.setHint("Drive through the car wash.");
        const fleet = { ...a.fleet, [active.id]: { ...active, mud: 0 } };
        if (active.hitch && fleet[active.hitch])
          fleet[active.hitch] = { ...fleet[active.hitch], mud: 0 };
        update({ ...a, fleet }, "Vehicle and trailer washed.");
        useActivitiesSession.setState({ sprayBurst: 1 });
      }
      if (name === "fill") {
        if (active?.type !== "firetruck" || dist(pos, LANDMARKS.hydrant) > 9.73)
          return store.setHint(
            "Bring the fire truck to the hydrant by the dock.",
          );
        update({ ...a, fireWater: 100 }, "Water tank filled.");
      }
      if (name === "fire-spray") {
        if (active?.type !== "firetruck") return;
        if (a.fireWater < 3)
          return store.setHint(
            "The water tank is empty. Refill at the dock hydrant.",
          );
        const tip = {
          x: pos.x + Math.sin(pos.heading) * 5,
          z: pos.z + Math.cos(pos.heading) * 5,
        };
        const fleet = Object.fromEntries(
          Object.entries(a.fleet).map(([id, v]) => [
            id,
            v.parked && dist(v.position, tip) < 3.06
              ? { ...v, mud: Math.max(0, v.mud - 0.05) }
              : v,
          ]),
        );
        update({ ...a, fleet, fireWater: a.fireWater - 3 }, "Water sprayed.");
        useActivitiesSession.setState({ sprayBurst: 0.8 });
      }
      if (name === "ladder" && active?.type === "firetruck")
        update(
          { ...a, ladderRaised: !a.ladderRaised },
          a.ladderRaised ? "Ladder lowered." : "Ladder raised.",
        );
      if (name === "slide" || name === "swing") {
        const kind = name === "slide" ? "slide" : "swings",
          spot =
            PLAY_LOCATIONS.find(
              (p) => p.id === s.action?.payload && p.kind === kind,
            ) ??
            PLAY_LOCATIONS.filter((p) => p.kind === kind).sort(
              (a, b) => dist(a, pos) - dist(b, pos),
            )[0];
        if (
          store.mode !== "foot" ||
          !spot ||
          dist(pos, spot) > (name === "slide" ? 9.45 : 8.9)
        )
          return store.setHint(`Walk closer to the ${kind}.`);
        s.openPanel(null);
        if (name === "slide") {
          s.relocate({
            x: spot.x,
            y: heightAt(spot.x, spot.z) + 2.8,
            z: spot.z - 1.8,
          });
          useActivitiesSession.setState({ impulse: { x: 0, y: 0, z: 14 } });
          store.setHint("Whoosh!");
        } else {
          useActivitiesSession.setState({
            swingRemaining: 6,
            swingId: spot.id,
          });
          s.relocate({
            x: spot.x,
            y: heightAt(spot.x, spot.z) + 0.6,
            z: spot.z,
          });
          store.setHint("Swinging! You will hop off in six seconds.");
        }
      }
    });
    const key = (e: KeyboardEvent) => {
      if (
        e.code !== "KeyT" ||
        e.repeat ||
        (e.target instanceof HTMLElement &&
          e.target.closest("input,textarea,button,select,[contenteditable]"))
      )
        return;
      if (
        useAdventureSession.getState().panel ||
        useFourWheeler3dStore.getState().isPaused
      )
        return;
      e.preventDefault();
      REQUEST("hitch");
    };
    window.addEventListener("keydown", key);
    const hidden = () => {
      if (document.hidden) {
        useActivitiesSession.setState({ spraying: false });
        persist();
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      unsub();
      unstore();
      unactivity();
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", hidden);
      persist();
      resetActivitiesSession();
    };
  }, []);
  useFrame((_, raw) => {
    const store = useFourWheeler3dStore.getState(),
      s = useAdventureSession.getState();
    if (store.isPaused || !store.hasStarted || s.panel) return;
    const dt = Math.min(raw, 0.1),
      a = store.progress.adventure,
      local = useActivitiesSession.getState();
    liveHeading.current.setFromQuaternion(playerQuat.current, "YXZ");
    const heading = liveHeading.current.y,
      pos = playerPos.current,
      speed = playerSpeedRef.current,
      active = a.fleet[a.activeVehicleId ?? ""];
    if (active && store.mode === "vehicle") {
      const tuning = tuningFor(active.type),
        clearance =
          tuning.chassis.height / 2 +
          tuning.wheelRadius +
          tuning.suspension.restLength;
      const above = pos.y - heightAt(pos.x, pos.z) - clearance;
      if (above > 0.6 && Math.abs(speed) > 1) {
        air.current.time += dt;
        air.current.height = Math.max(air.current.height, above);
      } else if (above < 0.35 && air.current.time > 0.15) {
        const points = Math.round(
          air.current.time * 100 + air.current.height * 10,
        );
        store.updateProgress((p) => ({
          ...p,
          airPoints: p.airPoints + points,
        }));
        store.setHint(`Clean landing! +${points} air points.`);
        air.current = { time: 0, height: 0 };
      }
    } else air.current = { time: 0, height: 0 };
    if (local.swingRemaining > 0) {
      const remaining = Math.max(0, local.swingRemaining - dt);
      useActivitiesSession.setState({ swingRemaining: remaining });
      const spot = PLAY_LOCATIONS.find((p) => p.id === local.swingId);
      if (spot) {
        const angle = Math.sin((6 - remaining) * 3) * 0.65;
        const y = heightAt(spot.x, spot.z) + 3 - Math.cos(angle) * 2.4;
        s.relocate({
          x: spot.x,
          y: y - 0.4,
          z: spot.z - Math.sin(angle) * 2.4,
        });
      }
      if (!remaining) {
        useActivitiesSession.setState({ swingId: null });
        store.setHint("That was fun! Back on your feet.");
      }
    }
    trampolineCooldown.current = Math.max(0, trampolineCooldown.current - dt);
    const tramp = YARD_PROPS.find((p) => p.kind === "trampoline")!;
    if (
      store.mode === "foot" &&
      dist(pos, tramp) < 1.6 &&
      pos.y < heightAt(tramp.x, tramp.z) + 2.1 &&
      !trampolineCooldown.current
    ) {
      useActivitiesSession.setState({ impulse: { x: 0, y: 6.3, z: 0 } });
      trampolineCooldown.current = 1.1;
      store.setHint("BOING!");
    }
    if (local.nozzle && (store.mode !== "foot" || dist(pos, NOZZLE) > 14.45)) {
      useActivitiesSession.setState({ nozzle: false, spraying: false });
      store.setHint("The hose reached its limit and returned to the wall.");
    }
    if (local.sprayBurst > 0)
      useActivitiesSession.setState({
        sprayBurst: Math.max(0, local.sprayBurst - dt),
      });
    if (active?.hitch && store.mode === "vehicle") {
      const source =
        trailers.current.get(active.hitch) ?? a.fleet[active.hitch];
      if (source) {
        const car = {
            ...active,
            heading,
            position: { x: pos.x, y: pos.y, z: pos.z },
          },
          next = advanceTrailer(car, source, dt);
        next.position.y = heightAt(next.position.x, next.position.z) + 0.6;
        trailers.current.set(next.id, next);
        trailerTransforms.set(next.id, {
          position: next.position,
          heading: next.heading,
        });
      }
    }
    timer.current += dt;
    simulation.current += dt;
    if (simulation.current < 0.2) return;
    const step = simulation.current;
    simulation.current = 0;
    let act = pending.current ?? a.activities ?? createActivitiesProgress(),
      changed = false;
    const hour = (store.progress.day - 1) * 24 + store.clock;
    if (Math.floor(hour) !== lastHour.current) {
      lastHour.current = Math.floor(hour);
      const regrown = regrowGrass(act.cutGrass, hour);
      if (Object.keys(regrown).length !== Object.keys(act.cutGrass).length) {
        act = { ...act, cutGrass: regrown };
        changed = true;
      }
    }
    const washing =
      active && store.mode === "vehicle" && dist(pos, LANDMARKS.carWash) < 5;
    if (active && store.mode === "vehicle") {
      let amount = mud.current.get(active.id) ?? active.mud;
      if (inMud(pos.x, pos.z) && Math.abs(speed) > 0.5)
        amount = Math.min(1, amount + step * 1.5);
      if (washing) amount = Math.max(0, amount - step * 2.1);
      if (amount !== active.mud) mud.current.set(active.id, amount);
      const trailer = active.hitch ? trailers.current.get(active.hitch) : null;
      if (trailer) {
        let dirt = mud.current.get(trailer.id) ?? trailer.mud;
        if (
          inMud(trailer.position.x, trailer.position.z) &&
          Math.abs(speed) > 0.5
        )
          dirt = Math.min(1, dirt + step * 1.5);
        if (washing) dirt = Math.max(0, dirt - step * 2.1);
        if (dirt !== trailer.mud) mud.current.set(trailer.id, dirt);
        if (trailer.type === "mower" && act.mowerOn && Math.abs(speed) > 0.3) {
          act = { ...act, cutGrass: mowSwath(act.cutGrass, trailer, hour) };
          changed = true;
        }
      }
      if (
        act.plowVehicleId === active.id &&
        act.plowDown &&
        Math.abs(speed) > 1.5 &&
        store.snowLevel > 0.12
      ) {
        const old = act.plowLoad;
        act = scrapeSnow(act, pos, heading, step, store.snowLevel);
        changed = true;
        if (old <= 4.6 && act.plowLoad > 4.6)
          store.setHint(
            "Your plow is buried. Raise it to dump the snow and drive again.",
          );
      }
    }
    if (local.nozzle && local.spraying)
      for (const v of Object.values(a.fleet))
        if (v.parked && dist(pos, v.position) < 6.12) {
          const amount = mud.current.get(v.id) ?? v.mud;
          if (amount > 0)
            mud.current.set(v.id, Math.max(0, amount - step * 1.2));
        }
    if (store.progress.weather !== "snowy" && act.snowPiles.length) {
      act = {
        ...act,
        snowPiles: act.snowPiles
          .map((p) => ({ ...p, size: p.size - step * 0.056 }))
          .filter((p) => p.size > 0.22),
      };
      changed = true;
    }
    if (changed) {
      pending.current = act;
      useActivitiesSession.setState({ liveActivities: act });
    }
    if (timer.current >= 5) {
      timer.current = 0;
      flush.current();
    }
  });
}

function JumpRamp({
  x,
  z,
  heading,
}: {
  x: number;
  z: number;
  heading: number;
}) {
  const h = heightAt(x, z);
  return (
    <RigidBody
      type="fixed"
      colliders={false}
      position={[x, h - 0.08, z]}
      rotation={[0, heading, 0]}
    >
      <ConvexHullCollider args={[WEDGE]} />
      <mesh
        position={[0, 1.1, 0]}
        rotation={[-Math.atan2(2.2, 10), 0, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[5, 0.16, 10.24]} />
        <meshStandardMaterial color="#716c59" roughness={0.95} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={[s * 2.42, 1.2, 0]}
          rotation={[-Math.atan2(2.2, 10), 0, 0]}
        >
          <boxGeometry args={[0.08, 0.08, 10.24]} />
          <meshStandardMaterial color="#c6ae65" />
        </mesh>
      ))}
    </RigidBody>
  );
}
function PlayBall({ kind }: { kind: "goal" | "hoop" }) {
  const spot = YARD_PROPS.find((p) => p.kind === kind)!,
    body = useRef<RapierRigidBody>(null),
    cooldown = useRef(0),
    armed = useRef(false),
    { playerPos, playerQuat, playerSpeedRef } = useGameContext();
  const y = heightAt(spot.x, spot.z),
    home = { x: spot.x, y: y + 0.3, z: spot.z + 4 };
  useFrame((_, raw) => {
    const b = body.current,
      store = useFourWheeler3dStore.getState();
    if (!b || store.isPaused || useAdventureSession.getState().panel) return;
    cooldown.current = Math.max(0, cooldown.current - Math.min(raw, 0.1));
    const p = b.translation();
    if (
      store.mode === "foot" &&
      dist(p, playerPos.current) < 1 &&
      !cooldown.current
    ) {
      const direction = new THREE.Vector3(0, 0, 1).applyQuaternion(
          playerQuat.current,
        ),
        speed = 8 + Math.abs(playerSpeedRef.current) * 1.5;
      b.setLinvel(
        {
          x: direction.x * speed,
          y: kind === "hoop" ? 7 : 2,
          z: direction.z * speed,
        },
        true,
      );
      cooldown.current = 0.8;
      armed.current = true;
    }
    const scored =
      kind === "goal"
        ? Math.abs(p.x - spot.x) < 2 &&
          Math.abs(p.z - spot.z) < 0.5 &&
          p.y < y + 2.1
        : Math.hypot(p.x - spot.x, p.z - spot.z) < 0.55 &&
          Math.abs(p.y - y - 3) < 0.3;
    if (scored && armed.current) {
      store.updateProgress((v) => ({
        ...v,
        money: v.money + 100,
        totalEarned: v.totalEarned + 100,
        adventure: {
          ...v.adventure,
          activities: {
            ...v.adventure.activities,
            goals: v.adventure.activities.goals + 1,
          },
        },
      }));
      store.setHint("Goal! You earned $100.");
    }
    if (scored || dist(p, home) > 44.45 || p.y < y - 10) {
      b.setTranslation(home, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      cooldown.current = 1;
      armed.current = false;
    }
  });
  return (
    <RigidBody
      ref={body}
      colliders={false}
      position={[home.x, home.y, home.z]}
      mass={0.5}
      restitution={0.65}
      linearDamping={0.45}
      angularDamping={0.4}
      ccd
    >
      <BallCollider args={[0.24]} />
      <mesh castShadow>
        <sphereGeometry args={[0.24, 16, 12]} />
        <meshStandardMaterial
          color={kind === "goal" ? "#e3dfca" : "#be692b"}
          roughness={0.8}
        />
      </mesh>
    </RigidBody>
  );
}
function WaterSpray() {
  const ref = useRef<THREE.InstancedMesh>(null),
    { playerPos, playerQuat } = useGameContext();
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const s = useActivitiesSession.getState(),
      store = useFourWheeler3dStore.getState();
    const wash =
      store.mode === "vehicle" &&
      dist(playerPos.current, LANDMARKS.carWash) < 5;
    const on = s.spraying || s.sprayBurst > 0 || wash;
    m.visible = on;
    if (!on) return;
    const heading = new THREE.Euler().setFromQuaternion(
        playerQuat.current,
        "YXZ",
      ).y,
      obj = new THREE.Object3D();
    for (let i = 0; i < 32; i++) {
      const t = (clock.elapsedTime * 1.8 + i / 32) % 1,
        d = 1 + t * 6;
      obj.position.set(
        playerPos.current.x + Math.sin(heading) * d + Math.sin(i * 7) * t,
        playerPos.current.y + 1 + t - t * t * 2,
        playerPos.current.z + Math.cos(heading) * d + Math.cos(i * 7) * t,
      );
      obj.scale.setScalar(0.03 + t * 0.07);
      obj.updateMatrix();
      m.setMatrixAt(i, obj.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, 32]}
      frustumCulled={false}
    >
      <sphereGeometry args={[1, 6, 4]} />
      <meshStandardMaterial color="#bedfdf" transparent opacity={0.65} />
    </instancedMesh>
  );
}
export function Activities() {
  useActivitiesRuntime();
  const { playerPos } = useGameContext();
  const [cell, setCell] = useState({ x: -400, z: 0 });
  const next = useRef(0);
  useFrame((_, dt) => {
    next.current += dt;
    if (next.current > 0.5) {
      next.current = 0;
      if (dist(cell, playerPos.current) > 45)
        setCell({ x: playerPos.current.x, z: playerPos.current.z });
    }
  });
  const ramps = useMemo(() => RAMPS.filter((p) => dist(p, cell) < 190), [cell]);
  const debris = useActivitiesSession((s) => s.debris);
  const saved = useFourWheeler3dStore((s) => s.progress.adventure.activities),
    live = useActivitiesSession((s) => s.liveActivities),
    act = live ?? saved;
  return (
    <group name="outdoor-activities">
      {ramps.map((p, i) => (
        <JumpRamp key={`${p.x}:${i}`} {...p} />
      ))}
      {PLAY_LOCATIONS.map((p) => (
        <YardProp key={p.id} prop={p} />
      ))}
      <PlayBall kind="goal" />
      <PlayBall kind="hoop" />
      {MUD_PATCHES.filter((p) => dist(p, cell) < 230).map((p, i) => (
        <MudVisual key={i} patch={p} />
      ))}
      {act?.snowPiles
        .filter((p) => dist(p, cell) < 180)
        .map((p, i) => (
          <mesh
            key={i}
            position={[p.x, heightAt(p.x, p.z), p.z]}
            scale={[p.size, p.size * 0.55, p.size]}
          >
            <sphereGeometry args={[1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#e0e8e4" roughness={1} />
          </mesh>
        ))}
      <mesh
        position={[
          WONDERLAND.x,
          heightAt(WONDERLAND.x, WONDERLAND.z) + 0.035,
          WONDERLAND.z,
        ]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[WONDERLAND.r, 48]} />
        <meshStandardMaterial color="#d3deda" roughness={1} />
      </mesh>
      <WaterSpray />
      <GrassClippings />
      <EquipmentVisual />
      <WashNozzle />
      <Snowman />
      {debris.map((d) => (
        <DebrisBurst key={d.id} at={d} />
      ))}
    </group>
  );
}

function EquipmentVisual() {
  const group = useRef<THREE.Group>(null),
    blade = useRef<THREE.Mesh>(null),
    ladder = useRef<THREE.Group>(null),
    held = useRef<THREE.Mesh>(null),
    { playerPos, playerQuat } = useGameContext();
  useFrame(() => {
    if (!group.current || !blade.current || !ladder.current) return;
    const store = useFourWheeler3dStore.getState(),
      a = store.progress.adventure,
      act = useActivitiesSession.getState().liveActivities ?? a.activities,
      car = a.fleet[a.activeVehicleId ?? ""];
    group.current.position.copy(playerPos.current);
    group.current.quaternion.copy(playerQuat.current);
    group.current.visible =
      store.mode === "vehicle" || useActivitiesSession.getState().nozzle;
    if (held.current)
      held.current.visible = useActivitiesSession.getState().nozzle;
    blade.current.visible = Boolean(
      store.mode === "vehicle" && car && act.plowVehicleId === car.id,
    );
    if (car) {
      blade.current.position.set(
        0,
        act.plowDown ? -0.45 : 0.15,
        tuningFor(car.type).chassis.length / 2 + 0.7,
      );
      blade.current.scale.x = tuningFor(car.type).chassis.width + 0.5;
    }
    ladder.current.visible = car?.type === "firetruck" && a.ladderRaised;
  });
  return (
    <group ref={group}>
      <mesh
        ref={held}
        position={[0.35, 0.1, 0.5]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <cylinderGeometry args={[0.04, 0.04, 0.35, 10]} />
        <meshStandardMaterial color="#bcc0b8" metalness={0.8} />
      </mesh>
      <mesh ref={blade} rotation={[0.2, 0, 0]} castShadow>
        <boxGeometry args={[1, 0.85, 0.15]} />
        <meshStandardMaterial color="#c8a443" metalness={0.5} roughness={0.5} />
      </mesh>
      <group ref={ladder} position={[0, 2, 0]} rotation={[-0.65, 0, 0]}>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.55, 0, 2.5]}>
            <boxGeometry args={[0.08, 0.09, 6]} />
            <meshStandardMaterial color="#b4b9b4" metalness={0.8} />
          </mesh>
        ))}
        {Array.from({ length: 16 }, (_, i) => (
          <mesh key={i} position={[0, 0, -0.3 + i * 0.37]}>
            <boxGeometry args={[1.1, 0.06, 0.05]} />
            <meshStandardMaterial color="#a0aaa6" metalness={0.75} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
function DebrisBurst({
  at,
}: {
  at: { x: number; y: number; z: number; kind: string };
}) {
  const group = useRef<THREE.Group>(null),
    age = useRef(0);
  useFrame((_, dt) => {
    if (!group.current || age.current > 2) return;
    if (useFourWheeler3dStore.getState().isPaused) return;
    age.current += Math.min(dt, 0.1);
    group.current.visible = age.current < 2;
    group.current.children.forEach((p, i) => {
      const a = i * 2.399;
      p.position.set(
        Math.sin(a) * age.current * 2,
        Math.max(0.08, 1 + age.current * 2 - age.current * age.current * 3),
        Math.cos(a) * age.current * 2,
      );
      p.rotation.set(age.current * (i + 1), age.current, 0);
    });
  });
  return (
    <group ref={group} position={[at.x, at.y, at.z]}>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} castShadow>
          <boxGeometry
            args={at.kind === "tree" ? [0.13, 0.7, 0.14] : [0.25, 0.2, 0.3]}
          />
          <meshStandardMaterial
            color={at.kind === "tree" ? "#6d614b" : "#6d7168"}
          />
        </mesh>
      ))}
    </group>
  );
}

function MudVisual({
  patch: p,
}: {
  patch: { x: number; z: number; radius: number };
}) {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(
      p.radius * 2,
      p.radius * 2,
      16,
      16,
    ).rotateX(-Math.PI / 2);
    const a = g.attributes.position;
    for (let i = 0; i < a.count; i++) {
      let x = a.getX(i),
        z = a.getZ(i);
      const d = Math.hypot(x, z);
      if (d > p.radius) {
        x *= p.radius / d;
        z *= p.radius / d;
      }
      a.setXYZ(i, x, heightAt(x + p.x, z + p.z) + 0.035, z);
    }
    g.computeVertexNormals();
    return g;
  }, [p]);
  return (
    <mesh geometry={geometry} position={[p.x, 0, p.z]} receiveShadow>
      <meshPhysicalMaterial
        color="#493e28"
        roughness={0.24}
        clearcoat={0.6}
        transparent
        opacity={0.83}
        depthWrite={false}
      />
    </mesh>
  );
}

function WashNozzle() {
  const y = heightAt(NOZZLE.x, NOZZLE.z);
  return (
    <group position={[NOZZLE.x, y + 1.3, NOZZLE.z]}>
      {[0, 0.08, 0.16].map((z) => (
        <mesh key={z} position={[0, 0, z]}>
          <torusGeometry args={[0.35, 0.035, 8, 24]} />
          <meshStandardMaterial color="#313e39" roughness={0.85} />
        </mesh>
      ))}
      <mesh position={[0.36, -0.15, 0.13]} rotation={[0, 0, 0.45]}>
        <cylinderGeometry args={[0.045, 0.045, 0.42, 10]} />
        <meshStandardMaterial color="#b2b9b4" metalness={0.8} />
      </mesh>
    </group>
  );
}
function Snowman() {
  const x = WONDERLAND.x,
    z = WONDERLAND.z - 5,
    y = heightAt(x, z);
  return (
    <group position={[x, y, z]}>
      {[
        [0.55, 0.55],
        [1.28, 0.4],
        [1.86, 0.29],
      ].map(([h, r]) => (
        <mesh key={h} position={[0, h, 0]} castShadow>
          <sphereGeometry args={[r, 20, 16]} />
          <meshStandardMaterial color="#e0e8e2" roughness={1} />
        </mesh>
      ))}
      <mesh position={[0, 1.87, 0.36]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.055, 0.24, 12]} />
        <meshStandardMaterial color="#b77a3e" />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.1, 1.95, 0.255]}>
          <sphereGeometry args={[0.027, 8, 6]} />
          <meshStandardMaterial color="#313631" />
        </mesh>
      ))}
    </group>
  );
}

function GrassClippings() {
  const mesh = useRef<THREE.InstancedMesh>(null),
    { playerSpeedRef } = useGameContext(),
    dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const store = useFourWheeler3dStore.getState(),
      a = store.progress.adventure,
      car = a.fleet[a.activeVehicleId ?? ""],
      act = useActivitiesSession.getState().liveActivities ?? a.activities,
      trailer = car?.hitch ? a.fleet[car.hitch] : null,
      at = trailer ? trailerTransforms.get(trailer.id)?.position : undefined;
    m.visible = Boolean(
      at &&
      trailer?.type === "mower" &&
      act.mowerOn &&
      Math.abs(playerSpeedRef.current) > 0.3 &&
      !store.isPaused,
    );
    if (!m.visible || !at) return;
    for (let i = 0; i < 24; i++) {
      const t = (clock.elapsedTime * 2 + i / 24) % 1;
      dummy.position.set(
        at.x + Math.sin(i * 2.4) * (1 + t * 2),
        at.y + 0.1 + t * 2 - t * t * 2,
        at.z + Math.cos(i * 2.4) * t * 2,
      );
      dummy.rotation.set(t * 5, i, t * 7);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh
      ref={mesh}
      args={[undefined, undefined, 24]}
      frustumCulled={false}
    >
      <boxGeometry args={[0.04, 0.015, 0.18]} />
      <meshStandardMaterial color="#597944" roughness={1} />
    </instancedMesh>
  );
}
