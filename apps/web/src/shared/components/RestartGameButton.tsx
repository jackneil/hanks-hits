"use client";

interface RestartGameButtonProps {
  onClick: () => void;
  className?: string;
  ref?: React.Ref<HTMLButtonElement>;
  /**
   * "header": the white glyph for the dark GameShell header. The glyph is
   * text, not a color emoji, so it needs its own color: without one it
   * took the dark page text color and almost disappeared on the header.
   * "menu": the glyph and a "Restart" label, for a menu button that
   * passes its own button classes.
   */
  variant?: "header" | "menu";
}

export function RestartGameButton({
  onClick,
  className = "",
  ref,
  variant = "header",
}: RestartGameButtonProps) {
  if (variant === "menu") {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        className={className}
        aria-label="Restart game"
        title="Restart game"
      >
        <span className="text-2xl" aria-hidden="true">
          ↻
        </span>
        Restart
      </button>
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={`min-w-[44px] min-h-[44px] flex items-center justify-center text-2xl text-white hover:scale-110 transition-transform active:scale-95 ${className}`}
      aria-label="Restart game"
      title="Restart game"
    >
      ↻
    </button>
  );
}
