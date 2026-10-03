/**
 * Drivers for every synced store: for each action, the arguments that fit
 * its game, and the kind of change it makes (shared/lib/progressStamp.ts).
 * progress-stamp-fuzz.test.ts runs them to hold each store to the time
 * rules. The no-worse-than-master test (no-worse/harness.ts) runs them to
 * make real progress, also with the store code of master
 * (scripts/legacy-saves/no-worse.sh): so this file imports only modules
 * that master has too.
 */
import { vi } from "vitest";
import { Chess } from "chess.js";
import { BUILDINGS, UPGRADES as COOKIE_UPGRADES } from "@/games/cookie-clicker/lib/constants";
import { STAGES, VEHICLES, UPGRADES as HILL_UPGRADES } from "@/games/hill-climb/lib/constants";
import { SHOP_ITEMS, PET_SPECIES } from "@/apps/virtual-pet/lib/constants";
import { DRUM_KITS } from "@/apps/drum-machine/lib/constants";
import { getSelectablePieces } from "@/games/checkers/lib/gameLogic";

/** Seeded random numbers (mulberry32), so a failure replays. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type State = any;
export type Kind = "player" | "automatic" | "continuous";
export type Progress = Record<string, unknown>;
export type Step = {
  args?: (rng: Rng, state: State) => unknown[];
  /**
   * "automatic": a change that a page makes once (automaticStamp).
   * "continuous": a clock that runs while the page is open (never stamps).
   * A function picks it from the arguments and the progress before and after.
   */
  kind?: Kind | ((args: unknown[], before: Progress, after: Progress) => Kind);
  weight?: number;
};
export type Driver = {
  /** The actions to run, with their arguments. Default: no arguments, a player action. */
  steps: Record<string, Step>;
  /** Actions that the test does not run, and why. */
  skip?: Record<string, string>;
  /** Clock fields of the progress (not a player's change). */
  clocks?: string[];
};

export const pick = <T,>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];
export const int = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
export const bool = (rng: Rng) => rng() < 0.5;

const DIRECTIONS = ["up", "down", "left", "right"] as const;
const AGE_DIFFICULTIES = ["4yo", "8yo", "12yo", "24yo", "99yo"] as const;
export const READ_ONLY = /^(get|is|can|calculate|has)[A-Z]/;
export const SYNC = new Set(["getProgress", "setProgress"]);

export const DRIVERS: Record<string, Driver> = {
  "2048": {
    steps: {
      move: { args: (rng) => [pick(rng, DIRECTIONS)], weight: 6 },
      newGame: {},
      undo: {},
      continueAfterWin: {},
      clearAnimationState: {},
    },
  },
  arkanoid: {
    steps: {
      startGame: {},
      launchBall: {},
      pauseGame: {},
      resumeGame: {},
      endGame: {},
      loseLife: {},
      setPaddleX: { args: (rng) => [rng() * 2 - 1] },
      addBall: { args: (rng) => [{ type: "blue", x: rng(), y: rng(), vx: 0.1, vy: 1, stuck: false }] },
      updateBalls: { args: (_rng, state) => [state.balls.slice(1)] },
      addScore: { args: (rng) => [int(rng, 0, 50)], weight: 3 },
      updateMultiplier: { args: (rng) => [int(rng, 0, 60)] },
      toggleSound: {},
    },
  },
  asteroids: {
    steps: {
      startGame: {},
      pauseGame: {},
      resumeGame: {},
      nextWave: {},
      gameOver: {},
      hyperspace: {},
      setInput: { args: (rng) => [{ rotatingLeft: bool(rng), thrusting: bool(rng), shooting: bool(rng) }] },
      update: { weight: 8 },
      toggleSound: {},
    },
  },
  "blitz-bomber": {
    steps: {
      startGame: {},
      pauseGame: {},
      resumeGame: {},
      dropBomb: {},
      update: { args: (rng) => [int(rng, 8, 40)], weight: 6 },
      crash: {},
      land: {},
      reset: {},
      nextLevel: {},
      setDifficulty: { args: (rng) => [pick(rng, ["easy", "normal", "hard"])] },
      setSoundEnabled: { args: (rng) => [bool(rng)] },
    },
  },
  bomberman: {
    steps: {
      startGame: {},
      pauseGame: {},
      resumeGame: {},
      nextLevel: {},
      resetGame: {},
      movePlayer: { args: (rng) => [pick(rng, ["UP", "DOWN", "LEFT", "RIGHT"])], weight: 4 },
      placeBomb: {},
      update: { args: (rng) => [int(rng, 16, 500)], weight: 6 },
      toggleSound: {},
    },
  },
  breakout: {
    steps: {
      startGame: {},
      pauseGame: {},
      resumeGame: {},
      nextLevel: {},
      restartLevel: {},
      gameOver: {},
      movePaddle: { args: (rng) => [rng() * 800] },
      launchBall: {},
      update: { weight: 8 },
    },
  },
  checkers: {
    steps: {
      selectPiece: {
        args: (rng, state) => {
          const pieces = getSelectablePieces(state.board, state.currentPlayer, state.rules);
          return [pieces.length ? pick(rng, pieces) : { row: 0, col: 0 }];
        },
        weight: 4,
      },
      makeMove: {
        args: (rng, state) => [state.validMoves.length ? pick<{ to: unknown }>(rng, state.validMoves).to : { row: 0, col: 0 }],
        weight: 4,
      },
      newGame: { args: (rng) => [bool(rng) ? undefined : { difficulty: pick(rng, ["easy", "medium", "hard"]) }] },
      setDifficulty: { args: (rng) => [pick(rng, ["easy", "medium", "hard"])] },
      setVariant: { args: (rng) => [pick(rng, ["american", "casual", "brazilian", "suicide"])] },
      setGameMode: { args: (rng) => [pick(rng, ["vs-ai", "vs-friend"])] },
      pauseGame: {},
      resumeGame: {},
      aiMove: { weight: 3 },
      recordWin: { args: (rng) => [pick(rng, ["red", "black"])] },
    },
  },
  chess: {
    steps: {
      selectSquare: { args: (rng) => [`${pick(rng, ["a", "b", "c", "d", "e", "f", "g", "h"])}${int(rng, 1, 8)}`] },
      makeMove: {
        args: (rng, state) => {
          const moves = (state.game as Chess).moves({ verbose: true });
          if (!moves.length) return ["a2", "a3"];
          const move = pick(rng, moves);
          return [move.from, move.to, move.promotion];
        },
        weight: 6,
      },
      handlePromotion: { args: (rng) => [pick(rng, ["q", "r", "b", "n"])] },
      cancelPromotion: {},
      aiMove: { weight: 2 },
      undoMove: {},
      newGame: { args: (rng) => [bool(rng) ? undefined : { difficulty: pick(rng, ["easy", "medium", "hard"]) }] },
      setDifficulty: { args: (rng) => [pick(rng, ["easy", "medium", "hard"])] },
      setGameMode: { args: (rng) => [pick(rng, ["ai", "local"])] },
      setPlayerColor: { args: (rng) => [pick(rng, ["white", "black"])] },
      pauseGame: {},
      resumeGame: {},
      resign: {},
      recordWin: {},
      recordLoss: {},
      recordDraw: {},
      clearMessage: {},
      updateGameState: {},
    },
  },
  "cookie-clicker": {
    clocks: ["lastTick"],
    steps: {
      clickCookie: { args: (rng) => [rng() * 100, rng() * 100], weight: 6 },
      tick: { kind: "continuous", weight: 4 },
      buyBuilding: { args: (rng) => [pick(rng, BUILDINGS).id], weight: 3 },
      buyUpgrade: { args: (rng) => [pick(rng, COOKIE_UPGRADES).id] },
      checkAchievements: {},
      clearNewAchievements: {},
      spawnGoldenCookie: { args: (rng) => [pick(rng, ["frenzy", "clickFrenzy", "lucky"])] },
      clickGoldenCookie: {},
      clearGoldenCookie: {},
      activateFrenzy: {},
      activateClickFrenzy: {},
      addLuckyCookies: {},
      applyOfflineProgress: { kind: "automatic" },
      toggleSound: {},
      clearFloatingText: { args: (_rng, state) => [state.floatingTexts[0]?.id ?? "none"] },
      resetSession: {},
      resetProgress: { weight: 0.2 },
    },
  },
  "dino-runner": {
    steps: {
      startGame: {},
      gameOver: {},
      reset: {},
      update: { args: (rng) => [int(rng, 8, 400)], weight: 8 },
      jump: {},
      releaseJump: {},
      duck: { args: (rng) => [bool(rng)] },
      setSoundEnabled: { args: (rng) => [bool(rng)] },
    },
  },
  "endless-runner": {
    steps: {
      startGame: {},
      jump: {},
      startDuck: {},
      stopDuck: {},
      update: { args: (rng) => [rng() * 0.05], weight: 6 },
      endGame: {},
      reset: {},
      unlockCharacter: {
        args: (rng) => [pick(rng, ["speedy-sam", "rocket-rita", "bouncy-bob", "ninja-nancy", "robo-randy", "golden-gary"])],
      },
      selectCharacter: {
        args: (rng) => [pick(rng, ["speedy-sam", "rocket-rita", "bouncy-bob", "ninja-nancy", "robo-randy", "golden-gary"])],
      },
    },
  },
  "flappy-bird": {
    steps: {
      startGame: {},
      flap: {},
      update: { args: (rng) => [rng() * 0.05], weight: 6 },
      endGame: {},
      reset: {},
    },
  },
  "four-wheeler-3d": {
    steps: {
      updateProgress: {
        args: (rng) => [
          bool(rng)
            ? (p: State) => ({ ...p })
            : (p: State) => ({ ...p, trophies: p.trophies + 1, fishCaught: { ...p.fishCaught } }),
        ],
        weight: 3,
      },
      addMoney: { args: (rng) => [pick(rng, [0, 25, -10, 100])], weight: 2 },
      setPaused: { args: (rng) => [bool(rng)] },
      setHasStarted: { args: (rng) => [bool(rng)] },
      setMode: { args: (rng) => [pick(rng, ["vehicle", "foot"])] },
      setHint: { args: (rng) => [bool(rng) ? null : "hint"] },
      resetSession: {},
      tick: { args: (rng) => [pick(rng, [1, 30, 61, 900])], kind: "continuous", weight: 4 },
      seedClock: {},
      flushClock: { kind: "continuous" },
      // Sleeping in the house: a player's choice.
      setTimeOfDay: { args: (rng) => [int(rng, 0, 23)] },
      startNos: {},
      clearNos: {},
      updateSettings: { args: (rng) => [{ soundEnabled: bool(rng) }] },
    },
  },
  hextris: {
    steps: {
      startGame: {},
      pauseGame: {},
      resumeGame: {},
      gameOver: {},
      rotateLeft: { weight: 2 },
      rotateRight: { weight: 2 },
      update: { args: (rng) => [int(rng, 16, 400)], weight: 8 },
    },
  },
  "hill-climb": {
    steps: {
      startRun: {},
      endRun: { args: (rng) => [pick(rng, ["head", "fuel"])] },
      restartRun: {},
      updateDistance: { args: (rng) => [int(rng, 0, 3000)], weight: 2 },
      pauseGame: {},
      resumeGame: {},
      consumeFuel: { args: (rng) => [int(rng, 0, 30)] },
      collectFuel: {},
      consumeNitro: { args: (rng) => [int(rng, 0, 30)] },
      refillNitro: { args: (rng) => [int(rng, 0, 30)] },
      addCoins: { args: (rng) => [int(rng, 0, 500), bool(rng)], weight: 3 },
      addFlip: {},
      addAirtime: { args: (rng) => [rng() * 2] },
      incrementCombo: {},
      resetCombo: {},
      unlockVehicle: { args: (rng) => [pick(rng, VEHICLES).id] },
      selectVehicle: { args: (rng) => [pick(rng, VEHICLES).id] },
      purchaseUpgrade: {
        args: (rng) => [pick(rng, VEHICLES).id, pick(rng, Object.keys(HILL_UPGRADES))],
      },
      selectStage: { args: (rng) => [pick(rng, STAGES).id] },
      toggleSound: {},
      toggleMusic: {},
      setLeanSensitivity: { args: (rng) => [pick(rng, [0.5, 1, 1.5, 3])] },
      resetProgress: { weight: 0.2 },
    },
  },
  "math-attack": {
    steps: {
      startGame: { args: (rng) => [int(rng, 1, 5)] },
      pauseGame: {},
      resumeGame: {},
      addScore: { args: (rng) => [int(rng, 1, 30), pick(rng, ["+", "-", "×", "÷"])], weight: 3 },
      recordAnswerAttempt: {},
      incrementCombo: { weight: 2 },
      resetCombo: {},
      loseLife: { weight: 2 },
      endGame: {},
      reset: {},
      setDifficulty: { args: (rng) => [pick(rng, ["4yo", "6yo", "8yo", "10yo"])] },
      setSoundEnabled: { args: (rng) => [bool(rng)] },
    },
  },
  "memory-match": {
    steps: {
      flipCard: { args: (rng, state) => [int(rng, 0, state.cards.length - 1)], weight: 8 },
      newGame: {
        args: (rng) =>
          bool(rng) ? [] : [pick(rng, ["easy", "medium", "hard", "expert"]), pick(rng, ["animals", "vehicles"])],
      },
      setDifficulty: { args: (rng) => [pick(rng, ["easy", "medium", "hard", "expert"])] },
      setTheme: { args: (rng) => [pick(rng, ["animals", "vehicles", "emojis", "dinosaurs"])] },
      toggleSound: {},
      tick: {},
      pauseTimer: {},
      resumeTimer: {},
    },
  },
  "monster-truck": {
    steps: {
      addCoins: { args: (rng) => [int(rng, 0, 400)], weight: 3 },
      spendCoins: { args: (rng) => [int(rng, 0, 400)] },
      selectTruck: { args: (rng, state) => [pick<{ id: string }>(rng, state.trucks).id] },
      unlockTruck: { args: (rng, state) => [pick<{ id: string }>(rng, state.trucks).id] },
      upgradeStat: {
        args: (rng, state) => [pick<{ id: string }>(rng, state.trucks).id, pick(rng, ["engine", "suspension", "tires", "nos"])],
      },
      setPaintColor: { args: (rng, state) => [pick<{ id: string }>(rng, state.trucks).id, pick(rng, ["#ff0000", "#00ff00"])] },
      setDecal: { args: (rng, state) => [pick<{ id: string }>(rng, state.trucks).id, pick(rng, [null, "flames"])] },
      addAirtime: { args: (rng) => [rng() * 3] },
      addFlip: {},
      addDestruction: {},
      collectStar: { weight: 2 },
      resetSession: {},
      useNos: { args: (rng) => [int(rng, 0, 50)] },
      rechargeNos: { args: (rng) => [int(rng, 0, 50)] },
      completeChallenge: { args: (rng, state) => [pick<{ id: string }>(rng, state.challenges).id] },
      resetChallenges: {},
      toggleSound: {},
      toggleMusic: {},
      setPaused: { args: (rng) => [bool(rng)] },
      setHasStarted: { args: (rng) => [bool(rng)] },
      setShowGarage: { args: (rng) => [bool(rng)] },
      setShowChallenges: { args: (rng) => [bool(rng)] },
    },
  },
  "oregon-trail": {
    steps: {
      setPhase: { args: (rng) => [pick(rng, ["title", "setup_name", "store", "travel", "status"])] },
      startGame: {
        args: (rng) => [
          "Synthetic",
          pick(rng, ["banker", "carpenter", "farmer"]),
          ["A", "B", "C"],
          pick(rng, ["march", "april", "may"]),
        ],
      },
      buySupply: { args: (rng) => [pick(rng, ["food", "oxen", "clothing", "ammunition", "wheel"]), int(rng, 0, 5)] },
      sellSupply: { args: (rng) => [pick(rng, ["food", "oxen", "clothing", "ammunition", "wheel"]), int(rng, 0, 5)] },
      leaveStore: {},
      travel: { weight: 4 },
      setPace: { args: (rng) => [pick(rng, ["steady", "strenuous", "grueling"])] },
      rest: {},
      dismissEvent: {},
      hunt: { args: (rng) => [int(rng, 0, 50), int(rng, 0, 5)] },
      crossRiver: { args: (rng) => [pick(rng, ["ford", "float", "ferry"])] },
      continueFromLandmark: {},
      resetGame: { weight: 0.3 },
      newJourney: { weight: 0.3 },
    },
  },
  platformer: {
    steps: {
      startGame: { args: (rng) => [int(rng, 0, 2)] },
      pauseGame: {},
      resumeGame: {},
      jump: { weight: 2 },
      moveLeft: {},
      moveRight: {},
      stopMove: {},
      setMovingLeft: { args: (rng) => [bool(rng)] },
      setMovingRight: { args: (rng) => [bool(rng)] },
      update: { args: (rng) => [rng() * 0.05], weight: 6 },
      endGame: { args: (rng) => [pick(rng, ["death", "complete"])] },
      reset: {},
      nextLevel: {},
    },
  },
  quoridor: {
    steps: {
      movePawn: {
        args: (rng, state) => {
          const moves = state.humanMoves();
          return [moves.length ? pick(rng, moves) : { row: 0, col: 0 }];
        },
        weight: 4,
      },
      enterWallMode: {},
      exitWallMode: {},
      toggleWallOrientation: {},
      setWallPreview: {
        args: (rng) => [{ row: int(rng, 0, 7), col: int(rng, 0, 7), orientation: pick(rng, ["horizontal", "vertical"]) }],
      },
      placeWall: {
        args: (rng) => [{ row: int(rng, 0, 7), col: int(rng, 0, 7), orientation: pick(rng, ["horizontal", "vertical"]) }],
        weight: 2,
      },
      aiMove: { args: (rng) => [rng], weight: 3 },
      newGame: { args: (rng) => (bool(rng) ? [] : [pick(rng, ["ai", "local"]), pick(rng, ["easy", "medium", "hard"])]) },
      setGameMode: { args: (rng) => [pick(rng, ["ai", "local"])] },
      setDifficulty: { args: (rng) => [pick(rng, ["easy", "medium", "hard"])] },
      pauseGame: {},
      resumeGame: {},
    },
    skip: { humanMoves: "reads the squares a player may step to; it changes nothing" },
  },
  "retro-arcade": {
    steps: {
      setCurrentSystem: { args: (rng) => [pick(rng, ["nes", "snes", null])] },
      startGame: { args: (rng) => ["/roms/x.nes", pick(rng, ["Synthetic Quest", "Other Game"]), "nes"] },
      restartGame: {},
      stopGame: {},
      setLoading: { args: (rng) => [bool(rng)] },
      addFavorite: { args: (rng) => [pick(rng, ["nes-a", "nes-b"])] },
      removeFavorite: { args: (rng) => [pick(rng, ["nes-a", "nes-b"])] },
      addRecentlyPlayed: { args: (rng) => [{ gameId: pick(rng, ["nes-a", "snes-b"]), name: "Game", system: "nes" }] },
      addCustomRom: { args: (rng) => [{ id: pick(rng, ["r1", "r2"]), name: "Rom", system: "nes", addedAt: 1 }] },
      removeCustomRom: { args: (rng) => [pick(rng, ["r1", "r2"])] },
      updateSettings: { args: (rng) => [{ volume: pick(rng, [0.5, 0.7]) }] },
      updatePlayTime: { args: (rng) => [int(rng, 0, 30)] },
    },
  },
  snake: {
    steps: {
      startGame: {},
      pauseGame: {},
      resumeGame: {},
      setDirection: { args: (rng) => [pick(rng, DIRECTIONS)], weight: 3 },
      tick: { weight: 8 },
      reset: {},
      setSpeed: { args: (rng) => [pick(rng, ["slow", "medium", "fast"])] },
      setWraparound: { args: (rng) => [bool(rng)] },
      setControlMode: { args: (rng) => [pick(rng, ["buttons", "swipe"])] },
      setSoundEnabled: { args: (rng) => [bool(rng)] },
    },
  },
  "space-invaders": {
    steps: {
      startGame: {},
      pauseGame: {},
      resumeGame: {},
      reset: {},
      movePlayer: { args: (rng) => [pick(rng, [-1, 0, 1])] },
      shoot: { weight: 2 },
      nextWave: {},
      update: { weight: 8 },
      setSoundEnabled: { args: (rng) => [bool(rng)] },
      setDifficulty: { args: (rng) => [pick(rng, ["4yo", "8yo", "12yo"])] },
    },
  },
  wordle: {
    steps: {
      startGame: {},
      addLetter: { args: (rng) => [pick(rng, ["A", "E", "R", "S", "T", "C", "O"])], weight: 6 },
      removeLetter: {},
      submitGuess: { weight: 3 },
      useHint: {},
      reset: {},
      setDifficulty: { args: (rng) => [pick(rng, AGE_DIFFICULTIES)] },
      setSoundEnabled: { args: (rng) => [bool(rng)] },
      openTutorial: {},
      closeTutorial: {},
    },
  },
  "drawing-app": {
    steps: {
      setTool: { args: (rng) => [pick(rng, ["pencil", "brush", "eraser"])] },
      setColor: { args: (rng) => [pick(rng, ["#000000", "#ff0000"])] },
      setBrushSize: { args: (rng) => [int(rng, 1, 30)] },
      setIsDrawing: { args: (rng) => [bool(rng)] },
      updateSettings: { args: (rng) => [{ showGrid: bool(rng) }] },
      toggleSound: {},
      toggleGrid: {},
      saveArtwork: { args: () => ["data:image/png;base64,AAAA", "Synthetic art"] },
      deleteArtwork: { args: (rng, state) => [state.savedArtworks[0]?.id ?? (bool(rng) ? "none" : "x")] },
      updateArtwork: { args: (_rng, state) => [state.savedArtworks[0]?.id ?? "none", "data:image/png;base64,BBBB"] },
      setShowGallery: { args: (rng) => [bool(rng)] },
      setSelectedArtwork: { args: () => [null] },
      incrementArtworksCreated: {},
      addDrawTime: { args: (rng) => [int(rng, 0, 20)] },
    },
  },
  "drum-machine": {
    steps: {
      setMode: { args: (rng) => [pick(rng, ["pads", "sequencer"])] },
      setKit: { args: (rng) => [pick(rng, DRUM_KITS).id] },
      setBpm: { args: (rng) => [int(rng, 60, 180)] },
      triggerPad: { args: (rng, state) => [pick(rng, DRUM_KITS.find((k) => k.id === state.currentKitId)!.sounds).id], weight: 3 },
      releasePad: { args: (rng, state) => [pick(rng, DRUM_KITS.find((k) => k.id === state.currentKitId)!.sounds).id] },
      toggleStep: { args: (rng, state) => [pick(rng, DRUM_KITS.find((k) => k.id === state.currentKitId)!.sounds).id, int(rng, 0, 15)] },
      clearPattern: {},
      extendPattern: {},
      shrinkPattern: {},
      startPlayback: {},
      stopPlayback: {},
      advanceStep: { weight: 2 },
      toggleRecording: {},
      saveBeat: { args: () => ["Synthetic beat"] },
      loadBeat: { args: (_rng, state) => [state.progress.savedBeats[0] ?? { id: "x", name: "x", kitId: "hip-hop", bpm: 100, pattern: {}, createdAt: "" }] },
      deleteBeat: { args: (_rng, state) => [state.progress.savedBeats[0]?.id ?? "none"] },
      toggleSound: {},
    },
  },
  "joke-generator": {
    steps: {
      setCurrentJoke: { args: () => [{ id: "j1", setup: "Synthetic?", punchline: "Yes", category: "animals" }] },
      revealPunchline: {},
      hidePunchline: {},
      setLoading: { args: (rng) => [bool(rng)] },
      setCategory: { args: (rng) => [pick(rng, ["all", "animals", "school"])] },
      addFavorite: { args: (rng) => [{ id: pick(rng, ["j1", "j2"]), setup: "S?", punchline: "P", category: "animals" }] },
      removeFavorite: { args: (rng) => [pick(rng, ["j1", "j2"])] },
      setShowFavorites: { args: (rng) => [bool(rng)] },
      rateJoke: { args: (rng) => [pick(rng, ["j1", "j2"]), pick(rng, ["funny", "not-funny"])] },
      // `true`: the first joke of a page, which shows by itself.
      incrementViewed: { args: (rng) => [bool(rng)], kind: (args) => (args[0] ? "automatic" : "player") },
      incrementCopied: {},
      incrementShared: {},
      setCopiedId: { args: (rng) => [bool(rng) ? null : "j1"] },
      markJokeSeen: {
        args: (rng) => [pick(rng, ["j1", "j2", "j3"]), bool(rng)],
        kind: (args) => (args[1] ? "automatic" : "player"),
      },
      resetSeenJokes: {},
    },
  },
  "toy-finder": {
    steps: {
      setCategory: { args: (rng) => [pick(rng, ["all", "outdoor"])] },
      setAgeRange: { args: (rng) => [pick(rng, ["all", "6-8"])] },
      addToWishlist: { args: (rng) => [{ id: pick(rng, ["t1", "t2"]) }, pick(rng, ["high", "low"])] },
      removeFromWishlist: { args: (rng) => [pick(rng, ["t1", "t2"])] },
      updatePriority: { args: (rng) => [pick(rng, ["t1", "t2"]), pick(rng, ["high", "low"])] },
      setShowWishlist: { args: (rng) => [bool(rng)] },
      addToRecentlyViewed: { args: (rng) => [pick(rng, ["t1", "t2", "t3"])] },
      setAddedToyId: { args: (rng) => [bool(rng) ? null : "t1"] },
    },
  },
  trivia: {
    steps: {
      startGame: {},
      answerQuestion: { args: (rng) => [bool(rng), int(rng, 0, 20)], weight: 3 },
      nextQuestion: {},
      endGame: {},
      reset: {},
      setDifficulty: { args: (rng) => [pick(rng, AGE_DIFFICULTIES)] },
      setSoundEnabled: { args: (rng) => [bool(rng)] },
    },
  },
  "virtual-pet": {
    steps: {
      feed: { args: (rng) => [pick(rng, SHOP_ITEMS).id] },
      useToy: { args: (rng) => [pick(rng, SHOP_ITEMS).id] },
      play: {},
      sleep: {},
      wake: {},
      clean: {},
      // The minute update: a visit on a new day (or an unlock) is once a
      // day; the needs alone are a continuous change.
      updateFromTime: {
        // Now and then the next day (a visit), so the streak and the unlocks run.
        args: (rng) => {
          if (rng() < 0.15) vi.advanceTimersByTime(24 * 60 * 60 * 1000);
          return [];
        },
        kind: (_args, before, after) => {
          const day = (p: Progress) => (p.stats as { lastPlayDate: string }).lastPlayDate;
          const species = (p: Progress) => (p.unlockedSpecies as string[]).length;
          return day(before) !== day(after) || species(before) !== species(after) ? "automatic" : "continuous";
        },
        weight: 4,
      },
      startMiniGame: {},
      endMiniGame: { args: (rng) => [int(rng, 0, 15)] },
      buyItem: { args: (rng) => [pick(rng, SHOP_ITEMS).id] },
      toggleShop: {},
      toggleStats: {},
      renamePet: { args: (rng) => [pick(rng, ["Blobby", "Synthetic"])] },
      newPet: { args: (rng) => [pick(rng, PET_SPECIES).id, "Synthetic"] },
      toggleSound: {},
    },
  },
  weather: {
    steps: {
      setLastLocation: { args: (rng) => [{ name: pick(rng, ["A", "B"]), latitude: 1, longitude: 2 }] },
      addSavedLocation: { args: (rng) => [{ name: pick(rng, ["A", "B"]), latitude: 1, longitude: 2 }] },
      removeSavedLocation: { args: (rng) => [pick(rng, ["A", "B"])] },
      setSearchQuery: { args: () => ["Syn"] },
      setSearchResults: { args: () => [[]] },
      setIsSearching: { args: (rng) => [bool(rng)] },
      clearSearch: {},
      setCurrentWeather: { args: () => [null] },
      setForecast: { args: () => [null] },
      setUnits: { args: (rng) => [pick(rng, ["fahrenheit", "celsius"])] },
      toggleUnits: {},
      setLoading: { args: (rng) => [bool(rng)] },
      setError: { args: (rng) => [bool(rng) ? null : "Oops"] },
      setCurrentFact: { args: () => ["fact"] },
    },
  },
  achievements: {
    steps: {
      reportProgress: {
        args: (rng) => [pick(rng, ["snake", "chess", "2048"]), { gamesPlayed: int(rng, 0, 30), highScore: int(rng, 0, 500) }],
        weight: 3,
      },
      dequeueCelebration: {},
      clearCelebrations: {},
    },
  },
};
