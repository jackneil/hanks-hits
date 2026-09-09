import { describe, expect, it } from "vitest";
import { animalGeometry } from "../components/Hunting";
import { ANIMAL_TYPES } from "../lib/hunting";

describe("non-gory tagged wildlife geometry", () => {
  it.each(ANIMAL_TYPES)(
    "keeps %s anatomical detail, visible marks and a grounded shared mesh",
    (type) => {
      const model = animalGeometry(type);
      try {
        const { body, leg, carcass } = model,
          positions = carcass.getAttribute("position");
        expect(positions.count).toBeGreaterThan(
          body.getAttribute("position").count +
            (type === "bat" ? 0 : 4 * leg.getAttribute("position").count),
        );
        expect(carcass.getAttribute("color").count).toBe(positions.count);
        expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
        carcass.computeBoundingBox();
        expect(carcass.boundingBox!.min.y).toBeCloseTo(0.03, 5);
        expect(carcass.boundingBox!.max.y).toBeLessThan(
          type === "bat" ? 1 : 1.2,
        );
      } finally {
        Object.values(model).forEach((geometry) => geometry.dispose());
      }
    },
  );
});
