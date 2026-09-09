"use client";
import { useAdventureSession } from "../../lib/adventureSession";
import { useFourWheeler3dStore } from "../../lib/store";
import { useActivitiesSession } from "../../lib/activitiesSession";
import { PLAY_LOCATIONS, NOZZLE, cutGrassCount } from "../../lib/activities";
import { LANDMARKS } from "../../lib/landmarks";
const request = (name: string, payload?: string) =>
  useAdventureSession.getState().requestAction(`activity:${name}`, payload);
export function ActivitiesPanel() {
  const a = useFourWheeler3dStore((s) => s.progress.adventure),
    mode = useFourWheeler3dStore((s) => s.mode),
    pos = useAdventureSession((s) => s.playerSnapshot),
    live = useActivitiesSession((s) => s.liveActivities),
    nozzle = useActivitiesSession((s) => s.nozzle);
  const act = live ?? a.activities,
    car = a.fleet[a.activeVehicleId ?? ""];
  const near = (p: { x: number; z: number }, r = 10) =>
    Math.hypot(pos.x - p.x, pos.z - p.z) < r;
  return (
    <div>
      <p className="fw-muted">
        Bring a trailer to haul your vehicles, mow the lawn, or head to the
        recreation yard south of the garage.
      </p>
      <div className="fw-build-list">
        <button disabled={mode !== "vehicle"} onClick={() => request("hitch")}>
          {car?.hitch ? "Detach trailer (T)" : "Hitch nearby equipment (T)"}
        </button>
        <button onClick={() => request("load")}>
          {["vehicle", "boat"].includes(mode)
            ? "Load vehicle onto trailer"
            : "Unload nearby trailer"}
        </button>
        <button
          disabled={!car?.hitch || a.fleet[car.hitch]?.type !== "mower"}
          onClick={() => request("mower")}
        >
          {act.mowerOn ? "Stop mower" : "Start mower"}
        </button>
        <button
          disabled={act.plowVehicleId !== car?.id}
          onClick={() => request("plow")}
        >
          {act.plowDown ? "Raise plow and dump snow" : "Lower snow plow"}
        </button>
      </div>
      {act.plowVehicleId === car?.id && (
        <p role="status">
          Plow load: {Math.round(act.plowLoad * 20)}%{" "}
          {act.plowLoad >= 4.6 ? " · Raise the plow to keep driving" : ""}
        </p>
      )}
      <p>
        {cutGrassCount(act.cutGrass)} grass patches cut. Grass grows back after
        four game days.
      </p>
      <h3>Water works</h3>
      <div className="fw-build-list">
        <button
          disabled={!near(LANDMARKS.carWash, 5) || mode !== "vehicle"}
          onClick={() => request("wash")}
        >
          Wash vehicle and trailer
        </button>
        <button
          disabled={!nozzle && (mode !== "foot" || !near(NOZZLE, 6.12))}
          onClick={() => request("nozzle")}
        >
          {nozzle ? "Return hose" : "Pick up car-wash hose"}
        </button>
        {car?.type === "firetruck" && (
          <>
            <button
              disabled={!near(LANDMARKS.hydrant, 9.73)}
              onClick={() => request("fill")}
            >
              Fill water tank
            </button>
            <button
              disabled={a.fireWater < 3}
              onClick={() => request("fire-spray")}
            >
              Spray water · {a.fireWater}% left
            </button>
            <button onClick={() => request("ladder")}>
              {a.ladderRaised ? "Lower ladder" : "Raise ladder"}
            </button>
          </>
        )}
      </div>
      <h3>Playground</h3>
      <div className="fw-build-list">
        {PLAY_LOCATIONS.filter(
          (p) => p.kind === "slide" || p.kind === "swings",
        ).map((p) => (
          <button
            key={p.id}
            disabled={mode !== "foot" || !near(p, 9)}
            onClick={() =>
              request(p.kind === "slide" ? "slide" : "swing", p.id)
            }
          >
            {p.id.startsWith("winter") ? "Winter " : "Yard "}
            {p.kind === "slide" ? "slide" : "swings"}
          </button>
        ))}
        <button
          onClick={() =>
            useAdventureSession.getState().setWaypoint({
              id: "playground",
              label: "Recreation yard",
              x: -484,
              z: 33,
            })
          }
        >
          Navigate to playground
        </button>
      </div>
      <p>
        Walk into a ball to kick it. Goals earn $100. Step onto the trampoline
        to bounce. Goals scored: {a.activities.goals}.
      </p>
    </div>
  );
}
/** Small live controls remain reachable after the panel closes. */
export function ActivitiesControls() {
  const nozzle = useActivitiesSession((s) => s.nozzle);
  const car = useFourWheeler3dStore(
    (s) =>
      s.progress.adventure.fleet[s.progress.adventure.activeVehicleId ?? ""],
  );
  if (!nozzle && car?.type !== "firetruck") return null;
  return (
    <div
      style={{
        position: "fixed",
        right: 18,
        bottom: 180,
        zIndex: 45,
        display: "flex",
        gap: 8,
      }}
    >
      {nozzle ? (
        <button
          className="fw-primary"
          aria-label="Hold to spray hose"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            request("spray-start");
          }}
          onPointerUp={() => request("spray-stop")}
          onPointerCancel={() => request("spray-stop")}
          onLostPointerCapture={() => request("spray-stop")}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") request("spray-start");
          }}
          onKeyUp={() => request("spray-stop")}
          onBlur={() => request("spray-stop")}
        >
          Hold to spray
        </button>
      ) : (
        <button className="fw-primary" onClick={() => request("fire-spray")}>
          Spray water
        </button>
      )}
      <button
        onClick={() => useAdventureSession.getState().openPanel("activities")}
      >
        Equipment
      </button>
    </div>
  );
}
