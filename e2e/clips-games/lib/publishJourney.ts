/** Optional real local account -> captured upload -> signed-out feed/watch journey. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type Browser, type Locator, type Page } from "playwright/test";
import { Finger } from "../../phone/touch";

export const PUBLISH = process.env.E2E_PUBLISH === "1";

function localOnly(baseURL: string) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname)) {
    throw new Error("E2E_PUBLISH writes real uploads and is restricted to the isolated local app");
  }
}

export async function signInForPublishing(page: Page, finger: Finger, baseURL: string, route: string) {
  localOnly(baseURL);
  await page.goto(`/login?returnTo=${encodeURIComponent(route)}`);
  // Scope to the one intended email/password form. Never submit a generic form.
  const form = page.locator("form").filter({ has: page.locator('input[type="email"]') });
  await expect(form).toHaveCount(1);
  const gameId = route.split("/").filter(Boolean).at(-1)!;
  const email = (process.env.E2E_PUBLISH_EMAIL ?? "all-games-video@example.test").replace("{game}", gameId);
  await form.locator('input[type="email"]').fill(email);
  await form.locator('input[type="password"]').fill(process.env.E2E_PUBLISH_PASSWORD ?? "ClipTest-2026-local-only");
  await finger.tap(form.getByRole("button", { name: "Sign In", exact: true }));
  await expect(page).toHaveURL(new URL(route, baseURL).href);
}

async function playByTouch(video: Locator, finger: Finger) {
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => Number.isFinite(v.duration) && v.duration >= 1 && v.readyState >= 2), { timeout: 30_000 }).toBe(true);
  await video.scrollIntoViewIfNeeded();
  const box = await video.boundingBox();
  if (!box) throw new Error("Public video has no visible player");
  let played = false;
  for (let attempt = 0; attempt < 2 && !played; attempt++) {
    const at: [number, number] = [box.x + 24, box.y + box.height - 48];
    expect(await video.evaluate((v, [x, y]) => document.elementFromPoint(x, y) === v, at), "native play control is not covered").toBe(true);
    await finger.tapAt(...at);
    played = await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && v.currentTime > 0), { timeout: 2000 }).toBe(true).then(() => true, () => false);
  }
  expect(played, "a signed-out viewer must start playback using the native touch control").toBe(true);
  const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 3000 }).toBeGreaterThan(before + .25);
  expect(await video.evaluate((v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(1);
  expect(await video.evaluate((v: HTMLVideoElement) => v.error?.code ?? null)).toBeNull();
}

export async function publishAndWatch(args: { browser: Browser; page: Page; finger: Finger; viewer: Locator; baseURL: string; game: { id: string; name: string; route: string }; file: string }): Promise<string> {
  const { browser, finger, viewer, baseURL, game, file } = args;
  localOnly(baseURL);
  const publish = viewer.getByRole("region", { name: "Publish gameplay" });
  await expect(publish.getByRole("button", { name: "Publish video", exact: true })).toBeEnabled({ timeout: 30_000 });
  await finger.tap(publish.getByRole("button", { name: "Publish video", exact: true }));
  const watch = publish.getByRole("link", { name: /^Watch my (shared )?video$/ });
  await expect(watch).toBeVisible({ timeout: 120_000 });
  const href = await watch.getAttribute("href");
  if (!href) throw new Error("Publish succeeded without a public watch link");
  const publicURL = new URL(href, baseURL);
  expect(publicURL.origin).toBe(new URL(baseURL).origin);
  const id = publicURL.pathname.split("/").at(-1)!;

  // A fresh context shares neither the player's session nor the local clip library.
  const guest = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, hasTouch: true });
  try {
    const guestPage = await guest.newPage();
    const cdp = await guest.newCDPSession(guestPage);
    const guestFinger = new Finger(guestPage, (type, touchPoints) => cdp.send("Input.dispatchTouchEvent", { type: type as "touchStart", touchPoints }));
    await guestPage.goto(game.route);
    const leaderboard = guestPage.getByTestId("game-share-bar").getByRole("button", { name: `View ${game.name} leaderboard`, exact: true });
    await expect(leaderboard).toHaveCount(1);
    await expect(leaderboard).toBeVisible();
    // Attach both rejection handlers immediately: if a touch fails, closing the
    // guest context must not leave an unhandled waitForResponse rejection.
    const [feed] = await Promise.all([
      guestPage.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === "/api/leaderboard-clips" && url.searchParams.get("appId") === game.id && response.request().method() === "GET";
      }),
      guestFinger.tap(leaderboard),
    ]);
    expect(feed.ok(), "signed-out shared runs feed loads").toBe(true);
    const data = await feed.json() as { runs: Array<{ handle: string; clip: { id: string } }> };
    const published = data.runs.find((run) => run.clip.id === id);
    expect(published, "the actual new upload is discoverable, not merely an old video from this account").toBeDefined();
    await guestFinger.tap(guestPage.getByRole("region", { name: "Shared runs" }).getByRole("button", { name: `Watch ${published!.handle}'s shared run`, exact: true }));
    const video = guestPage.getByLabel("Shared gameplay video", { exact: true });
    await expect(video).toHaveAttribute("src", new RegExp(`/api/leaderboard-clips/${id}/video`));
    await playByTouch(video, guestFinger);

    // Prove the public bytes are exactly the real file already decoded by this test.
    const mediaURL = await video.getAttribute("src");
    const response = await guest.request.get(new URL(mediaURL!, baseURL).href);
    expect(response.ok(), "the public authorized media route serves the uploaded file").toBe(true);
    const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    expect(sha(await response.body())).toBe(sha(readFileSync(file)));

    await guestPage.goto(publicURL.href);
    await playByTouch(guestPage.getByLabel("Shared gameplay video", { exact: true }), guestFinger);
    return `${game.id}: published ${id}; signed-out feed and direct watch play the identical captured MP4`;
  } finally { await guest.close(); }
}
