"use client";

import { GameNoticeOverlay, GameStartOverlayButton } from "@/shared/components/GameStartOverlay";
import { CONTENT_NOTICE_TEXT } from "../lib/contentNotice";

/**
 * The heads-up card for a mainstream violent classic (Jack, 2026-10-02).
 *
 * It shows before the emulator loads, each time a player opens such a
 * title. It has the look of the site's start card (GameNoticeOverlay), so
 * it is calm, has the "Read it to me" button, and fits a phone with no
 * scroll. The two buttons have the same size and the same look: the card
 * does not push the player toward either one. It holds no trophy card and
 * no install tip (they wait for the next break). On a keyboard, focus goes
 * to Play, Tab stays in the card, and Escape is "Pick another game".
 */
export function ContentNoticeCard({
  onPlay,
  onPickAnother,
}: {
  /** Starts the game. */
  onPlay: () => void;
  /** Closes the card. The game does not start. */
  onPickAnother: () => void;
}) {
  return (
    <GameNoticeOverlay
      title={CONTENT_NOTICE_TEXT.heading}
      subtitle={CONTENT_NOTICE_TEXT.body}
      hints={[CONTENT_NOTICE_TEXT.advice]}
      spokenStart={CONTENT_NOTICE_TEXT.spokenChoices}
      onDismiss={onPickAnother}
    >
      <GameStartOverlayButton onClick={onPlay}>{CONTENT_NOTICE_TEXT.play}</GameStartOverlayButton>
      <GameStartOverlayButton onClick={onPickAnother}>{CONTENT_NOTICE_TEXT.pickAnother}</GameStartOverlayButton>
    </GameNoticeOverlay>
  );
}
