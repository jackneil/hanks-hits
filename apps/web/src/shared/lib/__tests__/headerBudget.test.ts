import { describe, expect, it } from "vitest";

import { GAME_METADATA } from "../gameMetadata.generated";
import {
  HEADER_COMPACT_BELOW_PX,
  HEADER_EMOJI_TIGHT_TITLE_PX,
  HEADER_TITLE_MIN_PX,
  isPhoneScreen,
  planHeader,
  resolveHeaderEmoji,
  routeIdFromPath,
  type HeaderControls,
  type HeaderLogin,
} from "../headerBudget";

const WIDTHS = [320, 360, 375, 390, 412, 430, 480] as const;
const LANDSCAPE = 844;

/** The three header states. Recording uses the same single clip slot. */
const STATES = {
  noClipSlot: false,
  clipIdle: true,
  recording: true,
} as const;

/** A game with every header control: the worst case for the budget. */
function fullControls(overrides: Partial<HeaderControls>): HeaderControls {
  return {
    home: true,
    leaderboard: true,
    fullscreen: true,
    restart: true,
    pause: true,
    clipSlot: false,
    login: "guest",
    pausable: true,
    resultChipReady: false,
    hasEmoji: true,
    ...overrides,
  };
}

type Case = {
  width: number;
  state: keyof typeof STATES;
  login: HeaderLogin;
  pausable: boolean;
  resultChipReady: boolean;
};

function allCases(): Case[] {
  const cases: Case[] = [];
  for (const width of [...WIDTHS, LANDSCAPE]) {
    for (const state of Object.keys(STATES) as (keyof typeof STATES)[]) {
      for (const login of ["guest", "signedIn"] as const) {
        for (const pausable of [true, false]) {
          for (const resultChipReady of [true, false]) {
            cases.push({ width, state, login, pausable, resultChipReady });
          }
        }
      }
    }
  }
  return cases;
}

function plan(c: Case) {
  return planHeader(
    c.width,
    fullControls({
      clipSlot: STATES[c.state],
      login: c.login,
      pausable: c.pausable,
      // A game that cannot pause has no pause button.
      pause: c.pausable,
      resultChipReady: c.resultChipReady,
    })
  );
}

describe("planHeader: the header matrix", () => {
  const cases = allCases();

  it.each(cases)(
    "fits at $width px ($state, $login, pausable=$pausable, resultChipReady=$resultChipReady)",
    (c) => {
      const layout = plan(c);
      expect(layout.fits).toBe(true);
      expect(layout.requiredPx).toBeLessThanOrEqual(c.width);
    }
  );

  it.each(cases)(
    "keeps a visible title of at least 16 px at $width px ($state, $login, pausable=$pausable, resultChipReady=$resultChipReady)",
    (c) => {
      // Plan section 15.2: "title at least 16 px across the 11.2 matrix,
      // in all three states". The screen-reader-only title is a guard only.
      const layout = plan(c);
      expect(layout.title).not.toBe("screenReaderOnly");
      expect(layout.titleRoomPx).toBeGreaterThanOrEqual(HEADER_TITLE_MIN_PX);
    }
  );

  it.each(cases)(
    "never strands a control at $width px ($state, $login, pausable=$pausable, resultChipReady=$resultChipReady)",
    (c) => {
      const layout = plan(c);
      // Leaderboard and Restart leave the header only when BOTH the pause
      // menu (during play) and the result chip (at game over) hold them.
      if (!(c.pausable && c.resultChipReady)) {
        expect(layout.leaderboard).toBe("header");
        expect(layout.restart).toBe("header");
      }
      // Fullscreen leaves the header only for a game with a pause menu.
      if (!c.pausable) expect(layout.fullscreen).toBe("header");
    }
  );

  it.each(cases)(
    "uses the compact gap and title only below 480 px ($width px, $state, $login)",
    (c) => {
      const layout = plan(c);
      const compact = c.width < HEADER_COMPACT_BELOW_PX;
      expect(layout.compactGap).toBe(compact);
      if (compact) expect(layout.title).not.toBe("text");
      else expect(layout.title).toBe("text");
    }
  );

  it("gives the recording state the exact layout of the idle clip slot", () => {
    for (const c of allCases().filter((x) => x.state === "clipIdle")) {
      expect(plan({ ...c, state: "recording" })).toEqual(plan(c));
    }
  });

  it("keeps the emoji title at every width once a pausable game has the result chip", () => {
    for (const width of WIDTHS.filter((w) => w < HEADER_COMPACT_BELOW_PX)) {
      for (const login of ["guest", "signedIn"] as const) {
        const layout = plan({
          width,
          state: "clipIdle",
          login,
          pausable: true,
          resultChipReady: true,
        });
        expect(layout.title).toBe("emoji");
      }
    }
  });
});

describe("planHeader: step 0, a phone during play", () => {
  it("moves Leaderboard and Sign In into the pause menu on a phone during play", () => {
    for (const width of [...WIDTHS, LANDSCAPE]) {
      const layout = planHeader(width, fullControls({ phonePlay: true }));
      expect(layout.leaderboard, `${width}`).toBe("moved");
      expect(layout.signIn, `${width}`).toBe("moved");
      expect(layout.signInLabel, `${width}`).toBe(false);
      expect(layout.fits, `${width}`).toBe(true);
    }
  });

  it("keeps both in the header between runs, on a mouse, and for a game with no pause menu", () => {
    for (const controls of [
      fullControls({}),
      fullControls({ phonePlay: false }),
      fullControls({ phonePlay: true, pausable: false, pause: false }),
    ]) {
      const layout = planHeader(375, controls);
      expect(layout.leaderboard).toBe("header");
      expect(layout.signIn).toBe("header");
    }
  });

  it("leaves the signed-in avatar in the header: it is a 44 px control", () => {
    const layout = planHeader(375, fullControls({ phonePlay: true, login: "signedIn" }));
    expect(layout.signIn).toBe("none");
    expect(layout.leaderboard).toBe("moved");
  });

  it("does not count a moved Sign In in the width, so the title keeps its room", () => {
    const inHeader = planHeader(375, fullControls({ clipSlot: true }));
    const moved = planHeader(375, fullControls({ clipSlot: true, phonePlay: true }));
    expect(moved.requiredPx).toBeLessThan(inHeader.requiredPx);
    expect(moved.titleRoomPx).toBeGreaterThan(inHeader.titleRoomPx);
  });

  it("isPhoneScreen: the short side decides, in both orientations", () => {
    expect(isPhoneScreen(375, 549)).toBe(true);
    expect(isPhoneScreen(667, 311)).toBe(true);
    expect(isPhoneScreen(844, 340)).toBe(true);
    expect(isPhoneScreen(430, 932)).toBe(true);
    expect(isPhoneScreen(768, 1024)).toBe(false);
    expect(isPhoneScreen(1024, 768)).toBe(false);
    expect(isPhoneScreen(1280, 800)).toBe(false);
  });
});

describe("planHeader: each step", () => {
  it("step 1-2: 479 px is compact with the emoji title, 480 px is not", () => {
    const narrow = planHeader(479, fullControls({}));
    expect(narrow.compactGap).toBe(true);
    expect(narrow.title).toBe("emoji");

    const wide = planHeader(480, fullControls({}));
    expect(wide.compactGap).toBe(false);
    expect(wide.title).toBe("text");
  });

  it("step 2: keeps the text title when no emoji is known", () => {
    const layout = planHeader(390, {
      ...fullControls({ hasEmoji: false }),
      leaderboard: false,
      restart: false,
      pause: false,
      pausable: false,
    });
    expect(layout.title).toBe("text");
    expect(layout.fits).toBe(true);
  });

  it("step 3: below 400 px, moves Leaderboard and Restart only with pause AND the result chip", () => {
    const optedIn = planHeader(399, fullControls({ resultChipReady: true }));
    expect(optedIn.leaderboard).toBe("moved");
    expect(optedIn.restart).toBe("moved");

    const at400 = planHeader(400, fullControls({ resultChipReady: true }));
    expect(at400.leaderboard).toBe("header");
    expect(at400.restart).toBe("header");

    // No result chip yet: nothing may become unreachable at game over.
    const notReady = planHeader(360, fullControls({ resultChipReady: false }));
    expect(notReady.leaderboard).toBe("header");
    expect(notReady.restart).toBe("header");

    // No pause menu: nothing holds them during play.
    const noPause = planHeader(
      360,
      fullControls({ resultChipReady: true, pausable: false, pause: false })
    );
    expect(noPause.leaderboard).toBe("header");
    expect(noPause.restart).toBe("header");
  });

  it("step 3: leaves an absent control absent", () => {
    const layout = planHeader(
      360,
      fullControls({ resultChipReady: true, leaderboard: false, restart: false })
    );
    expect(layout.leaderboard).toBe("none");
    expect(layout.restart).toBe("none");
  });

  it("step 4: drops the Sign In label only when the header is over budget", () => {
    // Few controls: the label fits even on a narrow phone.
    const roomy = planHeader(
      360,
      fullControls({ leaderboard: false, restart: false, fullscreen: false })
    );
    expect(roomy.signInLabel).toBe(true);

    // Every control at 412 px: the label must go.
    const crowded = planHeader(412, fullControls({ clipSlot: true }));
    expect(crowded.signInLabel).toBe(false);
    expect(crowded.fits).toBe(true);

    // Only a guest has a label.
    expect(planHeader(844, fullControls({ login: "signedIn" })).signInLabel).toBe(false);
    expect(planHeader(844, fullControls({ login: "none" })).signInLabel).toBe(false);
    expect(planHeader(844, fullControls({ login: "guest" })).signInLabel).toBe(true);
  });

  it("step 5: below 340 px, moves Fullscreen into the pause menu for a pausable game only", () => {
    expect(planHeader(339, fullControls({})).fullscreen).toBe("moved");
    expect(planHeader(340, fullControls({})).fullscreen).toBe("header");
    expect(
      planHeader(320, fullControls({ pausable: false, pause: false })).fullscreen
    ).toBe("header");
    expect(planHeader(320, fullControls({ fullscreen: false })).fullscreen).toBe("none");
  });

  it("step 6: shrinks the emoji title (no padding) instead of hiding it", () => {
    // The plan's worst case: a guest in a game that cannot pause, with
    // Leaderboard, Fullscreen, Restart, the clip slot and the Sign In icon.
    const worst = planHeader(
      320,
      fullControls({ pausable: false, pause: false, clipSlot: true })
    );
    expect(worst.fullscreen).toBe("header");
    expect(worst.signInLabel).toBe(false);
    expect(worst.title).toBe("emojiTight");
    expect(worst.titleRoomPx).toBeGreaterThanOrEqual(HEADER_EMOJI_TIGHT_TITLE_PX);
    expect(worst.fits).toBe(true);

    // The same game at 360 px keeps the full emoji.
    const roomier = planHeader(
      360,
      fullControls({ pausable: false, pause: false, clipSlot: true })
    );
    expect(roomier.title).toBe("emoji");
  });

  it("step 6: keeps the title of a pausable game with the clip slot and no result chip", () => {
    // Every header control plus the pause button: the tightest pausable
    // case before a game sets resultChipReady.
    for (const width of [320, 360, 375]) {
      for (const login of ["guest", "signedIn"] as const) {
        const layout = planHeader(width, fullControls({ clipSlot: true, login }));
        expect(layout.title).toBe("emojiTight");
        expect(layout.fits).toBe(true);
      }
    }
    expect(planHeader(390, fullControls({ clipSlot: true })).title).toBe("emoji");
  });

  it("step 7: hides the title only when even the tight emoji cannot fit", () => {
    // Narrower than any phone in the matrix: only the guard is left.
    const layout = planHeader(280, fullControls({ pausable: false, pause: false, clipSlot: true }));
    expect(layout.title).toBe("screenReaderOnly");
  });

  it("gives an unlimited title room to the wide server layout", () => {
    const layout = planHeader(Number.POSITIVE_INFINITY, fullControls({ clipSlot: true }));
    expect(layout.title).toBe("text");
    expect(layout.titleRoomPx).toBe(Number.POSITIVE_INFINITY);
    expect(layout.fits).toBe(true);
  });

  it("keeps the wide layout in landscape (844 px)", () => {
    const layout = planHeader(LANDSCAPE, fullControls({ clipSlot: true }));
    expect(layout).toMatchObject({
      compactGap: false,
      title: "text",
      leaderboard: "header",
      restart: "header",
      fullscreen: "header",
      signInLabel: true,
      fits: true,
    });
  });
});

describe("resolveHeaderEmoji", () => {
  it("uses the emoji prop first", () => {
    expect(
      resolveHeaderEmoji(GAME_METADATA, { emoji: "🚚", appId: "snake", gameName: "Snake" })
    ).toBe("🚚");
  });

  it("uses the appId metadata next", () => {
    expect(resolveHeaderEmoji(GAME_METADATA, { appId: "snake", gameName: "Anything" })).toBe(
      GAME_METADATA.snake.icon
    );
  });

  it("uses the route's folder name before any name matching", () => {
    // The weather route passes no appId and says "Weather Buddy", which
    // matches no metadata name; its folder name is its metadata id.
    expect(
      resolveHeaderEmoji(GAME_METADATA, { routeId: "weather", gameName: "Weather Buddy" })
    ).toBe(GAME_METADATA.weather.icon);
    // The appId still wins over the route.
    expect(
      resolveHeaderEmoji(GAME_METADATA, { appId: "snake", routeId: "weather", gameName: "x" })
    ).toBe(GAME_METADATA.snake.icon);
  });

  it("matches a route with no appId by its display name", () => {
    expect(resolveHeaderEmoji(GAME_METADATA, { gameName: "Retro Arcade" })).toBe(
      GAME_METADATA["retro-arcade"].icon
    );
  });

  it("matches a route with no appId by its name as an id", () => {
    // The joke app's metadata name is "Jokes", its route says "Joke Generator".
    expect(resolveHeaderEmoji(GAME_METADATA, { gameName: "Joke Generator" })).toBe(
      GAME_METADATA["joke-generator"].icon
    );
  });

  it("returns null when nothing matches, so the text title stays", () => {
    expect(resolveHeaderEmoji(GAME_METADATA, { gameName: "Mystery Page" })).toBeNull();
  });

  it("ignores inherited object keys", () => {
    expect(
      resolveHeaderEmoji(GAME_METADATA, {
        appId: "constructor",
        routeId: "toString",
        gameName: "constructor",
      })
    ).toBeNull();
  });
});

describe("routeIdFromPath", () => {
  it.each([
    ["/games/snake", "snake"],
    ["/games/snake/", "snake"],
    ["/apps/weather", "weather"],
    ["/games/four-wheeler-3d?x=1", "four-wheeler-3d"],
  ])("reads %s as %s", (path, id) => {
    expect(routeIdFromPath(path)).toBe(id);
  });

  it.each([["/"], ["/profile"], ["/leaderboards/snake"], [""], [null], [undefined]])(
    "reads %s as no id",
    (path) => {
      expect(routeIdFromPath(path)).toBeNull();
    }
  );
});
