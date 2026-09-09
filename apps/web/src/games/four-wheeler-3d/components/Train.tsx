"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useGameContext } from "../lib/gameContext";
import { useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import { buyOffer } from "../lib/economy";
import { transact } from "../lib/transactions";
import { heightAt } from "../lib/terrain";
import type { ControlValues, OneShot } from "../lib/controls";
import {
  RAIL_TRACKS,
  RAIL_BOARD_RANGE,
  RAIL_STOPS,
  createRailSession,
  boardTrain,
  gapHeight,
  railPose,
  routeTrain,
  sampleTrack,
  stepTrain,
  toggleSkyTrack,
  type RailPath,
  type RailSession,
  type RailStop,
} from "../lib/rail";

type Props = {
  getControls: () => ControlValues;
  takeOneShot?: (action: OneShot) => boolean;
};
const worldPose = (state: RailSession) => {
  const p = railPose(state);
  return { ...p, y: heightAt(p.x, p.z) + p.y + 0.35 };
};
const telemetry = (state: RailSession): RailSession => ({
  ...state,
  position: worldPose(state),
});

/** The rails and sleepers are six instanced draws across the entire world. */
function Track({ path }: { path: RailPath }) {
  const rails = useRef<THREE.InstancedMesh>(null),
    sleepers = useRef<THREE.InstancedMesh>(null);
  const data = useMemo(() => {
    const t = RAIL_TRACKS[path],
      segments: {
        position: THREE.Vector3;
        quaternion: THREE.Quaternion;
        length: number;
      }[] = [];
    for (let i = 0; i < t.points.length - (t.closed ? 0 : 1); i++) {
      const j = (i + 1) % t.points.length;
      if (path === "loop" && gapHeight(t.cumulative[i]) > 0.01) continue;
      const a = t.points[i],
        b = t.points[j];
      const start = new THREE.Vector3(
          a.x,
          heightAt(a.x, a.z) + a.y + 0.22,
          a.z,
        ),
        end = new THREE.Vector3(b.x, heightAt(b.x, b.z) + b.y + 0.22, b.z);
      const direction = end.clone().sub(start);
      segments.push({
        position: start.clone().add(end).multiplyScalar(0.5),
        quaternion: new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          direction.clone().normalize(),
        ),
        length: direction.length(),
      });
    }
    return segments;
  }, [path]);
  useLayoutEffect(() => {
    const object = new THREE.Object3D(),
      offset = new THREE.Vector3();
    data.forEach((s, i) => {
      for (const [side, index] of [
        [-1, i * 2],
        [1, i * 2 + 1],
      ]) {
        offset.set(side * 0.72, 0, 0).applyQuaternion(s.quaternion);
        object.position.copy(s.position).add(offset);
        object.quaternion.copy(s.quaternion);
        object.scale.set(0.09, 0.12, s.length + 0.03);
        object.updateMatrix();
        rails.current?.setMatrixAt(index, object.matrix);
      }
      object.position.copy(s.position);
      object.position.y -= 0.1;
      object.quaternion.copy(s.quaternion);
      object.scale.set(2.1, 0.13, 0.3);
      object.updateMatrix();
      sleepers.current?.setMatrixAt(i, object.matrix);
    });
    for (const mesh of [rails.current, sleepers.current])
      if (mesh) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
  }, [data]);
  return (
    <group name={`${path}-railway`}>
      <instancedMesh ref={rails} args={[undefined, undefined, data.length * 2]}>
        <boxGeometry />
        <meshStandardMaterial
          color={path === "sky" ? "#abbfc5" : "#747b79"}
          metalness={0.82}
          roughness={0.32}
        />
      </instancedMesh>
      <instancedMesh ref={sleepers} args={[undefined, undefined, data.length]}>
        <boxGeometry />
        <meshStandardMaterial
          color={path === "sky" ? "#647b88" : "#584633"}
          roughness={0.9}
        />
      </instancedMesh>
    </group>
  );
}

function TrainModel({ engine }: { engine: boolean }) {
  return (
    <group name={engine ? "diesel-locomotive" : "passenger-carriage"}>
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[2.5, 0.6, 7.5]} />
        <meshStandardMaterial color="#20272b" metalness={0.6} roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.9, engine ? -0.5 : 0]} castShadow>
        <boxGeometry args={[2.35, 1.9, engine ? 5 : 6.9]} />
        <meshStandardMaterial
          color={engine ? "#b8472f" : "#bfc3b9"}
          metalness={0.45}
          roughness={0.4}
        />
      </mesh>
      <mesh
        position={[0, 2.94, engine ? -0.5 : 0]}
        scale={[1.2, 0.17, engine ? 2.6 : 3.5]}
        castShadow
      >
        <sphereGeometry args={[1, 16, 10]} />
        <meshStandardMaterial color="#454c4c" metalness={0.7} />
      </mesh>
      {engine && (
        <>
          <mesh position={[0, 2.28, 2.45]} castShadow>
            <boxGeometry args={[2.4, 2.7, 2.2]} />
            <meshStandardMaterial color="#d09939" metalness={0.35} />
          </mesh>
          <mesh position={[0, 3.05, 3.565]}>
            <boxGeometry args={[1.9, 0.7, 0.035]} />
            <meshStandardMaterial
              color="#91acb5"
              metalness={0.5}
              roughness={0.15}
            />
          </mesh>
          <mesh position={[0, 1.05, 3.9]} rotation={[0.3, 0, 0]}>
            <boxGeometry args={[2.6, 0.85, 0.16]} />
            <meshStandardMaterial color="#a0a29b" metalness={0.7} />
          </mesh>
          <mesh position={[0, 3.08, -1.6]}>
            <cylinderGeometry args={[0.22, 0.28, 0.7, 12]} />
            <meshStandardMaterial color="#30383a" metalness={0.8} />
          </mesh>
          {[-0.75, 0.75].map((x) => (
            <mesh
              key={x}
              position={[x, 2.22, 3.58]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <cylinderGeometry args={[0.17, 0.17, 0.08, 12]} />
              <meshStandardMaterial
                color="#fff5ce"
                emissive="#fff3bf"
                emissiveIntensity={1.1}
              />
            </mesh>
          ))}
        </>
      )}
      {[-1, 1].map((side) => (
        <group key={side}>
          {[-2.45, -1.65, 1.65, 2.45].map((z) => (
            <mesh
              key={z}
              position={[side * 1.12, 0.4, z]}
              rotation={[0, 0, Math.PI / 2]}
              castShadow
            >
              <cylinderGeometry args={[0.42, 0.42, 0.25, 16]} />
              <meshStandardMaterial
                color="#303638"
                metalness={0.8}
                roughness={0.5}
              />
            </mesh>
          ))}
          {(engine ? [-2, -1, 0] : [-2.4, -1.2, 0, 1.2, 2.4]).map((z) => (
            <mesh key={z} position={[side * 1.18, 2.3, z]}>
              <boxGeometry args={[0.035, engine ? 0.7 : 0.85, 0.8]} />
              <meshStandardMaterial
                color={engine ? "#342f2a" : "#6b929b"}
                metalness={0.65}
                roughness={0.18}
              />
            </mesh>
          ))}
          <mesh position={[side * 1.21, 1.28, 0]}>
            <boxGeometry args={[0.04, 0.14, 6.8]} />
            <meshStandardMaterial color="#dcad41" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.85, -4.15]}>
        <boxGeometry args={[0.4, 0.24, 1.1]} />
        <meshStandardMaterial color="#424849" metalness={0.8} />
      </mesh>
    </group>
  );
}

export function Train({ getControls, takeOneShot }: Props) {
  const owned = useFourWheeler3dStore((s) => s.progress.adventure.trainOwned);
  const mode = useFourWheeler3dStore((s) => s.mode);
  const train = useRef(createRailSession()),
    groups = useRef<(THREE.Group | null)[]>([]),
    seenAction = useRef(0),
    publish = useRef(0),
    boost = useRef(0);
  const { playerPos, playerQuat, playerSpeedRef } = useGameContext();
  useEffect(() => {
    train.current = createRailSession();
    useAdventureSession.setState({ rail: telemetry(train.current) });
    return () => useAdventureSession.setState({ rail: null });
  }, []);
  useEffect(() => {
    const handle = () => {
      const session = useAdventureSession.getState(),
        action = session.action,
        store = useFourWheeler3dStore.getState();
      if (
        !action ||
        action.id === seenAction.current ||
        !action.name.startsWith("rail:")
      )
        return;
      seenAction.current = action.id;
      if (store.isPaused || !store.hasStarted) return;
      const command = action.name.slice(5);
      if (command === "buy") {
        transact((p) => buyOffer(p, "anyStore:train", session.playerSnapshot));
        return;
      }
      if (!store.progress.adventure.trainOwned) {
        store.setHint("Buy the train for $110,000 at the Everything Store.");
        return;
      }
      if (command === "board") {
        const p = worldPose(train.current),
          at = session.playerSnapshot;
        if (
          store.mode !== "foot" ||
          Math.hypot(p.x - at.x, p.z - at.z, p.y - at.y) > RAIL_BOARD_RANGE
        ) {
          store.setHint("Walk closer to the train to climb aboard.");
          return;
        }
        train.current = boardTrain(train.current);
        useAdventureSession.setState({ panel: null, scope: false });
        store.setMode("train");
        store.setHint("All aboard. Use gas and brake, or choose a station.");
      } else if (store.mode !== "train") {
        store.setHint("Climb aboard the train first.");
        return;
      } else if (command === "exit") {
        const p = worldPose(train.current),
          x = p.x + Math.cos(p.heading) * 4.45,
          z = p.z - Math.sin(p.heading) * 4.45;
        train.current = routeTrain(train.current, "fence", true);
        store.setMode("foot");
        session.relocate({ x, y: heightAt(x, z) + 0.2, z }, p.heading);
        session.openPanel(null);
        store.setHint("The train is heading home to Fence Station.");
      } else if (
        command === "route" &&
        RAIL_STOPS.includes(action.payload as RailStop)
      ) {
        train.current = routeTrain(train.current, action.payload as RailStop);
        session.openPanel(null);
        store.setHint(
          `Next stop: ${action.payload === "fence" ? "Fence Station" : `${action.payload} station`}.`,
        );
      } else if (command === "sky") {
        train.current = toggleSkyTrack(train.current);
        session.openPanel(null);
        store.setHint(
          train.current.path === "sky"
            ? "Sky track: three loops above the countryside."
            : "Back on the ground railway.",
        );
      } else if (command === "boost") {
        boost.current = 3;
        session.openPanel(null);
        store.setHint("Train boost! Three seconds of extra speed.");
      } else if (command === "stop")
        train.current = {
          ...train.current,
          speed: 0,
          target: null,
          returning: false,
        };
      useAdventureSession.setState({ rail: telemetry(train.current) });
    };
    return useAdventureSession.subscribe(handle);
  }, []);
  useFrame((_, dt) => {
    const store = useFourWheeler3dStore.getState();
    if (!store.hasStarted || store.isPaused || !owned) return;
    const driving = store.mode === "train",
      controls = driving ? getControls() : null;
    if (driving && takeOneShot?.("nos")) boost.current = 3;
    boost.current = Math.max(0, boost.current - dt);
    const previousTarget = train.current.target;
    train.current = stepTrain(
      train.current,
      controls?.throttle ?? 0,
      controls ? Math.max(controls.brake, controls.handbrake ? 1 : 0) : 0,
      dt,
      boost.current > 0,
    );
    if (previousTarget && !train.current.target)
      store.setHint(
        `Arrived at ${previousTarget === "fence" ? "Fence Station" : `${previousTarget} station`}.`,
      );
    for (let i = 0; i < groups.current.length; i++) {
      const group = groups.current[i];
      if (!group) continue;
      const pose = worldPose({
        ...train.current,
        distance: train.current.distance - train.current.direction * i * 8.6,
      });
      group.position.set(pose.x, pose.y, pose.z);
      group.rotation.y = pose.heading;
    }
    if (driving) {
      const p = worldPose(train.current);
      playerPos.current.set(p.x, p.y + 2.2, p.z);
      playerQuat.current.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.heading);
      playerSpeedRef.current = train.current.speed;
    }
    publish.current += dt;
    if (publish.current >= 0.1) {
      publish.current = 0;
      const rail = telemetry(train.current);
      useAdventureSession.setState({
        rail,
        ...(driving
          ? {
              playerSnapshot: {
                ...rail.position,
                y: rail.position.y + 2.2,
                heading: rail.heading,
                speed: rail.speed,
              },
            }
          : {}),
      });
    }
  });
  const stations = useMemo(
    () =>
      RAIL_STOPS.map((name, i) => ({
        name,
        ...(name === "fence"
          ? sampleTrack(RAIL_TRACKS.spur, RAIL_TRACKS.spur.length)
          : sampleTrack(RAIL_TRACKS.loop, (i * RAIL_TRACKS.loop.length) / 4)),
      })),
    [],
  );
  if (["space", "planet"].includes(mode)) return null;
  return (
    <group name="hanks-railway">
      {(["loop", "spur", "sky"] as const).map((path) => (
        <Track key={path} path={path} />
      ))}
      {stations.map((s) => (
        <group
          key={s.name}
          position={[s.x, heightAt(s.x, s.z), s.z]}
          rotation={[0, s.heading, 0]}
        >
          <mesh position={[4, 0.45, 0]} receiveShadow>
            <boxGeometry args={[4, 0.9, 18]} />
            <meshStandardMaterial color="#8c887b" roughness={1} />
          </mesh>
          <mesh position={[4, 3.7, 0]} castShadow>
            <boxGeometry args={[4.8, 0.25, 12]} />
            <meshStandardMaterial color="#3f5a52" metalness={0.5} />
          </mesh>
          {[-5, 5].map((z) => (
            <mesh key={z} position={[5.3, 2.1, z]}>
              <cylinderGeometry args={[0.09, 0.09, 3.4, 8]} />
              <meshStandardMaterial color="#4b5b55" />
            </mesh>
          ))}
          <Html
            position={[4, 4.35, 0]}
            center
            zIndexRange={[10, 0]}
            style={{ pointerEvents: "none" }}
          >
            <div className="whitespace-nowrap rounded bg-slate-900/90 px-3 py-1 text-xs font-bold capitalize text-white">
              {s.name} Station
            </div>
          </Html>
        </group>
      ))}
      {owned &&
        [0, 1, 2].map((i) => (
          <group
            key={i}
            ref={(el) => {
              groups.current[i] = el;
            }}
          >
            <TrainModel engine={i === 0} />
          </group>
        ))}
    </group>
  );
}

export default Train;
