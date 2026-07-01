"use client";

import { useRef, useEffect, useCallback } from "react";
import { useOregonTrailStore } from "../lib/store";
import { WEATHER_CONDITIONS } from "../lib/constants";

// Color palettes for time of day
const TIME_PALETTES = {
  dawn: {
    sky: ["#ff9966", "#ff6b6b", "#4a90d9"],
    mountains: "#5a4a6a",
    hills: "#6b5a7a",
    ground: "#8b7355",
  },
  day: {
    sky: ["#87CEEB", "#98D8E8", "#B8E8F8"],
    mountains: "#6b8e9f",
    hills: "#7a9a6a",
    ground: "#a08060",
  },
  dusk: {
    sky: ["#ff7e5f", "#feb47b", "#6a5acd"],
    mountains: "#4a3a5a",
    hills: "#5a4a6a",
    ground: "#7a6045",
  },
  night: {
    sky: ["#1a1a2e", "#16213e", "#0f3460"],
    mountains: "#2a2a4a",
    hills: "#3a3a5a",
    ground: "#4a4035",
  },
};

// Weather effects config
const WEATHER_EFFECTS = {
  clear: { particles: 0, type: "none" },
  rain: { particles: 150, type: "rain" },
  snow: { particles: 100, type: "snow" },
  hot: { particles: 20, type: "heat" },
  cold: { particles: 50, type: "snow" },
};

interface Particle {
  x: number;
  y: number;
  speed: number;
  size: number;
  opacity: number;
}

interface DustParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
}

export function TravelScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const scrollRef = useRef({ mountains: 0, hills: 0, ground: 0 });
  const particlesRef = useRef<Particle[]>([]);
  const dustRef = useRef<DustParticle[]>([]);
  const oxenFrameRef = useRef(0);

  const { currentDay, weather, pace } = useOregonTrailStore();

  // Determine time of day based on game day (cycle every 4 days for visual variety)
  const getTimeOfDay = useCallback(() => {
    const hour = (currentDay % 4);
    if (hour === 0) return "dawn";
    if (hour === 1 || hour === 2) return "day";
    if (hour === 3) return "dusk";
    return "night";
  }, [currentDay]);

  // Get scroll speed based on pace
  const getScrollSpeed = useCallback(() => {
    switch (pace) {
      case "steady": return 0.5;
      case "strenuous": return 0.8;
      case "grueling": return 1.2;
      default: return 0.5;
    }
  }, [pace]);

  // Initialize particles for weather
  const initParticles = useCallback((count: number, canvasHeight: number, canvasWidth: number) => {
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvasWidth,
        y: Math.random() * canvasHeight,
        speed: 2 + Math.random() * 3,
        size: 1 + Math.random() * 2,
        opacity: 0.3 + Math.random() * 0.5,
      });
    }
    return particles;
  }, []);

  // Draw mountain silhouette
  const drawMountains = useCallback((
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    offset: number,
    color: string
  ) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.6);

    // Generate mountain peaks
    const peaks = [
      { x: 0.1, y: 0.35 },
      { x: 0.25, y: 0.25 },
      { x: 0.4, y: 0.32 },
      { x: 0.55, y: 0.2 },
      { x: 0.7, y: 0.28 },
      { x: 0.85, y: 0.22 },
      { x: 1.0, y: 0.35 },
    ];

    for (let i = 0; i < peaks.length; i++) {
      const x = ((peaks[i].x * width * 2) + offset) % (width * 2) - width * 0.5;
      const y = height * peaks[i].y + height * 0.2;
      if (i === 0) {
        ctx.moveTo(x - 100, height * 0.6);
      }
      ctx.lineTo(x, y);
    }

    ctx.lineTo(width + 100, height * 0.6);
    ctx.closePath();
    ctx.fill();
  }, []);

  // Draw rolling hills
  const drawHills = useCallback((
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    offset: number,
    color: string
  ) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, height);

    // Gentle rolling hills using sine waves
    for (let x = -50; x <= width + 50; x += 5) {
      const adjustedX = x + offset;
      const y = height * 0.65 +
        Math.sin(adjustedX * 0.01) * 20 +
        Math.sin(adjustedX * 0.02 + 1) * 15 +
        Math.sin(adjustedX * 0.005) * 30;
      ctx.lineTo(x, y);
    }

    ctx.lineTo(width + 50, height);
    ctx.closePath();
    ctx.fill();

    // Add some trees on hills
    ctx.fillStyle = "#2d5a3d";
    for (let i = 0; i < 20; i++) {
      const treeX = ((i * 80 + offset * 0.8) % (width + 200)) - 100;
      const baseY = height * 0.65 +
        Math.sin((treeX + offset) * 0.01) * 20 +
        Math.sin((treeX + offset) * 0.02 + 1) * 15;

      // Simple triangle tree
      ctx.beginPath();
      ctx.moveTo(treeX, baseY);
      ctx.lineTo(treeX - 8, baseY);
      ctx.lineTo(treeX - 4, baseY - 20);
      ctx.closePath();
      ctx.fill();
    }
  }, []);

  // Draw prairie ground with grass
  const drawGround = useCallback((
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    offset: number,
    color: string
  ) => {
    // Base ground
    ctx.fillStyle = color;
    ctx.fillRect(0, height * 0.75, width, height * 0.25);

    // Grass tufts
    ctx.strokeStyle = "#6b8e23";
    ctx.lineWidth = 2;
    for (let i = 0; i < 50; i++) {
      const grassX = ((i * 30 + offset) % (width + 100)) - 50;
      const grassY = height * 0.78 + Math.sin(i) * 5;

      ctx.beginPath();
      ctx.moveTo(grassX, grassY);
      ctx.lineTo(grassX - 3, grassY - 8);
      ctx.moveTo(grassX, grassY);
      ctx.lineTo(grassX + 2, grassY - 10);
      ctx.moveTo(grassX, grassY);
      ctx.lineTo(grassX + 5, grassY - 6);
      ctx.stroke();
    }

    // Trail/road
    ctx.fillStyle = "#8b7355";
    ctx.fillRect(0, height * 0.82, width, height * 0.08);
  }, []);

  // Draw a wheel with spokes
  function drawWheel(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    rotation: number
  ) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);

    // Wheel rim
    ctx.strokeStyle = "#4a3728";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Spokes
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      ctx.stroke();
    }

    // Hub
    ctx.fillStyle = "#4a3728";
    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // Draw covered wagon
  const drawWagon = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    bounce: number,
    wheelRotation: number
  ) => {
    const wagonY = y + bounce;

    // Wagon body
    ctx.fillStyle = "#8B4513";
    ctx.fillRect(x - 30, wagonY - 25, 60, 20);

    // Wagon cover (white canvas)
    ctx.fillStyle = "#F5F5DC";
    ctx.beginPath();
    ctx.moveTo(x - 35, wagonY - 25);
    ctx.quadraticCurveTo(x, wagonY - 55, x + 35, wagonY - 25);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#8B4513";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Cover ribs
    ctx.strokeStyle = "#A0522D";
    ctx.lineWidth = 1;
    for (let i = -20; i <= 20; i += 10) {
      ctx.beginPath();
      ctx.moveTo(x + i, wagonY - 25);
      ctx.quadraticCurveTo(x + i, wagonY - 45, x + i, wagonY - 25);
      ctx.stroke();
    }

    // Wheels
    const wheelRadius = 12;
    const wheelY = wagonY + 5;

    // Front wheel
    drawWheel(ctx, x + 20, wheelY, wheelRadius, wheelRotation);
    // Back wheel
    drawWheel(ctx, x - 20, wheelY, wheelRadius, wheelRotation);
  }, []);

  // Draw oxen
  const drawOxen = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    frame: number
  ) => {
    // Two oxen pulling the wagon
    for (let ox = 0; ox < 2; ox++) {
      const oxX = x - 60 - ox * 25;
      const legOffset = Math.sin(frame * 0.3 + ox * Math.PI) * 3;

      // Body
      ctx.fillStyle = "#8B6914";
      ctx.beginPath();
      ctx.ellipse(oxX, y - 8, 15, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      // Head
      ctx.beginPath();
      ctx.ellipse(oxX - 12, y - 12, 8, 6, -0.3, 0, Math.PI * 2);
      ctx.fill();

      // Horns
      ctx.strokeStyle = "#D2B48C";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(oxX - 15, y - 16);
      ctx.lineTo(oxX - 20, y - 22);
      ctx.moveTo(oxX - 10, y - 16);
      ctx.lineTo(oxX - 5, y - 22);
      ctx.stroke();

      // Legs (animated)
      ctx.fillStyle = "#6B4E14";
      ctx.fillRect(oxX - 8, y, 3, 10 + legOffset);
      ctx.fillRect(oxX + 5, y, 3, 10 - legOffset);
      ctx.fillRect(oxX - 3, y, 3, 10 - legOffset);
      ctx.fillRect(oxX + 10, y, 3, 10 + legOffset);

      // Yoke connection
      ctx.strokeStyle = "#4a3728";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(oxX + 15, y - 5);
      ctx.lineTo(x - 35, y - 5);
      ctx.stroke();
    }
  }, []);

  // Draw dust particles behind wagon
  const drawDust = useCallback((
    ctx: CanvasRenderingContext2D,
    dust: DustParticle[]
  ) => {
    dust.forEach(p => {
      const alpha = (p.life / p.maxLife) * 0.5;
      ctx.fillStyle = `rgba(139, 115, 85, ${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
  }, []);

  // Draw weather particles
  const drawWeather = useCallback((
    ctx: CanvasRenderingContext2D,
    particles: Particle[],
    type: string,
    width: number,
    height: number
  ) => {
    if (type === "rain") {
      ctx.strokeStyle = "rgba(174, 194, 224, 0.6)";
      ctx.lineWidth = 1;
      particles.forEach(p => {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - 2, p.y + 10);
        ctx.stroke();
      });
    } else if (type === "snow") {
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
    } else if (type === "heat") {
      // Heat shimmer effect
      ctx.fillStyle = "rgba(255, 200, 100, 0.1)";
      for (let i = 0; i < 10; i++) {
        const shimmerY = height * 0.7 + Math.sin(Date.now() * 0.002 + i) * 5;
        ctx.fillRect(0, shimmerY, width, 3);
      }
    }
  }, []);

  // Draw sky gradient
  const drawSky = useCallback((
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    colors: string[]
  ) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, height * 0.6);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(0.5, colors[1]);
    gradient.addColorStop(1, colors[2]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height * 0.6);
  }, []);

  // Draw clouds
  const drawClouds = useCallback((
    ctx: CanvasRenderingContext2D,
    width: number,
    offset: number
  ) => {
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";

    const clouds = [
      { x: 100, y: 50, size: 1 },
      { x: 300, y: 80, size: 0.8 },
      { x: 500, y: 40, size: 1.2 },
      { x: 700, y: 70, size: 0.9 },
    ];

    clouds.forEach(cloud => {
      const cloudX = ((cloud.x + offset * 0.1) % (width + 200)) - 100;
      const s = cloud.size;

      ctx.beginPath();
      ctx.arc(cloudX, cloud.y, 20 * s, 0, Math.PI * 2);
      ctx.arc(cloudX + 25 * s, cloud.y, 25 * s, 0, Math.PI * 2);
      ctx.arc(cloudX + 50 * s, cloud.y, 20 * s, 0, Math.PI * 2);
      ctx.arc(cloudX + 15 * s, cloud.y - 15 * s, 18 * s, 0, Math.PI * 2);
      ctx.arc(cloudX + 35 * s, cloud.y - 12 * s, 22 * s, 0, Math.PI * 2);
      ctx.fill();
    });
  }, []);

  // Main animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;

      // Reinitialize particles on resize
      const weatherConfig = WEATHER_EFFECTS[weather as keyof typeof WEATHER_EFFECTS] || WEATHER_EFFECTS.clear;
      particlesRef.current = initParticles(weatherConfig.particles, canvas.height, canvas.width);
    };

    resize();
    window.addEventListener("resize", resize);

    const animate = (timestamp: number) => {
      const delta = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      const width = canvas.width;
      const height = canvas.height;
      const scrollSpeed = getScrollSpeed();
      const timeOfDay = getTimeOfDay();
      const palette = TIME_PALETTES[timeOfDay];
      const weatherConfig = WEATHER_EFFECTS[weather as keyof typeof WEATHER_EFFECTS] || WEATHER_EFFECTS.clear;

      // Update scroll positions (parallax)
      scrollRef.current.mountains -= 0.2 * scrollSpeed * (delta / 16);
      scrollRef.current.hills -= 0.5 * scrollSpeed * (delta / 16);
      scrollRef.current.ground -= 1.0 * scrollSpeed * (delta / 16);

      // Update oxen animation
      oxenFrameRef.current += delta / 16;

      // Update weather particles
      particlesRef.current = particlesRef.current.map(p => {
        let newY = p.y + p.speed * (delta / 16);
        let newX = p.x;

        if (weatherConfig.type === "rain") {
          newX -= 1;
        } else if (weatherConfig.type === "snow") {
          newX += Math.sin(p.y * 0.02) * 0.5;
        }

        if (newY > height) {
          newY = -10;
          newX = Math.random() * width;
        }
        if (newX < 0) newX = width;
        if (newX > width) newX = 0;

        return { ...p, x: newX, y: newY };
      });

      // Spawn dust particles
      if (Math.random() < 0.3) {
        dustRef.current.push({
          x: width * 0.45 - 30,
          y: height * 0.85,
          vx: -1 - Math.random() * 2,
          vy: -0.5 - Math.random(),
          life: 30,
          maxLife: 30,
          size: 3 + Math.random() * 4,
        });
      }

      // Update dust particles
      dustRef.current = dustRef.current
        .map(p => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
          vy: p.vy + 0.02,
          life: p.life - 1,
        }))
        .filter(p => p.life > 0);

      // Clear and draw
      ctx.clearRect(0, 0, width, height);

      // Draw sky
      drawSky(ctx, width, height, palette.sky);

      // Draw clouds (only during day/dawn/dusk)
      if (timeOfDay !== "night") {
        drawClouds(ctx, width, scrollRef.current.mountains);
      } else {
        // Draw stars at night
        ctx.fillStyle = "white";
        for (let i = 0; i < 50; i++) {
          const starX = (i * 37 + scrollRef.current.mountains * 0.05) % width;
          const starY = 20 + (i * 17) % (height * 0.3);
          ctx.beginPath();
          ctx.arc(starX, starY, Math.random() < 0.3 ? 1.5 : 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw scene layers (parallax)
      drawMountains(ctx, width, height, scrollRef.current.mountains, palette.mountains);
      drawHills(ctx, width, height, scrollRef.current.hills, palette.hills);
      drawGround(ctx, width, height, scrollRef.current.ground, palette.ground);

      // Draw dust behind wagon
      drawDust(ctx, dustRef.current);

      // Calculate wagon bounce
      const bounce = Math.sin(timestamp * 0.005) * 3;
      const wheelRotation = scrollRef.current.ground * 0.05;

      // Draw oxen
      drawOxen(ctx, width * 0.45, height * 0.8, oxenFrameRef.current);

      // Draw wagon
      drawWagon(ctx, width * 0.45, height * 0.8, bounce, wheelRotation);

      // Draw weather overlay
      if (weatherConfig.type !== "none") {
        drawWeather(ctx, particlesRef.current, weatherConfig.type, width, height);
      }

      // Weather overlay tint
      if (weather === "rain" || weather === "cold") {
        ctx.fillStyle = "rgba(100, 120, 150, 0.1)";
        ctx.fillRect(0, 0, width, height);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [
    weather, pace,
    getTimeOfDay, getScrollSpeed, initParticles,
    drawSky, drawClouds, drawMountains, drawHills, drawGround,
    drawDust, drawOxen, drawWagon, drawWeather
  ]);

  return (
    <div className="relative w-full h-48 md:h-64 rounded-lg overflow-hidden shadow-lg">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ imageRendering: "pixelated" }}
      />
      {/* Weather indicator overlay */}
      <div className="absolute top-2 right-2 bg-black/30 backdrop-blur-sm rounded px-2 py-1 text-white text-sm">
        {(WEATHER_CONDITIONS[weather] || WEATHER_CONDITIONS.clear).emoji} {(WEATHER_CONDITIONS[weather] || WEATHER_CONDITIONS.clear).name}
      </div>
    </div>
  );
}
