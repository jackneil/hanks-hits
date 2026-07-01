import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchQuestions } from "../api";

describe("fetchQuestions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns trivia questions on successful API responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({
        response_code: 0,
        results: [
          {
            category: "General Knowledge",
            type: "multiple",
            difficulty: "easy",
            question: "Question?",
            correct_answer: "Yes",
            incorrect_answers: ["No", "Maybe", "Later"],
          },
        ],
      }),
    }));

    await expect(fetchQuestions(1, "easy")).resolves.toHaveLength(1);
  });

  it("rejects nonzero API response codes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ response_code: 1, results: [] }),
    }));

    await expect(fetchQuestions(1, "easy")).rejects.toThrow("Trivia API error code: 1");
  });

  it("rejects empty successful responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: async () => ({ response_code: 0, results: [] }),
    }));

    await expect(fetchQuestions(1, "easy")).rejects.toThrow("Trivia API returned no questions");
  });
});
