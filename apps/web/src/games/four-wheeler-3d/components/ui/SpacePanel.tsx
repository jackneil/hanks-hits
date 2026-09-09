"use client";
import { ReadAloudButton } from "@/shared/components/ReadAloudButton";

import { useFourWheeler3dStore } from "../../lib/store";
import { useAdventureSession } from "../../lib/adventureSession";
import { LANDMARKS } from "../../lib/landmarks";
import {
  PLANETS,
  createPlanetSurface,
  type SpaceSession,
} from "../../lib/space";

const action = (name: string) =>
  useAdventureSession.getState().requestAction(`space:${name}`);
export function SpacePanel() {
  const adventure = useFourWheeler3dStore((s) => s.progress.adventure),
    money = useFourWheeler3dStore((s) => s.progress.money),
    mode = useFourWheeler3dStore((s) => s.mode);
  const player = useAdventureSession((s) => s.playerSnapshot);
  const nearby =
    Math.hypot(
      player.x - LANDMARKS.launchPad.x,
      player.z - LANDMARKS.launchPad.z,
    ) <
    130 / 18;
  return (
    <div>
      <p className="fw-muted">
        Take your rocket to Mars, Neptune, Saturn and the Moon. Dodge drifting
        meteorites, land, and explore each world for fourteen $5,000 gems.
      </p>
      {!adventure.rocketOwned ? (
        <button
          className="fw-primary"
          disabled={money < 500000}
          onClick={() => action("buy")}
        >
          Buy rocket · $500,000
        </button>
      ) : (
        <div className="fw-products">
          <button
            className="fw-primary"
            disabled={mode !== "foot" || !nearby}
            onClick={() => action("launch")}
          >
            Blast off{" "}
            <small>
              {nearby ? "Ready at the launch pad" : "Walk to the launch pad"}
            </small>
          </button>
          <button
            onClick={() =>
              useAdventureSession.getState().setWaypoint({
                id: "rocket-pad",
                label: "Launch Pad",
                ...LANDMARKS.launchPad,
              })
            }
          >
            Find my rocket <small>GPS to the launch pad</small>
          </button>
        </div>
      )}
      <h3>Space passport</h3>
      <div className="fw-products">
        {PLANETS.map((p) => (
          <div key={p.id} className="rounded-lg border border-white/15 p-3">
            <strong>{p.name}</strong>
            <p>
              {adventure.space.visited.includes(p.id) ? "Landed" : "Unexplored"}{" "}
              · {adventure.space.gems[p.id]?.length ?? 0}/14 gems
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SpaceMap({
  flight,
  collected,
}: {
  flight: SpaceSession;
  collected: string[];
}) {
  const surface = flight.planet ? createPlanetSurface(flight.planet) : null;
  return (
    <svg
      viewBox="-280 -280 560 560"
      className="h-32 w-32 rounded-full border border-slate-500/60 bg-slate-950/80 sm:h-40 sm:w-40"
      role="img"
      aria-label={
        surface
          ? "Surface map with remaining gems and rocket"
          : "Space map with four planets and your rocket"
      }
    >
      {surface ? (
        <>
          <circle
            r="250"
            fill={PLANETS.find((p) => p.id === flight.planet)!.dark}
          />
          {surface.gems
            .filter((g) => !collected.includes(g.id))
            .map((g) => (
              <circle
                key={g.id}
                cx={g.x * 1.73}
                cy={g.z * 1.73}
                r="5"
                fill="#74f0ef"
              />
            ))}
          <path d="M-7 150 L0 133 L7 150 Z" fill="#f4e3bb" />
          <circle
            cx={flight.x * 1.73}
            cy={flight.z * 1.73}
            r="7"
            fill="white"
          />
        </>
      ) : (
        <>
          {PLANETS.map((p) => (
            <g key={p.id}>
              <circle cx={p.x} cy={p.z} r={p.radius} fill={p.color} />
              <text
                x={p.x}
                y={p.z - p.radius - 9}
                textAnchor="middle"
                fill="#f3f2e9"
                fontSize="22"
              >
                {p.name}
              </text>
            </g>
          ))}
          <g
            transform={`translate(${Math.max(-270, Math.min(270, flight.x))} ${Math.max(-270, Math.min(270, flight.z))}) rotate(${(-flight.heading * 180) / Math.PI})`}
          >
            <path
              d="M0 10 L-7 -8 L0 -3 L7 -8 Z"
              fill="white"
              stroke="#14202d"
              strokeWidth="2"
            />
          </g>
        </>
      )}
    </svg>
  );
}

export function SpaceHUD() {
  const flight = useAdventureSession((s) => s.spaceflight),
    mode = useFourWheeler3dStore((s) => s.mode),
    paused = useFourWheeler3dStore((s) => s.isPaused),
    gems = useFourWheeler3dStore((s) => s.progress.adventure.space.gems);
  if (!flight || !["space", "planet"].includes(mode) || paused) return null;
  const planet = PLANETS.find((p) => p.id === flight.planet),
    near = PLANETS.find((p) => p.id === flight.nearPlanet),
    collected = planet ? (gems[planet.id] ?? []) : [];
  return (
    <div className="pointer-events-none absolute inset-0 z-20 text-white">
      <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-xl border border-white/20 bg-slate-950/85 px-5 py-3 text-center">
        <p className="text-lg font-bold">
          {planet ? planet.name : "Outer space"}
        </p>
        <p className="text-xs text-slate-300">
          {planet
            ? `${collected.length}/14 gems · $5,000 each`
            : `${Math.round(flight.speed)} m/s · Dodge the meteorites`}
        </p>
      </div>
      <div className="absolute left-4 top-16">
        <SpaceMap flight={flight} collected={collected} />
      </div>
      <div className="pointer-events-auto absolute right-4 top-28 flex max-w-48 flex-col gap-2">
        {mode === "space" && (
          <button
            className="min-h-12 rounded-xl bg-slate-800/95 px-4 font-bold"
            onClick={() => action("return")}
          >
            Return to Earth
          </button>
        )}
        {mode === "space" && near && (
          <button
            className="min-h-12 rounded-xl bg-amber-600 px-4 font-bold"
            onClick={() => action("land")}
          >
            Land on {near.name}
          </button>
        )}
        {mode === "planet" && flight.nearRocket && (
          <button
            className="min-h-12 rounded-xl bg-amber-600 px-4 font-bold"
            onClick={() => action("board")}
          >
            Board rocket
          </button>
        )}
      </div>
      <div className="pointer-events-auto absolute right-4 top-16">
        <ReadAloudButton
          variant="icon"
          text={
            planet
              ? "Walk with the on-screen arrows or WASD. Walk over gems to collect five thousand dollars each. Find your rocket on the map, then board it to leave."
              : "Hold Thrust and use the turn buttons to fly. On a keyboard, W speeds up, A and D turn, S brakes. Fly close to a planet and choose Land. Return to Earth brings you home."
          }
        />
      </div>
      <p className="absolute bottom-36 left-1/2 max-w-64 -translate-x-1/2 rounded-lg bg-slate-950/80 px-3 py-2 text-center text-xs sm:bottom-6">
        {planet
          ? "Move with WASD or the arrows. Walk over gems to collect them. Return to your rocket to leave."
          : "W / up: thrust. A and D: steer. S / down: brake. Fly close to a planet to land."}
      </p>
    </div>
  );
}

export default SpacePanel;
