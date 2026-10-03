import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useShellOverlays } from "@/shared/lib/shellOverlays";
import { ShareGameplayButton } from "../ShareGameplayButton";
import { MENU_COPY } from "../copy";
import { renderWithClips } from "./renderClips";

describe("named sharing in continuous games", () => {
  it("opens immediately using the universal shell hold without waiting for a nonexistent run end", () => {
    const before = useShellOverlays.getState().count;
    const { fake, unmount } = renderWithClips(<ShareGameplayButton />, {
      snapshot: { gameCanPause: false, atBreak: false }, host: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Share gameplay" }));
    expect(screen.getByRole("dialog", { name: MENU_COPY.title })).toBeInTheDocument();
    expect(useShellOverlays.getState().count).toBe(before + 1);
    expect(fake.service.clipLast).not.toHaveBeenCalled();
    expect(fake.service.endPress).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ cancelled: true }));
    fireEvent.click(screen.getByRole("button", { name: MENU_COPY.back }));
    expect(useShellOverlays.getState().count).toBe(before);
    unmount();
  });
});
