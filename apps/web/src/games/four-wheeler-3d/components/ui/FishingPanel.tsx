"use client";

import { useAdventureSession } from "../../lib/adventureSession";
import { useFourWheeler3dStore } from "../../lib/store";
import { BAITS, FISH, fishSaleValue } from "../../lib/fishing";
import { FISH_TYPES } from "../../lib/constants";

const request = (name: string, payload?: string) =>
  useAdventureSession.getState().requestAction(`fishing:${name}`, payload);

export function FishingPanel() {
  const fishing = useAdventureSession((s) => s.fishing);
  const progress = useFourWheeler3dStore((s) => s.progress);
  const mode = useFourWheeler3dStore((s) => s.mode);
  const rods = progress.adventure.inventory.rod ?? 0;
  const bait = progress.adventure.hunting.activeBait;
  const fishingNow =
    fishing && ["casting", "bite", "reeling"].includes(fishing.phase);
  const canReel = fishing?.phase === "bite" || fishing?.phase === "reeling";
  const tension = fishing?.tension ?? 0;
  return (
    <div>
      <p className="fw-muted">
        Stop your boat near a school. Cast every rod, then pull in short bursts.
        Release to ease the line tension.
      </p>
      <p>
        <strong>
          {rods} {rods === 1 ? "rod" : "rods"}
        </strong>{" "}
        · {bait ? (BAITS[bait]?.label ?? bait) : "No bait"}
        {bait === "rainbow"
          ? ` (${progress.adventure.hunting.rainbowBaitUses} catches left)`
          : ""}
      </p>
      <p role="status" aria-live="polite">
        {fishing?.message ?? "Find fish near the surface, then cast."}
      </p>
      <div className="fw-build-list">
        <button onClick={() => request("find")}>🧭 Find nearby fish</button>
        <button
          className="fw-primary"
          disabled={
            !rods || !["boat", "deck"].includes(mode) || Boolean(fishingNow)
          }
          onClick={() => request("cast")}
        >
          🎣 Cast {rods > 1 ? `${rods} lines` : "line"}
        </button>
        <button
          disabled={!canReel}
          aria-pressed={fishing?.reeling ?? false}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            request("reel");
          }}
          onPointerUp={() => request("release")}
          onPointerCancel={() => request("release")}
          onLostPointerCapture={() => request("release")}
          onKeyDown={(event) => {
            if ((event.key === " " || event.key === "Enter") && !event.repeat) {
              event.preventDefault();
              request("reel");
            }
          }}
          onKeyUp={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.preventDefault();
              request("release");
            }
          }}
          onBlur={() => request("release")}
        >
          🧵 Hold to reel
        </button>
      </div>
      {canReel && (
        <div style={{ margin: "22px 0" }}>
          <label>
            Line tension: {Math.round(tension * 100)}%
            <progress
              aria-label="Line tension"
              max={1}
              value={tension}
              style={{
                width: "100%",
                height: 18,
                accentColor: tension > 0.75 ? "#d87956" : "#83b089",
              }}
            />
          </label>
          <label>
            Reeled in: {Math.round((fishing?.reelProgress ?? 0) * 100)}%
            <progress
              aria-label="Reeling progress"
              max={1}
              value={fishing?.reelProgress ?? 0}
              style={{ width: "100%", height: 18, accentColor: "#eac681" }}
            />
          </label>
          <p className="fw-muted">
            Release before tension reaches 100%. Hold Space or Enter on the reel
            button, or press and hold with your finger.
          </p>
        </div>
      )}
      {!rods && (
        <button
          onClick={() =>
            useAdventureSession.getState().openPanel("shop", "anyStore")
          }
        >
          Buy a fishing rod
        </button>
      )}
      <h3 style={{ marginTop: 28 }}>Fish bag</h3>
      <dl className="fw-trophies">
        {FISH_TYPES.filter((type) => type !== "rainbow").map((type) => (
          <div key={type}>
            <dt>
              {FISH[type].label}: {progress.fishCaught[type] ?? 0}
            </dt>
            <dd>${FISH[type].value.toLocaleString("en-US")} each</dd>
          </div>
        ))}
      </dl>
      <button
        disabled={!fishSaleValue(progress.fishCaught)}
        onClick={() => request("sell")}
      >
        Sell fish · $
        {fishSaleValue(progress.fishCaught).toLocaleString("en-US")}
      </button>
      <p className="fw-muted">
        Two rare rainbow fish live near the middle of the lake. Catch one for
        $1,000,000 immediately; another takes its place. Nets cannot catch
        rainbow fish.
      </p>
      <h3>Bait guide</h3>
      <div className="fw-build-list">
        {Object.entries(BAITS).map(([key, item]) => (
          <button
            key={key}
            aria-pressed={bait === key}
            onClick={() =>
              useAdventureSession.getState().openPanel("shop", "anyStore")
            }
          >
            {item.label}
            <small>
              ${item.price.toLocaleString("en-US")} ·{" "}
              {Math.round(item.chances.rainbow * 100)}% rainbow bite chance
            </small>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Mount beside the world HUD so the celebration survives closing the fishing panel. */
export function RainbowCelebration() {
  const remaining = useAdventureSession(
    (s) => s.fishing?.rainbowCelebration ?? 0,
  );
  const paused = useFourWheeler3dStore((s) => s.isPaused);
  if (remaining <= 0 || paused) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-20 z-50 w-[min(90vw,430px)] -translate-x-1/2 rounded-2xl border border-white/70 px-5 py-4 text-center text-white shadow-xl"
      style={{
        background:
          "linear-gradient(115deg,#ba3d50,#a56426,#26755f,#286ca0,#76538e)",
      }}
    >
      <p className="text-lg font-black">🌈 Rainbow catch!</p>
      <p className="text-2xl font-black">+$1,000,000</p>
      <p className="text-sm">
        Another rainbow fish is already waiting in the lake.
      </p>
    </div>
  );
}
