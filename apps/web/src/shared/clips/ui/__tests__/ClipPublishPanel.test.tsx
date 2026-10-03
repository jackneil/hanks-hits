import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ownerKeyFor } from "../../library/ownerKey";
import { publishSessionUser, resetSessionBusForTests } from "../../service/registry";
import { makeRecord } from "./fakeClipService";
import { PLACEHOLDER_POSTER } from "../../engine/io/poster";
import { ClipPublishPanel } from "../ClipPublishPanel";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), prepare: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/shared/clips", () => ({ prepareGuestPublish: mocks.prepare }));
vi.mock("../clipPublishing", async (original) => ({ ...await original<typeof import("../clipPublishing")>(), uploadClip: mocks.upload }));
const file = new File(["video"], "run.mp4", { type: "video/mp4" });
beforeEach(() => {
  resetSessionBusForTests(); mocks.upload.mockReset(); mocks.prepare.mockReset(); mocks.push.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.startsWith("data:")) throw new TypeError("Blocked by connect-src CSP");
    return new Response(JSON.stringify({ enabled: true }));
  }));
});
afterEach(() => { resetSessionBusForTests(); vi.unstubAllGlobals(); });
describe("explicit publish confirmation", () => {
  it("never uploads a guest preview and offers sign-in continuation", async () => {
    publishSessionUser(null);
    render(<ClipPublishPanel record={makeRecord()} file={file} />);
    expect(await screen.findByRole("button", { name: "Sign in to publish this video" })).toBeEnabled();
    expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("keeps the selected guest clip before leaving for login and still never uploads", async () => {
    publishSessionUser(null); mocks.prepare.mockResolvedValue(undefined);
    const record = makeRecord();
    render(<ClipPublishPanel record={record} file={file} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in to publish this video" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(expect.stringMatching(/^\/login\?returnTo=/)));
    expect(mocks.prepare).toHaveBeenCalledWith(record.id);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("retries the same prepared video after a failed upload without auto-publishing", async () => {
    publishSessionUser("a");
    const record = makeRecord({ ownerKey: await ownerKeyFor("a") });
    mocks.upload.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ clip: { id: "public-id" }, publicListing: true });
    render(<ClipPublishPanel record={record} file={file} />);
    fireEvent.click(await screen.findByRole("button", { name: "Publish video" }));
    fireEvent.click(await screen.findByRole("button", { name: "Try publishing again" }));
    expect(await screen.findByRole("link", { name: "Watch my video" })).toHaveAttribute("href", "/clips/public-id?game=snake");
    expect(mocks.upload).toHaveBeenCalledTimes(2);
    expect(mocks.upload.mock.calls[0][1]).toBe(file); expect(mocks.upload.mock.calls[1][1]).toBe(file);
  });
  it("refuses a stale account's clip even after a new account has signed in", async () => {
    publishSessionUser("b");
    render(<ClipPublishPanel record={makeRecord({ ownerKey: await ownerKeyFor("a") })} file={file} />);
    fireEvent.click(await screen.findByRole("button", { name: "Publish video" }));
    expect(await screen.findByText(/The signed-in player changed/)).toBeInTheDocument();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it("publishes a real JPEG poster without a data: network request under the production CSP", async () => {
    publishSessionUser("a");
    mocks.upload.mockResolvedValue({ clip: { id: "public-id" }, publicListing: true });
    render(<ClipPublishPanel record={makeRecord({ ownerKey: await ownerKeyFor("a"), posterDataUrl: PLACEHOLDER_POSTER })} file={file} />);
    fireEvent.click(await screen.findByRole("button", { name: "Publish video" }));
    expect(await screen.findByRole("link", { name: "Watch my video" })).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).startsWith("data:"))).toBe(true);
    const poster = mocks.upload.mock.calls[0][2] as Blob;
    expect(poster.type).toBe("image/jpeg");
    const bytes = await new Promise<Uint8Array>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(poster);
    });
    expect([...bytes.slice(0, 2)]).toEqual([255, 216]);
    expect([...bytes.slice(-2)]).toEqual([255, 217]);
    expect(bytes.length).toBe(atob(PLACEHOLDER_POSTER.split(",")[1]).length);
  });
  it("does not send after the account switches before owner verification finishes", async () => {
    publishSessionUser("a");
    render(<ClipPublishPanel record={makeRecord({ ownerKey: await ownerKeyFor("a") })} file={file} />);
    const button = await screen.findByRole("button", { name: "Publish video" });
    await act(async () => { fireEvent.click(button); publishSessionUser("b"); });
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
