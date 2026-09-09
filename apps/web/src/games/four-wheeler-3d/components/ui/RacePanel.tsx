"use client";

import { useAdventureSession } from "../../lib/adventureSession";
import { useFourWheeler3dStore } from "../../lib/store";
import { RACE_LENGTH } from "../../lib/race";
import { tuningFor } from "../../lib/vehicles";

const request = (name: string) =>
  useAdventureSession.getState().requestAction(`race:${name}`);
export function RacePanel() {
  const race = useAdventureSession((s) => s.race);
  const progress = useFourWheeler3dStore((s) => s.progress);
  const active = race?.phase === "racing" || race?.phase === "countdown";
  return (
    <div>
      <p className="fw-muted">
        One complete {(RACE_LENGTH / 1000).toFixed(1)} km lap around the world.
        Your rival uses the same vehicle at 80% of your top speed. Follow every
        checkpoint in order.
      </p>
      {race && (
        <>
          <h3>{tuningFor(race.vehicleType).label} race</h3>
          <p role="status">{race.message}</p>
          <dl className="fw-trophies">
            <div>
              <dt>Time</dt>
              <dd>{race.elapsed.toFixed(1)} s</dd>
            </div>
            <div>
              <dt>Checkpoints</dt>
              <dd>
                {race.checkpoint} / {race.totalCheckpoints}
              </dd>
            </div>
            <div>
              <dt>Off-track strikes</dt>
              <dd>{race.strikes}</dd>
            </div>
            <div>
              <dt>Prize</dt>
              <dd>$10,000</dd>
            </div>
          </dl>
        </>
      )}
      <div className="fw-build-list">
        {active && (
          <button
            className="fw-primary"
            onClick={() => useAdventureSession.getState().openPanel(null)}
          >
            Resume race
          </button>
        )}
        <button
          className={active ? "" : "fw-primary"}
          onClick={() => request(race ? "retry" : "start")}
        >
          {race ? "Restart race" : "Start race"}
        </button>
        {race && (
          <button onClick={() => request("abandon")}>
            End race and free roam
          </button>
        )}
      </div>
      <p className="fw-muted">
        Four blue boxes trigger NOS and slow the other racer. Leaving the road
        slows your vehicle and records a strike. Find the dirt road and keep
        racing.
      </p>
      <p>
        Wins: {progress.racesWon} · Best:{" "}
        {progress.bestRaceTimeMs
          ? `${(progress.bestRaceTimeMs / 1000).toFixed(1)} s`
          : "No completed race yet"}
      </p>
    </div>
  );
}

/** Always mounted by the HUD; controls remain usable underneath it. */
export function RaceStatus() {
  const race = useAdventureSession((s) => s.race);
  const panel = useAdventureSession((s) => s.panel);
  const paused = useFourWheeler3dStore((s) => s.isPaused);
  const speed = useAdventureSession((s) => s.playerSnapshot.speed);
  if (paused || panel || !race || !["countdown", "racing"].includes(race.phase))
    return null;
  return (
    <button
      type="button"
      className="fw-race-status"
      aria-label="Race options: resume, restart or end race"
      onClick={() => useAdventureSession.getState().openPanel("race")}
      style={{
        position: "fixed",
        top: 88,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 44,
        pointerEvents: "auto",
        background: "#17201de8",
        color: "#f4f0e5",
        padding: "10px 18px",
        borderRadius: 10,
        textAlign: "center",
        maxWidth: "65vw",
        minHeight: 44,
      }}
    >
      {race.phase === "countdown" ? (
        <strong
          className="fw-race-countdown"
          role="status"
          style={{ fontSize: 52 }}
        >
          {Math.min(3, Math.max(1, Math.ceil(race.countdown)))}
        </strong>
      ) : (
        <>
          <strong>
            {race.elapsed.toFixed(1)} s · {race.checkpoint}/
            {race.totalCheckpoints}
          </strong>
          <span
            className="fw-race-message"
            style={{ display: "block", fontSize: 12 }}
          >
            {race.message}
          </span>
        </>
      )}
      <span style={{ display: "block", fontSize: 11 }}>
        <span className="fw-race-speed">
          {Math.round(Math.abs(speed) * 2.237)} MPH ·{" "}
        </span>
        Race options
      </span>
    </button>
  );
}
