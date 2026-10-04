import { describe, expect, it } from "vitest";
import { useVirtualPetStore } from "@/apps/virtual-pet/lib/store";
import { useFourWheeler3dStore } from "@/games/four-wheeler-3d/lib/store";
import { stripProgressWords } from "@/lib/progress-words";
import { defineUntouchedProgress, isLegacyUntouchedRow, isUntouchedProgress } from "../untouchedProgress";

describe("word-free untouched classification", () => {
  it("keeps real Pet and ATV defaults untouched after a timestamped sound setting change", () => {
    for (const [appId, defaults] of [
      ["virtual-pet", useVirtualPetStore.getState().progress],
      ["four-wheeler-3d", useFourWheeler3dStore.getState().progress],
    ] as const) {
      const progress = { ...defaults, settings: { ...defaults.settings, soundEnabled: false }, lastModified: 9999 };
      expect(isUntouchedProgress(appId, progress)).toBe(true);
      expect(isUntouchedProgress(appId, stripProgressWords(appId, progress))).toBe(true);
      expect(isLegacyUntouchedRow(appId, progress)).toBe(true);
    }
    const pet = useVirtualPetStore.getState().progress;
    expect(isUntouchedProgress("virtual-pet", { ...pet, stats: { ...pet.stats, totalFeedings: 1 } })).toBe(false);
    const atv = useFourWheeler3dStore.getState().progress;
    expect(isUntouchedProgress("four-wheeler-3d", { ...atv, racesWon: 1 })).toBe(false);
  });

  it("retains the original legacy timestamp rule for a name-only save", () => {
    const rule = defineUntouchedProgress("oregon-trail", { defaults: { leaderName: "", milesTraveled: 0, lastModified: 0 } });
    const legacy = { leaderName: "Saved leader", milesTraveled: 0, lastModified: 1234 };
    expect(rule.isUntouchedForSync(legacy)).toBe(true);
    expect(rule.isUntouched(legacy)).toBe(false);
    expect(rule.legacyTime(legacy, 9999)).toBe(1234);
    expect(rule.legacyTime({ leaderName: "Saved leader", milesTraveled: 0 }, 9999)).toBe(9999);
  });
});
