import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameUI } from '../GameUI';
import { useGameStore, type Challenge } from '../../lib/store';

const defaultChallenges: Challenge[] = [
  { id: 'collect-10-stars', name: 'Star Collector', description: 'Collect 10 stars', type: 'collection', target: 10, reward: 300, completed: false },
  { id: 'airtime-10', name: 'Hang Time', description: 'Get 10 seconds of airtime', type: 'stunt', target: 10, reward: 500, completed: false },
  { id: 'smash-20', name: 'Demolition Derby', description: 'Smash 20 objects', type: 'destruction', target: 20, reward: 350, completed: false },
  { id: 'collect-500', name: 'Coin Hunter', description: 'Collect 500 coins', type: 'collection', target: 500, reward: 400, completed: false },
  { id: 'flip-5', name: 'Flipmaster', description: 'Do 5 flips', type: 'stunt', target: 5, reward: 600, completed: false },
];

describe('GameUI challenges', () => {
  beforeEach(() => {
    useGameStore.setState({
      coins: 0,
      sessionCoins: 0,
      sessionAirtime: 0,
      sessionFlips: 0,
      sessionDestructions: 0,
      starsCollected: 0,
      challenges: defaultChallenges.map((challenge) => ({ ...challenge })),
      nosCharge: 100,
      nosMaxCharge: 100,
      showChallenges: false,
    });
  });

  it('opens and closes the challenges panel from the HUD', () => {
    render(
      <GameUI
        speed={0}
        isMobile={false}
        onPause={vi.fn()}
        onOpenGarage={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Challenges/ }));

    expect(
      screen.getByRole('heading', { name: /Challenges/ })
    ).toBeInTheDocument();
    expect(screen.getByText('Star Collector')).toBeInTheDocument();
    expect(screen.getAllByText('0/10').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Close challenges' }));

    expect(screen.queryByText('Star Collector')).not.toBeInTheDocument();
  });
});
