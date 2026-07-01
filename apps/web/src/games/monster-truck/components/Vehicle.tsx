'use client';

import { useRef, useEffect, useState, forwardRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RigidBody, CuboidCollider, useRapier } from '@react-three/rapier';
import type { RapierRigidBody } from '@react-three/rapier';
import * as THREE from 'three';
import { PHYSICS, BONUSES, LAKES } from '../lib/constants';
import { useGameStore } from '../lib/store';
import { sounds } from '../lib/sounds';
import type { ControlValues } from '../hooks/useControls';

interface VehicleProps {
  position?: [number, number, number];
  rotation?: number;  // Y-axis rotation in radians
  getControls: () => ControlValues;
  onCollect?: (type: 'coin' | 'star' | 'mystery') => void;
}

export const Vehicle = forwardRef<RapierRigidBody, VehicleProps>(
  function Vehicle({ position = [0, 5, 0], rotation = 0, getControls }, ref) {
  const bodyRef = useRef<RapierRigidBody>(null);

  // Expose bodyRef to parent for speed tracking
  // Update on every frame to ensure ref is always current
  useEffect(() => {
    if (ref && bodyRef.current) {
      if (typeof ref === 'function') {
        ref(bodyRef.current);
      } else {
        (ref as React.MutableRefObject<RapierRigidBody | null>).current = bodyRef.current;
      }
    }
  });
  const meshRef = useRef<THREE.Group>(null);

  const { world, rapier } = useRapier();

  // Get truck stats from store
  const currentTruckId = useGameStore((s) => s.currentTruckId);
  const getTruckStats = useGameStore((s) => s.getTruckStats);
  const customization = useGameStore((s) => s.customization);
  const nosCharge = useGameStore((s) => s.nosCharge);
  const drainNos = useGameStore((s) => s.useNos);
  const rechargeNos = useGameStore((s) => s.rechargeNos);
  const addAirtime = useGameStore((s) => s.addAirtime);
  const addFlip = useGameStore((s) => s.addFlip);
  const addCoins = useGameStore((s) => s.addCoins);

  const stats = getTruckStats(currentTruckId);
  const truckColor = customization[currentTruckId]?.paintColor || '#e74c3c';

  // Wheel rotation state
  const [wheelRotation, setWheelRotation] = useState(0);
  const [steeringAngle, setSteeringAngle] = useState(0);

  // Flip detection
  const lastRotation = useRef(new THREE.Euler());
  const totalRotation = useRef(0);
  const isAirborne = useRef(false);
  const airborneTime = useRef(0);

  // Flip recovery timer
  const flipTimer = useRef(0);

  // Reset truck position
  const resetTruck = () => {
    if (!bodyRef.current) return;
    bodyRef.current.setTranslation({ x: position[0], y: position[1] + 2, z: position[2] }, true);
    bodyRef.current.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
    bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
    flipTimer.current = 0;
    totalRotation.current = 0;
  };

  useFrame((_, delta) => {
    if (!bodyRef.current) return;

    const controls = getControls();
    const body = bodyRef.current;

    // Get current state
    const pos = body.translation();
    const rot = body.rotation();
    const vel = body.linvel();

    // Convert quaternion to euler for easier calculations
    const euler = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w)
    );

    // Get forward direction using YAW ONLY (ignore pitch/roll from terrain bumps)
    // This prevents velocity from jerking when truck bounces on uneven terrain
    const yaw = Math.atan2(
      2 * (rot.w * rot.y + rot.x * rot.z),
      1 - 2 * (rot.y * rot.y + rot.x * rot.x)
    );
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

    // Right direction also yaw-only for consistency
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    // Check if we're grounded (raycast from chassis level, not RigidBody origin)
    // The chassis collider is offset above the RigidBody origin, so we need to
    // start the ray from the actual chassis position
    const chassisOffset = PHYSICS.TRUCK.CHASSIS_HEIGHT / 2 + PHYSICS.TRUCK.WHEEL_RADIUS;
    const rayOrigin = new rapier.Vector3(pos.x, pos.y + chassisOffset, pos.z);
    const rayDir = new rapier.Vector3(0, -1, 0);
    const maxToi = chassisOffset + 1.5; // Increased margin for ground detection
    const ray = new rapier.Ray(rayOrigin, rayDir);
    const hit = world.castRay(
      ray,
      maxToi,
      true,
      undefined,
      undefined,
      undefined,
      body
    );
    const grounded = hit !== null && hit.timeOfImpact < maxToi;

    // Handle reset
    if (controls.reset) {
      resetTruck();
      return;
    }

    // Track airborne state
    if (!grounded) {
      if (!isAirborne.current) {
        isAirborne.current = true;
        airborneTime.current = 0;
      }
      airborneTime.current += delta;

      // Track rotation for flip detection
      const rotDiff = Math.abs(euler.x - lastRotation.current.x);
      totalRotation.current += rotDiff;

      // Check for flip completion
      if (totalRotation.current >= BONUSES.FLIP.ROTATION_THRESHOLD) {
        addFlip();
        addCoins(50);
        sounds.playFlip();
        totalRotation.current = 0;
      }
    } else {
      if (isAirborne.current && airborneTime.current > 0.5) {
        // Award airtime bonus
        const airtimeBonus = Math.floor(airborneTime.current * 5);
        if (airtimeBonus > 0) {
          addCoins(airtimeBonus);
          addAirtime(airborneTime.current);
        }
        sounds.playLanding();
      }
      isAirborne.current = false;
      airborneTime.current = 0;
      totalRotation.current = 0;
    }
    lastRotation.current.copy(euler);

    // Check if flipped over (upside down)
    const up = new THREE.Vector3(0, 1, 0);
    up.applyQuaternion(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w));
    const isFlipped = up.y < 0.3;

    if (isFlipped && grounded) {
      flipTimer.current += delta;
      if (flipTimer.current >= PHYSICS.RECOVERY.FLIP_TIME) {
        resetTruck();
      }
    } else {
      flipTimer.current = 0;
    }

    // === NOS (always update, even when airborne) ===
    let nosMultiplier = 1;
    if (controls.nos && nosCharge > 0 && grounded) {
      // Only use NOS when grounded (can't thrust in air)
      nosMultiplier = PHYSICS.NOS.FORCE_MULTIPLIER * stats.nos;
      drainNos(PHYSICS.NOS.DRAIN_RATE * delta);
    } else if (!controls.nos) {
      // Always recharge when not using (even in air)
      rechargeNos(PHYSICS.NOS.RECHARGE_RATE * delta);
    }

    // Apply forces only when grounded
    if (grounded) {
      // === FULL ANGULAR STABILIZATION ===
      // Ghost collisions on trimesh inject random angular velocity - aggressively damp ALL axes
      const currentAngVel = body.angvel();
      const angularDampFactor = 0.7; // Strong damping per frame (0 = no damp, 1 = instant stop)

      // Damp pitch (x) and roll (z) heavily - we don't want terrain bumps spinning us
      const dampedX = currentAngVel.x * (1 - angularDampFactor);
      const dampedZ = currentAngVel.z * (1 - angularDampFactor);

      // === VELOCITY-BASED MOVEMENT (smooth, no impulses) ===
      const throttle = controls.throttle;
      const steering = controls.steering;

      // Current horizontal velocity
      const currentVelVec = new THREE.Vector3(vel.x, 0, vel.z);
      const signedSpeed = forward.dot(currentVelVec);
      const isReversing = signedSpeed < -0.5;
      const absSpeed = Math.abs(signedSpeed);

      // Calculate target speed based on throttle
      const maxSpeed = PHYSICS.ENGINE.MAX_SPEED * stats.engine * nosMultiplier;
      const acceleration = 0.15; // Lerp factor for speed changes (higher = snappier)
      const deceleration = 0.08; // Slower deceleration for coasting feel

      let targetSpeed = signedSpeed; // Start with current speed

      if (throttle > 0) {
        // Accelerating forward
        targetSpeed = Math.min(maxSpeed, signedSpeed + throttle * maxSpeed * acceleration);
      } else if (throttle < 0) {
        // Braking or reversing
        const reverseMax = (PHYSICS.ENGINE.MAX_SPEED * 0.4) * stats.engine; // Slower reverse
        if (signedSpeed > 0.5) {
          // Braking from forward motion
          targetSpeed = Math.max(0, signedSpeed + throttle * maxSpeed * acceleration * 2);
        } else {
          // Reversing
          targetSpeed = Math.max(-reverseMax, signedSpeed + throttle * reverseMax * acceleration);
        }
      } else {
        // Coasting - slow deceleration
        targetSpeed = signedSpeed * (1 - deceleration);
        if (Math.abs(targetSpeed) < 0.1) targetSpeed = 0;
      }

      // === IMPULSE-BASED MOVEMENT (proper physics formulas) ===
      // impulse = force × time, and Δv = impulse / mass
      // Using PHYSICS.ENGINE constants for realistic acceleration

      // Calculate throttle force based on direction
      const throttleForce = throttle > 0
        ? PHYSICS.ENGINE.BASE_FORCE * throttle * stats.engine * nosMultiplier
        : PHYSICS.ENGINE.REVERSE_FORCE * throttle * stats.engine;

      // Limit acceleration when approaching max speed (prevents overshooting)
      const currentSpeed = forward.dot(new THREE.Vector3(vel.x, 0, vel.z));
      const speedRatio = Math.abs(currentSpeed) / maxSpeed;
      const forceLimiter = Math.max(0, 1 - speedRatio * 0.8); // Gradual reduction

      // Apply impulse in forward direction
      const impulseStrength = throttleForce * forceLimiter * delta;
      const impulse = forward.clone().multiplyScalar(impulseStrength);
      body.applyImpulse({ x: impulse.x, y: 0, z: impulse.z }, true);

      // GRIP: Strong lateral counter-impulse for "wheels stuck to ground" feel
      // Force must be high enough to actually correct sideways sliding
      const sidewaysSpeed = right.dot(new THREE.Vector3(vel.x, 0, vel.z));
      const gripForce = 8000 * stats.tires; // Strong lateral correction
      const lateralCorrection = right.clone().multiplyScalar(-sidewaysSpeed * gripForce * delta);
      body.applyImpulse({ x: lateralCorrection.x, y: 0, z: lateralCorrection.z }, true);

      // === STEERING (yaw control) ===
      const effectiveSteering = isReversing ? -steering : steering;
      let targetYaw = 0;

      if (steering !== 0 && absSpeed > 0.3) {
        const steerFactor = Math.max(0.3, Math.min(1, absSpeed / 4)) * stats.tires;
        targetYaw = -effectiveSteering * PHYSICS.STEERING.SPEED * steerFactor;
      }

      // Smooth yaw with correction toward target
      const yawLerp = steering !== 0 ? 0.12 : 0.4; // Smoother steering, less twitchy
      const newYaw = currentAngVel.y + (targetYaw - currentAngVel.y) * yawLerp;
      const finalYaw = Math.abs(newYaw) < 0.15 ? 0 : newYaw; // Bigger dead zone for straight driving

      // Set all angular velocities (damped pitch/roll, controlled yaw)
      body.setAngvel({ x: dampedX, y: finalYaw, z: dampedZ }, true);

      // Update visual steering angle
      setSteeringAngle(-steering * PHYSICS.STEERING.MAX_ANGLE);
    }

    // Air control (limited, scaled by delta)
    if (!grounded) {
      const airControl = 20;
      if (controls.throttle !== 0) {
        body.applyTorqueImpulse({ x: controls.throttle * airControl * delta, y: 0, z: 0 }, true);
      }
      if (controls.steering !== 0) {
        body.applyTorqueImpulse({ x: 0, y: 0, z: controls.steering * airControl * delta }, true);
      }
    }

    // Water detection - slow down when in lake
    const inWater = LAKES.some(lake => {
      const dist = Math.sqrt((pos.x - lake.x) ** 2 + (pos.z - lake.z) ** 2);
      return dist < lake.size;
    });

    if (inWater) {
      // Apply water resistance as drag impulse (doesn't break collision response)
      const waterDrag = 0.08; // How much to slow down per frame
      body.applyImpulse({
        x: -vel.x * waterDrag * delta * 800,
        y: 0,
        z: -vel.z * waterDrag * delta * 800
      }, true);
    }

    // Update wheel rotation based on speed
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    setWheelRotation((prev) => prev + speed * delta * 2);
  });

  // Effect for horn
  useEffect(() => {
    let lastHorn = false;
    const checkHorn = () => {
      const controls = getControls();
      if (controls.horn && !lastHorn) {
        sounds.playHorn();
      }
      lastHorn = controls.horn;
    };
    const interval = setInterval(checkHorn, 50);
    return () => clearInterval(interval);
  }, [getControls]);

  const { CHASSIS_WIDTH, CHASSIS_HEIGHT, CHASSIS_LENGTH, WHEEL_RADIUS, WHEEL_WIDTH } = PHYSICS.TRUCK;

  return (
    <RigidBody
      ref={bodyRef}
      position={position}
      rotation={[0, rotation, 0]}
      colliders={false}
      mass={1500}
      canSleep={false}
      ccd={true}
      linearDamping={0.2}
      angularDamping={5.0}
      restitution={0.1}
      friction={1.2}
    >
      {/* Collider extends from wheel bottom to chassis top */}
      <CuboidCollider
        args={[CHASSIS_WIDTH / 2, (CHASSIS_HEIGHT + WHEEL_RADIUS * 2) / 2, CHASSIS_LENGTH / 2]}
        position={[0, (CHASSIS_HEIGHT + WHEEL_RADIUS * 2) / 2, 0]}
      />
      {/* Ballast at bottom - lowers center of mass to prevent flipping */}
      <CuboidCollider
        args={[CHASSIS_WIDTH / 2, 0.2, CHASSIS_LENGTH / 2]}
        position={[0, 0.1, 0]}
        mass={400}
      />

      <group ref={meshRef}>
        {/* === FRAME/CHASSIS === */}
        {/* Lower frame - visible under body */}
        <mesh position={[0, WHEEL_RADIUS * 0.6, 0]} castShadow>
          <boxGeometry args={[CHASSIS_WIDTH * 0.7, 0.25, CHASSIS_LENGTH * 0.85]} />
          <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.3} />
        </mesh>

        {/* Suspension arms - front */}
        <mesh position={[CHASSIS_WIDTH * 0.35, WHEEL_RADIUS * 0.5, CHASSIS_LENGTH * 0.25]} rotation={[0, 0, 0.3]}>
          <boxGeometry args={[0.8, 0.12, 0.15]} />
          <meshStandardMaterial color="#333" metalness={0.7} />
        </mesh>
        <mesh position={[-CHASSIS_WIDTH * 0.35, WHEEL_RADIUS * 0.5, CHASSIS_LENGTH * 0.25]} rotation={[0, 0, -0.3]}>
          <boxGeometry args={[0.8, 0.12, 0.15]} />
          <meshStandardMaterial color="#333" metalness={0.7} />
        </mesh>
        {/* Suspension arms - rear */}
        <mesh position={[CHASSIS_WIDTH * 0.35, WHEEL_RADIUS * 0.5, -CHASSIS_LENGTH * 0.25]} rotation={[0, 0, 0.3]}>
          <boxGeometry args={[0.8, 0.12, 0.15]} />
          <meshStandardMaterial color="#333" metalness={0.7} />
        </mesh>
        <mesh position={[-CHASSIS_WIDTH * 0.35, WHEEL_RADIUS * 0.5, -CHASSIS_LENGTH * 0.25]} rotation={[0, 0, -0.3]}>
          <boxGeometry args={[0.8, 0.12, 0.15]} />
          <meshStandardMaterial color="#333" metalness={0.7} />
        </mesh>

        {/* === MAIN BODY === */}
        {/* Hood/front body - sloped */}
        <mesh position={[0, WHEEL_RADIUS + 0.5, CHASSIS_LENGTH * 0.2]} castShadow>
          <boxGeometry args={[CHASSIS_WIDTH * 0.95, 0.6, CHASSIS_LENGTH * 0.4]} />
          <meshStandardMaterial color={truckColor} metalness={0.5} roughness={0.4} />
        </mesh>

        {/* Cab - main cabin */}
        <mesh position={[0, WHEEL_RADIUS + 1.0, -CHASSIS_LENGTH * 0.1]} castShadow>
          <boxGeometry args={[CHASSIS_WIDTH * 0.9, 0.85, CHASSIS_LENGTH * 0.35]} />
          <meshStandardMaterial color={truckColor} metalness={0.5} roughness={0.4} />
        </mesh>

        {/* Roof */}
        <mesh position={[0, WHEEL_RADIUS + 1.5, -CHASSIS_LENGTH * 0.1]} castShadow>
          <boxGeometry args={[CHASSIS_WIDTH * 0.85, 0.15, CHASSIS_LENGTH * 0.33]} />
          <meshStandardMaterial color={truckColor} metalness={0.5} roughness={0.4} />
        </mesh>

        {/* Bed/rear - pickup truck style */}
        <mesh position={[0, WHEEL_RADIUS + 0.4, -CHASSIS_LENGTH * 0.35]} castShadow>
          <boxGeometry args={[CHASSIS_WIDTH * 0.95, 0.5, CHASSIS_LENGTH * 0.35]} />
          <meshStandardMaterial color={truckColor} metalness={0.5} roughness={0.4} />
        </mesh>
        {/* Bed walls */}
        <mesh position={[CHASSIS_WIDTH * 0.45, WHEEL_RADIUS + 0.7, -CHASSIS_LENGTH * 0.35]} castShadow>
          <boxGeometry args={[0.1, 0.4, CHASSIS_LENGTH * 0.35]} />
          <meshStandardMaterial color={truckColor} metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[-CHASSIS_WIDTH * 0.45, WHEEL_RADIUS + 0.7, -CHASSIS_LENGTH * 0.35]} castShadow>
          <boxGeometry args={[0.1, 0.4, CHASSIS_LENGTH * 0.35]} />
          <meshStandardMaterial color={truckColor} metalness={0.5} roughness={0.4} />
        </mesh>

        {/* === FRONT DETAILS === */}
        {/* Grille */}
        <mesh position={[0, WHEEL_RADIUS + 0.35, CHASSIS_LENGTH / 2 - 0.05]}>
          <boxGeometry args={[CHASSIS_WIDTH * 0.6, 0.45, 0.1]} />
          <meshStandardMaterial color="#111" metalness={0.9} roughness={0.2} />
        </mesh>
        {/* Bumper */}
        <mesh position={[0, WHEEL_RADIUS * 0.7, CHASSIS_LENGTH / 2 + 0.1]} castShadow>
          <boxGeometry args={[CHASSIS_WIDTH * 1.05, 0.25, 0.2]} />
          <meshStandardMaterial color="#222" metalness={0.7} roughness={0.3} />
        </mesh>

        {/* Windshield - angled */}
        <mesh position={[0, WHEEL_RADIUS + 1.1, CHASSIS_LENGTH * 0.08]} rotation={[-0.4, 0, 0]} castShadow>
          <boxGeometry args={[CHASSIS_WIDTH * 0.75, 0.55, 0.08]} />
          <meshStandardMaterial color="#1a3a5c" metalness={0.95} roughness={0.05} transparent opacity={0.8} />
        </mesh>

        {/* Side windows */}
        <mesh position={[CHASSIS_WIDTH * 0.45, WHEEL_RADIUS + 1.05, -CHASSIS_LENGTH * 0.08]}>
          <boxGeometry args={[0.05, 0.4, 0.4]} />
          <meshStandardMaterial color="#1a3a5c" metalness={0.9} roughness={0.1} transparent opacity={0.7} />
        </mesh>
        <mesh position={[-CHASSIS_WIDTH * 0.45, WHEEL_RADIUS + 1.05, -CHASSIS_LENGTH * 0.08]}>
          <boxGeometry args={[0.05, 0.4, 0.4]} />
          <meshStandardMaterial color="#1a3a5c" metalness={0.9} roughness={0.1} transparent opacity={0.7} />
        </mesh>

        {/* Headlights */}
        <mesh position={[CHASSIS_WIDTH * 0.35, WHEEL_RADIUS + 0.5, CHASSIS_LENGTH / 2 - 0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.08, 16]} />
          <meshStandardMaterial color="#ffffcc" emissive="#ffff00" emissiveIntensity={0.6} />
        </mesh>
        <mesh position={[-CHASSIS_WIDTH * 0.35, WHEEL_RADIUS + 0.5, CHASSIS_LENGTH / 2 - 0.02]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.08, 16]} />
          <meshStandardMaterial color="#ffffcc" emissive="#ffff00" emissiveIntensity={0.6} />
        </mesh>

        {/* === ROLL CAGE === */}
        {/* Front pillars */}
        <mesh position={[CHASSIS_WIDTH * 0.4, WHEEL_RADIUS + 1.25, CHASSIS_LENGTH * 0.0]} rotation={[0.3, 0, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.7, 8]} />
          <meshStandardMaterial color="#222" metalness={0.8} />
        </mesh>
        <mesh position={[-CHASSIS_WIDTH * 0.4, WHEEL_RADIUS + 1.25, CHASSIS_LENGTH * 0.0]} rotation={[0.3, 0, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.7, 8]} />
          <meshStandardMaterial color="#222" metalness={0.8} />
        </mesh>
        {/* Rear pillars */}
        <mesh position={[CHASSIS_WIDTH * 0.38, WHEEL_RADIUS + 1.2, -CHASSIS_LENGTH * 0.2]} rotation={[-0.15, 0, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.6, 8]} />
          <meshStandardMaterial color="#222" metalness={0.8} />
        </mesh>
        <mesh position={[-CHASSIS_WIDTH * 0.38, WHEEL_RADIUS + 1.2, -CHASSIS_LENGTH * 0.2]} rotation={[-0.15, 0, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.6, 8]} />
          <meshStandardMaterial color="#222" metalness={0.8} />
        </mesh>
        {/* Cross bar */}
        <mesh position={[0, WHEEL_RADIUS + 1.55, -CHASSIS_LENGTH * 0.1]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.04, 0.04, CHASSIS_WIDTH * 0.75, 8]} />
          <meshStandardMaterial color="#222" metalness={0.8} />
        </mesh>

        {/* === EXHAUST STACKS === */}
        <mesh position={[CHASSIS_WIDTH * 0.35, WHEEL_RADIUS + 1.2, -CHASSIS_LENGTH * 0.4]}>
          <cylinderGeometry args={[0.06, 0.08, 1.0, 12]} />
          <meshStandardMaterial color="#333" metalness={0.9} roughness={0.2} />
        </mesh>
        <mesh position={[-CHASSIS_WIDTH * 0.35, WHEEL_RADIUS + 1.2, -CHASSIS_LENGTH * 0.4]}>
          <cylinderGeometry args={[0.06, 0.08, 1.0, 12]} />
          <meshStandardMaterial color="#333" metalness={0.9} roughness={0.2} />
        </mesh>

        {/* === BIG MONSTER TRUCK WHEELS === */}
        {/* Front Left Wheel */}
        <group position={[CHASSIS_WIDTH / 2 + WHEEL_WIDTH / 2 + 0.1, WHEEL_RADIUS, CHASSIS_LENGTH / 3]}>
          <group rotation={[0, steeringAngle, 0]}>
            {/* Tire */}
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 32]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
            </mesh>
            {/* Wheel rim */}
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[WHEEL_RADIUS * 0.5, WHEEL_RADIUS * 0.5, WHEEL_WIDTH + 0.05, 16]} />
              <meshStandardMaterial color="#888" metalness={0.9} roughness={0.2} />
            </mesh>
            {/* Rim spokes */}
            <mesh rotation={[wheelRotation, 0, Math.PI / 2]}>
              <torusGeometry args={[WHEEL_RADIUS * 0.65, 0.06, 8, 5]} />
              <meshStandardMaterial color="#666" metalness={0.8} />
            </mesh>
            {/* Tread pattern */}
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <mesh key={i} position={[0, 0, 0]} rotation={[wheelRotation + i * Math.PI / 4, 0, Math.PI / 2]}>
                <boxGeometry args={[WHEEL_WIDTH * 0.9, 0.08, WHEEL_RADIUS * 0.25]} />
                <meshStandardMaterial color="#111" />
              </mesh>
            ))}
          </group>
        </group>

        {/* Front Right Wheel */}
        <group position={[-CHASSIS_WIDTH / 2 - WHEEL_WIDTH / 2 - 0.1, WHEEL_RADIUS, CHASSIS_LENGTH / 3]}>
          <group rotation={[0, steeringAngle, 0]}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 32]} />
              <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[WHEEL_RADIUS * 0.5, WHEEL_RADIUS * 0.5, WHEEL_WIDTH + 0.05, 16]} />
              <meshStandardMaterial color="#888" metalness={0.9} roughness={0.2} />
            </mesh>
            <mesh rotation={[wheelRotation, 0, Math.PI / 2]}>
              <torusGeometry args={[WHEEL_RADIUS * 0.65, 0.06, 8, 5]} />
              <meshStandardMaterial color="#666" metalness={0.8} />
            </mesh>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <mesh key={i} position={[0, 0, 0]} rotation={[wheelRotation + i * Math.PI / 4, 0, Math.PI / 2]}>
                <boxGeometry args={[WHEEL_WIDTH * 0.9, 0.08, WHEEL_RADIUS * 0.25]} />
                <meshStandardMaterial color="#111" />
              </mesh>
            ))}
          </group>
        </group>

        {/* Rear Left Wheel */}
        <group position={[CHASSIS_WIDTH / 2 + WHEEL_WIDTH / 2 + 0.1, WHEEL_RADIUS, -CHASSIS_LENGTH / 3]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 32]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[WHEEL_RADIUS * 0.5, WHEEL_RADIUS * 0.5, WHEEL_WIDTH + 0.05, 16]} />
            <meshStandardMaterial color="#888" metalness={0.9} roughness={0.2} />
          </mesh>
          <mesh rotation={[wheelRotation, 0, Math.PI / 2]}>
            <torusGeometry args={[WHEEL_RADIUS * 0.65, 0.06, 8, 5]} />
            <meshStandardMaterial color="#666" metalness={0.8} />
          </mesh>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <mesh key={i} position={[0, 0, 0]} rotation={[wheelRotation + i * Math.PI / 4, 0, Math.PI / 2]}>
              <boxGeometry args={[WHEEL_WIDTH * 0.9, 0.08, WHEEL_RADIUS * 0.25]} />
              <meshStandardMaterial color="#111" />
            </mesh>
          ))}
        </group>

        {/* Rear Right Wheel */}
        <group position={[-CHASSIS_WIDTH / 2 - WHEEL_WIDTH / 2 - 0.1, WHEEL_RADIUS, -CHASSIS_LENGTH / 3]}>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 32]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[WHEEL_RADIUS * 0.5, WHEEL_RADIUS * 0.5, WHEEL_WIDTH + 0.05, 16]} />
            <meshStandardMaterial color="#888" metalness={0.9} roughness={0.2} />
          </mesh>
          <mesh rotation={[wheelRotation, 0, Math.PI / 2]}>
            <torusGeometry args={[WHEEL_RADIUS * 0.65, 0.06, 8, 5]} />
            <meshStandardMaterial color="#666" metalness={0.8} />
          </mesh>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <mesh key={i} position={[0, 0, 0]} rotation={[wheelRotation + i * Math.PI / 4, 0, Math.PI / 2]}>
              <boxGeometry args={[WHEEL_WIDTH * 0.9, 0.08, WHEEL_RADIUS * 0.25]} />
              <meshStandardMaterial color="#111" />
            </mesh>
          ))}
        </group>

        {/* === FENDER FLARES === */}
        {/* Front flares */}
        <mesh position={[CHASSIS_WIDTH * 0.48, WHEEL_RADIUS + 0.3, CHASSIS_LENGTH * 0.25]} castShadow>
          <boxGeometry args={[0.15, 0.4, WHEEL_WIDTH * 1.5]} />
          <meshStandardMaterial color={truckColor} metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[-CHASSIS_WIDTH * 0.48, WHEEL_RADIUS + 0.3, CHASSIS_LENGTH * 0.25]} castShadow>
          <boxGeometry args={[0.15, 0.4, WHEEL_WIDTH * 1.5]} />
          <meshStandardMaterial color={truckColor} metalness={0.5} roughness={0.4} />
        </mesh>
        {/* Rear flares */}
        <mesh position={[CHASSIS_WIDTH * 0.48, WHEEL_RADIUS + 0.3, -CHASSIS_LENGTH * 0.25]} castShadow>
          <boxGeometry args={[0.15, 0.4, WHEEL_WIDTH * 1.5]} />
          <meshStandardMaterial color={truckColor} metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[-CHASSIS_WIDTH * 0.48, WHEEL_RADIUS + 0.3, -CHASSIS_LENGTH * 0.25]} castShadow>
          <boxGeometry args={[0.15, 0.4, WHEEL_WIDTH * 1.5]} />
          <meshStandardMaterial color={truckColor} metalness={0.5} roughness={0.4} />
        </mesh>
      </group>
    </RigidBody>
  );
});

// Export a ref component to get vehicle position
export function useVehicleRef() {
  const ref = useRef<RapierRigidBody>(null);
  return ref;
}
