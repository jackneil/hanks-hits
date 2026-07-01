"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Leaderboard } from "./Leaderboard";

interface LeaderboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  appId: string;
  gameName: string;
  icon?: string;
}

export function LeaderboardModal({
  isOpen,
  onClose,
  appId,
  gameName,
  icon = "🏆",
}: LeaderboardModalProps) {
  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="leaderboard-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative bg-slate-900 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden shadow-2xl border border-slate-700 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 id="leaderboard-title" className="text-xl font-bold flex items-center gap-2">
            <span aria-hidden="true">{icon}</span>
            <span>Leaderboard</span>
          </h2>
          <button
            onClick={onClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-2xl text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            aria-label="Close leaderboard"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden p-4">
          <Leaderboard
            appId={appId}
            gameName={gameName}
            icon={icon}
            showPeriodSelector={true}
            compact={true}
            className="h-full"
          />
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700 flex justify-center">
          <button
            onClick={onClose}
            className="btn btn-primary btn-lg min-w-[150px]"
          >
            Keep Playing
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;

  return createPortal(modal, document.body);
}
