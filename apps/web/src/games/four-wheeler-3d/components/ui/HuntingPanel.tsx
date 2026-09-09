"use client";

import { useEffect, useRef, useState } from "react";
import { useFourWheeler3dStore } from "../../lib/store";
import { useAdventureSession } from "../../lib/adventureSession";
import { ANIMAL_TYPES, canAim, killValue } from "../../lib/hunting";
import { OFFERS } from "../../lib/catalog";

const names = Object.fromEntries(
  OFFERS.filter((o) => ["gear", "saddle"].includes(o.kind)).map((o) => [
    o.key,
    o.label,
  ]),
);
const request = (name: string) =>
  useAdventureSession.getState().requestAction(`hunt:${name}`);

export function HuntingPanel() {
  const a = useFourWheeler3dStore((s) => s.progress.adventure);
  const mode = useFourWheeler3dStore((s) => s.mode);
  const inv = a.inventory,
    held = Object.values(a.heldKills).reduce((sum, n) => sum + n, 0);
  return (
    <div className="fw-hunting">
      <p className="fw-muted">
        Find wildlife beyond the fence. Use your toy rifle or bow, then let your
        dog bring back your tags.
      </p>
      <div className="fw-products">
        <button
          className="fw-primary"
          disabled={!canAim(mode)}
          onClick={() => request("scope")}
        >
          🎯 Raise scope <small>G · on foot or in a stand</small>
        </button>
        <button
          disabled={!a.dog.alive || a.hunting.carcasses.length === 0}
          onClick={() => request("retrieve")}
        >
          🐕 Retrieve <small>{a.hunting.carcasses.length} tags to fetch</small>
        </button>
        <button disabled={held === 0} onClick={() => request("sell")}>
          💰 Sell {held} tags{" "}
          <small>
            $
            {Object.entries(a.heldKills)
              .reduce((sum, [type, n]) => sum + killValue(type) * n, 0)
              .toLocaleString("en-US")}
          </small>
        </button>
        <button
          aria-pressed={a.hunting.camoOn}
          disabled={!inv.camo}
          onClick={() => request("camo")}
        >
          🥷 Camo: {a.hunting.camoOn ? "ON" : "OFF"}
        </button>
        <button
          aria-pressed={a.hunting.useBow}
          disabled={!inv.bow}
          onClick={() => request("bow")}
        >
          🏹 {a.hunting.useBow ? "Use toy rifle" : "Use bow"}
        </button>
        <button
          disabled={a.hunting.gruntUses === 0}
          onClick={() => request("grunt")}
        >
          📢 Grunt call <small>{a.hunting.gruntUses} uses · N</small>
        </button>
        <button disabled={!inv.scent} onClick={() => request("scent")}>
          💨 Spray scent <small>{inv.scent ?? 0} bottles · near a feeder</small>
        </button>
        <button
          disabled={!inv.corn && !a.hunting.carryingCorn}
          onClick={() => request("corn")}
        >
          🌽{" "}
          {a.hunting.carryingCorn ? "Fill feeder / load trailer" : "Carry corn"}{" "}
          <small>{inv.corn ?? 0} bags · B</small>
        </button>
        <button onClick={() => request("feeder")}>
          🌽 Place / pick up feeder{" "}
          <small>{inv.feeder ?? 0} to place · V</small>
        </button>
        <button
          disabled={!inv["stand-tree"]}
          onClick={() => request("stand-tree")}
        >
          🪜 Place tree stand{" "}
          <small>{inv["stand-tree"] ?? 0} to place · J</small>
        </button>
        <button
          disabled={!inv["stand-ground"]}
          onClick={() => request("stand-ground")}
        >
          🌿 Place ground blind{" "}
          <small>{inv["stand-ground"] ?? 0} to place</small>
        </button>
        <button
          onClick={() =>
            request(mode === "stand" || mode === "mount" ? "leave" : "climb")
          }
        >
          {mode === "stand"
            ? "🪜 Climb down"
            : mode === "mount"
              ? "🦶 Hop off animal"
              : "🪜 Climb nearby stand"}
        </button>
      </div>
      <h3>Your bag</h3>
      <ul>
        {Object.entries(inv)
          .filter(([, n]) => n > 0)
          .map(([key, n]) => (
            <li key={key}>
              {names[key] ??
                (key === "rifle"
                  ? "Toy Hunting Rifle"
                  : key.replaceAll("-", " "))}{" "}
              × {n}
            </li>
          ))}
      </ul>
      <p>Rifle shots are unlimited. Corn, scent and grunt calls run out.</p>
      <h3>Trophy room</h3>
      <dl>
        {ANIMAL_TYPES.map((type) => (
          <div key={type}>
            <dt style={{ textTransform: "capitalize" }}>{type}</dt>
            <dd>{a.trophyCounts[type] ?? 0}</dd>
          </div>
        ))}
      </dl>
      <p>
        💀 Buck skulls: {a.collectedSkulls} · World record:{" "}
        {Math.max(312, a.collectedSkulls)}
      </p>
      <p className="fw-muted">
        Selling a buck tag leaves a skull on the ground. Walk over it to add it
        to your collection.
      </p>
      <button
        onClick={() =>
          useAdventureSession.getState().setWaypoint({
            id: "hunting-stand",
            label: "Tree Stand",
            x: a.stands[0]?.position.x ?? 417,
            z: a.stands[0]?.position.z ?? -417,
          })
        }
      >
        🧭 Find a hunting stand
      </button>
    </div>
  );
}

/** Interactive sight, never a screenshot or a simulated result. The world ray decides the hit. */
export function HuntingScope() {
  const scope = useAdventureSession((s) => s.scope);
  const paused = useFourWheeler3dStore((s) => s.isPaused);
  const bow = useFourWheeler3dStore((s) => s.progress.adventure.hunting.useBow);
  const [pointer, setPointer] = useState({ x: 0.5, y: 0.5 });
  const aim = useRef(pointer);
  const fire = () =>
    useAdventureSession
      .getState()
      .requestAction(
        "hunt:fire",
        JSON.stringify({ x: aim.current.x * 2 - 1, y: 1 - aim.current.y * 2 }),
      );
  useEffect(() => {
    if (!scope || paused) return;
    const key = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.matches("input,textarea,select,[contenteditable=true]")
      )
        return;
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.code)
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const next = {
          x: Math.max(
            0.02,
            Math.min(
              0.98,
              aim.current.x +
                (event.code === "ArrowRight"
                  ? 0.04
                  : event.code === "ArrowLeft"
                    ? -0.04
                    : 0),
            ),
          ),
          y: Math.max(
            0.02,
            Math.min(
              0.98,
              aim.current.y +
                (event.code === "ArrowDown"
                  ? 0.04
                  : event.code === "ArrowUp"
                    ? -0.04
                    : 0),
            ),
          ),
        };
        aim.current = next;
        setPointer(next);
        return;
      }
      if (
        event.repeat ||
        (event.target instanceof HTMLElement && event.target.closest("button"))
      )
        return;
      if (event.code === "Enter") {
        event.preventDefault();
        useAdventureSession.getState().requestAction(
          "hunt:fire",
          JSON.stringify({
            x: aim.current.x * 2 - 1,
            y: 1 - aim.current.y * 2,
          }),
        );
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [scope, paused]);
  if (!scope || paused) return null;
  return (
    <div
      aria-label="Hunting scope. Arrow keys aim, Enter tags, Escape lowers scope."
      className="fixed inset-0 z-40"
      style={{ touchAction: "none", cursor: "crosshair" }}
      onPointerMove={(event) => {
        if ((event.target as HTMLElement).closest("button")) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const next = {
          x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        };
        aim.current = next;
        setPointer(next);
      }}
      onPointerDown={(event) => {
        if (
          event.button !== 0 ||
          (event.target as HTMLElement).closest("button")
        )
          return;
        const rect = event.currentTarget.getBoundingClientRect();
        aim.current = {
          x: (event.clientX - rect.left) / rect.width,
          y: (event.clientY - rect.top) / rect.height,
        };
        setPointer(aim.current);
        fire();
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at center, transparent 31%, rgba(0,0,0,.72) 32%)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 h-8 w-8 rounded-full border border-white/90"
        style={{
          transform: `translate(${pointer.x * 100}vw, ${pointer.y * 100}vh) translate(-50%, -50%)`,
        }}
      >
        <span className="absolute left-1/2 top-[-7px] h-[46px] w-px bg-white/90" />
        <span className="absolute left-[-7px] top-1/2 h-px w-[46px] bg-white/90" />
      </div>
      <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-3 rounded-xl bg-black/75 p-3 text-white">
        <button
          className="min-h-14 min-w-24 rounded-lg bg-amber-600 px-5 font-bold active:scale-[0.97] motion-reduce:transform-none"
          onClick={fire}
        >
          🎯 {bow ? "Loose arrow" : "Tag"}
        </button>
        <button
          className="min-h-14 min-w-24 rounded-lg bg-slate-700 px-5 font-bold active:scale-[0.97] motion-reduce:transform-none"
          onClick={() => useAdventureSession.setState({ scope: false })}
        >
          Lower scope
        </button>
      </div>
      <p className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded bg-black/60 px-3 py-1 text-sm text-white">
        Aim at the body. Tap or press Enter to tag.
      </p>
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 right-3 w-44"
        viewBox="0 0 180 130"
      >
        {bow ? (
          <>
            <path
              d="M120 15 Q35 65 120 120"
              fill="none"
              stroke="#b17c48"
              strokeWidth="8"
            />
            <path
              d="M120 15 L105 67 L120 120"
              fill="none"
              stroke="#e5d5b4"
              strokeWidth="2"
            />
            <path d="M105 67 L30 18" stroke="#d8bd83" strokeWidth="4" />
            <path d="M30 18 L35 32 L45 17 Z" fill="#e49131" />
          </>
        ) : (
          <>
            <path d="M10 28 L100 42 L106 60 L35 47 Z" fill="#ed9135" />
            <path
              d="M95 43 L163 88 L155 125 L130 112 L130 80 L97 70 Z"
              fill="#2488a4"
            />
            <path d="M18 25 L37 29 L33 47 L14 42 Z" fill="#efb03e" />
            <path d="M105 73 L123 80 L118 100 L99 90 Z" fill="#374747" />
            <circle cx="104" cy="53" r="7" fill="#e8e1c3" />
          </>
        )}
      </svg>
    </div>
  );
}
