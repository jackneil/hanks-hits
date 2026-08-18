import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PauseMenu } from "../PauseMenu";

describe("PauseMenu restart", () => {
  it("shows restart and forwards a confirmed restart", async () => {
    const onRestart = vi.fn();
    render(
      <PauseMenu isOpen onResume={vi.fn()} onHome={vi.fn()} onRestart={onRestart} gameName="2048" />
    );

    fireEvent.click(screen.getByRole("button", { name: /restart game/i }));
    expect(await screen.findByRole("dialog", { name: /restart game/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm restart/i }));

    await waitFor(() => expect(onRestart).toHaveBeenCalledTimes(1));
  });
});
