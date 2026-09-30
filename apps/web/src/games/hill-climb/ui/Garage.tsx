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
}

export function Garage({ onStartGame }: GarageProps) {
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
    <div className="min-h-full bg-gradient-to-b from-base-200 to-base-300 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-primary mb-2">🏔️ Hill Climb Racing</h1>
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
            className={`tab tab-lg ${tab === 'vehicles' ? 'tab-active' : ''}`}
            onClick={() => setTab('vehicles')}
          >
            🚗 Vehicles
          </button>
          <button
            className={`tab tab-lg ${tab === 'upgrades' ? 'tab-active' : ''}`}
            onClick={() => setTab('upgrades')}
          >
            ⬆️ Upgrades
          </button>
          <button
            className={`tab tab-lg ${tab === 'stages' ? 'tab-active' : ''}`}
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

        {/* Play Button */}
        <div className="text-center">
          <button
            onClick={onStartGame}
            className="btn btn-primary btn-lg text-2xl px-12 gap-2"
          >
            🎮 Play Now
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// VEHICLES TAB
// =============================================================================

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

        return (
          <div
            key={vehicle.id}
            className={`card bg-base-200 cursor-pointer transition-all hover:scale-105 ${
              isSelected ? 'ring-4 ring-primary' : ''
            } ${!isUnlocked ? 'opacity-70' : ''}`}
            onClick={() => isUnlocked && onSelect(vehicle.id)}
          >
            <div className="card-body items-center text-center p-4">
              <span className="text-4xl mb-2">
                {vehicle.id === 'jeep' && '🚙'}
                {vehicle.id === 'motorbike' && '🏍️'}
                {vehicle.id === 'monster-truck' && '🚗'}
                {vehicle.id === 'quad-bike' && '🏎️'}
                {vehicle.id === 'dune-buggy' && '🛻'}
                {vehicle.id === 'big-rig' && '🚛'}
                {vehicle.id === 'tank' && '🪖'}
                {vehicle.id === 'rocket' && '🚀'}
              </span>
              <h3 className="font-bold">{vehicle.name}</h3>
              <p className="text-xs text-base-content/60">{vehicle.description}</p>

              {!isUnlocked ? (
                <button
                  className={`btn btn-sm mt-2 ${canAfford ? 'btn-warning' : 'btn-disabled'}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (canAfford) onUnlock(vehicle.id);
                  }}
                >
                  🔓 {vehicle.cost.toLocaleString()}
                </button>
              ) : isSelected ? (
                <span className="badge badge-primary mt-2">Selected</span>
              ) : (
                <span className="badge badge-ghost mt-2">Unlocked</span>
              )}
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
                  className={`btn btn-sm ${canAfford ? 'btn-warning' : 'btn-disabled'}`}
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
          <div
            key={stage.id}
            className={`card cursor-pointer transition-all hover:scale-105 ${
              isSelected ? 'ring-4 ring-primary' : ''
            } ${!isUnlocked ? 'opacity-50' : ''}`}
            style={{ backgroundColor: stage.skyColor }}
            onClick={() => isUnlocked && onSelect(stage.id)}
          >
            <div className="card-body items-center text-center text-white">
              <span className="text-4xl">
                {stage.id === 'countryside' && '🌳'}
                {stage.id === 'arctic' && '❄️'}
                {stage.id === 'moon' && '🌙'}
              </span>
              <h3 className="font-bold text-xl">{stage.name}</h3>

              {!isUnlocked ? (
                <span className="badge badge-lg">
                  🔒 Reach {stage.unlockDistance}m
                </span>
              ) : isSelected ? (
                <span className="badge badge-primary badge-lg">Selected</span>
              ) : (
                <span className="badge badge-ghost badge-lg">Unlocked</span>
              )}

              <div className="text-sm opacity-80 mt-2">
                {stage.id === 'countryside' && 'Rolling green hills'}
                {stage.id === 'arctic' && 'Slippery ice!'}
                {stage.id === 'moon' && 'Low gravity!'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
