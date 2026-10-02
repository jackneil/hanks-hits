import { create } from "zustand";
import { playSound } from "./sounds";
import { persist } from "zustand/middleware";
import {
  type GameStatus,
  type Ship,
  type Bullet,
  type Asteroid,
  type UFO,
  type Particle,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  ROTATION_SPEED,
  THRUST_POWER,
  MAX_SPEED,
  FRICTION,
  SHIP_SIZE,
  BULLET_SPEED,
  BULLET_LIFETIME,
  MAX_BULLETS,
  BULLET_COOLDOWN,
  ASTEROID_SIZES,
  INITIAL_ASTEROIDS,
  ASTEROIDS_PER_WAVE,
  UFO_SPEED,
  UFO_SIZE,
  UFO_POINTS,
  UFO_SHOOT_INTERVAL,
  UFO_SPAWN_CHANCE,
  SAFE_SPAWN_RADIUS,
  RESPAWN_INVINCIBILITY,
  HYPERSPACE_COOLDOWN,
  HYPERSPACE_RISK,
  INITIAL_LIVES,
  COLORS,
  wrap,
  createAsteroid,
  distance,
} from "./constants";
import { stampIfChanged } from "@/shared/lib/progressStamp";
import { defineUntouchedProgress, markSaved, settleOnLoad } from "@/shared/lib/untouchedProgress";

// Progress data (persisted)
export type AsteroidsProgress = {
  highScore: number;
  highestWave: number;
  totalAsteroidsDestroyed: number;
  totalUfosDestroyed: number;
  gamesPlayed: number;
  soundEnabled: boolean;
  difficulty: "easy" | "normal" | "hard";
  lastModified: number;
};

// Full game state
export type AsteroidsGameState = {
  status: GameStatus;
  score: number;
  lives: number;
  wave: number;
  /**
   * Counts the runs of this page: startGame adds one (the start card, Play
   * again, and the header or pause-menu Restart). Not saved. The clips hook
   * reads it, so a restart during a run is a new run.
   */
  runId: number;
  /** True when the last run ended with a new best (a first-ever score counts). Not saved. */
  lastRunNewBest: boolean;

  ship: Ship;
  bullets: Bullet[];
  asteroids: Asteroid[];
  ufo: UFO | null;
  particles: Particle[];

  // Input state
  rotatingLeft: boolean;
  rotatingRight: boolean;
  thrusting: boolean;
  shooting: boolean;

  // Cooldowns
  shootCooldown: number;
  hyperspaceCooldown: number;

  // Counters
  nextBulletId: number;
  nextAsteroidId: number;
  nextParticleId: number;

  progress: AsteroidsProgress;
};

type AsteroidsActions = {
  startGame: () => void;
  pauseGame: () => void;
  resumeGame: () => void;
  nextWave: () => void;
  gameOver: () => void;
  hyperspace: () => void;

  setInput: (input: Partial<{
    rotatingLeft: boolean;
    rotatingRight: boolean;
    thrusting: boolean;
    shooting: boolean;
  }>) => void;

  update: () => void;

  /** The sound switch: a player's choice, so it stamps the time. */
  toggleSound: () => void;

  getProgress: () => AsteroidsProgress;
  setProgress: (data: AsteroidsProgress) => void;
};

const defaultProgress: AsteroidsProgress = {
  highScore: 0,
  highestWave: 1,
  totalAsteroidsDestroyed: 0,
  totalUfosDestroyed: 0,
  gamesPlayed: 0,
  soundEnabled: true,
  difficulty: "normal",
  lastModified: 0, // Untouched until a player action stamps it (shared/lib/progressStamp.ts).
};

// The sound switch did not stamp the time before the sync-time fix.
const UNTOUCHED = defineUntouchedProgress("asteroids", { defaults: defaultProgress, ignore: ["soundEnabled"] });

function createInitialShip(): Ship {
  return {
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT / 2,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2, // Point up
    thrusting: false,
    invincibleFrames: RESPAWN_INVINCIBILITY,
  };
}

function createInitialAsteroids(wave: number, avoidX: number, avoidY: number): Asteroid[] {
  const count = INITIAL_ASTEROIDS + (wave - 1) * ASTEROIDS_PER_WAVE;
  const asteroids: Asteroid[] = [];
  let id = 1;

  for (let i = 0; i < count; i++) {
    let x: number, y: number;
    let attempts = 0;

    // Find position away from ship
    do {
      x = Math.random() * CANVAS_WIDTH;
      y = Math.random() * CANVAS_HEIGHT;
      attempts++;
    } while (distance(x, y, avoidX, avoidY) < SAFE_SPAWN_RADIUS && attempts < 20);

    asteroids.push(createAsteroid(id++, x, y, "large"));
  }

  return asteroids;
}

function createInitialState(wave: number = 1): Partial<AsteroidsGameState> {
  const ship = createInitialShip();

  return {
    status: "ready",
    score: 0,
    lives: INITIAL_LIVES,
    wave,
    ship,
    bullets: [],
    asteroids: createInitialAsteroids(wave, ship.x, ship.y),
    ufo: null,
    particles: [],
    rotatingLeft: false,
    rotatingRight: false,
    thrusting: false,
    shooting: false,
    shootCooldown: 0,
    hyperspaceCooldown: 0,
    nextBulletId: 1,
    nextAsteroidId: 100,
    nextParticleId: 1,
  };
}

export const useAsteroidsStore = create<AsteroidsGameState & AsteroidsActions>()(
  persist(
    (set, get) => ({
      ...createInitialState() as AsteroidsGameState,
      runId: 0,
      lastRunNewBest: false,
      progress: defaultProgress,

      startGame: () => {
        const state = get();
        set({
          ...createInitialState(1),
          status: "playing",
          runId: state.runId + 1,
          lastRunNewBest: false,
          progress: {
            ...state.progress,
            gamesPlayed: state.progress.gamesPlayed + 1,
            lastModified: Date.now(),
          },
        });
      },

      pauseGame: () => {
        const state = get();
        if (state.status === "playing") {
          set({ status: "paused" });
        }
      },

      resumeGame: () => {
        if (get().status === "paused") {
          set({ status: "playing" });
        }
      },

      nextWave: () => {
        const state = get();
        const nextWaveNum = state.wave + 1;

        playSound("wave");

        set({
          status: "playing",
          wave: nextWaveNum,
          ship: createInitialShip(),
          bullets: [],
          asteroids: createInitialAsteroids(nextWaveNum, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2),
          ufo: null,
          particles: [],
          progress: stampIfChanged(state.progress, {
            ...state.progress,
            highestWave: Math.max(state.progress.highestWave, nextWaveNum),
          }),
        });
      },

      gameOver: () => {
        const state = get();
        playSound("death");

        set({
          status: "gameOver",
          // Strictly better than the best before this run (a cloud best
          // that arrived during the run counts). A first score counts too.
          lastRunNewBest: state.score > 0 && state.score > state.progress.highScore,
          progress: stampIfChanged(state.progress, {
            ...state.progress,
            highScore: Math.max(state.progress.highScore, state.score),
          }),
        });
      },

      hyperspace: () => {
        const state = get();
        if (state.status !== "playing" || state.hyperspaceCooldown > 0) return;

        playSound("hyperspace");

        // Risk of death
        if (Math.random() < HYPERSPACE_RISK) {
          set({ lives: state.lives - 1 });
          if (state.lives - 1 <= 0) {
            get().gameOver();
            return;
          }
        }

        // Teleport to random location
        set({
          ship: {
            ...state.ship,
            x: Math.random() * CANVAS_WIDTH,
            y: Math.random() * CANVAS_HEIGHT,
            vx: 0,
            vy: 0,
            invincibleFrames: 30,
          },
          hyperspaceCooldown: HYPERSPACE_COOLDOWN,
        });
      },

      setInput: (input) => {
        set(input);
      },

      update: () => {
        const state = get();
        if (state.status !== "playing") return;

        let {
          ship,
          bullets,
          asteroids,
          ufo,
          particles,
          score,
          lives,
          shootCooldown,
          hyperspaceCooldown,
          nextBulletId,
          nextAsteroidId,
          nextParticleId,
          progress,
        } = state;
        const { rotatingLeft, rotatingRight, thrusting, shooting } = state;

        // Copy arrays
        bullets = [...bullets];
        asteroids = [...asteroids];
        particles = [...particles];

        // Decrease cooldowns
        if (shootCooldown > 0) shootCooldown--;
        if (hyperspaceCooldown > 0) hyperspaceCooldown--;
        if (ship.invincibleFrames > 0) {
          ship = { ...ship, invincibleFrames: ship.invincibleFrames - 1 };
        }

        // Rotate ship
        let angle = ship.angle;
        if (rotatingLeft) angle -= ROTATION_SPEED;
        if (rotatingRight) angle += ROTATION_SPEED;

        // Thrust
        let vx = ship.vx;
        let vy = ship.vy;
        if (thrusting) {
          vx += Math.cos(angle) * THRUST_POWER;
          vy += Math.sin(angle) * THRUST_POWER;

          // Clamp speed
          const speed = Math.sqrt(vx * vx + vy * vy);
          if (speed > MAX_SPEED) {
            vx = (vx / speed) * MAX_SPEED;
            vy = (vy / speed) * MAX_SPEED;
          }
        }

        // Apply friction
        vx *= FRICTION;
        vy *= FRICTION;

        // Update position with wrap
        const newX = wrap(ship.x + vx, CANVAS_WIDTH);
        const newY = wrap(ship.y + vy, CANVAS_HEIGHT);

        ship = {
          ...ship,
          x: newX,
          y: newY,
          vx,
          vy,
          angle,
          thrusting,
        };

        // Shoot
        if (shooting && shootCooldown === 0 && bullets.length < MAX_BULLETS) {
          playSound("shoot");

          bullets.push({
            id: nextBulletId++,
            x: ship.x + Math.cos(ship.angle) * SHIP_SIZE,
            y: ship.y + Math.sin(ship.angle) * SHIP_SIZE,
            vx: Math.cos(ship.angle) * BULLET_SPEED + ship.vx * 0.5,
            vy: Math.sin(ship.angle) * BULLET_SPEED + ship.vy * 0.5,
            life: BULLET_LIFETIME,
            isUfoBullet: false,
          });
          shootCooldown = BULLET_COOLDOWN;
        }

        // Update bullets
        bullets = bullets
          .map(bullet => ({
            ...bullet,
            x: wrap(bullet.x + bullet.vx, CANVAS_WIDTH),
            y: wrap(bullet.y + bullet.vy, CANVAS_HEIGHT),
            life: bullet.life - 1,
          }))
          .filter(bullet => bullet.life > 0);

        // Update asteroids
        asteroids = asteroids.map(asteroid => ({
          ...asteroid,
          x: wrap(asteroid.x + asteroid.vx, CANVAS_WIDTH),
          y: wrap(asteroid.y + asteroid.vy, CANVAS_HEIGHT),
          rotation: asteroid.rotation + asteroid.rotationSpeed,
        }));

        // Spawn UFO
        if (!ufo && Math.random() < UFO_SPAWN_CHANCE) {
          const side = Math.random() < 0.5 ? 0 : CANVAS_WIDTH;
          ufo = {
            x: side,
            y: Math.random() * CANVAS_HEIGHT,
            vx: side === 0 ? UFO_SPEED : -UFO_SPEED,
            vy: (Math.random() - 0.5) * UFO_SPEED,
            shootCooldown: UFO_SHOOT_INTERVAL,
          };
        }

        // Update UFO
        if (ufo) {
          ufo = {
            ...ufo,
            x: ufo.x + ufo.vx,
            y: wrap(ufo.y + ufo.vy, CANVAS_HEIGHT),
            shootCooldown: ufo.shootCooldown - 1,
          };

          // UFO shoots
          if (ufo.shootCooldown <= 0) {
            const angleToShip = Math.atan2(ship.y - ufo.y, ship.x - ufo.x);
            const spread = (Math.random() - 0.5) * 0.5; // Inaccurate shots

            bullets.push({
              id: nextBulletId++,
              x: ufo.x,
              y: ufo.y,
              vx: Math.cos(angleToShip + spread) * BULLET_SPEED * 0.7,
              vy: Math.sin(angleToShip + spread) * BULLET_SPEED * 0.7,
              life: BULLET_LIFETIME,
              isUfoBullet: true,
            });
            ufo.shootCooldown = UFO_SHOOT_INTERVAL;
          }

          // UFO leaves screen
          if (ufo.x < -UFO_SIZE || ufo.x > CANVAS_WIDTH + UFO_SIZE) {
            ufo = null;
          }
        }

        // Collision detection: bullets vs asteroids
        const bulletsToRemove: number[] = [];
        const asteroidsToRemove: number[] = [];
        const newAsteroids: Asteroid[] = [];

        for (const bullet of bullets) {
          if (bullet.isUfoBullet) continue;

          for (const asteroid of asteroids) {
            const asteroidRadius = ASTEROID_SIZES[asteroid.size].radius;
            if (distance(bullet.x, bullet.y, asteroid.x, asteroid.y) < asteroidRadius) {
              bulletsToRemove.push(bullet.id);
              asteroidsToRemove.push(asteroid.id);

              // Score
              score += ASTEROID_SIZES[asteroid.size].points;
              progress = {
                ...progress,
                totalAsteroidsDestroyed: progress.totalAsteroidsDestroyed + 1,
              };

              // Split asteroid
              if (asteroid.size === "large") {
                for (let i = 0; i < 2; i++) {
                  newAsteroids.push(
                    createAsteroid(
                      nextAsteroidId++,
                      asteroid.x,
                      asteroid.y,
                      "medium",
                      Math.random() * Math.PI * 2
                    )
                  );
                }
              } else if (asteroid.size === "medium") {
                for (let i = 0; i < 2; i++) {
                  newAsteroids.push(
                    createAsteroid(
                      nextAsteroidId++,
                      asteroid.x,
                      asteroid.y,
                      "small",
                      Math.random() * Math.PI * 2
                    )
                  );
                }
              }

              // Particles
              for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                particles.push({
                  id: nextParticleId++,
                  x: asteroid.x,
                  y: asteroid.y,
                  vx: Math.cos(angle) * (2 + Math.random() * 2),
                  vy: Math.sin(angle) * (2 + Math.random() * 2),
                  life: 30,
                  maxLife: 30,
                  color: COLORS.ASTEROID,
                });
              }

              playSound("explode");
              break;
            }
          }
        }

        // Collision: bullets vs UFO
        if (ufo) {
          for (const bullet of bullets) {
            if (bullet.isUfoBullet) continue;
            if (distance(bullet.x, bullet.y, ufo.x, ufo.y) < UFO_SIZE) {
              bulletsToRemove.push(bullet.id);
              score += UFO_POINTS;
              progress = {
                ...progress,
                totalUfosDestroyed: progress.totalUfosDestroyed + 1,
              };

              // Particles
              for (let i = 0; i < 12; i++) {
                const angle = (i / 12) * Math.PI * 2;
                particles.push({
                  id: nextParticleId++,
                  x: ufo.x,
                  y: ufo.y,
                  vx: Math.cos(angle) * (3 + Math.random() * 2),
                  vy: Math.sin(angle) * (3 + Math.random() * 2),
                  life: 40,
                  maxLife: 40,
                  color: COLORS.UFO,
                });
              }

              playSound("explode");
              ufo = null;
              break;
            }
          }
        }

        // Collision: ship vs asteroids (if not invincible)
        if (ship.invincibleFrames === 0) {
          for (const asteroid of asteroids) {
            const asteroidRadius = ASTEROID_SIZES[asteroid.size].radius * 0.8; // Forgiving hitbox
            if (distance(ship.x, ship.y, asteroid.x, asteroid.y) < asteroidRadius + SHIP_SIZE * 0.6) {
              playSound("death");
              lives--;

              // Explosion particles
              for (let i = 0; i < 15; i++) {
                const angle = (i / 15) * Math.PI * 2;
                particles.push({
                  id: nextParticleId++,
                  x: ship.x,
                  y: ship.y,
                  vx: Math.cos(angle) * (2 + Math.random() * 3),
                  vy: Math.sin(angle) * (2 + Math.random() * 3),
                  life: 45,
                  maxLife: 45,
                  color: COLORS.SHIP,
                });
              }

              if (lives <= 0) {
                set({
                  ship,
                  bullets: bullets.filter(b => !bulletsToRemove.includes(b.id)),
                  asteroids: [...asteroids.filter(a => !asteroidsToRemove.includes(a.id)), ...newAsteroids],
                  ufo,
                  particles,
                  score,
                  lives,
                  shootCooldown,
                  hyperspaceCooldown,
                  nextBulletId,
                  nextAsteroidId,
                  nextParticleId,
                  progress: stampIfChanged(state.progress, progress),
                });
                get().gameOver();
                return;
              }

              // Respawn
              ship = createInitialShip();
              break;
            }
          }
        }

        // Collision: ship vs UFO bullets
        if (ship.invincibleFrames === 0) {
          for (const bullet of bullets) {
            if (!bullet.isUfoBullet) continue;
            if (distance(ship.x, ship.y, bullet.x, bullet.y) < SHIP_SIZE * 0.7) {
              playSound("death");
              bulletsToRemove.push(bullet.id);
              lives--;

              // Explosion particles
              for (let i = 0; i < 15; i++) {
                const angle = (i / 15) * Math.PI * 2;
                particles.push({
                  id: nextParticleId++,
                  x: ship.x,
                  y: ship.y,
                  vx: Math.cos(angle) * (2 + Math.random() * 3),
                  vy: Math.sin(angle) * (2 + Math.random() * 3),
                  life: 45,
                  maxLife: 45,
                  color: COLORS.SHIP,
                });
              }

              if (lives <= 0) {
                set({
                  ship,
                  bullets: bullets.filter(b => !bulletsToRemove.includes(b.id)),
                  asteroids: [...asteroids.filter(a => !asteroidsToRemove.includes(a.id)), ...newAsteroids],
                  ufo,
                  particles,
                  score,
                  lives,
                  shootCooldown,
                  hyperspaceCooldown,
                  nextBulletId,
                  nextAsteroidId,
                  nextParticleId,
                  progress: stampIfChanged(state.progress, progress),
                });
                get().gameOver();
                return;
              }

              ship = createInitialShip();
              break;
            }
          }
        }

        // Remove destroyed objects
        bullets = bullets.filter(b => !bulletsToRemove.includes(b.id));
        asteroids = [...asteroids.filter(a => !asteroidsToRemove.includes(a.id)), ...newAsteroids];

        // Update particles
        particles = particles
          .map(p => ({
            ...p,
            x: p.x + p.vx,
            y: p.y + p.vy,
            vx: p.vx * 0.98,
            vy: p.vy * 0.98,
            life: p.life - 1,
          }))
          .filter(p => p.life > 0);

        // Check wave complete
        if (asteroids.length === 0) {
          set({
            status: "waveComplete",
            ship,
            bullets,
            asteroids,
            ufo,
            particles,
            score,
            lives,
            shootCooldown,
            hyperspaceCooldown,
            nextBulletId,
            nextAsteroidId,
            nextParticleId,
            progress: stampIfChanged(state.progress, progress),
          });
          return;
        }

        // Update state
        set({
          ship,
          bullets,
          asteroids,
          ufo,
          particles,
          score,
          lives,
          shootCooldown,
          hyperspaceCooldown,
          nextBulletId,
          nextAsteroidId,
          nextParticleId,
          // A frame that destroyed something stamps the new totals.
          progress: stampIfChanged(state.progress, progress),
        });
      },

      toggleSound: () =>
        set((state) => ({
          progress: { ...state.progress, soundEnabled: !state.progress.soundEnabled, lastModified: Date.now() },
        })),

      getProgress: () => get().progress,
      setProgress: (data: AsteroidsProgress) => set({ progress: data }),
    }),
    {
      name: "asteroids-game-state",
      // A save of the code before the sync-time fix gets the real time of
      // its progress. The version stays, so that code still loads a new
      // save (shared/lib/untouchedProgress.ts).
      merge: settleOnLoad(UNTOUCHED),
      partialize: (state) => markSaved({
        progress: state.progress,
      }),
    }
  )
);
