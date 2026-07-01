import { describe, expect, it } from "vitest";
import { mergeProgress } from "../progress-merge";

describe("mergeProgress", () => {
  it("prefers server data when local timestamps are not trusted", () => {
    const result = mergeProgress(
      { score: 200 },
      { score: 100 },
      null,
      1000
    );

    expect(result.source).toBe("server");
    expect(result.data).toEqual({ score: 100 });
  });

  it("uses local data when there is no existing server data", () => {
    const result = mergeProgress(
      { score: 200 },
      null,
      null,
      null
    );

    expect(result.source).toBe("local");
    expect(result.data).toEqual({ score: 200 });
  });
});
