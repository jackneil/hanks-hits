"use client";

import { useState } from "react";
import { useDrawingStore } from "../lib/store";
import { BASIC_COLORS, EXTENDED_COLORS } from "../lib/constants";

/**
 * ColorPicker Component - Color selection
 * Basic palette + full color picker
 */
export function ColorPicker() {
  const { color, setColor } = useDrawingStore();
  const [showExtended, setShowExtended] = useState(false);
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  return (
    <div className="p-2 bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Basic color palette */}
        {BASIC_COLORS.map((c) => (
          <button
            key={c.hex}
            onClick={() => setColor(c.hex)}
            className={`
              w-11 h-11 md:w-12 md:h-12 rounded-full transition-all touch-manipulation
              ${
                color === c.hex
                  ? "ring-4 ring-blue-500 ring-offset-2 scale-110"
                  : "hover:scale-105"
              }
              ${c.hex === "#FFFFFF" ? "border-2 border-gray-300" : ""}
            `}
            style={{ backgroundColor: c.hex }}
            aria-label={c.name}
            title={c.name}
          />
        ))}

        {/* More colors button */}
        <button
          onClick={() => setShowExtended(!showExtended)}
          className={`
            w-11 h-11 md:w-12 md:h-12 rounded-full flex items-center justify-center
            bg-gradient-to-br from-red-400 via-yellow-400 to-blue-400
            text-white font-bold text-xl
            transition-all touch-manipulation hover:scale-105
            ${showExtended ? "ring-4 ring-blue-500 ring-offset-2" : ""}
          `}
          aria-label="More colors"
          title="More colors"
        >
          +
        </button>

        {/* Custom color picker button */}
        <div className="relative">
          <button
            onClick={() => setShowCustomPicker(!showCustomPicker)}
            className="w-11 h-11 md:w-12 md:h-12 rounded-full flex items-center justify-center bg-gray-100 hover:bg-gray-200 transition-all touch-manipulation text-2xl"
            aria-label="Custom color"
            title="Pick any color"
          >
            {"\uD83C\uDFA8"}
          </button>
          {showCustomPicker && (
            <div className="absolute bottom-full left-0 mb-2 p-2 bg-white rounded-xl shadow-xl z-50">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-20 h-20 cursor-pointer border-0 rounded-lg"
              />
              <button
                onClick={() => setShowCustomPicker(false)}
                className="w-full mt-2 py-1 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                Done
              </button>
            </div>
          )}
        </div>

        {/* Current color preview */}
        <div
          className="w-11 h-11 md:w-12 md:h-12 rounded-full shadow-inner border-2 border-gray-200"
          style={{ backgroundColor: color }}
          aria-label={`Current color: ${color}`}
        />
      </div>

      {/* Extended colors */}
      {showExtended && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex flex-wrap gap-2">
            {EXTENDED_COLORS.map((hex) => (
              <button
                key={hex}
                onClick={() => {
                  setColor(hex);
                  setShowExtended(false);
                }}
                className={`
                  w-11 h-11 md:w-12 md:h-12 rounded-full transition-all touch-manipulation
                  ${
                    color === hex
                      ? "ring-4 ring-blue-500 ring-offset-2 scale-110"
                      : "hover:scale-105"
                  }
                  ${hex === "#FFFFFF" ? "border border-gray-300" : ""}
                `}
                style={{ backgroundColor: hex }}
                aria-label={hex}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
