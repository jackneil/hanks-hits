"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { ControlValues, OneShot } from "../lib/controls";
import { NEUTRAL } from "../lib/controls";
import { useFourWheeler3dStore } from "../lib/store";
import { useAdventureSession } from "../lib/adventureSession";
import { useGameContext } from "../lib/gameContext";
import { LANDMARKS } from "../lib/landmarks";
import { heightAt } from "../lib/terrain";
import { buyOffer } from "../lib/economy";
import { transact } from "../lib/transactions";
import {
  SPACE_HEIGHT,
  PLANET_RADIUS,
  PLANETS,
  collectSpaceGems,
  createMeteors,
  createPlanetSurface,
  createSpaceSession,
  landOnPlanet,
  leavePlanet,
  spacePosition,
  stepSpace,
  surfaceHeight,
  type PlanetId,
  type SpaceSession,
} from "../lib/space";

type Props = {
  getControls: () => ControlValues;
  takeOneShot?: (action: OneShot) => boolean;
};
const METEOR_SHAPES = createMeteors().map(({ id, radius }) => ({ id, radius }));

function setSpaceFov(camera: THREE.Camera) {
  const perspective = camera as THREE.PerspectiveCamera;
  if (perspective.isPerspectiveCamera && perspective.fov !== 58) {
    perspective.fov = 58;
    perspective.updateProjectionMatrix();
  }
}

function Rocket({ flight = false }: { flight?: boolean }) {
  return (
    <group name="hanks-rocket" rotation={[flight ? Math.PI / 2 : 0, 0, 0]}>
      <mesh position={[0, 2.9, 0]} castShadow>
        <cylinderGeometry args={[0.76, 0.85, 4.2, 24]} />
        <meshStandardMaterial
          color="#e5e7dd"
          metalness={0.62}
          roughness={0.27}
        />
      </mesh>
      <mesh position={[0, 5.55, 0]} castShadow>
        <coneGeometry args={[0.76, 1.35, 24]} />
        <meshStandardMaterial
          color="#bd432f"
          metalness={0.45}
          roughness={0.3}
        />
      </mesh>
      <mesh position={[0, 3.5, 0.765]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.31, 0.31, 0.08, 24]} />
        <meshStandardMaterial
          color="#467d9d"
          metalness={0.75}
          roughness={0.08}
        />
      </mesh>
      <mesh position={[0, 3.5, 0.81]}>
        <torusGeometry args={[0.33, 0.055, 8, 24]} />
        <meshStandardMaterial color="#7b898d" metalness={0.8} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <group key={i} rotation={[0, (i * Math.PI) / 2, 0]}>
          <mesh position={[0.92, 1.1, 0]} rotation={[0, 0, -0.25]} castShadow>
            <boxGeometry args={[0.55, 1.9, 0.09]} />
            <meshStandardMaterial color="#b34231" metalness={0.5} />
          </mesh>
          <mesh position={[0.84, 1.45, 0]}>
            <cylinderGeometry args={[0.055, 0.055, 1.35, 8]} />
            <meshStandardMaterial color="#687278" metalness={0.8} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 0.62, 0]}>
        <cylinderGeometry args={[0.45, 0.67, 0.65, 16, 1, true]} />
        <meshStandardMaterial
          color="#475158"
          metalness={0.85}
          side={THREE.DoubleSide}
        />
      </mesh>
      {flight && (
        <mesh position={[0, -0.9, 0]} rotation={[Math.PI, 0, 0]}>
          <coneGeometry args={[0.48, 2.5, 14]} />
          <meshBasicMaterial color="#ffba42" transparent opacity={0.82} />
        </mesh>
      )}
    </group>
  );
}

function Astronaut() {
  return (
    <group name="hank-space-explorer">
      <mesh position={[0, 1.05, 0]} scale={[0.34, 0.45, 0.22]} castShadow>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#d8dfd9" roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.67, 0]} castShadow>
        <sphereGeometry args={[0.3, 20, 16]} />
        <meshStandardMaterial color="#e6e8dc" metalness={0.4} />
      </mesh>
      <mesh position={[0, 1.69, 0.19]} scale={[0.24, 0.2, 0.15]}>
        <sphereGeometry args={[1, 20, 12]} />
        <meshStandardMaterial
          color="#b49345"
          metalness={0.8}
          roughness={0.13}
        />
      </mesh>
      <mesh position={[0, 1.05, -0.24]} castShadow>
        <boxGeometry args={[0.46, 0.6, 0.2]} />
        <meshStandardMaterial color="#919b9b" />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 0.17, 0.46, 0]}>
            <capsuleGeometry args={[0.14, 0.52, 6, 12]} />
            <meshStandardMaterial color="#d1d8d1" />
          </mesh>
          <mesh position={[side * 0.17, 0.12, 0.08]}>
            <boxGeometry args={[0.27, 0.23, 0.4]} />
            <meshStandardMaterial color="#566368" />
          </mesh>
          <mesh position={[side * 0.4, 1.1, 0]} rotation={[0, 0, side * 0.2]}>
            <capsuleGeometry args={[0.12, 0.43, 6, 12]} />
            <meshStandardMaterial color="#d1d8d1" />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 1.08, 0.22]}>
        <boxGeometry args={[0.26, 0.23, 0.04]} />
        <meshStandardMaterial color="#3f657a" />
      </mesh>
    </group>
  );
}

function Alien() {
  return (
    <group>
      <mesh position={[0, 0.65, 0]} scale={[0.25, 0.4, 0.18]}>
        <sphereGeometry args={[1, 12, 10]} />
        <meshStandardMaterial color="#789b63" />
      </mesh>
      <mesh position={[0, 1.13, 0]} scale={[0.39, 0.31, 0.28]}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#93bd79" />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh
            position={[side * 0.13, 1.17, 0.24]}
            scale={[0.09, 0.13, 0.035]}
            rotation={[0, 0, side * -0.2]}
          >
            <sphereGeometry args={[1, 12, 10]} />
            <meshStandardMaterial color="#253d3c" roughness={0.2} />
          </mesh>
          <mesh position={[side * 0.13, 0.2, 0]}>
            <capsuleGeometry args={[0.07, 0.3, 5, 8]} />
            <meshStandardMaterial color="#789b63" />
          </mesh>
          <mesh
            position={[side * 0.27, 0.64, 0]}
            rotation={[0, 0, side * 0.28]}
          >
            <capsuleGeometry args={[0.06, 0.3, 5, 8]} />
            <meshStandardMaterial color="#789b63" />
          </mesh>
          <mesh
            position={[side * 0.19, 1.52, 0]}
            rotation={[0, 0, -side * 0.4]}
          >
            <cylinderGeometry args={[0.025, 0.025, 0.32, 6]} />
            <meshStandardMaterial color="#93bd79" />
          </mesh>
          <mesh position={[side * 0.25, 1.68, 0]}>
            <sphereGeometry args={[0.05, 8, 6]} />
            <meshStandardMaterial
              color="#c2db8d"
              emissive="#93a34e"
              emissiveIntensity={0.3}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Surface({
  planet,
  collected,
  reducedMotion,
}: {
  planet: PlanetId;
  collected: string[];
  reducedMotion: boolean;
}) {
  const config = PLANETS.find((p) => p.id === planet)!;
  const surface = useMemo(() => createPlanetSurface(planet), [planet]);
  const gems = useRef<(THREE.Mesh | null)[]>([]),
    aliens = useRef<(THREE.Group | null)[]>([]);
  const ground = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    // Concentric rings retain enough vertices for the undulating surface.
    const positions: number[] = [],
      indices: number[] = [],
      rings = 48,
      slices = 128;
    for (let r = 0; r <= rings; r++)
      for (let i = 0; i <= slices; i++) {
        const a = (i / slices) * Math.PI * 2,
          x = ((Math.cos(a) * r) / rings) * PLANET_RADIUS,
          z = ((Math.sin(a) * r) / rings) * PLANET_RADIUS;
        positions.push(x, surfaceHeight(x, z), z);
      }
    for (let r = 0; r < rings; r++)
      for (let i = 0; i < slices; i++) {
        const a = r * (slices + 1) + i,
          b = a + slices + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }, []);
  useEffect(() => () => ground.dispose(), [ground]);
  useFrame(({ clock }) => {
    const time = reducedMotion ? 0 : clock.elapsedTime;
    gems.current.forEach((g) => {
      if (g) g.rotation.y = time * 1.2;
    });
    aliens.current.forEach((g, i) => {
      if (g) {
        const a = surface.aliens[i],
          x = a.x + Math.sin(time * 0.22 + a.phase) * 2,
          z = a.z + Math.cos(time * 0.17 + a.phase) * 2;
        g.position.set(x, surfaceHeight(x, z), z);
        g.rotation.y = time * 0.15 + a.phase;
      }
    });
  });
  return (
    <group name={`${planet}-explorable-surface`}>
      <mesh geometry={ground} receiveShadow>
        <meshStandardMaterial color={config.color} roughness={1} />
      </mesh>
      {surface.rocks.map((rock, i) => (
        <group
          key={rock.id}
          position={[rock.x, surfaceHeight(rock.x, rock.z), rock.z]}
        >
          <mesh
            position={[0, rock.radius * 0.45, 0]}
            scale={[rock.radius, rock.radius * 0.7, rock.radius * 0.85]}
            rotation={[i * 0.7, i * 1.3, i * 0.35]}
            castShadow
          >
            <dodecahedronGeometry args={[1, 1]} />
            <meshStandardMaterial color={config.dark} roughness={1} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
            <ringGeometry args={[rock.radius * 1.1, rock.radius * 1.55, 20]} />
            <meshStandardMaterial
              color={config.dark}
              transparent
              opacity={0.35}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
      {surface.gems.map((g, i) => (
        <mesh
          key={g.id}
          ref={(el) => {
            gems.current[i] = el;
          }}
          position={[g.x, surfaceHeight(g.x, g.z) + 1, g.z]}
          visible={!collected.includes(g.id)}
          scale={[0.65, 1.1, 0.65]}
        >
          <octahedronGeometry args={[1]} />
          <meshStandardMaterial
            color="#83e2e9"
            metalness={0.55}
            roughness={0.12}
            emissive="#41abb9"
            emissiveIntensity={0.6}
          />
        </mesh>
      ))}
      {surface.aliens.map((a, i) => (
        <group
          key={a.id}
          ref={(el) => {
            aliens.current[i] = el;
          }}
        >
          <Alien />
        </group>
      ))}
      <group
        position={[
          0,
          surfaceHeight(0, PLANET_RADIUS * 0.6),
          PLANET_RADIUS * 0.6,
        ]}
      >
        <Rocket />
        <Html position={[0, 7, 0]} center distanceFactor={25}>
          <span className="rounded bg-slate-950/80 px-2 py-1 text-xs text-white">
            Your rocket
          </span>
        </Html>
      </group>
      <mesh position={[0, 1.5, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 3, 8]} />
        <meshStandardMaterial color="#b3bfc0" metalness={0.7} />
      </mesh>
      <mesh position={[0.6, 2.5, 0]}>
        <boxGeometry args={[1.2, 0.7, 0.035]} />
        <meshStandardMaterial color="#c9543c" />
      </mesh>
    </group>
  );
}

export function Space({ getControls, takeOneShot }: Props) {
  const mode = useFourWheeler3dStore((s) => s.mode),
    owned = useFourWheeler3dStore((s) => s.progress.adventure.rocketOwned);
  const savedGems = useFourWheeler3dStore(
    (s) => s.progress.adventure.space.gems,
  );
  const flight = useRef<SpaceSession | null>(null),
    meteors = useRef(createMeteors()),
    rocket = useRef<THREE.Group>(null),
    avatar = useRef<THREE.Group>(null),
    rocks = useRef<(THREE.Group | null)[]>([]);
  const seenAction = useRef(0),
    publish = useRef(0),
    gemClock = useRef(0);
  const [planet, setPlanet] = useState<PlanetId | null>(null),
    [reducedMotion, setReducedMotion] = useState(false);
  const camera = useThree((s) => s.camera);
  const { playerPos, playerQuat, playerSpeedRef } = useGameContext();
  const active = mode === "space" || mode === "planet";
  const stars = useMemo(
    () =>
      new Float32Array(
        Array.from({ length: 260 }, (_, i) => {
          const a = i * 2.399963,
            y = 0.1 + (i / 260) * 0.85,
            r = 650 * Math.sqrt(1 - y * y);
          return [Math.cos(a) * r, y * 650, Math.sin(a) * r];
        }).flat(),
      ),
    [],
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)"),
      update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(
    () => () => useAdventureSession.setState({ spaceflight: null }),
    [],
  );
  useEffect(() => {
    // Route navigation can remount the canvas while the nonpersistent mode survives.
    // Recover to the pad instead of leaving a camera in space with no live ship.
    const store = useFourWheeler3dStore.getState();
    if (["space", "planet"].includes(store.mode) && !flight.current) {
      const x = LANDMARKS.launchPad.x,
        z = LANDMARKS.launchPad.z + 130 / 18;
      store.setMode("foot");
      useAdventureSession.setState({ spaceflight: null, panel: null });
      useAdventureSession
        .getState()
        .relocate({ x, y: heightAt(x, z) + 0.1, z }, Math.PI);
    }
  }, []);
  const returnHome = () => {
    const s = useAdventureSession.getState(),
      x = LANDMARKS.launchPad.x,
      z = LANDMARKS.launchPad.z + 130 / 18;
    flight.current = null;
    setPlanet(null);
    useAdventureSession.setState({ spaceflight: null, panel: null });
    useFourWheeler3dStore.getState().setMode("foot");
    s.relocate({ x, y: heightAt(x, z) + 0.1, z }, Math.PI);
  };
  const land = (id: PlanetId) => {
    flight.current = landOnPlanet(id);
    setPlanet(id);
    const store = useFourWheeler3dStore.getState();
    store.setMode("planet");
    store.updateProgress((p) => ({
      ...p,
      adventure: {
        ...p.adventure,
        space: {
          ...p.adventure.space,
          visited: [...new Set([...p.adventure.space.visited, id])],
        },
      },
    }));
    useAdventureSession.setState({ spaceflight: flight.current, panel: null });
    store.setHint(
      `Landed on ${PLANETS.find((p) => p.id === id)!.name}. Explore for gems, then walk back to your rocket.`,
    );
  };
  // The subscription reads refs and latest stores; action identities are consumed once.
  useEffect(() => {
    const handle = () => {
      const s = useAdventureSession.getState(),
        action = s.action,
        store = useFourWheeler3dStore.getState();
      if (
        !action ||
        action.id === seenAction.current ||
        !action.name.startsWith("space:")
      )
        return;
      seenAction.current = action.id;
      if (store.isPaused || !store.hasStarted) return;
      const command = action.name.slice(6);
      if (command === "buy") {
        transact((p) => buyOffer(p, "flyStore:rocket", s.playerSnapshot));
        return;
      }
      if (!store.progress.adventure.rocketOwned) {
        store.setHint("The rocket costs $500,000 at the Flying Store.");
        return;
      }
      if (command === "launch") {
        if (
          store.mode !== "foot" ||
          Math.hypot(
            s.playerSnapshot.x - LANDMARKS.launchPad.x,
            s.playerSnapshot.z - LANDMARKS.launchPad.z,
          ) >
            130 / 18
        ) {
          store.setHint("Walk to your rocket at the launch pad first.");
          return;
        }
        flight.current = createSpaceSession();
        meteors.current = createMeteors();
        setPlanet(null);
        store.setMode("space");
        useAdventureSession.setState({
          spaceflight: flight.current,
          panel: null,
          scope: false,
        });
        store.setHint(
          "Blast off. Steer toward a planet and dodge the meteorites.",
        );
      } else if (command === "return" && store.mode === "space") {
        returnHome();
        store.setHint("Touchdown at your launch pad.");
      } else if (
        command === "land" &&
        store.mode === "space" &&
        flight.current?.nearPlanet
      )
        land(flight.current.nearPlanet);
      else if (
        command === "board" &&
        store.mode === "planet" &&
        flight.current
      ) {
        const next = leavePlanet(flight.current);
        if (!next) {
          store.setHint("Walk closer to your rocket to leave.");
          return;
        }
        flight.current = next;
        setPlanet(null);
        store.setMode("space");
        useAdventureSession.setState({ spaceflight: next, panel: null });
        store.setHint(
          "Back in orbit. Fly to another world or return to Earth.",
        );
      }
    };
    return useAdventureSession.subscribe(handle);
  }, []);
  useFrame((_, dt) => {
    const store = useFourWheeler3dStore.getState();
    if (!active || !flight.current || !store.hasStarted || store.isPaused)
      return;
    if (takeOneShot?.("interact")) {
      useAdventureSession
        .getState()
        .requestAction(
          flight.current.phase === "surface" ? "space:board" : "space:land",
        );
    }
    const controls = useAdventureSession.getState().panel
      ? NEUTRAL
      : getControls();
    const stepped = stepSpace(flight.current, meteors.current, controls, dt);
    flight.current = stepped.state;
    if (stepped.crash) {
      returnHome();
      store.setHint(
        "A meteor bumped your rocket. You're safely back on Earth.",
      );
      return;
    }
    if (stepped.landed) land(stepped.landed);
    const state = flight.current!,
      p = spacePosition(state);
    playerPos.current.set(p.x, p.y, p.z);
    playerQuat.current.setFromAxisAngle(
      THREE.Object3D.DEFAULT_UP,
      state.heading,
    );
    playerSpeedRef.current = state.speed;
    if (rocket.current) {
      rocket.current.position.set(state.x, 0, state.z);
      rocket.current.rotation.y = state.heading;
    }
    if (avatar.current) {
      avatar.current.position.set(
        state.x,
        surfaceHeight(state.x, state.z),
        state.z,
      );
      avatar.current.rotation.y = state.heading;
    }
    rocks.current.forEach((g, i) => {
      if (g) {
        const m = meteors.current[i];
        g.position.set(m.x, 0, m.z);
        g.rotation.set(m.spin * 0.4, m.spin, 0);
      }
    });
    // A fixed north-up camera makes the eight-direction surface controls predictable.
    if (state.phase === "flight") {
      camera.position.set(p.x, SPACE_HEIGHT + 105, p.z + 62);
      camera.lookAt(p.x, SPACE_HEIGHT, p.z);
    } else {
      camera.position.set(p.x, p.y + 15, p.z + 19);
      camera.lookAt(p.x, p.y + 0.8, p.z);
    }
    setSpaceFov(camera);
    gemClock.current += dt;
    if (state.phase === "surface" && gemClock.current >= 0.05) {
      gemClock.current = 0;
      const result = collectSpaceGems(store.progress.adventure, state);
      if (result.reward) {
        store.updateProgress((p) => {
          const fresh = collectSpaceGems(p.adventure, state);
          return {
            ...p,
            adventure: fresh.adventure,
            money: p.money + fresh.reward,
            totalEarned: p.totalEarned + fresh.reward,
          };
        });
        store.setHint(`Space gem! +$${result.reward.toLocaleString("en-US")}`);
      }
    }
    publish.current += dt;
    if (publish.current >= 0.1) {
      publish.current = 0;
      useAdventureSession.setState({
        spaceflight: { ...state },
        playerSnapshot: { ...p, heading: state.heading, speed: state.speed },
      });
    }
  });
  if (!active)
    return owned ? (
      <group
        name="launch-pad-rocket"
        position={[
          LANDMARKS.launchPad.x,
          heightAt(LANDMARKS.launchPad.x, LANDMARKS.launchPad.z),
          LANDMARKS.launchPad.z,
        ]}
      >
        <Rocket />
      </group>
    ) : null;
  return (
    <>
      <color attach="background" args={["#030610"]} />
      <group name="outer-space" position={[0, SPACE_HEIGHT, 0]}>
        <ambientLight intensity={0.9} />
        <directionalLight
          position={[-120, 180, -100]}
          intensity={2.3}
          color="#fff0d9"
        />
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[stars, 3]} />
          </bufferGeometry>
          <pointsMaterial color="#dae4f0" size={1.1} sizeAttenuation />
        </points>
        {planet ? (
          <>
            <Surface
              planet={planet}
              collected={savedGems[planet] ?? []}
              reducedMotion={reducedMotion}
            />
            <group ref={avatar}>
              <Astronaut />
            </group>
          </>
        ) : (
          <>
            {PLANETS.map((p) => (
              <group key={p.id} position={[p.x, 0, p.z]}>
                <mesh>
                  <sphereGeometry args={[p.radius, 48, 32]} />
                  <meshStandardMaterial color={p.color} roughness={0.9} />
                </mesh>
                {Array.from({ length: 7 }, (_, i) => {
                  const a = i * 2.4,
                    x = Math.cos(a) * p.radius * 0.6,
                    z = Math.sin(a) * p.radius * 0.6;
                  return (
                    <mesh
                      key={i}
                      position={[
                        x,
                        Math.sqrt(p.radius * p.radius - x * x - z * z) * 1.003,
                        z,
                      ]}
                      rotation={[-Math.PI / 2, 0, a]}
                    >
                      <circleGeometry
                        args={[p.radius * (0.05 + (i % 3) * 0.025), 14]}
                      />
                      <meshStandardMaterial color={p.dark} roughness={1} />
                    </mesh>
                  );
                })}
                {p.ring && (
                  <mesh rotation={[-Math.PI / 2 + 0.25, 0, 0]}>
                    <ringGeometry
                      args={[p.radius * 1.25, p.radius * 1.65, 64]}
                    />
                    <meshStandardMaterial
                      color="#b69e73"
                      transparent
                      opacity={0.8}
                      side={THREE.DoubleSide}
                    />
                  </mesh>
                )}
                <Html
                  position={[0, p.radius + 5, 0]}
                  center
                  distanceFactor={85}
                >
                  <span className="rounded bg-slate-950/75 px-2 py-1 text-xs font-bold text-white">
                    {p.name}
                  </span>
                </Html>
              </group>
            ))}
            {METEOR_SHAPES.map((m, i) => (
              <group
                key={m.id}
                ref={(el) => {
                  rocks.current[i] = el;
                }}
              >
                <mesh scale={[m.radius, m.radius * 0.8, m.radius * 1.1]}>
                  <dodecahedronGeometry args={[1, 1]} />
                  <meshStandardMaterial color="#786c5f" roughness={1} />
                </mesh>
                <mesh
                  scale={[m.radius * 1.13, m.radius * 0.93, m.radius * 1.23]}
                >
                  <icosahedronGeometry args={[1, 1]} />
                  <meshBasicMaterial
                    color="#e78539"
                    transparent
                    opacity={0.13}
                    depthWrite={false}
                  />
                </mesh>
              </group>
            ))}
            <group ref={rocket}>
              <Rocket flight />
            </group>
          </>
        )}
      </group>
    </>
  );
}

export default Space;
