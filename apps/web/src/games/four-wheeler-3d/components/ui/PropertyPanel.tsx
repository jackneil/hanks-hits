"use client";
import { useState } from "react";
import {
  BUILD_PRICES,
  LAND_PRICE,
  LAND_UPGRADE_PRICES,
} from "../../lib/catalog";
import { useFourWheeler3dStore } from "../../lib/store";
import { useAdventureSession } from "../../lib/adventureSession";
import { dollars } from "./ShopPanel";
import {
  BUILDING_LABELS,
  GARAGE_BAYS,
  PROPERTY_RANGE,
  buildingDimensions,
  canEnterProperty,
  canManageProperty,
  propertyDoor,
  propertySize,
  propertySlot,
} from "../../lib/property";

export function PropertyPanel({ id }: { id: string | null }) {
  const progress = useFourWheeler3dStore((s) => s.progress),
    mode = useFourWheeler3dStore((s) => s.mode);
  const player = useAdventureSession((s) => s.playerSnapshot),
    interior = useAdventureSession((s) => s.interior);
  const plot = id ? progress.adventure.plots[id] : null;
  if (!plot || !id) return <p>Visit a land plot to see what you can build.</p>;
  const action = (command: string, slot?: number, detail?: string) =>
    useAdventureSession
      .getState()
      .requestAction(
        `property:${command}`,
        `${id}${slot === undefined ? "" : `:${slot}`}${detail === undefined ? "" : `:${detail}`}`,
      );
  const manage =
    mode === "foot" && canManageProperty(progress.adventure, id, player);
  return (
    <>
      <p>Two building spots, room to grow, and a view all your own.</p>
      {!plot.owned ? (
        <button
          className="fw-primary"
          disabled={!manage || progress.money < LAND_PRICE}
          onClick={() => action("buy")}
        >
          Buy this land · {dollars(LAND_PRICE)}
        </button>
      ) : (
        <>
          <p>
            Land size: level {plot.sizeLevel + 1} ·{" "}
            {Math.round(propertySize(progress.adventure, id))} m across
          </p>
          {plot.sizeLevel < 4 ? (
            <button
              disabled={
                !manage || progress.money < LAND_UPGRADE_PRICES[plot.sizeLevel]
              }
              onClick={() => action("upgrade")}
            >
              Expand land · {dollars(LAND_UPGRADE_PRICES[plot.sizeLevel])}
            </button>
          ) : (
            <p>Your land is at its biggest size.</p>
          )}
          {([0, 1] as const).map((slot) => {
            const building = plot.buildings.find((b) => b.slot === slot),
              door = propertyDoor(progress.adventure, id, slot),
              center = propertySlot(progress.adventure, id, slot),
              nearDoor =
                door &&
                Math.hypot(player.x - door.x, player.z - door.z) <=
                  PROPERTY_RANGE,
              nearCenter =
                center &&
                Math.hypot(player.x - center.x, player.z - center.z) <=
                  PROPERTY_RANGE,
              inside = interior?.id === `${id}:${slot}`;
            const navigate = () => {
              const point = door ?? propertySlot(progress.adventure, id, slot);
              if (point)
                useAdventureSession.getState().setWaypoint({
                  id: `${id}-slot-${slot}`,
                  label: building
                    ? BUILDING_LABELS[building.type]
                    : `Build spot ${slot + 1}`,
                  ...point,
                });
            };
            return (
              <article className="fw-detail" key={slot}>
                <h3>Building spot {slot + 1}</h3>
                {building ? (
                  <>
                    <p>
                      {BUILDING_LABELS[building.type]}
                      {building.type.startsWith("house")
                        ? ` · ${buildingDimensions(building.type).rooms} bedroom${buildingDimensions(building.type).rooms > 1 ? "s" : ""}`
                        : ""}
                    </p>
                    <div className="fw-products">
                      <button
                        disabled={
                          !canEnterProperty(
                            progress.adventure,
                            id,
                            slot,
                            player,
                            mode,
                          )
                        }
                        onClick={() => action("enter", slot)}
                      >
                        Go inside <small>Walk to the entrance first</small>
                      </button>
                      <button onClick={navigate}>Find the entrance</button>
                    </div>
                    {building.type === "garage" && (
                      <>
                        <p>
                          {building.parkedVehicleIds.length}/{GARAGE_BAYS} bays
                          occupied · Door{" "}
                          {building.doorOpen ? "open" : "closed"}
                        </p>
                        <div className="fw-products">
                          <button
                            disabled={mode !== "foot" || !nearDoor}
                            onClick={() => action("door", slot)}
                          >
                            {building.doorOpen ? "Close" : "Open"} garage door{" "}
                            <small>Stand beside the doorway</small>
                          </button>
                          <button
                            disabled={
                              mode !== "vehicle" ||
                              (!nearDoor && !nearCenter) ||
                              !building.doorOpen
                            }
                            onClick={() => action("park", slot)}
                          >
                            Park this ride{" "}
                            <small>Drive up slowly with the door open</small>
                          </button>
                        </div>
                        {building.parkedVehicleIds.length > 0 ? (
                          <div className="fw-products">
                            {building.parkedVehicleIds.map(
                              (vehicleId, index) => {
                                const v = progress.adventure.fleet[vehicleId];
                                return v ? (
                                  <button
                                    key={vehicleId}
                                    disabled={
                                      !building.doorOpen ||
                                      (!inside &&
                                        (mode !== "foot" || !nearDoor))
                                    }
                                    onClick={() =>
                                      action("retrieve", slot, vehicleId)
                                    }
                                  >
                                    Retrieve {v.type}
                                    <small>
                                      Ride {index + 1} ·{" "}
                                      {v.speedUpgrade
                                        ? `+${v.speedUpgrade} mph`
                                        : "Original tune"}
                                    </small>
                                  </button>
                                ) : null;
                              },
                            )}
                          </div>
                        ) : (
                          <p className="fw-muted">
                            Your parked rides will appear here.
                          </p>
                        )}
                      </>
                    )}
                    {building.type === "trophy" && (
                      <p>
                        {Object.values(progress.adventure.trophyCounts).reduce(
                          (sum, n) => sum + n,
                          0,
                        )}{" "}
                        hunting trophies · {progress.adventure.collectedSkulls}{" "}
                        buck skulls on display
                      </p>
                    )}
                  </>
                ) : slot === 1 && !plot.buildings.length ? (
                  <p>Build in spot one first.</p>
                ) : (
                  <div className="fw-build-list">
                    {Object.entries(BUILD_PRICES).map(([type, price]) => (
                      <button
                        key={type}
                        disabled={!manage || progress.money < price}
                        onClick={() => action("build", slot, type)}
                      >
                        {BUILDING_LABELS[type as keyof typeof BUILD_PRICES]}
                        <small>{dollars(price)}</small>
                      </button>
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </>
      )}
    </>
  );
}
const COLORS = [
  "#e23b2e",
  "#ff7a1a",
  "#ffae1a",
  "#ffd23f",
  "#c8e020",
  "#5fc25f",
  "#2aa86a",
  "#10b0a0",
  "#2a9bd0",
  "#3a6ee0",
  "#1a4fd0",
  "#5a3ad0",
  "#7a4fd0",
  "#a84fe0",
  "#e84fae",
  "#ff5fd0",
  "#ff9fd0",
  "#ffc0cb",
  "#8a5a2a",
  "#5a3a1c",
  "#222831",
  "#444a52",
  "#9aa0a6",
  "#f4f4f4",
  "#d4a017",
  "#7a0a0a",
  "#0a2a6a",
  "#1a5a1a",
  "#006a6a",
  "#aa0a6a",
];
const WORDS = [
  "",
  "HANK",
  "COOL",
  "RACER",
  "#1",
  "PRO",
  "MVP",
  "BOSS",
  "GAMER",
  "CHAMP",
  "HUNTER",
  "LEGEND",
  "😎",
  "🏎️",
  "❤️",
  "⚡",
  "🔥",
  "🦌",
  "🎣",
  "🌈",
  "⭐",
];
export function HomePanel() {
  const p = useFourWheeler3dStore((s) => s.progress),
    [hour, setHour] = useState(8);
  const action = useAdventureSession((s) => s.requestAction);
  const outfit = (patch: Partial<typeof p.adventure.outfit>) =>
    useFourWheeler3dStore.getState().updateProgress((prev) => ({
      ...prev,
      adventure: {
        ...prev.adventure,
        outfit: { ...prev.adventure.outfit, ...patch },
      },
    }));
  return (
    <div className="fw-home">
      <button className="fw-primary" onClick={() => action("home:enter")}>
        Go inside
      </button>
      <section>
        <h3>Kitchen</h3>
        <p>A good meal gets you ready for another adventure.</p>
        <button disabled={p.money < 100} onClick={() => action("home:eat")}>
          Eat a meal · $100
        </button>
      </section>
      <section>
        <h3>Get some rest</h3>
        <label>
          Wake-up hour
          <select
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {h.toString().padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => action("home:sleep", String(hour))}>
          Sleep until {hour}:00
        </button>
      </section>
      <section>
        <h3>Your look</h3>
        <div className="fw-swatches">
          {COLORS.map((color) => (
            <button
              key={color}
              style={{ background: color }}
              aria-label={`Shirt color ${color}`}
              aria-pressed={p.adventure.outfit.color === color}
              onClick={() => outfit({ color })}
            />
          ))}
        </div>
        <label>
          Shirt text
          <input
            maxLength={10}
            value={p.adventure.outfit.text}
            onChange={(e) =>
              outfit({ text: e.target.value.toUpperCase().slice(0, 10) })
            }
          />
        </label>
        <div className="fw-word-grid">
          {WORDS.map((word) => (
            <button key={word} onClick={() => outfit({ text: word })}>
              {word || "Plain"}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
