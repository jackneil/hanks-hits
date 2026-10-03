import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicClipViewer } from "../PublicClipViewer";
import { SharedRuns } from "../SharedRuns";
import { publishSessionUser, resetSessionBusForTests } from "../../service/registry";
beforeEach(() => {
  resetSessionBusForTests(); publishSessionUser(null);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});
afterEach(() => { cleanup(); resetSessionBusForTests(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("public viewing and privacy controls", () => {
  it("refreshes the route URL after a playback failure", () => {
    render(<PublicClipViewer id="video-id" onClose={() => {}} />);
    const video = screen.getByLabelText("Shared gameplay video");
    fireEvent.error(video);
    fireEvent.click(screen.getByRole("button", { name: "Try loading video again" }));
    expect(screen.getByLabelText("Shared gameplay video")).toHaveAttribute("src", expect.stringMatching(/^\/api\/leaderboard-clips\/video-id\/video\?retry=1&session=\d+$/));
  });
  it("hides playback immediately on reporting, and confirms server acceptance", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    const hidden = vi.fn();
    render(<PublicClipViewer id="video-id" onClose={() => {}} onHidden={hidden} />);
    fireEvent.click(screen.getByRole("button", { name: "Report and hide this video" }));
    expect(screen.queryByLabelText("Shared gameplay video")).not.toBeInTheDocument();
    await act(async () => { finish(new Response(JSON.stringify({ hidden: true }))); });
    expect(hidden).toHaveBeenCalledWith("video-id");
  });
  it("allows owner removal while public sharing is off and supplies the expected owner", async () => {
    publishSessionUser("owner-a");
    const mockFetch = vi.fn(async (_url: unknown, init?: RequestInit) => new Response(JSON.stringify(init?.method === "DELETE" ? { deleted: true } : {
      enabled: false, runs: [], myClip: { clipStatus: "hidden", clip: { id: "hidden-video" } },
    })));
    vi.stubGlobal("fetch", mockFetch);
    render(<SharedRuns appId="retro-arcade" />);
    fireEvent.click(await screen.findByRole("button", { name: "Take my video off" }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith("/api/leaderboard-clips/hidden-video", expect.objectContaining({ method: "DELETE", headers: { "x-hh-expected-owner": "owner-a" } })));
    expect(await screen.findByText("Your video is off the site.")).toBeInTheDocument();
  });
  it.each([false, true])("discards owner-private buffered media and reauthorizes after an account change (batched A-B-A: %s)", (roundtrip) => {
    publishSessionUser("a");
    render(<PublicClipViewer id="private-video" canRemove onClose={() => {}} />);
    const original = screen.getByLabelText("Shared gameplay video") as HTMLVideoElement;
    const originalSrc = original.getAttribute("src");
    fireEvent.error(original);
    act(() => {
      publishSessionUser("b");
      // The subscriber clears buffered media synchronously, before React can render the new account.
      expect(original.hidden).toBe(true);
      expect(original.hasAttribute("src")).toBe(false);
      expect(original.hasAttribute("poster")).toBe(false);
      if (roundtrip) publishSessionUser("a");
    });
    const next = screen.getByLabelText("Shared gameplay video") as HTMLVideoElement;
    expect(next).not.toBe(original);
    expect(next.hidden).toBe(false);
    expect(next.getAttribute("src")).not.toBe(originalSrc);
    expect(next.getAttribute("src")).toMatch(/^\/api\/leaderboard-clips\/private-video\/video\?/);
    expect(original.pause).toHaveBeenCalled(); expect(original.load).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Try loading video again" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Take my video off" })).not.toBeInTheDocument();
  });
  it("aborts and ignores the old account's late action without preserving its busy or hidden state", async () => {
    publishSessionUser("a");
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    const hidden = vi.fn();
    render(<PublicClipViewer id="private-video" canRemove onClose={() => {}} onHidden={hidden} />);
    fireEvent.click(screen.getByRole("button", { name: "Report and hide this video" }));
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    act(() => { publishSessionUser("b"); publishSessionUser("a"); });
    expect(signal?.aborted).toBe(true);
    expect(screen.getByLabelText("Shared gameplay video")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report and hide this video" })).toBeEnabled();
    await act(async () => finish(new Response(JSON.stringify({ hidden: true }))));
    expect(hidden).not.toHaveBeenCalled();
    expect(screen.queryByText("Thanks for telling us. This video is hidden.")).not.toBeInTheDocument();
  });
  it("retains freshly authorized media through Strict Mode effect replay", () => {
    publishSessionUser("a");
    render(<StrictMode><PublicClipViewer id="private-video" onClose={() => {}} /></StrictMode>);
    const video = screen.getByLabelText("Shared gameplay video") as HTMLVideoElement;
    expect(video.hidden).toBe(false); expect(video).toHaveAttribute("src");
  });

});
