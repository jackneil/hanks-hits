import { describe, it, expect, vi } from 'vitest';
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

  // Proves the brand binding is LIVE — not a coincidence of the default name.
  // Swap the config for a sentinel and confirm it actually renders. This fails
  // if someone hardcodes the name back into HomeClient instead of using SITE.
  it('renders the name from the config binding (rebrand actually works)', async () => {
    vi.resetModules();
    vi.doMock('@/config/site', () => ({
      SITE: {
        name: 'Zzyzx Test Brand',
        owner: 'Zog',
        tagline: 'Zog tagline',
        description: 'sentinel description',
        emoji: '🧪',
      },
    }));
    try {
      const { default: HomeFresh } = await import('../app/page');
      const ui = await HomeFresh();
      render(<SessionProvider session={null}>{ui}</SessionProvider>);
      const h1s = screen.getAllByRole('heading', { level: 1 });
      expect(h1s.some((h) => h.textContent?.includes('Zzyzx Test Brand'))).toBe(true);
    } finally {
      vi.doUnmock('@/config/site');
      vi.resetModules();
    }
  });
});
