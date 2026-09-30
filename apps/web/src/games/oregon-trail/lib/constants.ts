// Oregon Trail - Constants and Game Data
import type { Occupation } from '../types';

export const TOTAL_DISTANCE = 2000; // Miles from Independence to Oregon
export const MAX_CARRY_WEIGHT = 200; // Max lbs of meat from hunting
export const HUNTING_TIME = 30; // Seconds per hunting session
export const BULLETS_PER_BOX = 20;

export const OCCUPATIONS: Occupation[] = [
  { id: 'banker', name: 'Banker', startingMoney: 1600, description: 'Start with lots of money!', bonus: 'Extra cash' },
  { id: 'carpenter', name: 'Carpenter', startingMoney: 800, description: 'Great at fixing wagons!', bonus: 'Cheaper repairs' },
  { id: 'farmer', name: 'Farmer', startingMoney: 400, description: 'Your family eats less!', bonus: 'Less food needed' },
];


export const PACES = { steady: { id: 'steady', name: 'Steady', milesPerDay: 15, foodMultiplier: 1.0, healthRisk: 0.02 }, strenuous: { id: 'strenuous', name: 'Strenuous', milesPerDay: 20, foodMultiplier: 1.3, healthRisk: 0.05 }, grueling: { id: 'grueling', name: 'Grueling', milesPerDay: 25, foodMultiplier: 1.6, healthRisk: 0.10 } };
export const WEATHER_CONDITIONS: Record<string, { type: string; name: string; emoji: string; travelModifier: number; healthRisk: number }> = {
  clear: { type: 'clear', name: 'Clear skies', emoji: '☀️', travelModifier: 1.0, healthRisk: 0 },
  rain: { type: 'rain', name: 'Rainy', emoji: '🌧️', travelModifier: 0.8, healthRisk: 0.02 },
  hot: { type: 'hot', name: 'Very hot', emoji: '🔥', travelModifier: 0.9, healthRisk: 0.03 },
  cold: { type: 'cold', name: 'Cold', emoji: '❄️', travelModifier: 0.9, healthRisk: 0.03 },
  snow: { type: 'snow', name: 'Snowy', emoji: '🌨️', travelModifier: 0.5, healthRisk: 0.08 },
  storm: { type: 'storm', name: 'Stormy', emoji: '⛈️', travelModifier: 0.3, healthRisk: 0.05 },
};
export const LANDMARKS = [{ id: 'independence', name: 'Independence, MO', description: 'Journey begins!', milesFromStart: 0, hasStore: true, hasRiver: false }, { id: 'kansas-river', name: 'Kansas River', description: 'First river crossing.', milesFromStart: 102, hasStore: false, hasRiver: true, riverName: 'Kansas River' }, { id: 'fort-kearney', name: 'Fort Kearney', description: 'Military outpost.', milesFromStart: 304, hasStore: true, hasRiver: false }, { id: 'chimney-rock', name: 'Chimney Rock', description: 'Famous landmark!', milesFromStart: 554, hasStore: false, hasRiver: false }, { id: 'fort-laramie', name: 'Fort Laramie', description: 'Trading post.', milesFromStart: 640, hasStore: true, hasRiver: false }, { id: 'independence-rock', name: 'Independence Rock', description: 'Register of Desert!', milesFromStart: 830, hasStore: false, hasRiver: false }, { id: 'south-pass', name: 'South Pass', description: 'Rocky Mountains!', milesFromStart: 914, hasStore: false, hasRiver: false }, { id: 'green-river', name: 'Green River', description: 'Deep and fast river.', milesFromStart: 989, hasStore: false, hasRiver: true, riverName: 'Green River' }, { id: 'fort-bridger', name: 'Fort Bridger', description: 'Mountain trading post.', milesFromStart: 1026, hasStore: true, hasRiver: false }, { id: 'fort-hall', name: 'Fort Hall', description: 'Last major fort.', milesFromStart: 1220, hasStore: true, hasRiver: false }, { id: 'snake-river', name: 'Snake River', description: 'Treacherous crossing.', milesFromStart: 1400, hasStore: false, hasRiver: true, riverName: 'Snake River' }, { id: 'fort-boise', name: 'Fort Boise', description: 'Almost to Oregon!', milesFromStart: 1535, hasStore: true, hasRiver: false }, { id: 'blue-mountains', name: 'Blue Mountains', description: 'Last mountain range!', milesFromStart: 1700, hasStore: false, hasRiver: false }, { id: 'the-dalles', name: 'The Dalles', description: 'End is near!', milesFromStart: 1830, hasStore: true, hasRiver: true, riverName: 'Columbia River' }, { id: 'willamette-valley', name: 'Willamette Valley', description: 'You made it to Oregon!', milesFromStart: 2000, hasStore: false, hasRiver: false }];
export const ANIMALS = [{ type: 'squirrel', name: 'Squirrel', meat: 2, points: 5, speed: 8, size: 1, spawnChance: 0.4 }, { type: 'rabbit', name: 'Rabbit', meat: 5, points: 10, speed: 7, size: 2, spawnChance: 0.35 }, { type: 'deer', name: 'Deer', meat: 60, points: 25, speed: 6, size: 3, spawnChance: 0.2 }, { type: 'buffalo', name: 'Buffalo', meat: 200, points: 50, speed: 4, size: 5, spawnChance: 0.05 }];
export const STORE_PRICES = { oxen: 40, food: 0.20, clothing: 10, ammunition: 2, wheel: 10, axle: 10, tongue: 10 };
export const FOOD_CONSUMPTION_PER_PERSON = 3; export const PARTY_SIZE = 5;
export const MONTH_NAMES = { march: 'March', april: 'April', may: 'May', june: 'June', july: 'July' };
export const HEALTH_DISPLAY = { good: { name: 'Feeling Great!', color: 'text-success' }, fair: { name: 'A Little Tired', color: 'text-warning' }, poor: { name: 'Not So Good', color: 'text-error' }, very_poor: { name: 'Really Sick', color: 'text-error' } };
