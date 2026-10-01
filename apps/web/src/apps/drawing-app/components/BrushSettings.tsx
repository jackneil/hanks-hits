"use client";

import { useDrawingStore } from "../lib/store";
import { MIN_BRUSH_SIZE, MAX_BRUSH_SIZE, SIZE_PRESETS } from "../lib/constants";

/**
 * BrushSettings Component - Size slider and presets
 * Kid-friendly with preset buttons
 */
export function BrushSettings() {
  const { brushSize, setBrushSize, color, tool } = useDrawingStore();

  const presets = [
    { name: "Tiny", size: SIZE_PRESETS.small, icon: "\u2022" },
    { name: "Small", size: SIZE_PRESETS.medium, icon: "\u25CF" },
    { name: "Big", size: SIZE_PRESETS.large, icon: "\u2B24" },
    { name: "Huge", size: SIZE_PRESETS.huge, icon: "\u2B24" },
  ];

  // Preview color (use eraser color for eraser tool)
  const previewColor = tool === "eraser" ? "#E5E7EB" : color;

  return (
    <div className="p-3 bg-white/90 rounded-2xl shadow-lg">
      {/* Size label */}
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-gray-600">Brush Size</span>
        <span className="text-sm font-bold text-blue-600">{brushSize}px</span>
      </div>

      {/* Size slider */}
      <div className="flex items-center gap-3 mb-3">
        {/* Min indicator */}
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: previewColor }}
        />

        {/* Slider */}
        <input
          type="range"
          min={MIN_BRUSH_SIZE}
          max={MAX_BRUSH_SIZE}
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          className="flex-1 h-3 bg-gray-200 rounded-full appearance-none cursor-pointer accent-blue-500"
          style={{
            background: `linear-gradient(to right, #3B82F6 0%, #3B82F6 ${
              ((brushSize - MIN_BRUSH_SIZE) / (MAX_BRUSH_SIZE - MIN_BRUSH_SIZE)) * 100
            }%, #E5E7EB ${
              ((brushSize - MIN_BRUSH_SIZE) / (MAX_BRUSH_SIZE - MIN_BRUSH_SIZE)) * 100
            }%, #E5E7EB 100%)`,
          }}
        />

        {/* Max indicator */}
        <div
          className="w-6 h-6 rounded-full flex-shrink-0"
          style={{ backgroundColor: previewColor }}
        />
      </div>

      {/* Preset buttons */}
      <div className="flex gap-2 justify-between">
        {presets.map((preset) => (
          <button
            key={preset.name}
            onClick={() => setBrushSize(preset.size)}
            className={`
              flex-1 py-2 px-1 rounded-xl flex flex-col items-center
              transition-all touch-manipulation
              ${
                brushSize === preset.size
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 hover:bg-gray-200 text-gray-700"
              }
            `}
          >
            <span
              className="mb-1"
              style={{
                fontSize:
                  preset.size <= 4
                    ? "10px"
                    : preset.size <= 12
                    ? "14px"
                    : preset.size <= 24
                    ? "20px"
                    : "28px",
              }}
            >
              {preset.icon}
            </span>
            <span className="text-sm font-medium">{preset.name}</span>
          </button>
        ))}
      </div>

      {/* Preview dot */}
      <div className="mt-3 flex justify-center">
        <div
          className="rounded-full border-2 border-gray-300 transition-all"
          style={{
            width: Math.min(brushSize, 50),
            height: Math.min(brushSize, 50),
            backgroundColor: previewColor,
          }}
        />
      </div>
    </div>
  );
}
