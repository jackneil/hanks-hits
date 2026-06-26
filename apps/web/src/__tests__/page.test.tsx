import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionProvider } from 'next-auth/react';
import Home from '../app/page';
import { SITE } from '../config/site';

// Home is an async server component: it discovers games/apps from the filesystem
// (discoverGamesAndApps) and renders them via HomeClient as a dynamic grid.
// The Header renders a LoginButton that calls useSession(), so the tree must be
// wrapped in a SessionProvider. Branding comes from src/config/site (site.json),
// so these tests read SITE.* and survive a rebrand (e.g. "Jimmie's Hits").
async function renderHome() {
  const ui = await Home();
  return render(<SessionProvider session={null}>{ui}</SessionProvider>);
}

describe('Home Page', () => {
  it('renders the site name', async () => {
    await renderHome();
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s.some((h) => h.textContent?.includes(SITE.name))).toBe(true);
  });

  it('renders the tagline', async () => {
    await renderHome();
    expect(screen.getByText(SITE.tagline)).toBeInTheDocument();
  });

  it('discovers and links at least one game', async () => {
    await renderHome();
    const gameLinks = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('/games/'));
    expect(gameLinks.length).toBeGreaterThan(0);
  });
});
