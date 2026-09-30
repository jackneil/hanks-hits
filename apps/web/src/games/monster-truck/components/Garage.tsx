'use client';

import { useState } from 'react';
import { useGameStore, Truck } from '../lib/store';
import { sounds } from '../lib/sounds';
import { GameSheet, GAME_SHEET_ACTION } from '@/shared/components';

interface GarageProps {
  onClose: () => void;
}

export function Garage({ onClose }: GarageProps) {
  const [activeTab, setActiveTab] = useState<'trucks' | 'upgrades' | 'paint'>('trucks');

  const coins = useGameStore((s) => s.coins);
  const trucks = useGameStore((s) => s.trucks);
  const currentTruckId = useGameStore((s) => s.currentTruckId);
  const upgrades = useGameStore((s) => s.upgrades);
  const customization = useGameStore((s) => s.customization);
  const selectTruck = useGameStore((s) => s.selectTruck);
  const unlockTruck = useGameStore((s) => s.unlockTruck);
  const upgradeStat = useGameStore((s) => s.upgradeStat);
  const setPaintColor = useGameStore((s) => s.setPaintColor);
  const getTruckStats = useGameStore((s) => s.getTruckStats);
  const getNextUpgradeCost = useGameStore((s) => s.getNextUpgradeCost);
  const soundEnabled = useGameStore((s) => s.soundEnabled);

  const currentTruck = trucks.find((t) => t.id === currentTruckId) || trucks[0];
  const currentStats = getTruckStats(currentTruckId);
  const currentUpgrades = upgrades[currentTruckId];

  const handleUnlock = (truck: Truck) => {
    if (unlockTruck(truck.id)) {
      if (soundEnabled) sounds.playUnlock();
    }
  };

  const handleSelect = (truck: Truck) => {
    if (truck.unlocked) {
      selectTruck(truck.id);
      if (soundEnabled) sounds.playCoin();
    }
  };

  const handleUpgrade = (stat: 'engine' | 'suspension' | 'tires' | 'nos') => {
    if (upgradeStat(currentTruckId, stat)) {
      if (soundEnabled) sounds.playUpgrade();
    }
  };

  const paintColors: { color: string; name: string }[] = [
    { color: '#e74c3c', name: 'Red' },
    { color: '#c0392b', name: 'Dark red' },
    { color: '#9b59b6', name: 'Purple' },
    { color: '#8e44ad', name: 'Dark purple' },
    { color: '#3498db', name: 'Blue' },
    { color: '#2980b9', name: 'Dark blue' },
    { color: '#1abc9c', name: 'Teal' },
    { color: '#16a085', name: 'Dark teal' },
    { color: '#27ae60', name: 'Green' },
    { color: '#2ecc71', name: 'Light green' },
    { color: '#f39c12', name: 'Orange' },
    { color: '#e67e22', name: 'Dark orange' },
    { color: '#ecf0f1', name: 'White' },
    { color: '#bdc3c7', name: 'Silver' },
    { color: '#34495e', name: 'Slate' },
    { color: '#2c3e50', name: 'Navy' },
  ];
  const currentPaint = customization[currentTruckId]?.paintColor || currentTruck.color;

  // On the shared GameSheet: "Back to driving" never leaves the screen (the
  // old footer was 0 px visible on a phone held sideways), the tabs and the
  // truck list scroll inside the sheet, and the game stands still while the
  // Garage is open (Game.tsx).
  return (
    <GameSheet
      title="Garage"
      emoji="🔧"
      testId="monster-truck-garage"
      className="bg-gray-900 text-white"
      actions={
        <button type="button" onClick={onClose} className={`${GAME_SHEET_ACTION} btn-primary`}>
          🎮 Back to driving
        </button>
      }
    >
      <div className="text-left">
        <div className="mb-3 flex items-center gap-2 text-lg font-bold">
          <span aria-hidden="true">🪙</span>
          <span className="text-yellow-300">{coins.toLocaleString()} coins</span>
        </div>

        {/* Tabs */}
        <div role="tablist" className="mb-3 flex gap-1 rounded-xl bg-black/30 p-1">
          {(['trucks', 'upgrades', 'paint'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`min-h-11 flex-1 rounded-lg px-2 text-base font-bold transition-colors ${
                activeTab === tab ? 'bg-orange-600 text-white' : 'text-gray-300'
              }`}
            >
              {tab === 'trucks' && '🚛 Trucks'}
              {tab === 'upgrades' && '⬆️ Upgrades'}
              {tab === 'paint' && '🎨 Paint'}
            </button>
          ))}
        </div>

        {/* Trucks: an unlocked truck is one select button; a locked one is a
            panel whose only control is its Unlock button (a button inside a
            button can fire twice on one tap) */}
        {activeTab === 'trucks' && (
          <div className="grid grid-cols-2 gap-3">
            {trucks.map((truck) => {
              const selected = truck.id === currentTruckId;
              const body = (
                <>
                  <span className="mb-2 block h-12 w-full rounded-lg" style={{ backgroundColor: truck.color }} aria-hidden="true" />
                  <span className="block text-lg font-bold">{truck.name}</span>
                  <span className="block text-sm text-gray-300">{truck.description}</span>
                </>
              );
              if (truck.unlocked) {
                return (
                  <button
                    key={truck.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => handleSelect(truck)}
                    className={`relative min-h-11 rounded-xl p-3 text-left transition-colors ${
                      selected ? 'bg-orange-700 ring-4 ring-orange-300' : 'bg-gray-700'
                    }`}
                  >
                    {body}
                    {selected && (
                      <span className="mt-2 inline-block rounded-full bg-green-600 px-2 py-0.5 text-xs font-bold">SELECTED</span>
                    )}
                  </button>
                );
              }
              return (
                <div key={truck.id} className="rounded-xl bg-gray-800 p-3 opacity-90">
                  {body}
                  <button
                    type="button"
                    onClick={() => handleUnlock(truck)}
                    disabled={coins < truck.cost}
                    aria-label={`Unlock ${truck.name} for ${truck.cost.toLocaleString()} coins`}
                    className={`mt-2 min-h-11 w-full rounded-full px-3 text-base font-bold ${
                      coins >= truck.cost ? 'bg-green-700 text-white' : 'cursor-not-allowed bg-gray-600 text-gray-300'
                    }`}
                  >
                    🔓 {truck.cost.toLocaleString()}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Upgrades */}
        {activeTab === 'upgrades' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="block h-8 w-16 rounded-lg" style={{ backgroundColor: currentPaint }} aria-hidden="true" />
              <span className="text-xl font-bold">{currentTruck.name}</span>
            </div>
            {(['engine', 'suspension', 'tires', 'nos'] as const).map((stat) => {
              const upgrade = currentUpgrades[stat];
              const cost = getNextUpgradeCost(currentTruckId, stat);
              const statValue = currentStats[stat];
              const maxed = upgrade.level >= upgrade.maxLevel;
              return (
                <div key={stat} className="rounded-xl bg-gray-700 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-lg font-bold capitalize">
                      <span className="mr-2" aria-hidden="true">
                        {stat === 'engine' && '🔥'}
                        {stat === 'suspension' && '🔩'}
                        {stat === 'tires' && '🛞'}
                        {stat === 'nos' && '🚀'}
                      </span>
                      {stat}
                    </span>
                    <span className="text-right text-sm text-gray-300">
                      Level {upgrade.level}/{upgrade.maxLevel} · <span className="font-bold text-green-300">{(statValue * 100).toFixed(0)}%</span>
                    </span>
                  </div>
                  <div className="mb-2 h-3 overflow-hidden rounded-full bg-gray-600">
                    <div className="h-full bg-green-500 transition-all" style={{ width: `${(upgrade.level / upgrade.maxLevel) * 100}%` }} />
                  </div>
                  {maxed ? (
                    <div className="text-center font-bold text-yellow-300">✨ Maxed out ✨</div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleUpgrade(stat)}
                      disabled={coins < (cost || 0)}
                      className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-lg font-bold ${
                        coins >= (cost || 0) ? 'bg-green-700 text-white' : 'cursor-not-allowed bg-gray-600 text-gray-300'
                      }`}
                    >
                      <span>Upgrade</span>
                      <span className="text-yellow-200">🪙 {cost?.toLocaleString()}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Paint */}
        {activeTab === 'paint' && (
          <div>
            <div className="mb-3 flex items-center gap-3">
              <span className="block h-10 w-20 rounded-lg transition-colors" style={{ backgroundColor: currentPaint }} aria-hidden="true" />
              <span className="text-xl font-bold">{currentTruck.name}</span>
            </div>
            <div className="grid grid-cols-4 gap-2 short:grid-cols-8">
              {paintColors.map(({ color, name }) => (
                <button
                  key={color}
                  type="button"
                  aria-label={name}
                  aria-pressed={currentPaint === color}
                  onClick={() => {
                    setPaintColor(currentTruckId, color);
                    if (soundEnabled) sounds.playCoin();
                  }}
                  className={`h-12 w-full min-w-11 rounded-lg ${currentPaint === color ? 'ring-4 ring-white' : ''}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </GameSheet>
  );
}
