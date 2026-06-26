import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionProvider } from 'next-auth/react';
import Home from '../app/page';

// Home is an async server component: it discovers games/apps from the filesystem
// (discoverGamesAndApps) and renders them via HomeClient as a dynamic grid.
// The Header renders a LoginButton that calls useSession(), so the tree must be
// wrapped in a SessionProvider. These tests assert the stable shell + that the
// discovery actually surfaces playable games, rather than brittle per-game copy.
async function renderHome() {
  const ui = await Home();
  return render(<SessionProvider session={null}>{ui}</SessionProvider>);
}

describe('Home Page', () => {
  it("renders the Hank's Hits title", async () => {
    await renderHome();
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s.some((h) => h.textContent?.includes("Hank's Hits"))).toBe(true);
  });

  it('renders the tagline', async () => {
    await renderHome();
    expect(
      screen.getByText(/Games, apps, and awesome stuff/i)
    ).toBeInTheDocument();
  });

  it('discovers and links at least one game', async () => {
    await renderHome();
    const gameLinks = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('/games/'));
    expect(gameLinks.length).toBeGreaterThan(0);
  });
});
