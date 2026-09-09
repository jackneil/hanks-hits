"use client";
import { VehiclePreview } from "./VehiclePreview";
import { displaySpeedMph } from "../../lib/displaySpeed";
import { useState } from "react";
import {
  AMAZON_STORES,
  PAINT_COLORS,
  STORE_CATALOGS,
  STORE_LABELS,
  type StoreId,
} from "../../lib/catalog";
import {
  buyOffer,
  customizeVehicle,
  orderDelivery,
  sellVehicle,
} from "../../lib/economy";
import { transact } from "../../lib/transactions";
import { useFourWheeler3dStore } from "../../lib/store";
import { useAdventureSession } from "../../lib/adventureSession";
import { DESTINATIONS, distanceTo } from "../../lib/destinations";

export const dollars = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;
export function ShopPanel({
  storeId,
  delivery = false,
}: {
  storeId?: string | null;
  delivery?: boolean;
}) {
  const [details, setDetails] = useState<string | null>(null);
  const [category, setCategory] = useState<StoreId>("anyStore"),
    [query, setQuery] = useState("");
  const progress = useFourWheeler3dStore((s) => s.progress);
  const id = (
    storeId && Object.hasOwn(STORE_CATALOGS, storeId) ? storeId : category
  ) as StoreId;
  const offers = STORE_CATALOGS[id].filter((o) =>
    o.label.toLowerCase().includes(query.toLowerCase()),
  );
  const purchase = (offerId: string) => {
    const session = useAdventureSession.getState(),
      destination = DESTINATIONS.find((d) => d.id === id);
    if (
      !delivery &&
      (!destination ||
        distanceTo(session.playerSnapshot, destination) > destination.radius)
    ) {
      useFourWheeler3dStore
        .getState()
        .setHint("Visit this store to buy here, or order from your phone.");
      return;
    }
    if (
      transact((p) =>
        delivery
          ? orderDelivery(p, offerId)
          : buyOffer(p, offerId, session.playerSnapshot),
      ) &&
      delivery
    )
      session.openPanel(null);
  };
  return (
    <div className="fw-shop">
      {delivery && (
        <>
          <p className="fw-muted">
            Order from anywhere. Your delivery plane brings one order at a time.
          </p>
          <label>
            Department
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as StoreId)}
            >
              {AMAZON_STORES.map((id) => (
                <option key={id} value={id}>
                  {STORE_LABELS[id]}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label className="fw-search">
        <span>Find a ride or item</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search this store"
        />
      </label>
      {progress.adventure.delivery && delivery && (
        <p role="status">
          Delivery arriving in{" "}
          {Math.ceil(progress.adventure.delivery.remainingSeconds)} seconds
        </p>
      )}
      {details && STORE_CATALOGS[id].find((o) => o.id === details) && (
        <VehiclePreview
          offer={STORE_CATALOGS[id].find((o) => o.id === details)!}
          onClose={() => setDetails(null)}
        />
      )}
      <div className="fw-products">
        {offers.map((o) => (
          <article className="fw-product" key={o.id}>
            <div
              className={`fw-product-art fw-product-${o.kind}`}
              aria-hidden="true"
            >
              <span>
                {o.kind === "vehicle"
                  ? "◒"
                  : o.kind === "gear"
                    ? "⌖"
                    : o.kind === "bait"
                      ? "≈"
                      : "◇"}
              </span>
              <small>{o.kind.replaceAll("-", " ")}</small>
            </div>
            <h3>{o.label}</h3>
            <p>
              {dollars(o.price)}
              {o.kind === "vehicle" && (
                <small> · {displaySpeedMph(o.key)} mph</small>
              )}
            </p>
            {o.kind === "vehicle" && (
              <button
                onClick={() => setDetails(details === o.id ? null : o.id)}
              >
                View details & model
              </button>
            )}
            <button
              className="fw-primary"
              disabled={
                progress.money < o.price ||
                (delivery && !!progress.adventure.delivery)
              }
              onClick={() => purchase(o.id)}
            >
              {progress.money < o.price
                ? `Need ${dollars(o.price - progress.money)} more`
                : delivery
                  ? "Order delivery"
                  : "Buy"}
            </button>
          </article>
        ))}
      </div>
      {!offers.length && <p>No items match “{query}”. Try another name.</p>}
    </div>
  );
}

export function GaragePanel({ custom = false }: { custom?: boolean }) {
  const p = useFourWheeler3dStore((s) => s.progress),
    session = useAdventureSession();
  const [selected, setSelected] = useState(
    p.adventure.activeVehicleId ?? Object.keys(p.adventure.fleet)[0],
  );
  const vehicle = p.adventure.fleet[selected];
  const near = () => {
    const d = DESTINATIONS.find(
      (d) => d.id === (custom ? "customGarage" : "garage"),
    )!;
    return (
      distanceTo(useAdventureSession.getState().playerSnapshot, d) <= d.radius
    );
  };
  return (
    <div>
      <p className="fw-muted">
        Every ride stays where you park it. Select a ride to locate it on GPS.
      </p>
      <div className="fw-fleet-list">
        {Object.values(p.adventure.fleet).map((v) => (
          <button
            className={v.id === selected ? "is-selected" : ""}
            key={v.id}
            onClick={() => setSelected(v.id)}
          >
            <span style={{ background: v.paint }} className="fw-paint-chip" />
            <span>
              {v.type.toUpperCase()}
              <small>
                {v.id === p.adventure.activeVehicleId
                  ? "Current ride"
                  : `${Math.round(distanceTo(session.playerSnapshot, v.position))} m away`}
              </small>
            </span>
          </button>
        ))}
      </div>
      {vehicle && (
        <section className="fw-detail">
          <h3>{vehicle.type.toUpperCase()}</h3>
          <button
            onClick={() =>
              session.setWaypoint({
                id: vehicle.id,
                label: `Your ${vehicle.type}`,
                x: vehicle.position.x,
                z: vehicle.position.z,
              })
            }
          >
            Locate on GPS
          </button>
          {custom && (
            <>
              <h4>Paint color</h4>
              <div className="fw-swatches">
                {PAINT_COLORS.map((color) => (
                  <button
                    key={color}
                    style={{ background: color }}
                    aria-label={`Paint ${color}`}
                    aria-pressed={vehicle.paint === color}
                    onClick={() => {
                      if (near())
                        transact((p) =>
                          customizeVehicle(p, vehicle.id, { paint: color }),
                        );
                    }}
                  />
                ))}
              </div>
              <h4>Performance</h4>
              <p>Speed adjustment: {vehicle.speedUpgrade.toFixed(0)} mph</p>
              <button
                onClick={() => {
                  if (near())
                    transact((p) =>
                      customizeVehicle(p, vehicle.id, { speedDelta: 10 }),
                    );
                }}
              >
                +10 mph · $10
              </button>
              <button
                onClick={() => {
                  if (near())
                    transact((p) =>
                      customizeVehicle(p, vehicle.id, { speedDelta: -10 }),
                    );
                }}
              >
                −10 mph · refund
              </button>
            </>
          )}
          <button
            className="fw-danger"
            onClick={() => {
              if (!near()) return;
              if (transact((p) => sellVehicle(p, vehicle.id))) {
                if (vehicle.id === p.adventure.activeVehicleId) {
                  useFourWheeler3dStore.getState().setMode("foot");
                  session.relocate(
                    session.playerSnapshot,
                    session.playerSnapshot.heading,
                  );
                }
                setSelected("");
              }
            }}
          >
            Sell this ride
          </button>
        </section>
      )}
    </div>
  );
}
