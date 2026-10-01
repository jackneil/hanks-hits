'use client';

/**
 * Hill Climb Racing - Garage UI
 *
 * Vehicle selection and upgrade purchasing.
 */

import { useState } from 'react';
import { useHillClimbStore } from '../lib/store';
import { VEHICLES, UPGRADES, STAGES, type UpgradeType } from '../lib/constants';

interface GarageProps {
  onStartGame: () => void;
  /** Back to the start card without a run. */
  onBack: () => void;
}

export function Garage({ onStartGame, onBack }: GarageProps) {
  const [tab, setTab] = useState<'vehicles' | 'upgrades' | 'stages'>('vehicles');

  const {
    coins,
    currentVehicleId,
    unlockedVehicles,
    vehicleUpgrades,
    currentStageId,
    unlockedStages,
    bestDistance,
    selectVehicle,
    unlockVehicle,
    purchaseUpgrade,
    selectStage,
  } = useHillClimbStore();

  const currentVehicle = VEHICLES.find((v) => v.id === currentVehicleId);
  const currentUpgrades = vehicleUpgrades[currentVehicleId] || {
    engine: 0,
    suspension: 0,
    tires: 0,
    fuelTank: 0,
    nitro: 0,
  };

  return (
    <div className="min-h-full bg-base-200 pb-4">
      {/* The way out, always on screen: the play box scrolls under this bar,
          so Play Now is one tap away at the top too. It used to sit only at
          the end of the page, three swipes down on a phone held sideways
          (phone UX audit 2026-09-29). */}
      <div
        data-testid="hill-climb-garage-bar"
        className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-base-300 bg-base-200/95 px-3 py-2"
      >
        <button type="button" onClick={onBack} className="btn btn-ghost min-h-11 h-11 gap-1 text-base">
          ← Back
        </button>
        <span className="min-w-0 truncate text-lg font-bold text-primary">🔧 Garage</span>
        <button type="button" onClick={onStartGame} className="btn btn-primary min-h-11 h-11 gap-1 text-lg">
          🎮 Play Now
        </button>
      </div>
      <div className="max-w-4xl mx-auto px-4 pt-4">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="flex justify-center gap-4 text-lg">
            <span className="badge badge-lg badge-warning gap-2">
              💰 {coins.toLocaleString()} coins
            </span>
            <span className="badge badge-lg badge-info gap-2">
              🏆 Best: {Math.floor(bestDistance)}m
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs tabs-boxed justify-center mb-6">
          <button
            className={`tab tab-lg min-h-11 ${tab === 'vehicles' ? 'tab-active' : ''}`}
            onClick={() => setTab('vehicles')}
          >
            🚗 Vehicles
          </button>
          <button
            className={`tab tab-lg min-h-11 ${tab === 'upgrades' ? 'tab-active' : ''}`}
            onClick={() => setTab('upgrades')}
          >
            ⬆️ Upgrades
          </button>
          <button
            className={`tab tab-lg min-h-11 ${tab === 'stages' ? 'tab-active' : ''}`}
            onClick={() => setTab('stages')}
          >
            🌍 Stages
          </button>
        </div>

        {/* Tab Content */}
        <div className="bg-base-100 rounded-2xl p-6 shadow-xl mb-6">
          {tab === 'vehicles' && (
            <VehiclesTab
              vehicles={VEHICLES}
              currentVehicleId={currentVehicleId}
              unlockedVehicles={unlockedVehicles}
              coins={coins}
              onSelect={selectVehicle}
              onUnlock={unlockVehicle}
            />
          )}

          {tab === 'upgrades' && (
            <UpgradesTab
              currentVehicle={currentVehicle!}
              currentUpgrades={currentUpgrades}
              coins={coins}
              onPurchase={(type) => purchaseUpgrade(currentVehicleId, type)}
            />
          )}

          {tab === 'stages' && (
            <StagesTab
              stages={STAGES}
              currentStageId={currentStageId}
              unlockedStages={unlockedStages}
              bestDistance={bestDistance}
              onSelect={selectStage}
            />
          )}
        </div>

      </div>
    </div>
  );
}

// =============================================================================
// VEHICLES TAB
// =============================================================================

const VEHICLE_EMOJI: Record<string, string> = {
  jeep: '🚙',
  motorbike: '🏍️',
  'monster-truck': '🚗',
  'quad-bike': '🏎️',
  'dune-buggy': '🛻',
  'big-rig': '🚛',
  tank: '🪖',
  rocket: '🚀',
};

interface VehiclesTabProps {
  vehicles: typeof VEHICLES;
  currentVehicleId: string;
  unlockedVehicles: string[];
  coins: number;
  onSelect: (id: string) => void;
  onUnlock: (id: string) => boolean;
}

function VehiclesTab({
  vehicles,
  currentVehicleId,
  unlockedVehicles,
  coins,
  onSelect,
  onUnlock,
}: VehiclesTabProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {vehicles.map((vehicle) => {
        const isUnlocked = unlockedVehicles.includes(vehicle.id);
        const isSelected = currentVehicleId === vehicle.id;
        const canAfford = coins >= vehicle.cost;

        const art = VEHICLE_EMOJI[vehicle.id] ?? '🚙';
        const body = (
          <>
            <span className="text-4xl mb-2" aria-hidden="true">{art}</span>
            <span className="block font-bold">{vehicle.name}</span>
            <span className="block text-xs text-base-content/70">{vehicle.description}</span>
          </>
        );

        // An unlocked vehicle is one button that selects it. A locked one is a
        // panel whose only control is its Unlock button: a button inside a
        // button confuses screen readers and can fire both on one tap.
        if (isUnlocked) {
          return (
            <button
              key={vehicle.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(vehicle.id)}
              className={`card min-h-11 bg-base-200 transition-colors ${isSelected ? 'ring-4 ring-primary' : ''}`}
            >
              <span className="card-body items-center text-center p-4">
                {body}
                <span className={`badge mt-2 ${isSelected ? 'badge-primary' : 'badge-ghost'}`}>
                  {isSelected ? 'Selected' : 'Unlocked'}
                </span>
              </span>
            </button>
          );
        }

        return (
          <div key={vehicle.id} className="card bg-base-200 opacity-80">
            <div className="card-body items-center text-center p-4">
              {body}
              <button
                type="button"
                disabled={!canAfford}
                aria-label={`Unlock ${vehicle.name} for ${vehicle.cost.toLocaleString()} coins`}
                className={`btn btn-sm mt-2 min-h-11 ${canAfford ? 'btn-warning' : 'btn-disabled'}`}
                onClick={() => onUnlock(vehicle.id)}
              >
                🔓 {vehicle.cost.toLocaleString()}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =============================================================================
// UPGRADES TAB
// =============================================================================

interface UpgradesTabProps {
  currentVehicle: typeof VEHICLES[0];
  currentUpgrades: { engine: number; suspension: number; tires: number; fuelTank: number; nitro: number };
  coins: number;
  onPurchase: (type: UpgradeType) => boolean;
}

function UpgradesTab({ currentVehicle, currentUpgrades, coins, onPurchase }: UpgradesTabProps) {
  const upgradeTypes: UpgradeType[] = ['engine', 'suspension', 'tires', 'fuelTank', 'nitro'];

  const upgradeIcons: Record<UpgradeType, string> = {
    engine: '⚡',
    suspension: '🔧',
    tires: '🛞',
    fuelTank: '⛽',
    nitro: '🚀',
  };

  return (
    <div>
      <div className="text-center mb-6">
        <span className="text-4xl">
          {currentVehicle.id === 'jeep' && '🚙'}
          {currentVehicle.id === 'motorbike' && '🏍️'}
          {currentVehicle.id === 'monster-truck' && '🚗'}
          {currentVehicle.id === 'quad-bike' && '🏎️'}
          {currentVehicle.id === 'dune-buggy' && '🛻'}
          {currentVehicle.id === 'big-rig' && '🚛'}
          {currentVehicle.id === 'tank' && '🪖'}
          {currentVehicle.id === 'rocket' && '🚀'}
        </span>
        <h2 className="text-2xl font-bold mt-2">{currentVehicle.name}</h2>
      </div>

      <div className="space-y-4">
        {upgradeTypes.map((type) => {
          const config = UPGRADES[type];
          const currentLevel = currentUpgrades[type];
          const maxLevel = config.levels.length;
          const isMaxed = currentLevel >= maxLevel;
          const nextCost = isMaxed ? 0 : config.levels[currentLevel].cost;
          const canAfford = coins >= nextCost;

          return (
            <div key={type} className="bg-base-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{upgradeIcons[type]}</span>
                  <span className="font-bold">{config.name}</span>
                </div>
                <span className="text-sm text-base-content/60">
                  Level {currentLevel}/{maxLevel}
                </span>
              </div>

              {/* Progress bar */}
              <div className="flex gap-1 mb-2">
                {Array.from({ length: maxLevel }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 flex-1 rounded ${
                      i < currentLevel ? 'bg-primary' : 'bg-base-300'
                    }`}
                  />
                ))}
              </div>

              {/* Upgrade button */}
              {isMaxed ? (
                <span className="badge badge-success">MAX</span>
              ) : (
                <button
                  type="button"
                  className={`btn btn-sm min-h-11 ${canAfford ? 'btn-warning' : 'btn-disabled'}`}
                  onClick={() => onPurchase(type)}
                >
                  ⬆️ Upgrade - {nextCost.toLocaleString()} coins
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// STAGES TAB
// =============================================================================

interface StagesTabProps {
  stages: typeof STAGES;
  currentStageId: string;
  unlockedStages: string[];
  bestDistance: number;
  onSelect: (id: string) => void;
}

function StagesTab({
  stages,
  currentStageId,
  unlockedStages,
  bestDistance,
  onSelect,
}: StagesTabProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {stages.map((stage) => {
        const isUnlocked = unlockedStages.includes(stage.id) || bestDistance >= stage.unlockDistance;
        const isSelected = currentStageId === stage.id;

        return (
          <button
            key={stage.id}
            type="button"
            disabled={!isUnlocked}
            aria-pressed={isSelected}
            className={`card min-h-11 transition-colors disabled:cursor-not-allowed ${
              isSelected ? 'ring-4 ring-primary' : ''
            } ${!isUnlocked ? 'opacity-50' : ''}`}
            style={{ backgroundColor: stage.skyColor }}
            onClick={() => onSelect(stage.id)}
          >
            <span className="card-body items-center text-center text-white">
              <span className="text-4xl">
                {stage.id === 'countryside' && '🌳'}
                {stage.id === 'arctic' && '❄️'}
                {stage.id === 'moon' && '🌙'}
              </span>
              <span className="block font-bold text-xl">{stage.name}</span>

              {!isUnlocked ? (
                <span className="badge badge-lg">
                  🔒 Reach {stage.unlockDistance}m
                </span>
              ) : isSelected ? (
                <span className="badge badge-primary badge-lg">Selected</span>
              ) : (
                <span className="badge badge-ghost badge-lg">Unlocked</span>
              )}

              <span className="block text-sm opacity-80 mt-2">
                {stage.id === 'countryside' && 'Rolling green hills'}
                {stage.id === 'arctic' && 'Slippery ice!'}
                {stage.id === 'moon' && 'Low gravity!'}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
