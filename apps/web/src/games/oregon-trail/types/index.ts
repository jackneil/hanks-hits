export type HealthStatus = 'good' | 'fair' | 'poor' | 'very_poor';
export interface PartyMember { id: string; name: string; health: HealthStatus; isSick: boolean; sickDays: number; leftBehind: boolean; }
export type OccupationType = 'banker' | 'carpenter' | 'farmer';
export interface Occupation { id: OccupationType; name: string; startingMoney: number; description: string; bonus?: string; }
export interface SpareParts { wheels: number; axles: number; tongues: number; }
export interface Supplies { food: number; oxen: number; clothing: number; ammunition: number; spareParts: SpareParts; money: number; }
export type PaceType = 'steady' | 'strenuous' | 'grueling';
export interface Pace { id: PaceType; name: string; milesPerDay: number; foodMultiplier: number; healthRisk: number; }
export type WeatherType = 'clear' | 'rain' | 'hot' | 'cold' | 'snow' | 'storm';
export interface Weather { type: WeatherType; name: string; travelModifier: number; healthRisk: number; }
export type Month = 'march' | 'april' | 'may' | 'june' | 'july';
export interface Landmark { id: string; name: string; description: string; milesFromStart: number; hasStore: boolean; hasRiver: boolean; riverName?: string; funFact?: string; }
export type EventCategory = 'positive' | 'neutral' | 'negative' | 'severe';
export interface EventEffect { food?: number; money?: number; oxen?: number; clothing?: number; ammunition?: number; wheels?: number; axles?: number; tongues?: number; partyHealth?: HealthStatus; memberSick?: boolean; memberLeftBehind?: boolean; daysLost?: number; }
export interface EventChoice { id: string; text: string; effect: EventEffect; successChance?: number; }
export interface GameEvent { id: string; title: string; message: string; category: EventCategory; probability: number; effect: EventEffect; choices?: EventChoice[]; }
export type CrossingMethod = 'ford' | 'caulk' | 'ferry' | 'wait';
export interface RiverCrossing { method: CrossingMethod; name: string; description: string; cost?: number; risk: number; daysRequired: number; }
export type AnimalType = 'squirrel' | 'rabbit' | 'deer' | 'buffalo';
export interface Animal { type: AnimalType; name: string; meat: number; points: number; speed: number; size: number; spawnChance: number; }
export type GamePhase = 'title' | 'setup_name' | 'setup_party' | 'setup_month' | 'store' | 'travel' | 'event' | 'landmark' | 'river' | 'hunting' | 'status' | 'game_over' | 'victory';
export interface GameState {
  journeyId?: string; gamePhase: GamePhase; gameStarted: boolean; leaderName: string; occupation: OccupationType; party: PartyMember[]; departureMonth: Month; currentDay: number; milesTraveled: number; currentLandmarkIndex: number; pace: PaceType; supplies: Supplies; weather: WeatherType; currentEvent: GameEvent | null; currentRiver: { name: string; depth: number } | null; huntingFood: number; huntingAmmoUsed: number; daysRested: number; foodHunted: number; riversCrossed: number; eventsEncountered: number; }
export interface OregonTrailProgress { gamesCompleted: number; gamesAttempted: number; bestScore: number; fastestJourney: number; totalMilesTraveled: number; totalFoodHunted: number; totalRiversCrossed: number; totalDaysTraveled: number; totalPartySaved: number; totalPartyLost: number; partyMemberNames: string[]; achievementsUnlocked: string[]; preferredOccupation: OccupationType; lastDepartureMonth: Month; lastPlayedAt: number; totalPlaytimeMinutes: number; }
export interface ScoreBreakdown { reachOregon: number; survivingMembers: number; remainingSupplies: number; earlyArrival: number; fullHealth: number; huntMaster: number; safeCrosser: number; total: number; }
