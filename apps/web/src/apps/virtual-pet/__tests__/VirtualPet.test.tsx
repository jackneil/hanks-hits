import { toSpeakable } from "@/shared/hooks/useReadAloud";
import { fireEvent, render, screen } from "@testing-library/react";
import { VIRTUAL_PET_INSTRUCTIONS } from "../lib/readAloud";
import {
  installSpeechMock,
  removeSpeechMock,
} from "@/__tests__/speech-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualPet } from "../VirtualPet";
import {
  useVirtualPetStore,
  type VirtualPetProgress,
} from "../lib/store";

vi.mock("@/shared/hooks/useAuthSync", () => ({
  useAuthSync: vi.fn(),
}));

vi.mock("@/shared/components/FullscreenButton", () => ({
  FullscreenButton: () => null,
}));

vi.mock("@/shared/components/IOSInstallPrompt", () => ({
  IOSInstallPrompt: () => null,
}));

function createProgress(overrides: Partial<VirtualPetProgress> = {}): VirtualPetProgress {
  const now = new Date().toISOString();
  const base: VirtualPetProgress = {
    pet: {
      name: "Blobby",
      speciesId: "blobby",
      hunger: 80,
      happiness: 40,
      energy: 100,
      cleanliness: 100,
      sleeping: false,
      bornAt: now,
      lastChecked: now,
    },
    coins: 50,
    inventory: [{ itemId: "ball", quantity: 1 }],
    unlockedSpecies: ["blobby"],
    equippedCosmetics: [],
    stats: {
      daysCaredFor: 0,
      totalFeedings: 0,
      totalPlaySessions: 0,
      longestStreak: 0,
      currentStreak: 0,
      lastPlayDate: new Date().toDateString(),
    },
    settings: {
      soundEnabled: false,
      petName: "Blobby",
    },
    lastModified: Date.now(),
  };

  return {
    ...base,
    ...overrides,
    pet: {
      ...base.pet,
      ...overrides.pet,
    },
    stats: {
      ...base.stats,
      ...overrides.stats,
    },
    settings: {
      ...base.settings,
      ...overrides.settings,
    },
  };
}

function resetStore(progress = createProgress()) {
  localStorage.clear();
  useVirtualPetStore.setState({
    showShop: false,
    showStats: false,
    isPlaying: false,
    miniGameScore: 0,
    progress,
  });
}

describe("VirtualPet", () => {
  beforeEach(() => {
    resetStore();
  });

  it("uses toy inventory to apply happiness effects", () => {
    useVirtualPetStore.getState().useToy("ball");

    const state = useVirtualPetStore.getState();
    expect(state.progress.pet.happiness).toBe(70);
    expect(state.progress.inventory).toEqual([]);
    expect(state.progress.stats.totalPlaySessions).toBe(1);
  });

  it("exposes toy use through the main action grid", () => {
    render(<VirtualPet />);

    expect(screen.getByText("40%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Toy/ }));

    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(useVirtualPetStore.getState().progress.inventory).toEqual([]);
  });
});

describe("virtual pet read aloud", () => {
  afterEach(() => {
    removeSpeechMock();
  });

  it("shows the read-aloud button when the browser can speak", async () => {
    installSpeechMock();
    render(<VirtualPet />);

    expect(await screen.findByTestId("read-aloud-button")).toBeInTheDocument();
  });

  it("speaks the virtual pet instructions when tapped", async () => {
    const speech = installSpeechMock();
    render(<VirtualPet />);

    fireEvent.click(await screen.findByTestId("read-aloud-button"));

    expect(speech.speak).toHaveBeenCalledTimes(1);
    expect(speech.lastUtterance().text).toBe(toSpeakable(VIRTUAL_PET_INSTRUCTIONS));
  });

  it("hides the button when the browser cannot speak", () => {
    removeSpeechMock();
    render(<VirtualPet />);

    expect(screen.queryByTestId("read-aloud-button")).not.toBeInTheDocument();
  });
});
