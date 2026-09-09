"use client";

import { useFourWheeler3dStore } from "../../lib/store";
import { useAdventureSession } from "../../lib/adventureSession";
import { RAIL_BOARD_RANGE, RAIL_STOPS } from "../../lib/rail";

const action = (name: string, payload?: string) =>
  useAdventureSession.getState().requestAction(`rail:${name}`, payload);
export function TrainPanel() {
  const owned = useFourWheeler3dStore((s) => s.progress.adventure.trainOwned),
    money = useFourWheeler3dStore((s) => s.progress.money),
    mode = useFourWheeler3dStore((s) => s.mode);
  const train = useAdventureSession((s) => s.rail),
    player = useAdventureSession((s) => s.playerSnapshot);
  const nearby =
    train &&
    Math.hypot(
      player.x - train.position.x,
      player.z - train.position.z,
      player.y - train.position.y,
    ) <= RAIL_BOARD_RANGE;
  return (
    <div>
      <p className="fw-muted">
        Your own countryside railway. Drive the edge loop, stop at four
        stations, cross the home bridge, or take the three loops in the sky.
      </p>
      {!owned ? (
        <button
          className="fw-primary"
          disabled={money < 110000}
          onClick={() => action("buy")}
        >
          Buy train · $110,000
        </button>
      ) : mode !== "train" ? (
        <div className="fw-products">
          <button
            className="fw-primary"
            disabled={mode !== "foot" || !nearby}
            onClick={() => action("board")}
          >
            Climb aboard{" "}
            <small>
              {nearby ? "Walk up to the cab" : "Walk closer to the train"}
            </small>
          </button>
          <button
            onClick={() => {
              if (train)
                useAdventureSession.getState().setWaypoint({
                  id: "train",
                  label: "Your train",
                  x: train.position.x,
                  z: train.position.z,
                });
            }}
          >
            Find my train{" "}
            <small>
              {train?.returning ? "Returning to Fence Station" : "GPS marker"}
            </small>
          </button>
        </div>
      ) : (
        <>
          <p>
            {Math.round(train?.speed ?? 0)} m/s ·{" "}
            {train?.path === "sky"
              ? "Sky railway"
              : train?.path === "spur"
                ? "Home branch"
                : "Countryside loop"}
          </p>
          <h3>Choose a station</h3>
          <div className="fw-products">
            {RAIL_STOPS.map((stop) => (
              <button
                key={stop}
                onClick={() => action("route", stop)}
                style={{ textTransform: "capitalize" }}
              >
                🚉 {stop} Station{" "}
                <small>
                  {stop === "fence"
                    ? "Your home platform"
                    : "Automatic station stop"}
                </small>
              </button>
            ))}
          </div>
          <div className="fw-products">
            <button onClick={() => action("sky")}>
              {train?.path === "sky"
                ? "Return to ground railway"
                : "Ride the sky railway"}
            </button>
            <button onClick={() => action("stop")}>Stop train</button>
            <button onClick={() => action("boost")}>
              NOS boost · 3 seconds
            </button>
            <button onClick={() => action("exit")}>
              Hop off <small>The train drives home by itself</small>
            </button>
          </div>
          <p className="fw-muted">
            W / up: gas. S / down or brake: slow down. N: boost. Choose a
            station to let the train drive itself.
          </p>
        </>
      )}
    </div>
  );
}

export function TrainHUD() {
  const mode = useFourWheeler3dStore((s) => s.mode),
    paused = useFourWheeler3dStore((s) => s.isPaused),
    train = useAdventureSession((s) => s.rail);
  if (mode !== "train" || paused || !train) return null;
  return (
    <div className="fw-train-hud pointer-events-auto absolute right-4 top-48 z-20 max-w-64 rounded-xl border border-white/20 bg-slate-950/85 p-3 text-sm text-white">
      <p className="font-bold">
        🚂 {train.path === "sky" ? "Sky railway" : "Hank's railway"}
      </p>
      <p>
        {Math.round(train.speed)} m/s{" "}
        {train.target && (
          <span className="capitalize">· To {train.target} Station</span>
        )}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          className="min-h-11 rounded-lg bg-amber-700 px-3 font-bold"
          onClick={() => action("boost")}
        >
          NOS
        </button>
        <button
          className="min-h-11 rounded-lg bg-amber-700 px-3 font-bold"
          onClick={() => useAdventureSession.getState().openPanel("train")}
        >
          Stations
        </button>
        <button
          className="min-h-11 rounded-lg bg-slate-700 px-3"
          onClick={() => action("exit")}
        >
          Hop off
        </button>
      </div>
    </div>
  );
}

export default TrainPanel;
