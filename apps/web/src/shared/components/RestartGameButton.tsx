"use client";

interface RestartGameButtonProps {
  onClick: () => void;
  className?: string;
}

export function RestartGameButton({ onClick, className = "" }: RestartGameButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-w-[44px] min-h-[44px] flex items-center justify-center text-2xl hover:scale-110 transition-transform active:scale-95 ${className}`}
      aria-label="Restart game"
      title="Restart game"
    >
      ↻
    </button>
  );
}
