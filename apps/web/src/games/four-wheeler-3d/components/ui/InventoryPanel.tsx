"use client";
import { useAdventureSession } from "../../lib/adventureSession";
import { useFourWheeler3dStore } from "../../lib/store";
import { HuntingPanel } from "./HuntingPanel";
import { sellMilk } from "../../lib/economy";
import { transact } from "../../lib/transactions";
import { distanceTo } from "../../lib/destinations";
import { LANDMARKS } from "../../lib/landmarks";

export function InventoryPanel() {
  const a = useFourWheeler3dStore((s) => s.progress.adventure),
    mode = useFourWheeler3dStore((s) => s.mode),
    milking = useAdventureSession((s) => s.milking),
    request = useAdventureSession((s) => s.requestAction);
  return (
    <>
      <section className="fw-detail">
        <h3>A day on the lake</h3>
        <button
          onClick={() => useAdventureSession.getState().openPanel("fishing")}
        >
          Open your fishing kit
        </button>
      </section>
      <section className="fw-detail">
        <h3>Your best friend</h3>
        <p>
          Bones collected: {a.collectedBones.length}/56 · Dog fullness:{" "}
          {Math.max(0, Math.round(100 - (a.dog.hungerHours / 24) * 100))}%
        </p>
        <button onClick={() => request("dog:whistle")}>Whistle</button>
        <button onClick={() => request("dog:feed")}>Feed your dog · $10</button>
      </section>
      <section className="fw-detail">
        <h3>Around the farm</h3>
        <button onClick={() => request("farm:saddle")}>
          Put a saddle on a horse
        </button>
        <button onClick={() => request("farm:ride")}>
          {mode === "mount" ? "Hop off your horse" : "Ride a horse"}
        </button>
        <p>
          {a.bucket
            ? `${a.bucket.colorName} bucket · ${Math.round(a.bucket.fill * 100)}% full · ${a.bucket.uses}/5 milkings`
            : "Buy a bucket and visit the cows to collect milk."}
        </p>
        <button onClick={() => request("farm:milk")}>
          {milking
            ? `Stop milking · ${Math.round(milking.progress * 100)}%`
            : "Milk a cow"}
        </button>
        {a.bucket && a.bucket.fill > 0 && (
          <button
            onClick={() => {
              if (
                distanceTo(
                  useAdventureSession.getState().playerSnapshot,
                  LANDMARKS.sellBox,
                ) < 6
              )
                transact(sellMilk);
              else
                useFourWheeler3dStore
                  .getState()
                  .setHint("Take your milk to the sell box.");
            }}
          >
            Sell milk at the sell box
          </button>
        )}
      </section>
      <section className="fw-detail">
        <HuntingPanel />
      </section>
    </>
  );
}
