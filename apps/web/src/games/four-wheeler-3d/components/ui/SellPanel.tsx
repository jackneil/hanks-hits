"use client";
import { useFourWheeler3dStore } from "../../lib/store";
import { useAdventureSession } from "../../lib/adventureSession";
import { sellMilk, sellVehicle } from "../../lib/economy";
import { resalePrice } from "../../lib/catalog";
import { LANDMARKS } from "../../lib/landmarks";
import { distanceTo } from "../../lib/destinations";
import { transact } from "../../lib/transactions";
import { dollars } from "./ShopPanel";

export function SellPanel() {
  const p = useFourWheeler3dStore((s) => s.progress),
    s = useAdventureSession();
  const current = p.adventure.fleet[p.adventure.activeVehicleId ?? ""];
  const trailer = current?.hitch ? p.adventure.fleet[current.hitch] : null;
  const nearby = Object.values(p.adventure.fleet).filter(
    (v) => distanceTo(v.position, LANDMARKS.sellBox) < 15,
  );
  const ids = [
    ...new Set([
      ...(current ? [current.id] : []),
      ...(trailer ? [trailer.id, ...trailer.cargo] : []),
      ...nearby.map((v) => v.id),
    ]),
  ];
  const here = () =>
    distanceTo(
      useAdventureSession.getState().playerSnapshot,
      LANDMARKS.sellBox,
    ) < 12;
  return (
    <>
      <p className="fw-muted">
        Sell your current ride, its trailer and cargo, nearby parked rides, milk
        or hunting haul. Each sale is paid once.
      </p>
      <div className="fw-build-list">
        <button
          onClick={() => {
            if (here()) s.requestAction("hunt:sell");
          }}
        >
          Sell hunting haul
        </button>
        <button
          disabled={!p.adventure.bucket?.fill}
          onClick={() => {
            if (here()) transact(sellMilk);
          }}
        >
          Sell milk · {dollars(200 * (p.adventure.bucket?.fill ?? 0))}
        </button>
      </div>
      <h3>Rides and cargo</h3>
      <div className="fw-build-list">
        {ids.map((id) => {
          const v = p.adventure.fleet[id];
          if (!v || !resalePrice(v.type)) return null;
          return (
            <button
              key={id}
              onClick={() => {
                if (!here()) return;
                if (transact((p) => sellVehicle(p, id)) && id === current?.id) {
                  const store = useFourWheeler3dStore.getState();
                  store.setMode("foot");
                  s.relocate(
                    { ...s.playerSnapshot, x: s.playerSnapshot.x + 2 },
                    s.playerSnapshot.heading,
                  );
                }
              }}
            >
              Sell {v.type} · {dollars(resalePrice(v.type))}
              <small>
                {id}
                {v.cargo.length
                  ? ` · ${v.cargo.length} cargo items stay parked`
                  : ""}
              </small>
            </button>
          );
        })}
      </div>
    </>
  );
}
