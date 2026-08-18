"use client";

interface RestartGameButtonProps {
  onClick: () => void;
  className?: string;
  ref?: React.Ref<HTMLButtonElement>;
}

export function RestartGameButton({ onClick, className = "", ref }: RestartGameButtonProps) {
  return (
    <button
      ref={ref}
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
