import { disc, frame, rect, text } from "@/shared/clips/replay/draw";
import { LANDMARKS } from "./constants";
import { ALL_EVENTS } from "./events";
import type { GameState, HealthStatus } from "../types";

/** Explicit projection: leader/party names, event messages and river names never cross into capture. */
export interface HuntClipResult {
  food: number;
  ammo: number;
  score: number;
  outOfBullets: boolean;
}
export interface OregonClipState {
  huntResult: HuntClipResult | null;
  phase: GameState["gamePhase"];
  day: number;
  miles: number;
  landmark: number;
  weather: GameState["weather"];
  food: number;
  oxen: number;
  ammunition: number;
  money: number;
  eventId: string | null;
  riverDepth: number | null;
  members: { health: HealthStatus; sick: boolean; left: boolean }[];
}
export function oregonClipState(s: GameState, huntResult: HuntClipResult | null = null): OregonClipState {
  return { huntResult, phase: s.gamePhase, day: s.currentDay, miles: s.milesTraveled, landmark: s.currentLandmarkIndex, weather: s.weather,
    eventId: s.currentEvent?.id ?? null, riverDepth: s.currentRiver?.depth ?? null,
    food: s.supplies.food, oxen: s.supplies.oxen, ammunition: s.supplies.ammunition, money: s.supplies.money,
    members: s.party.map(member => ({ health: member.health, sick: member.isSick, left: member.leftBehind })) };
}
const WEATHER = { clear: "☀️", rain: "🌧️", hot: "🌞", cold: "🌬️", snow: "❄️", storm: "⛈️" };
const HEALTH = { good: "💚", fair: "💛", poor: "🧡", very_poor: "❤️" };
export function paintOregon(c: CanvasRenderingContext2D, s: OregonClipState): void {
  if (s.phase === "hunting" && s.huntResult) {
    const result = s.huntResult;
    frame(c, "Oregon Trail", result.outOfBullets ? "Out of bullets!" : "Hunt complete!", "#14532d");
    text(c, "🎯", 320, 184, 96);
    const rows = [`${result.food} lbs of meat`, `${result.ammo} bullets used`, `Score: ${result.score}`];
    rows.forEach((label, i) => {
      rect(c, 72, 284 + i * 105, 496, 82, "#166534");
      text(c, label, 320, 325 + i * 105, 34, i === 2 ? "#fcd34d" : "#fff");
    });
    text(c, "Take the food to the wagon", 320, 649, 26);
    return;
  }
  const eventTitle = ALL_EVENTS.find(event => event.id === s.eventId)?.title;
  const status = s.phase === "victory" ? "You reached Oregon!" : s.phase === "game_over" ? "Journey ended" : s.phase === "river" ? "River crossing" : s.phase === "store" ? "Buying supplies" : s.phase === "event" ? eventTitle ?? "An event on the trail" : LANDMARKS[s.landmark]?.name ?? "On the trail";
  frame(c, "Oregon Trail", `Day ${s.day} · ${status}`, "#14532d");
  rect(c, 24, 103, 592, 250, "#bae6fd");
  text(c, WEATHER[s.weather], 553, 153, 57);
  // The wagon's location follows actual journey progress on the route below.
  rect(c, 24, 263, 592, 90, "#84cc16");
  rect(c, 24, 319, 592, 24, "#a16207");
  if (s.phase === "river") rect(c, 425, 235, 86, 118, "#38bdf8");
  const wagonX = 130 + (Math.max(0, s.miles) % 100) * 1.5;
  rect(c, wagonX, 223, 129, 70, "#92400e");
  disc(c, wagonX + 64, 223, 64, "#fef3c7");
  rect(c, wagonX, 225, 129, 51, "#fef3c7");
  disc(c, wagonX + 25, 296, 24, "#422006");
  disc(c, wagonX + 106, 296, 24, "#422006");
  text(c, "🐂", wagonX + 185, 284, 66);
  text(c, `${Math.round(s.miles)} / 2000 miles`, 320, 385, 24);
  rect(c, 48, 415, 544, 8, "#bbf7d0");
  for (const stop of LANDMARKS) disc(c, 48 + stop.milesFromStart / 2000 * 544, 419, 5, "#fde68a");
  disc(c, 48 + Math.min(1, Math.max(0, s.miles / 2000)) * 544, 419, 12, "#f97316");
  text(c, `🍖 ${s.food} lb · 🐂 ${s.oxen} · 🎯 ${s.ammunition}`, 320, 465, 25);
  if (s.phase === "river" && s.riverDepth !== null) text(c, `Water depth: ${s.riverDepth} feet`, 320, 677, 22);
  text(c, `Supplies money: $${Math.round(s.money)}`, 320, 505, 23);
  s.members.forEach((member, i) => {
    const x = 80 + i * 120;
    text(c, member.left ? "👋" : HEALTH[member.health], x, 565, 38);
    text(c, member.left ? "Left trail" : member.sick ? "Sick" : "Traveling", x, 615, 17);
  });
}
