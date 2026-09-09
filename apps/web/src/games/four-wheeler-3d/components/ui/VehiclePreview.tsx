"use client";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { VehicleModel } from "../models";
import { WheelModel } from "../models/WheelModel";
import { TransportModel } from "../models/TransportModel";
import { tuningFor } from "../../lib/vehicles";
import {
  BIKES,
  isAirVehicle,
  isWaterVehicle,
  type StoreOffer,
} from "../../lib/catalog";
import { displaySpeedMph } from "../../lib/displaySpeed";
import { transportTuning } from "../../lib/transport";
export function VehiclePreview({
  offer,
  onClose,
}: {
  offer: StoreOffer;
  onClose: () => void;
}) {
  const t = tuningFor(offer.key),
    craft = isAirVehicle(offer.key) || isWaterVehicle(offer.key),
    length = craft ? transportTuning(offer.key).length : t.chassis.length;
  const scale = 4 / Math.max(4, length),
    two =
      offer.key === "moto" ||
      offer.key === "bike" ||
      BIKES.some(([key]) => key === offer.key);
  const mph = displaySpeedMph(offer.key);
  return (
    <section className="fw-vehicle-preview">
      <header>
        <div>
          <small>TAKE A CLOSER LOOK</small>
          <h3>{offer.label}</h3>
        </div>
        <button onClick={onClose} aria-label="Close vehicle details">
          ×
        </button>
      </header>
      <div
        style={{ height: 240, touchAction: "none" }}
        aria-label={`Interactive ${offer.label} preview. Drag to rotate.`}
      >
        <Canvas
          frameloop="demand"
          dpr={[1, 1.5]}
          camera={{ position: [4, 2.5, 5], fov: 40 }}
          gl={{ alpha: false }}
        >
          <color attach="background" args={["#26332e"]} />
          <ambientLight intensity={1.5} />
          <directionalLight position={[3, 6, 4]} intensity={3} />
          <directionalLight
            position={[-4, 2, -3]}
            intensity={1.7}
            color="#b6cdd1"
          />
          <group scale={scale} rotation={[0, 0.4, 0]}>
            {craft ? (
              <TransportModel
                type={offer.key}
                paint={offer.color ?? "#bf513c"}
              />
            ) : (
              <>
                <VehicleModel
                  id={offer.key}
                  tuning={t}
                  paint={offer.color ?? "#bf513c"}
                  detail="parked"
                  lightsEnabled={false}
                />
                {t.wheelPositions.map((p, i) =>
                  two && i % 2 ? null : (
                    <group
                      key={i}
                      position={[
                        two ? 0 : p[0],
                        p[1] - t.suspension.restLength,
                        p[2],
                      ]}
                    >
                      <WheelModel radius={t.wheelRadius} />
                    </group>
                  ),
                )}
              </>
            )}
          </group>
          <OrbitControls
            enablePan={false}
            minDistance={3}
            maxDistance={10}
            maxPolarAngle={Math.PI * 0.6}
          />
        </Canvas>
      </div>
      <p>
        {Math.round(mph)} mph top speed ·{" "}
        {craft
          ? "Explore beyond the trails"
          : "Paint and tune it at the custom garage"}
      </p>
      <p className="fw-muted">
        Drag to turn the model. Scroll or pinch to look closer.
      </p>
    </section>
  );
}
