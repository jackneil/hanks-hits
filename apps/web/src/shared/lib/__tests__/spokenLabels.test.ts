import { describe, expect, it } from "vitest";

import { joinSpoken, spokenLabel, spokenLabelsIn, spokenTextOf, spokenWordsOf } from "../spokenLabels";

function html(markup: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = markup;
  return el;
}

describe("spokenLabels", () => {
  it("takes the emoji out of a label and keeps the words", () => {
    expect(spokenTextOf("🏆 Leaderboard")).toBe("Leaderboard");
    expect(spokenTextOf("  ▶️  Resume ")).toBe("Resume");
    expect(spokenTextOf("⭐ First 🏁")).toBe("First");
  });

  it("prefers data-spoken, then the visible words, then the aria-label", () => {
    expect(spokenLabel(html('<button data-spoken="16 seconds">0:16</button>').firstElementChild!)).toBe("16 seconds");
    expect(spokenLabel(html("<button>🎬 Clips</button>").firstElementChild!)).toBe("Clips");
    expect(spokenLabel(html('<button aria-label="Sound on">🔊</button>').firstElementChild!)).toBe("Sound on");
    expect(spokenLabel(html("<button>🔊</button>").firstElementChild!)).toBeNull();
  });

  it("lists the visible controls in DOM order and skips hidden ones", () => {
    const root = html(
      '<button>A</button><div hidden><button>B</button></div><a href="/x">C</a><div aria-hidden="true"><button>D</button></div><span role="button">E</span>'
    );
    expect(spokenLabelsIn(root)).toEqual(["A", "C", "E"]);
    expect(spokenLabelsIn(null)).toEqual([]);
  });

  it("reads the words of a container with a space between nodes, without hidden parts", () => {
    const root = html('<p>You drove 213 m.</p><p>Best: <b>890</b> m.</p><span aria-hidden="true">💥</span><p hidden>no</p>');
    expect(spokenWordsOf(root)).toBe("You drove 213 m. Best: 890 m.");
    expect(spokenWordsOf(null)).toBe("");
  });

  it("joins parts into sentences without a double period", () => {
    expect(joinSpoken(["You crashed!", "You drove 213 m.", "Try again", null, "", false, "Garage"])).toBe(
      "You crashed! You drove 213 m. Try again. Garage."
    );
    expect(joinSpoken([])).toBe("");
  });
});
