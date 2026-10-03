"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { useOregonTrailStore } from "../lib/store";
import type { HuntClipResult } from "../lib/clipRenderer";
import { useHuntPauseStore } from "../lib/huntPause";
import { HUNTING_TIME, MAX_CARRY_WEIGHT } from "../lib/constants";
import { usePointerTap, type TapEvent } from "@/shared/lib/input";
import { useShellHold } from "@/shared/hooks/useShellHold";
import { MAIN_ACTION, Screen } from "./Screen";

// Animal configurations
export const ANIMAL_CONFIG = {
  squirrel: { emoji: "🐿️", name: "Squirrel", speed: 6, size: 32, meat: 2, spawnChance: 0.4, points: 50, yRange: [0.3, 0.5] },
  rabbit: { emoji: "🐰", name: "Rabbit", speed: 5, size: 40, meat: 5, spawnChance: 0.35, points: 30, yRange: [0.5, 0.7] },
  deer: { emoji: "🦌", name: "Deer", speed: 3, size: 56, meat: 60, spawnChance: 0.18, points: 100, yRange: [0.45, 0.65] },
  buffalo: { emoji: "🦬", name: "Buffalo", speed: 1.5, size: 72, meat: 200, spawnChance: 0.07, points: 200, yRange: [0.5, 0.7] },
} as const;

type AnimalType = keyof typeof ANIMAL_CONFIG;

/**
 * A tap this close to an animal's centre hits it. Half its size, but never
 * less than a fingertip (a squirrel is 32 px; a finger covers about 40).
 */
export const MIN_HIT_RADIUS = 26;
export const hitRadius = (type: AnimalType) => Math.max(ANIMAL_CONFIG[type].size / 2, MIN_HIT_RADIUS);

interface Animal {
  id: number;
  type: AnimalType;
  x: number;
  y: number;
  hit: boolean;
  direction: 1 | -1; // 1 = right to left, -1 = left to right
  frameOffset: number;
}

interface Effect {
  id: number;
  x: number;
  y: number;
  text?: string;
  life: number;
}

/** How long the "tap an animal" tip stays when nobody taps. */
const TIP_MS = 4000;

/**
 * The hunt: 30 seconds, animals run across the prairie, a tap shoots
 * where the finger lands.
 *
 * Why this shape (phone UX audit 2026-09-29): the field was screen-tall
 * under the header, so the time and score slid under it; the animal legend
 * and a "Controls" box sat over the bottom of the field, across the band
 * the animals run in when the phone is sideways; the canvas had a 1x
 * backing store (blurry emoji on a 2x phone); and the drawing loop was
 * torn down and rebuilt on every finger move. Now the counts and the
 * legend are one strip at the top, the animals live in refs (React draws
 * only the numbers), the canvas has the screen's pixels, and the loop runs
 * once for the whole hunt.
 */
export function Hunting({ onCaptureCanvas, onCaptureResult }: {
  onCaptureCanvas?: (canvas: HTMLCanvasElement | null) => void;
  onCaptureResult?: (result: HuntClipResult | null) => void;
} = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const setCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    onCaptureCanvas?.(canvas);
  }, [onCaptureCanvas]);

  const ammunition = useOregonTrailStore((s) => s.supplies.ammunition);
  const hunt = useOregonTrailStore((s) => s.hunt);

  // Paused by the GameShell (ESC / pause button / pause-on-blur), and held
  // under a shell overlay (the orientation tip, the leaderboard) or in a
  // hidden tab: the countdown, the spawner and the animals all stand still.
  const paused = useHuntPauseStore((s) => s.paused);
  const setPaused = useHuntPauseStore((s) => s.setPaused);
  const held = useShellHold();
  const frozen = paused || held;

  // A fresh hunt must never start paused, and leaving the hunt must not strand
  // the flag as paused for the next one.
  useEffect(() => {
    setPaused(false);
    return () => setPaused(false);
  }, [setPaused]);

  const [food, setFood] = useState(0);
  const [ammo, setAmmo] = useState(0);
  const [time, setTime] = useState(HUNTING_TIME);
  const [score, setScore] = useState(0);
  const [tip, setTip] = useState(true);

  const animals = useRef<Animal[]>([]);
  const hits = useRef<Effect[]>([]);
  const misses = useRef<Effect[]>([]);
  const cursor = useRef<{ x: number; y: number } | null>(null);
  const recoilUntil = useRef(0);
  const size = useRef({ width: 0, height: 0 });
  const frozenRef = useRef(frozen);
  useEffect(() => {
    frozenRef.current = frozen;
  }, [frozen]);

  const left = ammunition - ammo;
  const finished = time <= 0 || left <= 0;
  const outOfBullets = left <= 0 && time > 0;
  // The result replaces the native field. Hand only its numeric gameplay
  // facts to the semantic recorder before paint, and clear on leaving it.
  useLayoutEffect(() => {
    if (!finished) return;
    onCaptureResult?.({ food, ammo, score, outOfBullets });
    return () => onCaptureResult?.(null);
  }, [finished, food, ammo, score, outOfBullets, onCaptureResult]);

  // Timer countdown
  useEffect(() => {
    if (finished || frozen) return;
    const t = setInterval(() => setTime((p) => Math.max(0, p - 1)), 1000);
    return () => clearInterval(t);
  }, [finished, frozen]);

  // The tip goes after the first shot, or after a while.
  useEffect(() => {
    if (!tip || frozen) return;
    const t = setTimeout(() => setTip(false), TIP_MS);
    return () => clearTimeout(t);
  }, [tip, frozen]);

  // Spawn animals
  useEffect(() => {
    if (finished || frozen) return;
    const spawn = setInterval(() => {
      const { width, height } = size.current;
      if (!width || !height) return;
      for (const type of Object.keys(ANIMAL_CONFIG) as AnimalType[]) {
        const config = ANIMAL_CONFIG[type];
        if (Math.random() < config.spawnChance * 0.3) {
          const direction = Math.random() < 0.5 ? 1 : -1;
          animals.current.push({
            id: performance.now() + Math.random(),
            type,
            x: direction === 1 ? width + config.size : -config.size,
            y: height * (config.yRange[0] + Math.random() * (config.yRange[1] - config.yRange[0])),
            hit: false,
            direction,
            frameOffset: Math.random() * Math.PI * 2,
          });
        }
      }
    }, 800);
    return () => clearInterval(spawn);
  }, [finished, frozen]);

  // A mouse moves the crosshair; a finger's tap places it.
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) cursor.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // One tap = one shot (the field used to carry onClick AND onTouchStart,
  // so a finger tap fired twice and spent two bullets).
  const shoot = (e: TapEvent<HTMLDivElement>) => {
    if (finished || frozen) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    cursor.current = { x, y };
    recoilUntil.current = performance.now() + 100;
    setTip(false);
    setAmmo((p) => p + 1);

    // The nearest live animal within reach is hit.
    let target: Animal | null = null;
    let best = Infinity;
    for (const animal of animals.current) {
      if (animal.hit) continue;
      const d = Math.hypot(x - animal.x, y - animal.y);
      if (d < hitRadius(animal.type) && d < best) {
        target = animal;
        best = d;
      }
    }
    if (target && food < MAX_CARRY_WEIGHT) {
      const config = ANIMAL_CONFIG[target.type];
      const meat = Math.min(config.meat, MAX_CARRY_WEIGHT - food);
      const shot = target;
      animals.current = animals.current.map((a) => (a === shot ? { ...a, hit: true } : a));
      setFood((f) => Math.min(MAX_CARRY_WEIGHT, f + meat));
      setScore((s) => s + config.points);
      hits.current.push({ id: performance.now(), x: target.x, y: target.y, text: `+${meat} lbs!`, life: 60 });
    } else {
      misses.current.push({ id: performance.now(), x, y, life: 30 });
    }
  };
  const shootTap = usePointerTap<HTMLDivElement>(shoot);

  // The drawing loop: once for the whole hunt. It reads the refs, so a
  // finger move or a shot never rebuilds it; a pause or a hold keeps the
  // last frame on screen.
  useEffect(() => {
    if (finished) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      size.current = { width, height };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    let frame = 0;
    let last = performance.now();
    const animate = (timestamp: number) => {
      const delta = Math.min(3, (timestamp - last) / 16);
      last = timestamp;
      frame = requestAnimationFrame(animate);
      if (frozenRef.current) return;
      const { width, height } = size.current;

      ctx.clearRect(0, 0, width, height);
      const sky = ctx.createLinearGradient(0, 0, 0, height * 0.5);
      sky.addColorStop(0, "#87CEEB");
      sky.addColorStop(1, "#B8E8F8");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height * 0.5);

      ctx.fillStyle = "#6b8e6b";
      ctx.beginPath();
      ctx.moveTo(0, height * 0.4);
      for (let x = 0; x <= width; x += 50) {
        ctx.lineTo(x, height * 0.4 + Math.sin(x * 0.02) * 20 + Math.sin(x * 0.01) * 30);
      }
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fill();

      const prairie = ctx.createLinearGradient(0, height * 0.45, 0, height);
      prairie.addColorStop(0, "#9ACD32");
      prairie.addColorStop(0.5, "#8FBC8F");
      prairie.addColorStop(1, "#6B8E23");
      ctx.fillStyle = prairie;
      ctx.fillRect(0, height * 0.45, width, height * 0.55);

      ctx.strokeStyle = "#556B2F";
      ctx.lineWidth = 2;
      for (let i = 0; i < 80; i++) {
        const gx = (i * 17 + timestamp * 0.01) % width;
        const gy = height * 0.5 + (i % 5) * (height * 0.1);
        const sway = Math.sin(timestamp * 0.002 + i) * 3;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx - 3 + sway, gy - 12);
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + 2 + sway, gy - 15);
        ctx.moveTo(gx, gy);
        ctx.lineTo(gx + 6 + sway, gy - 10);
        ctx.stroke();
      }

      // Move the animals, then draw them.
      animals.current = animals.current.filter((animal) => {
        const config = ANIMAL_CONFIG[animal.type];
        animal.x -= config.speed * delta * animal.direction;
        if (animal.hit) animal.y += 5 * delta;
        if (animal.direction === 1 && animal.x < -config.size) return false;
        if (animal.direction === -1 && animal.x > width + config.size) return false;
        return animal.y <= height + config.size;
      });
      for (const animal of animals.current) {
        const config = ANIMAL_CONFIG[animal.type];
        ctx.save();
        ctx.translate(animal.x, animal.y);
        if (animal.direction === -1) ctx.scale(-1, 1);
        const bob = Math.sin(timestamp * 0.01 + animal.frameOffset) * 3;
        ctx.fillStyle = "rgba(0,0,0,0.2)";
        ctx.beginPath();
        ctx.ellipse(0, config.size / 2, config.size / 3, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `${config.size}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // An opaque fill: the browser draws a colour emoji with the alpha of
        // the fill style, and the shadow left it at 20% (every animal was
        // drawn faded, as if already hit).
        ctx.fillStyle = "#000";
        if (animal.hit) {
          ctx.globalAlpha = 0.5;
          ctx.rotate(0.3);
        }
        ctx.fillText(config.emoji, 0, bob);
        ctx.restore();
      }

      hits.current = hits.current.filter((e) => (e.life -= delta) > 0);
      for (const e of hits.current) {
        ctx.save();
        ctx.globalAlpha = e.life / 60;
        ctx.fillStyle = "#FFD700";
        ctx.font = "bold 24px sans-serif";
        ctx.textAlign = "center";
        ctx.strokeStyle = "black";
        ctx.lineWidth = 3;
        const rise = (60 - e.life) * 0.5;
        ctx.strokeText(e.text ?? "", e.x, e.y - rise);
        ctx.fillText(e.text ?? "", e.x, e.y - rise);
        ctx.restore();
      }

      misses.current = misses.current.filter((e) => (e.life -= delta) > 0);
      for (const e of misses.current) {
        ctx.save();
        ctx.globalAlpha = e.life / 30;
        ctx.fillStyle = "#654321";
        ctx.beginPath();
        ctx.arc(e.x, e.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#8B7355";
        for (let i = 0; i < 5; i++) {
          const angle = (i / 5) * Math.PI * 2;
          const dist = 8 + (30 - e.life) * 0.5;
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(angle) * dist, e.y + Math.sin(angle) * dist, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // The crosshair, where the last shot (or the mouse) is.
      const c = cursor.current;
      if (c) {
        const red = timestamp < recoilUntil.current ? "#ff0000" : "#ff4444";
        const r = 20;
        ctx.save();
        ctx.strokeStyle = red;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(c.x - r - 5, c.y);
        ctx.lineTo(c.x - 5, c.y);
        ctx.moveTo(c.x + 5, c.y);
        ctx.lineTo(c.x + r + 5, c.y);
        ctx.moveTo(c.x, c.y - r - 5);
        ctx.lineTo(c.x, c.y - 5);
        ctx.moveTo(c.x, c.y + 5);
        ctx.lineTo(c.x, c.y + r + 5);
        ctx.stroke();
        ctx.fillStyle = red;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [finished]);

  // The hunt is over: the time ran out, or the bullets did.
  if (finished) {
    return (
      <Screen
        testId="oregon-hunt-done"
        tone="green"
        title={outOfBullets ? "🎯 Out of bullets!" : "🎯 Hunt complete!"}
        speak={`${outOfBullets ? "Out of bullets!" : "The hunt is over!"} You got ${food} pounds of meat with ${ammo} bullets. Your score is ${score}.${
          food >= MAX_CARRY_WEIGHT ? ` You can only carry ${MAX_CARRY_WEIGHT} pounds.` : ""
        }`}
        actions={
          <button type="button" onClick={() => hunt(food, ammo)} className={MAIN_ACTION}>
            🐂 Take the food to the wagon
          </button>
        }
      >
        <div className="mx-auto grid max-w-md grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-black/25 px-2 py-2">
            <div className="text-2xl font-bold">{food}</div>
            <div className="text-sm">🍖 lbs of meat</div>
          </div>
          <div className="rounded-lg bg-black/25 px-2 py-2">
            <div className="text-2xl font-bold">{ammo}</div>
            <div className="text-sm">🎯 bullets used</div>
          </div>
          <div className="rounded-lg bg-black/25 px-2 py-2">
            <div className="text-2xl font-bold text-amber-300">{score}</div>
            <div className="text-sm">⭐ score</div>
          </div>
        </div>
        {food >= MAX_CARRY_WEIGHT && (
          <p className="mt-2 text-center text-base text-amber-200">🎒 That is all you can carry ({MAX_CARRY_WEIGHT} lbs)</p>
        )}
      </Screen>
    );
  }

  const pill = "rounded-full bg-black/55 px-2.5 py-1 text-base font-bold text-white";
  return (
    <div
      ref={containerRef}
      data-testid="hunt-field"
      className="relative h-full select-none overflow-hidden bg-green-900 touch-none"
      onPointerMove={handlePointerMove}
      {...shootTap}
    >
      <canvas ref={setCanvas} className="absolute inset-0 h-full w-full" />

      {/* The counts, then the animals and their meat, in one strip at the top. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-1 p-2">
        <div className="flex w-full items-center justify-between gap-1">
          <span className={`${pill} ${time <= 10 ? "text-red-300" : ""}`} aria-label={`${time} seconds left`}>
            ⏱ {time}s
          </span>
          <span className={pill} aria-label={`Score ${score}`}>
            ⭐ {score}
          </span>
          <span className={`${pill} ${left <= 10 ? "text-red-300" : ""}`}>
            🎯 <span data-testid="hunt-ammo">{left}</span>
          </span>
          <span className={pill} aria-label={`${food} of ${MAX_CARRY_WEIGHT} pounds of meat`}>
            🍖 {food}/{MAX_CARRY_WEIGHT}
          </span>
        </div>
        <div data-testid="hunt-legend" className="flex flex-wrap justify-center gap-x-2 rounded-full bg-black/45 px-3 py-0.5 text-sm text-white">
          {Object.values(ANIMAL_CONFIG).map((a) => (
            <span key={a.name} className="whitespace-nowrap">
              {a.emoji} +{a.meat}
            </span>
          ))}
        </div>
      </div>

      {tip && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
          <p className="rounded-xl bg-black/60 px-4 py-2 text-lg font-bold text-white">👆 Tap an animal to hunt it!</p>
        </div>
      )}

      {left > 0 && left <= 5 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <p className="rounded-lg bg-red-900/85 px-4 py-1.5 text-base font-bold text-red-100">⚠️ {left} bullets left</p>
        </div>
      )}
    </div>
  );
}
