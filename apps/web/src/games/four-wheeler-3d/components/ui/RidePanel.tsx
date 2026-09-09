"use client";
import { useFourWheeler3dStore } from "../../lib/store";
import { useAdventureSession } from "../../lib/adventureSession";
import { isWaterVehicle, isAirVehicle, OFFERS } from "../../lib/catalog";
import { canSwitchRide } from "../../lib/rideTransitions";
import { canWalkDeck } from "../../lib/transport";
import { tuningFor } from "../../lib/vehicles";

export function RidePanel() {
  const p = useFourWheeler3dStore((s) => s.progress),
    mode = useFourWheeler3dStore((s) => s.mode),
    session = useAdventureSession();
  const v = p.adventure.fleet[p.adventure.activeVehicleId ?? ""];
  if (!v) return <p>Walk up to a ride and press E to get started.</p>;
  if (!["vehicle", "boat", "aircraft", "deck"].includes(mode))
    return (
      <div>
        <p>Walk up to your ride and use it before operating its equipment.</p>
        <button
          onClick={() =>
            session.setWaypoint({
              id: v.id,
              label: `Your ${v.type}`,
              x: v.position.x,
              z: v.position.z,
            })
          }
        >
          Find your ride
        </button>
      </div>
    );
  const action = (name: string) => {
    session.requestAction(name);
    session.openPanel(null);
  };
  const water = isWaterVehicle(v.type),
    air = isAirVehicle(v.type);
  const alternatives = Object.values(p.adventure.fleet).filter((other) =>
    canSwitchRide(p.adventure, other.id, mode, session.playerSnapshot.speed),
  );
  return (
    <div className="fw-guide">
      <h3>
        {OFFERS.find(
          (offer) => offer.kind === "vehicle" && offer.key === v.type,
        )?.label ?? tuningFor(v.type).label}
      </h3>
      <p>Every ride has its own place, paint and upgrades.</p>
      {["vehicle", "boat", "aircraft"].includes(mode) && (
        <button
          className="fw-primary"
          onClick={() => {
            useFourWheeler3dStore.getState().startNos();
            session.openPanel(null);
          }}
        >
          Use NOS boost
        </button>
      )}
      {!water && !air && (
        <button
          aria-pressed={session.lightsOn}
          onClick={() =>
            useAdventureSession.setState({ lightsOn: !session.lightsOn })
          }
        >
          Headlights: {session.lightsOn ? "on" : "off"}
        </button>
      )}
      {v.type === "atv" && mode === "vehicle" && (
        <button onClick={() => action("vehicle:parachute")}>
          Open ATV parachute
        </button>
      )}
      {v.type === "rv" && mode === "vehicle" && (
        <button onClick={() => action("home:rv")}>Go inside your RV</button>
      )}
      {water && (
        <>
          <h3>On the water</h3>
          <div className="fw-build-list">
            {canWalkDeck(v.type) && (
              <button
                onClick={() =>
                  action(mode === "deck" ? "boat:helm" : "boat:deck")
                }
              >
                {mode === "deck" ? "Take the helm" : "Walk on deck"}
              </button>
            )}
            <button onClick={() => session.openPanel("fishing")}>
              Open fishing kit
            </button>
            <button onClick={() => action("boat:anchor")}>
              Raise / lower anchor
            </button>
            <button onClick={() => action("boat:lights")}>
              Switch boat lights
            </button>
            <button onClick={() => action("boat:canopy")}>
              Open / close canopy
            </button>
          </div>
        </>
      )}
      {v.type === "yacht" && (
        <>
          <h3>Your yacht</h3>
          <div className="fw-build-list">
            <button onClick={() => action("boat:cabin")}>
              Go inside the cabin
            </button>
            <button onClick={() => action("boat:net")}>
              Raise / lower fishing net
            </button>
            {[
              ["tender", "Fishing tender"],
              ["jetski", "Jet ski"],
              ["utv", "UTV"],
              ["heli", "Helicopter"],
            ].map(([id, label]) => (
              <button key={id} onClick={() => action(`boat:${id}`)}>
                Launch {label}
              </button>
            ))}
          </div>
          <p className="fw-muted">
            Your extras belong to this yacht. Park beside it and use Load on
            yacht to bring them aboard again.
          </p>
        </>
      )}
      {Object.values(p.adventure.fleet).some(
        (c) => c.type === "yacht" && c.id !== v.id,
      ) && <button onClick={() => action("boat:load")}>Load on yacht</button>}
      {air && (
        <div className="fw-build-list">
          {["climb", "descend", "level", "roll", "bomb", "parachute"].map(
            (name) => (
              <button key={name} onClick={() => action(`air:${name}`)}>
                {name === "bomb"
                  ? "Drop a smoke bomb"
                  : name[0].toUpperCase() + name.slice(1)}
              </button>
            ),
          )}
        </div>
      )}
      {alternatives.length > 0 && (
        <>
          <h3>
            Switch to another {water ? "boat" : air ? "aircraft" : "land ride"}
          </h3>
          <p className="fw-muted">
            At a stop, take over another{" "}
            {water ? "boat" : air ? "aircraft" : "land ride"} here. Your current
            ride takes its parking spot.
          </p>
          <div className="fw-build-list">
            {alternatives.map((other) => (
              <button
                key={other.id}
                onClick={() => action(`world:switch:${other.id}`)}
              >
                <span
                  className="fw-paint-chip"
                  style={{ background: other.paint }}
                />
                {other.type.toUpperCase()}
                <small>{other.id}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
