import { beforeEach, describe, expect, it } from "vitest";
import {
  useDrawingStore,
  type DrawingAppProgress,
  type SavedArtwork,
} from "../lib/store";
import { validateProgress } from "@/lib/progress-schemas";

const artwork: SavedArtwork = {
  id: "art-1",
  name: "Rainbow",
  thumbnail: "data:image/png;base64,thumb",
  dataUrl: "data:image/png;base64,full",
  createdAt: "2026-06-27T12:00:00.000Z",
  editedAt: "2026-06-27T12:00:00.000Z",
};

function resetStore() {
  localStorage.clear();
  useDrawingStore.setState({
    savedArtworks: [],
    stats: {
      artworksCreated: 0,
      totalDrawTime: 0,
    },
    lastModified: Date.now(),
  });
}

describe("Drawing app progress sync", () => {
  beforeEach(() => {
    resetStore();
  });

  it("includes saved artworks in synced progress", () => {
    useDrawingStore.setState({ savedArtworks: [artwork] });

    const progress = useDrawingStore.getState().getProgress();

    expect(progress.savedArtworks).toEqual([artwork]);
    expect(validateProgress("drawing-app", progress).success).toBe(true);
  });

  it("restores saved artworks from synced progress", () => {
    const progress: DrawingAppProgress = {
      ...useDrawingStore.getState().getProgress(),
      savedArtworks: [artwork],
    };

    useDrawingStore.getState().setProgress(progress);

    expect(useDrawingStore.getState().savedArtworks).toEqual([artwork]);
  });

  it("preserves local artworks when old synced progress has no artwork field", () => {
    useDrawingStore.setState({ savedArtworks: [artwork] });
    const { savedArtworks, ...legacyProgress } =
      useDrawingStore.getState().getProgress();

    useDrawingStore
      .getState()
      .setProgress(legacyProgress as DrawingAppProgress);

    expect(savedArtworks).toEqual([artwork]);
    expect(useDrawingStore.getState().savedArtworks).toEqual([artwork]);
  });
});
