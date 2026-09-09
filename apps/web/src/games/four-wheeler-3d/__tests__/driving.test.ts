import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import type { RapierContext } from "@react-three/rapier";
import {
  applyDriving,
  chassisMassProperties,
  configureVehicle,
  recoverVehicle,
} from "../lib/driving";
import { tuningFor } from "../lib/vehicles";
import { NEUTRAL } from "../lib/controls";

// Resolve the exact engine used by R3F, without introducing a second Rapier dependency.
const require = createRequire(import.meta.url);
const rapierRequire = createRequire(require.resolve("@react-three/rapier"));
const R = rapierRequire("@dimforge/rapier3d-compat") as RapierContext["rapier"];
const tuning = tuningFor("atv");
const dt = 1 / 60;
beforeAll(async () => {
  await R.init();
});

function ride(roughGround = false) {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = dt;
  if (roughGround) {
    // Eight-degree cross slope with rolling 30cm rises, sampled like the streamed terrain.
    const segments = 128;
    const heights = new Float32Array((segments + 1) ** 2);
    for (let x = 0; x <= segments; x++) {
      for (let z = 0; z <= segments; z++) {
        const wx = (x / segments - 0.5) * 512;
        const wz = (z / segments - 0.5) * 512;
        heights[x * (segments + 1) + z] = wx * 0.14 + 0.3 * Math.sin(wz / 6);
      }
    }
    world.createCollider(
      R.ColliderDesc.heightfield(segments, segments, heights, {
        x: 512,
        y: 1,
        z: 512,
      }),
    );
  } else {
    world.createCollider(
      R.ColliderDesc.cuboid(1000, 1, 1000).setTranslation(0, -1, 0),
    );
  }
  const body = world.createRigidBody(
    R.RigidBodyDesc.dynamic()
      .setTranslation(0, 1.2, 0)
      .setLinearDamping(0.1)
      .setAngularDamping(1)
      .setCcdEnabled(true),
  );
  const { width, height, length } = tuning.chassis;
  const mass = chassisMassProperties(tuning);
  world.createCollider(
    R.ColliderDesc.cuboid(width / 2, height / 2, length / 2).setMassProperties(
      mass.mass,
      mass.centerOfMass,
      mass.principalAngularInertia,
      mass.angularInertiaLocalFrame,
    ),
    body,
  );
  const vehicle = world.createVehicleController(body);
  configureVehicle(vehicle, tuning);
  const state = { steerAngle: 0, engine: 0 };
  const step = (seconds: number, input = {}, boost = 1) => {
    let minUp = 1;
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      applyDriving(vehicle, tuning, { ...NEUTRAL, ...input }, state, dt, {
        boost,
      });
      vehicle.updateVehicle(dt);
      world.step();
      const q = body.rotation();
      minUp = Math.min(minUp, 1 - 2 * (q.x * q.x + q.z * q.z));
    }
    return minUp;
  };
  step(2);
  return { world, body, vehicle, state, step };
}

describe("real Rapier quad driving", () => {
  it.each([
    [-1, 1],
    [1, -1],
  ])("steer %s moves toward the rider's correct side", (steer, expectedX) => {
    const r = ride();
    try {
      r.step(1.5, { throttle: 1 });
      r.step(0.75, { throttle: 1, steer });
      expect(r.body.translation().x * expectedX).toBeGreaterThan(0.3);
      expect(r.body.translation().z).toBeGreaterThan(3);
      expect(r.vehicle.currentVehicleSpeed()).toBeGreaterThan(1);
      expect(r.body.rotation().y * expectedX).toBeGreaterThan(0.03);
    } finally {
      r.world.free();
    }
  });

  it("reports reverse speed along local Z and backs away", () => {
    const r = ride();
    try {
      r.step(3, { throttle: -1 });
      expect(r.vehicle.currentVehicleSpeed()).toBeLessThan(-1);
      expect(r.body.translation().z).toBeLessThan(-2);
    } finally {
      r.world.free();
    }
  });

  it.each([1, 2])(
    "stays on its wheels through sustained full-lock turns at boost %s",
    (boost) => {
      const r = ride();
      try {
        r.step(7, { throttle: 1 }, boost);
        expect(r.vehicle.currentVehicleSpeed()).toBeGreaterThan(17);
        const minUp = r.step(8, { throttle: 1, steer: 1 }, boost);
        expect(minUp).toBeGreaterThan(0.7);
        expect(r.body.translation().x).toBeLessThan(-5);
      } finally {
        r.world.free();
      }
    },
  );

  it("corners across banked, uneven ground without rolling over", () => {
    const r = ride(true);
    try {
      r.step(5, { throttle: 1 });
      expect(r.vehicle.currentVehicleSpeed()).toBeGreaterThan(12);
      const minUp = r.step(8, { throttle: 1, steer: 1 });
      expect(minUp).toBeGreaterThan(0.6);
      expect(r.vehicle.currentVehicleSpeed()).toBeGreaterThan(5);
    } finally {
      r.world.free();
    }
  });

  it("brakes from cruising speed without a nose-over", () => {
    const r = ride();
    try {
      r.step(5, { throttle: 1 });
      expect(r.vehicle.currentVehicleSpeed()).toBeGreaterThan(15);
      const minUp = r.step(4, { brake: 1 });
      expect(Math.abs(r.vehicle.currentVehicleSpeed())).toBeLessThan(0.5);
      expect(minUp).toBeGreaterThan(0.7);
    } finally {
      r.world.free();
    }
  });

  it.each([false, true])(
    "keeps a corner recoverable when braking (handbrake %s)",
    (handbrake) => {
      const r = ride();
      try {
        r.step(5, { throttle: 1 });
        const minUp = r.step(3, {
          steer: 1,
          brake: handbrake ? 0 : 1,
          handbrake,
        });
        expect(minUp).toBeGreaterThan(0.6);
        expect(Math.abs(r.vehicle.currentVehicleSpeed())).toBeLessThan(8);
      } finally {
        r.world.free();
      }
    },
  );

  it("allows a jump and physical roll instead of locking the chassis upright", () => {
    const r = ride();
    try {
      r.body.applyImpulse({ x: 0, y: tuning.mass * 5.5, z: 0 }, true);
      r.step(0.1);
      expect(r.body.translation().y).toBeGreaterThan(1);
      r.body.applyTorqueImpulse({ x: 0, y: 0, z: tuning.mass * 0.5 }, true);
      const minUp = r.step(0.2);
      expect(minUp).toBeLessThan(0.9);
    } finally {
      r.world.free();
    }
  });

  it("keeps physical rotation and recovers an overturned quad into a driveable state", () => {
    const r = ride();
    try {
      r.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
      r.step(0.5);
      expect(Math.abs(r.body.rotation().z)).toBeGreaterThan(0.8);
      recoverVehicle(r.body, 0);
      r.step(2);
      expect(r.body.rotation().w).toBeGreaterThan(0.95);
      const start = r.body.translation().z;
      r.step(2, { throttle: 1 });
      expect(r.body.translation().z - start).toBeGreaterThan(3);
    } finally {
      r.world.free();
    }
  });
});
