'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Matter from 'matter-js';
import { GameShell } from '@/shared/components';

/**
 * Hill Climb Racing Physics Proof-of-Concept
 *
 * This page validates the Matter.js 2D vehicle physics before building the full game.
 *
 * Controls:
 * - D / Right Arrow: Gas (spin wheels forward)
 * - A / Left Arrow: Brake/Reverse (spin wheels backward)
 * - W / Up Arrow: Lean back (rotate vehicle counter-clockwise)
 * - S / Down Arrow: Lean forward (rotate vehicle clockwise)
 * - R: Reset vehicle position
 */

// Physics constants - will move to constants.ts in final version
const PHYSICS = {
  // Vehicle dimensions
  CHASSIS_WIDTH: 120,
  CHASSIS_HEIGHT: 40,
  WHEEL_RADIUS: 25,
  WHEEL_BASE: 80, // Distance between wheel centers
  HEAD_RADIUS: 15,
  HEAD_OFFSET_Y: -35, // Above chassis

  // Physics properties
  CHASSIS_MASS: 50,
  WHEEL_FRICTION: 0.9,
  WHEEL_FRICTION_STATIC: 1.0,

  // Motor control
  WHEEL_TORQUE: 0.15, // Angular velocity applied to wheels
  MAX_WHEEL_SPEED: 0.5,
  LEAN_FORCE: 0.008, // Torque applied to chassis for leaning

  // Suspension
  SUSPENSION_STIFFNESS: 0.4,
  SUSPENSION_DAMPING: 0.3,

  // World
  GRAVITY: 1,
  GROUND_FRICTION: 0.8,
};

export default function HillClimbPOC() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const renderRef = useRef<Matter.Render | null>(null);
  const runnerRef = useRef<Matter.Runner | null>(null);
  const vehicleRef = useRef<{
    chassis: Matter.Body;
    head: Matter.Body;
    wheelA: Matter.Body;
    wheelB: Matter.Body;
  } | null>(null);

  const [controls, setControls] = useState({
    gas: false,
    brake: false,
    leanBack: false,
    leanForward: false,
  });

  const [stats, setStats] = useState({
    speed: 0,
    rotation: 0,
    position: { x: 0, y: 0 },
  });
  const controlsRef = useRef(controls);

  const resetVehicle = useCallback(() => {
    if (!vehicleRef.current) return;
    const { chassis, head, wheelA, wheelB } = vehicleRef.current;

    const startX = 400;
    const startY = 300;

    // Reset positions
    Matter.Body.setPosition(chassis, { x: startX, y: startY });
    Matter.Body.setPosition(head, { x: startX, y: startY + PHYSICS.HEAD_OFFSET_Y });
    Matter.Body.setPosition(wheelA, { x: startX - PHYSICS.WHEEL_BASE / 2, y: startY + PHYSICS.CHASSIS_HEIGHT / 2 });
    Matter.Body.setPosition(wheelB, { x: startX + PHYSICS.WHEEL_BASE / 2, y: startY + PHYSICS.CHASSIS_HEIGHT / 2 });

    // Reset velocities and rotation
    [chassis, head, wheelA, wheelB].forEach(body => {
      Matter.Body.setVelocity(body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(body, 0);
      Matter.Body.setAngle(body, 0);
    });
  }, []);

  // Keyboard handlers
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    switch (e.key.toLowerCase()) {
      case 'd':
      case 'arrowright':
        setControls(c => ({ ...c, gas: true }));
        break;
      case 'a':
      case 'arrowleft':
        setControls(c => ({ ...c, brake: true }));
        break;
      case 'w':
      case 'arrowup':
        setControls(c => ({ ...c, leanBack: true }));
        break;
      case 's':
      case 'arrowdown':
        setControls(c => ({ ...c, leanForward: true }));
        break;
      case 'r':
        resetVehicle();
        break;
    }
  }, [resetVehicle]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    switch (e.key.toLowerCase()) {
      case 'd':
      case 'arrowright':
        setControls(c => ({ ...c, gas: false }));
        break;
      case 'a':
      case 'arrowleft':
        setControls(c => ({ ...c, brake: false }));
        break;
      case 'w':
      case 'arrowup':
        setControls(c => ({ ...c, leanBack: false }));
        break;
      case 's':
      case 'arrowdown':
        setControls(c => ({ ...c, leanForward: false }));
        break;
    }
  }, []);

  // Initialize Matter.js
  useEffect(() => {
    if (!canvasRef.current) return;

    // Create engine
    const engine = Matter.Engine.create({
      gravity: { x: 0, y: PHYSICS.GRAVITY },
    });
    engineRef.current = engine;

    // Create renderer
    const render = Matter.Render.create({
      canvas: canvasRef.current,
      engine: engine,
      options: {
        width: 1200,
        height: 600,
        wireframes: false,
        background: '#87CEEB', // Sky blue
        showAngleIndicator: true,
        showCollisions: true,
        showVelocity: true,
      },
    });
    renderRef.current = render;

    // Create ground with some hills
    const groundParts: Matter.Body[] = [];

    // Flat starting area
    groundParts.push(
      Matter.Bodies.rectangle(300, 550, 600, 60, {
        isStatic: true,
        friction: PHYSICS.GROUND_FRICTION,
        render: { fillStyle: '#228B22' }, // Forest green
        label: 'ground',
      })
    );

    // Small hill
    groundParts.push(
      Matter.Bodies.rectangle(700, 530, 200, 20, {
        isStatic: true,
        friction: PHYSICS.GROUND_FRICTION,
        angle: -0.2,
        render: { fillStyle: '#228B22' },
        label: 'ground',
      })
    );

    // Steeper hill
    groundParts.push(
      Matter.Bodies.rectangle(900, 480, 200, 20, {
        isStatic: true,
        friction: PHYSICS.GROUND_FRICTION,
        angle: -0.4,
        render: { fillStyle: '#228B22' },
        label: 'ground',
      })
    );

    // Flat top
    groundParts.push(
      Matter.Bodies.rectangle(1100, 420, 200, 20, {
        isStatic: true,
        friction: PHYSICS.GROUND_FRICTION,
        render: { fillStyle: '#228B22' },
        label: 'ground',
      })
    );

    // Create vehicle
    const startX = 200;
    const startY = 400;

    // Collision group for vehicle parts (negative = don't collide with each other)
    const vehicleGroup = Matter.Body.nextGroup(true);

    // Chassis (main body)
    const chassis = Matter.Bodies.rectangle(
      startX,
      startY,
      PHYSICS.CHASSIS_WIDTH,
      PHYSICS.CHASSIS_HEIGHT,
      {
        collisionFilter: { group: vehicleGroup },
        render: { fillStyle: '#FF6B35' }, // Orange
        label: 'chassis',
        mass: PHYSICS.CHASSIS_MASS,
      }
    );

    // Driver head (for death detection)
    const head = Matter.Bodies.circle(
      startX,
      startY + PHYSICS.HEAD_OFFSET_Y,
      PHYSICS.HEAD_RADIUS,
      {
        collisionFilter: { group: vehicleGroup },
        render: { fillStyle: '#FFE4C4' }, // Bisque (skin color)
        label: 'driverHead',
        mass: 5,
      }
    );

    // Front wheel (right side - vehicle faces right)
    const wheelA = Matter.Bodies.circle(
      startX + PHYSICS.WHEEL_BASE / 2,
      startY + PHYSICS.CHASSIS_HEIGHT / 2,
      PHYSICS.WHEEL_RADIUS,
      {
        collisionFilter: { group: vehicleGroup },
        friction: PHYSICS.WHEEL_FRICTION,
        frictionStatic: PHYSICS.WHEEL_FRICTION_STATIC,
        render: { fillStyle: '#333333' }, // Dark gray
        label: 'wheel',
        mass: 10,
      }
    );

    // Rear wheel (left side)
    const wheelB = Matter.Bodies.circle(
      startX - PHYSICS.WHEEL_BASE / 2,
      startY + PHYSICS.CHASSIS_HEIGHT / 2,
      PHYSICS.WHEEL_RADIUS,
      {
        collisionFilter: { group: vehicleGroup },
        friction: PHYSICS.WHEEL_FRICTION,
        frictionStatic: PHYSICS.WHEEL_FRICTION_STATIC,
        render: { fillStyle: '#333333' },
        label: 'wheel',
        mass: 10,
      }
    );

    // Constraints (wheel axles with suspension)
    const axleA = Matter.Constraint.create({
      bodyA: chassis,
      pointA: { x: PHYSICS.WHEEL_BASE / 2, y: PHYSICS.CHASSIS_HEIGHT / 2 },
      bodyB: wheelA,
      pointB: { x: 0, y: 0 },
      length: 0,
      stiffness: PHYSICS.SUSPENSION_STIFFNESS,
      damping: PHYSICS.SUSPENSION_DAMPING,
      render: { strokeStyle: '#666666', lineWidth: 3 },
    });

    const axleB = Matter.Constraint.create({
      bodyA: chassis,
      pointA: { x: -PHYSICS.WHEEL_BASE / 2, y: PHYSICS.CHASSIS_HEIGHT / 2 },
      bodyB: wheelB,
      pointB: { x: 0, y: 0 },
      length: 0,
      stiffness: PHYSICS.SUSPENSION_STIFFNESS,
      damping: PHYSICS.SUSPENSION_DAMPING,
      render: { strokeStyle: '#666666', lineWidth: 3 },
    });

    // Head constraint (attached to chassis)
    const headConstraint = Matter.Constraint.create({
      bodyA: chassis,
      pointA: { x: 0, y: PHYSICS.HEAD_OFFSET_Y },
      bodyB: head,
      pointB: { x: 0, y: 0 },
      length: 0,
      stiffness: 1, // Rigid connection
      damping: 0.1,
      render: { strokeStyle: '#8B4513', lineWidth: 2 }, // Brown neck
    });

    // Store vehicle reference
    vehicleRef.current = { chassis, head, wheelA, wheelB };

    // Add all to world
    Matter.Composite.add(engine.world, [
      ...groundParts,
      chassis,
      head,
      wheelA,
      wheelB,
      axleA,
      axleB,
      headConstraint,
    ]);

    // Collision detection for head hitting ground
    Matter.Events.on(engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        const labels = [pair.bodyA.label, pair.bodyB.label];
        if (labels.includes('driverHead') && labels.includes('ground')) {
          console.log('💀 HEAD HIT GROUND - GAME OVER!');
          // In the real game, this would trigger game over
        }
      }
    });

    // Physics update loop
    Matter.Events.on(engine, 'beforeUpdate', () => {
      if (!vehicleRef.current) return;
      const { chassis, wheelA, wheelB } = vehicleRef.current;

      // Get current controls from closure
      const currentControls = controlsRef.current;

      // Apply wheel torque (gas/brake)
      if (currentControls.gas) {
        // Spin wheels clockwise (forward motion to the right)
        const targetSpeed = PHYSICS.WHEEL_TORQUE;
        if (wheelA.angularVelocity < PHYSICS.MAX_WHEEL_SPEED) {
          Matter.Body.setAngularVelocity(wheelA, wheelA.angularVelocity + targetSpeed);
        }
        if (wheelB.angularVelocity < PHYSICS.MAX_WHEEL_SPEED) {
          Matter.Body.setAngularVelocity(wheelB, wheelB.angularVelocity + targetSpeed);
        }
      }

      if (currentControls.brake) {
        // Spin wheels counter-clockwise (reverse/brake)
        const targetSpeed = -PHYSICS.WHEEL_TORQUE;
        if (wheelA.angularVelocity > -PHYSICS.MAX_WHEEL_SPEED) {
          Matter.Body.setAngularVelocity(wheelA, wheelA.angularVelocity + targetSpeed);
        }
        if (wheelB.angularVelocity > -PHYSICS.MAX_WHEEL_SPEED) {
          Matter.Body.setAngularVelocity(wheelB, wheelB.angularVelocity + targetSpeed);
        }
      }

      // Apply lean torque to chassis
      if (currentControls.leanBack) {
        Matter.Body.setAngularVelocity(chassis, chassis.angularVelocity - PHYSICS.LEAN_FORCE);
      }
      if (currentControls.leanForward) {
        Matter.Body.setAngularVelocity(chassis, chassis.angularVelocity + PHYSICS.LEAN_FORCE);
      }

      // Update stats
      const velocity = chassis.velocity;
      const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
      setStats({
        speed: Math.round(speed * 10),
        rotation: Math.round((chassis.angle * 180 / Math.PI) % 360),
        position: { x: Math.round(chassis.position.x), y: Math.round(chassis.position.y) },
      });
    });

    // Camera follow
    Matter.Events.on(render, 'beforeRender', () => {
      if (!vehicleRef.current) return;
      const { chassis } = vehicleRef.current;

      // Center camera on vehicle
      Matter.Render.lookAt(render, {
        min: { x: chassis.position.x - 400, y: chassis.position.y - 200 },
        max: { x: chassis.position.x + 400, y: chassis.position.y + 400 },
      });
    });

    // Create runner
    const runner = Matter.Runner.create();
    runnerRef.current = runner;

    // Start engine and renderer
    Matter.Render.run(render);
    Matter.Runner.run(runner, engine);

    // Cleanup
    return () => {
      Matter.Render.stop(render);
      Matter.Runner.stop(runner);
      Matter.Engine.clear(engine);
    };
  }, []);

  // Use ref to access controls in physics loop
  useEffect(() => {
    controlsRef.current = controls;
  }, [controls]);

  // Keyboard event listeners
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  return (
    <GameShell gameName="Hill Climb POC" canPause={false} showPauseButton={false}>
    <div className="min-h-screen bg-gray-900 p-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-4">
          🚗 Hill Climb Racing - Physics POC
        </h1>

        {/* Controls info */}
        <div className="bg-gray-800 rounded-lg p-4 mb-4 text-white">
          <h2 className="text-xl font-semibold mb-2">Controls:</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className={`p-2 rounded ${controls.gas ? 'bg-green-600' : 'bg-gray-700'}`}>
              <kbd>D</kbd> / <kbd>→</kbd> Gas
            </div>
            <div className={`p-2 rounded ${controls.brake ? 'bg-red-600' : 'bg-gray-700'}`}>
              <kbd>A</kbd> / <kbd>←</kbd> Brake
            </div>
            <div className={`p-2 rounded ${controls.leanBack ? 'bg-blue-600' : 'bg-gray-700'}`}>
              <kbd>W</kbd> / <kbd>↑</kbd> Lean Back
            </div>
            <div className={`p-2 rounded ${controls.leanForward ? 'bg-yellow-600' : 'bg-gray-700'}`}>
              <kbd>S</kbd> / <kbd>↓</kbd> Lean Forward
            </div>
          </div>
          <div className="mt-2 text-gray-400">
            <kbd>R</kbd> Reset vehicle
          </div>
        </div>

        {/* Stats */}
        <div className="bg-gray-800 rounded-lg p-4 mb-4 text-white">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold">{stats.speed}</div>
              <div className="text-sm text-gray-400">Speed</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{stats.rotation}°</div>
              <div className="text-sm text-gray-400">Rotation</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{stats.position.x}m</div>
              <div className="text-sm text-gray-400">Distance</div>
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div className="rounded-lg overflow-hidden border-4 border-gray-700">
          <canvas ref={canvasRef} />
        </div>

        {/* Notes */}
        <div className="mt-4 bg-gray-800 rounded-lg p-4 text-gray-300 text-sm">
          <h3 className="font-semibold text-white mb-2">POC Validation Checklist:</h3>
          <ul className="list-disc list-inside space-y-1">
            <li>✅ Vehicle drives forward/backward with wheel torque</li>
            <li>✅ Vehicle can lean forward/backward</li>
            <li>✅ Vehicle can flip and recover</li>
            <li>✅ Suspension provides some bounce</li>
            <li>✅ Camera follows vehicle</li>
            <li>✅ Head collision detected (check console)</li>
            <li>⬜ Test on actual hills (see simple ramps above)</li>
          </ul>
        </div>
      </div>
    </div>
    </GameShell>
  );
}
