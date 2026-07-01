"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useOregonTrailStore } from "../lib/store";
import { HUNTING_TIME, MAX_CARRY_WEIGHT } from "../lib/constants";

// Animal configurations
const ANIMAL_CONFIG = {
  squirrel: {
    emoji: "🐿️",
    name: "Squirrel",
    speed: 6,
    size: 32,
    meat: 2,
    spawnChance: 0.4,
    points: 50,
    yRange: [0.3, 0.5], // Spawns higher (in trees)
  },
  rabbit: {
    emoji: "🐰",
    name: "Rabbit",
    speed: 5,
    size: 40,
    meat: 5,
    spawnChance: 0.35,
    points: 30,
    yRange: [0.5, 0.7],
  },
  deer: {
    emoji: "🦌",
    name: "Deer",
    speed: 3,
    size: 56,
    meat: 60,
    spawnChance: 0.18,
    points: 100,
    yRange: [0.45, 0.65],
  },
  buffalo: {
    emoji: "🦬",
    name: "Buffalo",
    speed: 1.5,
    size: 72,
    meat: 200,
    spawnChance: 0.07,
    points: 200,
    yRange: [0.5, 0.7],
  },
};

type AnimalType = keyof typeof ANIMAL_CONFIG;

interface Animal {
  id: number;
  type: AnimalType;
  x: number;
  y: number;
  hit: boolean;
  direction: 1 | -1; // 1 = right to left, -1 = left to right
  frameOffset: number;
}

interface HitEffect {
  id: number;
  x: number;
  y: number;
  text: string;
  life: number;
}

interface MissEffect {
  id: number;
  x: number;
  y: number;
  life: number;
}

export function Hunting() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);

  const { supplies, hunt } = useOregonTrailStore();

  const [food, setFood] = useState(0);
  const [ammo, setAmmo] = useState(0);
  const [time, setTime] = useState(HUNTING_TIME);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [hitEffects, setHitEffects] = useState<HitEffect[]>([]);
  const [missEffects, setMissEffects] = useState<MissEffect[]>([]);
  const [score, setScore] = useState(0);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [recoil, setRecoil] = useState(false);

  // Timer countdown
  useEffect(() => {
    if (time <= 0) return;
    const t = setInterval(() => setTime((p) => Math.max(0, p - 1)), 1000);
    return () => clearInterval(t);
  }, [time]);

  // Spawn animals
  useEffect(() => {
    if (time <= 0) return;

    const spawn = setInterval(() => {
      const types = Object.keys(ANIMAL_CONFIG) as AnimalType[];

      for (const type of types) {
        const config = ANIMAL_CONFIG[type];
        if (Math.random() < config.spawnChance * 0.3) {
          const direction = Math.random() < 0.5 ? 1 : -1;
          const canvas = canvasRef.current;
          const width = canvas?.width || 800;
          const height = canvas?.height || 400;

          setAnimals((prev) => [
            ...prev,
            {
              id: Date.now() + Math.random(),
              type,
              x: direction === 1 ? width + config.size : -config.size,
              y: height * (config.yRange[0] + Math.random() * (config.yRange[1] - config.yRange[0])),
              hit: false,
              direction,
              frameOffset: Math.random() * Math.PI * 2,
            },
          ]);
        }
      }
    }, 800);

    return () => clearInterval(spawn);
  }, [time]);

  // Update cursor position
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setCursorPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect && e.touches[0]) {
      setCursorPos({
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      });
    }
  }, []);

  // Shooting logic
  const shoot = useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if (time <= 0) return;
    if (supplies.ammunition - ammo <= 0) return;

    // Get click position
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    let clickX: number, clickY: number;
    if ("touches" in e && e.touches[0]) {
      clickX = e.touches[0].clientX - rect.left;
      clickY = e.touches[0].clientY - rect.top;
    } else if ("clientX" in e) {
      clickX = e.clientX - rect.left;
      clickY = e.clientY - rect.top;
    } else {
      return;
    }

    // Trigger recoil animation
    setRecoil(true);
    setTimeout(() => setRecoil(false), 100);

    // Use ammo
    setAmmo((p) => p + 1);

    // Check if we hit any animal
    let hitSomething = false;

    setAnimals((prev) =>
      prev.map((animal) => {
        if (animal.hit) return animal;

        const config = ANIMAL_CONFIG[animal.type];
        const hitRadius = config.size / 2;

        // Check if click is within animal hitbox
        const dx = clickX - animal.x;
        const dy = clickY - animal.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < hitRadius && food < MAX_CARRY_WEIGHT) {
          hitSomething = true;

          // Add food
          const meatGained = Math.min(config.meat, MAX_CARRY_WEIGHT - food);
          setFood((f) => Math.min(MAX_CARRY_WEIGHT, f + meatGained));
          setScore((s) => s + config.points);

          // Add hit effect
          setHitEffects((effects) => [
            ...effects,
            {
              id: Date.now(),
              x: animal.x,
              y: animal.y,
              text: `+${meatGained} lbs!`,
              life: 60,
            },
          ]);

          return { ...animal, hit: true };
        }

        return animal;
      })
    );

    // Add miss effect if we didn't hit anything
    if (!hitSomething) {
      setMissEffects((effects) => [
        ...effects,
        { id: Date.now(), x: clickX, y: clickY, life: 30 },
      ]);
    }
  }, [time, supplies.ammunition, ammo, food]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    let lastTime = 0;

    const animate = (timestamp: number) => {
      const delta = (timestamp - lastTime) / 16; // Normalize to 60fps
      lastTime = timestamp;

      const width = canvas.width;
      const height = canvas.height;

      // Clear
      ctx.clearRect(0, 0, width, height);

      // Draw sky gradient
      const skyGradient = ctx.createLinearGradient(0, 0, 0, height * 0.5);
      skyGradient.addColorStop(0, "#87CEEB");
      skyGradient.addColorStop(1, "#B8E8F8");
      ctx.fillStyle = skyGradient;
      ctx.fillRect(0, 0, width, height * 0.5);

      // Draw distant hills
      ctx.fillStyle = "#6b8e6b";
      ctx.beginPath();
      ctx.moveTo(0, height * 0.4);
      for (let x = 0; x <= width; x += 50) {
        const y = height * 0.4 + Math.sin(x * 0.02) * 20 + Math.sin(x * 0.01) * 30;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fill();

      // Draw prairie
      const prairieGradient = ctx.createLinearGradient(0, height * 0.45, 0, height);
      prairieGradient.addColorStop(0, "#9ACD32");
      prairieGradient.addColorStop(0.5, "#8FBC8F");
      prairieGradient.addColorStop(1, "#6B8E23");
      ctx.fillStyle = prairieGradient;
      ctx.fillRect(0, height * 0.45, width, height * 0.55);

      // Draw grass tufts
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

      // Update and draw animals
      setAnimals((prev) => {
        const updated = prev
          .map((animal) => {
            const config = ANIMAL_CONFIG[animal.type];

            // Move animal
            const newX = animal.x - config.speed * delta * animal.direction;

            // Remove if off screen
            if (animal.direction === 1 && newX < -config.size) return null;
            if (animal.direction === -1 && newX > width + config.size) return null;

            // Fall down if hit
            let newY = animal.y;
            if (animal.hit) {
              newY += 5 * delta;
              if (newY > height + config.size) return null;
            }

            return { ...animal, x: newX, y: newY };
          })
          .filter(Boolean) as Animal[];

        // Draw animals (in animation frame)
        updated.forEach((animal) => {
          const config = ANIMAL_CONFIG[animal.type];

          ctx.save();
          ctx.translate(animal.x, animal.y);

          // Flip based on direction
          if (animal.direction === -1) {
            ctx.scale(-1, 1);
          }

          // Bobbing animation
          const bob = Math.sin(timestamp * 0.01 + animal.frameOffset) * 3;

          // Draw shadow
          ctx.fillStyle = "rgba(0,0,0,0.2)";
          ctx.beginPath();
          ctx.ellipse(0, config.size / 2, config.size / 3, 5, 0, 0, Math.PI * 2);
          ctx.fill();

          // Draw animal (emoji)
          ctx.font = `${config.size}px serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          if (animal.hit) {
            // Fade out and rotate when hit
            ctx.globalAlpha = 0.5;
            ctx.rotate(0.3);
          }

          ctx.fillText(config.emoji, 0, bob);

          ctx.restore();
        });

        return updated;
      });

      // Draw hit effects
      setHitEffects((effects) => {
        const updated = effects
          .map((e) => ({ ...e, life: e.life - 1 }))
          .filter((e) => e.life > 0);

        updated.forEach((effect) => {
          const alpha = effect.life / 60;
          const rise = (60 - effect.life) * 0.5;

          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = "#FFD700";
          ctx.font = "bold 24px sans-serif";
          ctx.textAlign = "center";
          ctx.strokeStyle = "black";
          ctx.lineWidth = 3;
          ctx.strokeText(effect.text, effect.x, effect.y - rise);
          ctx.fillText(effect.text, effect.x, effect.y - rise);
          ctx.restore();
        });

        return updated;
      });

      // Draw miss effects (bullet holes)
      setMissEffects((effects) => {
        const updated = effects
          .map((e) => ({ ...e, life: e.life - 1 }))
          .filter((e) => e.life > 0);

        updated.forEach((effect) => {
          const alpha = effect.life / 30;
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = "#654321";
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, 5, 0, Math.PI * 2);
          ctx.fill();
          // Dirt spray
          ctx.fillStyle = "#8B7355";
          for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2;
            const dist = 8 + (30 - effect.life) * 0.5;
            ctx.beginPath();
            ctx.arc(
              effect.x + Math.cos(angle) * dist,
              effect.y + Math.sin(angle) * dist,
              2,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
          ctx.restore();
        });

        return updated;
      });

      // Draw crosshair
      ctx.save();
      ctx.strokeStyle = recoil ? "#ff0000" : "#ff4444";
      ctx.lineWidth = 2;
      const crosshairSize = 20;

      ctx.beginPath();
      ctx.arc(cursorPos.x, cursorPos.y, crosshairSize, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cursorPos.x - crosshairSize - 5, cursorPos.y);
      ctx.lineTo(cursorPos.x - 5, cursorPos.y);
      ctx.moveTo(cursorPos.x + 5, cursorPos.y);
      ctx.lineTo(cursorPos.x + crosshairSize + 5, cursorPos.y);
      ctx.moveTo(cursorPos.x, cursorPos.y - crosshairSize - 5);
      ctx.lineTo(cursorPos.x, cursorPos.y - 5);
      ctx.moveTo(cursorPos.x, cursorPos.y + 5);
      ctx.lineTo(cursorPos.x, cursorPos.y + crosshairSize + 5);
      ctx.stroke();

      // Center dot
      ctx.fillStyle = recoil ? "#ff0000" : "#ff4444";
      ctx.beginPath();
      ctx.arc(cursorPos.x, cursorPos.y, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [cursorPos, recoil]);

  // Game over screen
  if (time <= 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-green-800 to-green-900">
        <div className="bg-green-700/90 backdrop-blur p-8 rounded-2xl text-white text-center max-w-md shadow-2xl">
          <h2 className="text-4xl font-bold mb-4 text-amber-200">
            🎯 Hunt Complete!
          </h2>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-green-600/50 rounded-lg p-4">
              <div className="text-3xl mb-1">🍖</div>
              <div className="text-2xl font-bold">{food}</div>
              <div className="text-sm text-green-300">lbs of meat</div>
            </div>
            <div className="bg-green-600/50 rounded-lg p-4">
              <div className="text-3xl mb-1">🎯</div>
              <div className="text-2xl font-bold">{ammo}</div>
              <div className="text-sm text-green-300">bullets used</div>
            </div>
          </div>

          <div className="mb-6">
            <div className="text-lg text-green-300">Score</div>
            <div className="text-4xl font-bold text-amber-400">{score}</div>
          </div>

          {food >= MAX_CARRY_WEIGHT && (
            <div className="mb-4 text-amber-300 bg-amber-900/30 rounded-lg p-2">
              🎒 Carrying capacity reached! ({MAX_CARRY_WEIGHT} lbs max)
            </div>
          )}

          <button
            onClick={() => hunt(food, ammo)}
            className="btn btn-primary btn-lg text-xl w-full"
          >
            Take Food Back to Wagon
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="min-h-screen bg-green-900 relative select-none overflow-hidden"
      style={{ cursor: "none" }}
      onMouseMove={handleMouseMove}
      onTouchMove={handleTouchMove}
      onClick={shoot}
      onTouchStart={shoot}
    >
      {/* Game canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* HUD */}
      <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start pointer-events-none">
        {/* Timer */}
        <div className="bg-black/50 backdrop-blur rounded-lg px-4 py-2 text-white">
          <div className="text-sm text-gray-300">Time</div>
          <div className={`text-3xl font-bold ${time <= 10 ? "text-red-400 animate-pulse" : "text-white"}`}>
            {time}s
          </div>
        </div>

        {/* Center info */}
        <div className="bg-black/50 backdrop-blur rounded-lg px-4 py-2 text-white text-center">
          <div className="text-sm text-gray-300">Score</div>
          <div className="text-2xl font-bold text-amber-400">{score}</div>
        </div>

        {/* Ammo & Food */}
        <div className="bg-black/50 backdrop-blur rounded-lg px-4 py-2 text-white text-right">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🎯</span>
            <span className={`font-bold ${supplies.ammunition - ammo <= 10 ? "text-red-400" : ""}`}>
              {supplies.ammunition - ammo}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg">🍖</span>
            <span className="font-bold">{food}/{MAX_CARRY_WEIGHT}</span>
          </div>
        </div>
      </div>

      {/* Animal legend */}
      <div className="absolute bottom-4 left-4 bg-black/50 backdrop-blur rounded-lg p-3 text-white text-sm pointer-events-none">
        <div className="text-xs text-gray-400 mb-2">Animals</div>
        {Object.entries(ANIMAL_CONFIG).map(([type, config]) => (
          <div key={type} className="flex items-center gap-2 mb-1">
            <span>{config.emoji}</span>
            <span>{config.name}</span>
            <span className="text-green-400">+{config.meat} lbs</span>
          </div>
        ))}
      </div>

      {/* Instructions */}
      <div className="absolute bottom-4 right-4 bg-black/50 backdrop-blur rounded-lg p-3 text-white text-sm pointer-events-none">
        <div className="text-xs text-gray-400 mb-1">Controls</div>
        <div>Click/Tap to shoot!</div>
        <div className="text-xs text-gray-400 mt-1">
          Bigger animals = more food
        </div>
      </div>

      {/* Low ammo warning */}
      {supplies.ammunition - ammo <= 5 && supplies.ammunition - ammo > 0 && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          <div className="bg-red-900/80 text-red-200 px-4 py-2 rounded-lg animate-pulse">
            ⚠️ Low Ammo: {supplies.ammunition - ammo} left
          </div>
        </div>
      )}

      {/* Out of ammo */}
      {supplies.ammunition - ammo <= 0 && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
          <div className="bg-red-900/90 text-white p-6 rounded-lg text-center">
            <div className="text-2xl mb-4">❌ Out of Ammo!</div>
            <button
              onClick={() => hunt(food, ammo)}
              className="btn btn-primary"
            >
              End Hunt Early
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
